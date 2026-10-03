import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { UNIVERSITY_ID, jstDay } from './common.js';
import { MARKET, blockRef, isLive, listingRef, millisOf, normalizeTitle } from './marketCore.js';

/** Two normalized titles match when the shorter (>= matchMinLength) is contained in the longer. */
export function titlesMatch(a: string, b: string): boolean {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= MARKET.matchMinLength && l.includes(s);
}

/** A 買いたい listing matches an offer by the same course, or by title. */
export function listingsMatch(offer: DocumentData, want: DocumentData): boolean {
  if (typeof offer.courseId === 'string' && offer.courseId !== '' && offer.courseId === want.courseId) return true;
  return titlesMatch(normalizeTitle(offer.title), normalizeTitle(want.title));
}

export const matchNoticeId = (offerId: string, uid: string) => `mkt_match_${offerId}_${uid}`;
const inboxRef = (db: Firestore, uid: string) => db.collection('market_inbox').doc(uid);

/**
 * `onListingCreated` (T-9): a new 譲る/売る listing tells the owners of matching
 * live 買いたい listings — at most `matchMaxRecipients` people per offer, at most
 * `matchNoticeDailyCap` match notices per recipient per JST day, never the
 * offer's own owner, never someone who blocked the offerer (or was blocked),
 * one notice per (offer, recipient) (deterministic id, so a trigger retry
 * writes nothing new). Returns the uids notified by THIS call.
 */
export async function handleListingCreated(db: Firestore, listingId: string, now: Date = new Date()): Promise<string[]> {
  const snap = await listingRef(db, listingId).get();
  const offer = snap.data();
  if (!offer || offer.type === 'want' || !isLive(offer, now)) return [];
  const wants = await db.collection('textbook_listings').where('type', '==', 'want').where('status', '==', 'active').limit(500).get();
  const byOwner = new Map<string, DocumentData>();
  for (const d of wants.docs.map((x) => x.data()).sort((a, b) => millisOf(b.createdAt) - millisOf(a.createdAt))) {
    const owner = String(d.ownerId ?? '');
    if (owner === '' || owner === offer.ownerId || byOwner.has(owner) || !isLive(d, now) || !listingsMatch(offer, d)) continue;
    byOwner.set(owner, d);
  }
  const day = jstDay(now);
  const notified: string[] = [];
  for (const uid of [...byOwner.keys()].slice(0, MARKET.matchMaxRecipients)) {
    const sent = await db.runTransaction(async (tx) => {
      const note = await tx.get(db.collection('notifications').doc(matchNoticeId(listingId, uid)));
      const inbox = await tx.get(inboxRef(db, uid));
      const b1 = await tx.get(blockRef(db, uid, String(offer.ownerId)));
      const b2 = await tx.get(blockRef(db, String(offer.ownerId), uid));
      if (note.exists || b1.exists || b2.exists) return false;
      const used = inbox.get('day') === day ? Number(inbox.get('count') ?? 0) : 0;
      if (used >= MARKET.matchNoticeDailyCap) return false;
      tx.create(db.collection('notifications').doc(matchNoticeId(listingId, uid)), {
        uid, type: 'listing_match', listingId, postId: '', postTitle: String(offer.title ?? '').slice(0, 200),
        read: false, createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
      });
      tx.set(inboxRef(db, uid), { day, count: used + 1, university_id: UNIVERSITY_ID });
      return true;
    });
    if (sent) notified.push(uid);
  }
  return notified;
}
