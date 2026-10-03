import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { UNIVERSITY_ID, isDocId, jstDay } from './common.js';
import {
  MARKET, blockRef, callerKey, displayNameFor, identityRef, isLive, listingRef, marketActorRef, millisOf, roomRef,
  sanitizeLine, type MarketCaller,
} from './marketCore.js';
import { refreshReputation } from './ratings.js';

/** One room per (listing, requester): opening twice returns the same room (T-14). */
export const roomIdFor = (listingId: string, uid: string) => `l_${listingId}_${uid}`;

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
    const blocked = await tx.get(blockRef(db, ownerId, caller.uid));
    const blocking = await tx.get(blockRef(db, caller.uid, ownerId));
    if (ownerId === caller.uid) throw new HttpsError('failed-precondition', 'own-listing');
    if (blocked.exists || blocking.exists) throw new HttpsError('failed-precondition', 'blocked');
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
  await refreshReputation(db, out.ownerId, now); // lazy reveal of the owner's old one-sided ratings (T-11)
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
    if (r.closedBy) return { changed: false };
    tx.update(roomRef(db, roomId), { closedBy: caller.uid, closedAt: FieldValue.serverTimestamp() });
    tx.set(blockRef(db, caller.uid, other), {
      blocker: caller.uid, blocked: other, roomId, createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
    });
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
export async function handleMessageCreated(db: Firestore, roomId: string, msg: DocumentData | undefined): Promise<boolean> {
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
    if (at > 0 && at >= millisOf(r.lastMessageAt)) {
      patch.lastMessageText = sanitizeLine(msg.text).slice(0, MARKET.previewLength);
      patch.lastMessageAt = msg.createdAt;
      patch.lastSenderId = sender;
    }
    tx.update(roomRef(db, roomId), patch);
    return true;
  });
}
