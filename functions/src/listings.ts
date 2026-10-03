import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { UNIVERSITY_ID, isDocId, jstDay } from './common.js';
import {
  BOOK_CONDITIONS, DAY_MS, HANDOFF_PLACES, LISTING_TYPES, MARKET, callerKey, displayNameFor, identityRef,
  intOrNull, isLive, listingRef, marketActorRef, millisOf, normalizeTitle, sanitizeLine, sanitizeText,
  type ListingType, type MarketCaller,
} from './marketCore.js';
import { refreshReputation } from './ratings.js';

/** The editable, validated part of a listing (everything a client may choose). */
export interface ListingFields {
  description: string;
  condition: string;
  price: number | null;
  listPrice: number | null;
  place: string;
}
export interface ListingDraft extends ListingFields {
  type: ListingType;
  title: string;
  courseId: string;
  photoPaths: string[];
}

const bad = (what: string) => new HttpsError('invalid-argument', `bad ${what}`);

function price(v: unknown, what: string, required: boolean): number | null {
  if (v === undefined || v === null) {
    if (required) throw bad(what);
    return null;
  }
  const n = intOrNull(v);
  if (n === null || n < 0 || n > MARKET.maxPrice) throw bad(what);
  return n;
}

/** Validation of the fields an owner may set at create AND later edit (T-3). */
export function parseListingFields(type: ListingType, input: Record<string, unknown>): ListingFields {
  const description = sanitizeText(input.description);
  if (description.length > MARKET.maxDescription) throw bad('description');
  const condition = typeof input.condition === 'string' ? input.condition : '';
  if (type === 'want') {
    if (condition !== '' && !(BOOK_CONDITIONS as readonly string[]).includes(condition)) throw bad('condition');
  } else if (!(BOOK_CONDITIONS as readonly string[]).includes(condition)) {
    throw bad('condition');
  }
  // 売る needs a price (>= 1); 譲る is free by definition; 買いたい may name a budget.
  let p = price(input.price, 'price', type === 'sell');
  if (type === 'sell' && (p === null || p < 1)) throw bad('price');
  if (type === 'give') {
    if (p !== null && p !== 0) throw bad('price');
    p = null;
  }
  const listPrice = price(input.listPrice, 'listPrice', false);
  const place = typeof input.place === 'string' ? input.place : '';
  if (!(HANDOFF_PLACES as readonly string[]).includes(place)) throw bad('place');
  return { description, condition, price: p, listPrice, place };
}

/** Whitelist + bounds for a new listing. Only these fields ever reach Firestore. */
export function parseListingDraft(input: Record<string, unknown>, uid: string): ListingDraft {
  const type = input?.type;
  if (typeof type !== 'string' || !(LISTING_TYPES as readonly string[]).includes(type)) throw bad('type');
  const title = sanitizeLine(input.title);
  if (title.length < 1 || title.length > MARKET.maxTitle) throw bad('title');
  const courseId = input.courseId === undefined || input.courseId === null || input.courseId === '' ? '' : input.courseId;
  if (courseId !== '' && !isDocId(courseId)) throw bad('course');
  const raw = input.photoPaths ?? [];
  const prefix = `listings/${uid}/`;
  if (!Array.isArray(raw) || raw.length > MARKET.maxPhotos || !raw.every((p) =>
    typeof p === 'string' && p.startsWith(prefix) && p.length > prefix.length && p.length <= 300 &&
    !p.slice(prefix.length).includes('/') && !p.includes('..'))) {
    throw bad('photos'); // only the caller's own flat objects (storage.rules writes the same shape)
  }
  return {
    type: type as ListingType,
    title,
    courseId: courseId as string,
    photoPaths: [...new Set(raw as string[])],
    ...parseListingFields(type as ListingType, input),
  };
}

/**
 * `createListing` (T-2..T-6). One transaction, reads first: the course (a
 * named course must exist; its name is copied, never trusted from the client),
 * the caller's profile (display name, sanitized) and their per-mailbox daily
 * counter. The listing id is server-generated and `ownerId` is the caller, so
 * no client can forge ownership or squat an id. Afterwards the caller's public
 * rating summary is refreshed (a re-signup with the same mailbox gets its
 * reputation back, T-12).
 */
