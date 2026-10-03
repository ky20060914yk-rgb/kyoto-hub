import { FieldValue, type DocumentData, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { UNIVERSITY_ID, isDocId, jstDay } from './common.js';
import {
  MARKET, blockRef, callerKey, clip, displayNameFor, identityRef, isLive, keyFromIdentity, listingRef, mailboxBlockRef,
  marketActorRef, millisOf, roomIdFor, roomRef, sanitizeLine, type MarketCaller,
} from './marketCore.js';
import { refreshReputation } from './ratings.js';

export { roomIdFor };

const ROOMS_PER_PAIR_MAX = 200;
const CLOCK_SKEW_MS = 60_000; // trigger clock vs. server timestamp

export const ROOM_WARNING =
  'アプリはお金を扱いません。代金は受け渡しのときに当事者どうしで直接やりとりしてください。電話番号・住所などの個人情報は送らないでください。';

/**
 * `openListingChat` (T-14..T-16). The caller (not the owner) asks about a live
 * listing; the room is created by this Function only (rules deny client
 * creates), with `lenderId` = the listing owner and `borrowerId` = the caller
 * (the historical field names mean "owner side" / "requester side"). Refused
 * when either party has blocked the other. At most `roomDailyCap` NEW rooms per
 * mailbox per JST day; re-opening an existing room is free.
 */
export async function processOpenChat(
  db: Firestore, caller: MarketCaller, input: Record<string, unknown>, now: Date = new Date(),
): Promise<{ roomId: string; created: boolean }> {
  const listingId = input?.listingId;
  if (!isDocId(listingId)) throw new HttpsError('invalid-argument', 'bad listing id');
  const key = callerKey(caller);
  const day = jstDay(now);
  const roomId = roomIdFor(listingId, caller.uid);
  const out = await db.runTransaction(async (tx) => {
    const listing = await tx.get(listingRef(db, listingId));
    const room = await tx.get(roomRef(db, roomId));
    const actor = await tx.get(marketActorRef(db, key));
    const profile = await tx.get(db.collection('users').doc(caller.uid));
    if (!listing.exists) throw new HttpsError('not-found', 'listing not found');
    const l = listing.data()!;
    const ownerId = String(l.ownerId ?? '');
    const ownerKey = keyFromIdentity(await tx.get(identityRef(db, ownerId)), ownerId);
    const blocks = await Promise.all([
      tx.get(blockRef(db, ownerId, caller.uid)), tx.get(blockRef(db, caller.uid, ownerId)),
      tx.get(mailboxBlockRef(db, ownerKey, key)), tx.get(mailboxBlockRef(db, key, ownerKey)),
    ]);
    if (ownerId === caller.uid || ownerKey === key) throw new HttpsError('failed-precondition', 'own-listing');
    if (blocks.some((b) => b.exists)) throw new HttpsError('failed-precondition', 'blocked');
    if (room.exists) return { roomId, created: false, ownerId };
    if (!isLive(l, now)) throw new HttpsError('failed-precondition', 'listing-closed');
    const used = actor.get('roomDay') === day ? Number(actor.get('roomsToday') ?? 0) : 0;
    if (used >= MARKET.roomDailyCap) throw new HttpsError('resource-exhausted', 'room-limit');

    tx.create(roomRef(db, roomId), {
      id: roomId,
      university_id: UNIVERSITY_ID,
      listingId,
      listingType: String(l.type ?? ''),
      requestId: '',
      bookTitle: String(l.title ?? ''),
      subjectName: String(l.courseName ?? ''),
      lenderId: ownerId,
      lenderName: String(l.ownerName ?? '京大生'),
      borrowerId: caller.uid,
      borrowerName: displayNameFor(profile.get('displayName')),
      createdAt: now.toISOString(),
      warningNotice: ROOM_WARNING,
      lastMessageText: '',
      lastMessageAt: null,
      lastSenderId: '',
      lenderSent: false,
      borrowerSent: false,
      lenderReadAt: null,
      borrowerReadAt: null,
      closedBy: null,
    });
    tx.set(marketActorRef(db, key), { roomDay: day, roomsToday: used + 1, university_id: UNIVERSITY_ID }, { merge: true });
    tx.set(identityRef(db, caller.uid), { key, updatedAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID }, { merge: true });
    return { roomId, created: true, ownerId };
  });
  // Lazy reveal of the owner's old one-sided ratings (T-11); best-effort, and only when a room was created.
  if (out.created) await refreshReputation(db, out.ownerId, now).catch((e) => console.warn('refreshReputation failed', e));
  return { roomId: out.roomId, created: out.created };
}

/**
 * `blockRoom` (T-17): either participant closes the room for good (no more
 * messages from either side — the messages create rule checks `closedBy`) and
 * records a block, so the blocked user can neither open a new chat with the
 * blocker nor trigger match notices to them.
 */
export async function processBlockRoom(
  db: Firestore, caller: MarketCaller, input: Record<string, unknown>,
): Promise<{ changed: boolean }> {
  const roomId = input?.roomId;
  if (!isDocId(roomId)) throw new HttpsError('invalid-argument', 'bad room id');
  return db.runTransaction(async (tx) => {
    const room = await tx.get(roomRef(db, roomId));
    if (!room.exists) throw new HttpsError('not-found', 'room not found');
    const r = room.data()!;
    const other = r.lenderId === caller.uid ? r.borrowerId : r.borrowerId === caller.uid ? r.lenderId : null;
    if (typeof other !== 'string' || other === '') throw new HttpsError('permission-denied', 'not-participant');
    const myKey = callerKey(caller);
    const otherKey = keyFromIdentity(await tx.get(identityRef(db, other)), other);
    // The block is about the PAIR: every room between them, in both lender/borrower orderings, is closed
    // (bounded: ROOMS_PER_PAIR_MAX per ordering; a pair cannot hold more than ~one room per listing x requester).
    const [mine, theirs, uidBlock, keyBlock] = await Promise.all([
      tx.get(db.collection('talk_rooms').where('lenderId', '==', caller.uid).where('borrowerId', '==', other).limit(ROOMS_PER_PAIR_MAX)),
      tx.get(db.collection('talk_rooms').where('lenderId', '==', other).where('borrowerId', '==', caller.uid).limit(ROOMS_PER_PAIR_MAX)),
      tx.get(blockRef(db, caller.uid, other)),
      tx.get(mailboxBlockRef(db, myKey, otherKey)),
    ]);
    const open = new Map<string, DocumentReference>();
    for (const d of [...mine.docs, ...theirs.docs]) if (!d.get('closedBy')) open.set(d.id, d.ref);
    if (!r.closedBy) open.set(roomId, roomRef(db, roomId));
    if (open.size === 0) return { changed: false }; // everything between them is already closed (a block is written together with its closes)
    for (const ref of open.values()) tx.update(ref, { closedBy: caller.uid, closedAt: FieldValue.serverTimestamp() });
    if (!uidBlock.exists) {
      tx.set(blockRef(db, caller.uid, other), {
        blocker: caller.uid, blocked: other, roomId, createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
      });
    }
    if (!keyBlock.exists) {
      tx.set(mailboxBlockRef(db, myKey, otherKey), {
        blockerKey: myKey, blockedKey: otherKey, roomId, createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
      });
    }
    return { changed: true };
  });
}

/**
 * `onTalkMessageCreated` (T-18): the room summary (last message preview, time,
 * sender, and whether each side has spoken) is Function-owned, so a participant
 * can neither forge a preview of words the other never sent nor fake the
 * "both sides talked" condition that unlocks rating. Monotonic: an older
 * message processed late (trigger retries, the chat migration) never moves the
 * preview backwards. Returns false when the message is not from a participant.
 */
export async function handleMessageCreated(
  db: Firestore, roomId: string, msg: DocumentData | undefined, now: Date = new Date(),
): Promise<boolean> {
  if (!msg || !isDocId(roomId)) return false;
  return db.runTransaction(async (tx) => {
    const room = await tx.get(roomRef(db, roomId));
    if (!room.exists) return false;
    const r = room.data()!;
    const sender = String(msg.senderId ?? '');
    const side = sender !== '' && sender === r.lenderId ? 'lender' : sender !== '' && sender === r.borrowerId ? 'borrower' : null;
    if (!side) return false;
    const patch: Record<string, unknown> = { [`${side}Sent`]: true };
    const at = millisOf(msg.createdAt);
    // A stored time in the future is forged (rooms are Function-written; pre-deploy rooms are not trusted): ignore it.
    const stored = millisOf(r.lastMessageAt);
    if (at > 0 && at >= (stored > now.getTime() + CLOCK_SKEW_MS ? 0 : stored)) {
      patch.lastMessageText = clip(sanitizeLine(msg.text), MARKET.previewLength);
      patch.lastMessageAt = msg.createdAt;
      patch.lastSenderId = sender;
    }
    tx.update(roomRef(db, roomId), patch);
    return true;
  });
}