export async function processCreateListing(
  db: Firestore, caller: MarketCaller, input: Record<string, unknown>, now: Date = new Date(),
): Promise<{ listingId: string }> {
  const draft = parseListingDraft(input ?? {}, caller.uid);
  const key = callerKey(caller);
  const day = jstDay(now);
  const ref = db.collection('textbook_listings').doc();
  await db.runTransaction(async (tx) => {
    const course = draft.courseId ? await tx.get(db.collection('courses').doc(draft.courseId)) : null;
    const profile = await tx.get(db.collection('users').doc(caller.uid));
    const actor = await tx.get(marketActorRef(db, key));
    if (course && !course.exists) throw bad('course');
    const used = actor.get('listingDay') === day ? Number(actor.get('listingsToday') ?? 0) : 0;
    if (used >= MARKET.listingDailyCap) throw new HttpsError('resource-exhausted', 'listing-limit');
    tx.create(ref, {
      id: ref.id,
      ...draft,
      titleNorm: normalizeTitle(draft.title),
      courseName: course ? sanitizeLine(course.get('name')).slice(0, 100) : '',
      ownerId: caller.uid,
      ownerName: displayNameFor(profile.get('displayName')),
      status: 'active',
      renewCount: 0,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromMillis(now.getTime() + MARKET.listingDays * DAY_MS),
      updatedAt: FieldValue.serverTimestamp(),
      university_id: UNIVERSITY_ID,
    });
    tx.set(marketActorRef(db, key), { listingDay: day, listingsToday: used + 1, university_id: UNIVERSITY_ID }, { merge: true });
    tx.set(identityRef(db, caller.uid), { key, updatedAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID }, { merge: true });
  });
  // Best-effort: the listing is committed; a failed recount must not make the
  // client retry and create a duplicate (the next market call recounts again).
  await refreshReputation(db, caller.uid, now).catch((e) => console.warn('refreshReputation failed', e));
  return { listingId: ref.id };
}

export type UpdateAction = 'edit' | 'renew' | 'close';

/**
 * `updateListing`: the owner edits the free fields, renews (only in the last
 * `renewWindowDays` or after expiry) or closes. Title, type, course, photos and
 * owner are immutable (a match notice must keep describing the same book). A
 * hidden listing cannot be touched by its owner (moderation decides).
 */
export async function processUpdateListing(
  db: Firestore, caller: MarketCaller, input: Record<string, unknown>, now: Date = new Date(),
): Promise<{ listingId: string; status: string; expiresAtMs: number }> {
  const id = input?.listingId;
  if (!isDocId(id)) throw bad('listing id');
  const action = input.action;
  if (action !== 'edit' && action !== 'renew' && action !== 'close') throw bad('action');
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(listingRef(db, id));
    if (!snap.exists) throw new HttpsError('not-found', 'listing not found');
    const d = snap.data() as DocumentData;
    if (d.ownerId !== caller.uid) throw new HttpsError('permission-denied', 'not-owner');
    if (d.status !== 'active') throw new HttpsError('failed-precondition', 'not-active');
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    let expiresAtMs = millisOf(d.expiresAt);
    if (action === 'close') {
      patch.status = 'closed';
    } else if (action === 'renew') {
      if (expiresAtMs - now.getTime() > MARKET.renewWindowDays * DAY_MS) throw new HttpsError('failed-precondition', 'too-early');
      expiresAtMs = now.getTime() + MARKET.listingDays * DAY_MS;
      patch.expiresAt = Timestamp.fromMillis(expiresAtMs);
      patch.renewCount = Number(d.renewCount ?? 0) + 1;
    } else {
      if (!isLive(d, now)) throw new HttpsError('failed-precondition', 'expired');
      Object.assign(patch, parseListingFields(d.type as ListingType, input));
    }
    tx.update(listingRef(db, id), patch);
    return { listingId: id, status: String(patch.status ?? d.status), expiresAtMs };
  });
}
