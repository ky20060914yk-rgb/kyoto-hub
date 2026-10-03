import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { db, uid, as, get, NOW, later, LISTING, seedUser } from '../testlib/market.mjs';
import { processCreateListing, processUpdateListing } from '../lib/listings.js';
import { processOpenChat, processBlockRoom, handleMessageCreated, roomIdFor } from '../lib/chat.js';

const setup = async (over = {}) => {
  const owner = await seedUser(uid('o'), 'オーナー'); const buyer = await seedUser(uid('b'), '買う人');
  const { listingId } = await processCreateListing(db, as(owner), LISTING(over), NOW);
  return { owner, buyer, listingId };
};
const msg = (senderId, text, ms) => ({ senderId, senderName: 'x', text, createdAt: Timestamp.fromMillis(ms), university_id: 'kyoto_u' });

test('openListingChat creates ONE Function-owned room per (listing, requester): owner = lenderId, caller = borrowerId', async () => {
  const { owner, buyer, listingId } = await setup();
  const r = await processOpenChat(db, as(buyer), { listingId }, NOW);
  assert.deepEqual(r, { roomId: roomIdFor(listingId, buyer), created: true });
  const room = (await get(`talk_rooms/${r.roomId}`)).data();
  assert.deepEqual(
    [room.lenderId, room.lenderName, room.borrowerId, room.borrowerName, room.listingId, room.bookTitle, room.university_id],
    [owner, 'オーナー', buyer, '買う人', listingId, '線形代数入門 第2版', 'kyoto_u']);
  assert.deepEqual([room.lenderSent, room.borrowerSent, room.closedBy, room.lastMessageAt], [false, false, null, null]);
  assert.equal(room.messages, undefined); // no array any more (spec §4.5.5)
  assert.match(room.warningNotice, /お金を扱いません/);
  assert.deepEqual(await processOpenChat(db, as(buyer), { listingId }, NOW), { roomId: r.roomId, created: false });
});

test('the owner cannot open a chat on their own listing; closed, hidden or expired listings refuse NEW rooms', async () => {
  const { owner, buyer, listingId } = await setup();
  await assert.rejects(processOpenChat(db, as(owner), { listingId }, NOW), (e) => e.message === 'own-listing');
  await assert.rejects(processOpenChat(db, as(buyer), { listingId }, later(31)), (e) => e.message === 'listing-closed');
  await processUpdateListing(db, as(owner), { listingId, action: 'close' }, NOW);
  await assert.rejects(processOpenChat(db, as(buyer), { listingId }, NOW), (e) => e.message === 'listing-closed');
  await assert.rejects(processOpenChat(db, as(buyer), { listingId: uid('nope') }, NOW), (e) => e.code === 'not-found');
  await assert.rejects(processOpenChat(db, as(buyer), { listingId: 'a/b' }, NOW), (e) => e.code === 'invalid-argument');
});

test('T-6: the 11th NEW room of a JST day per mailbox is refused; re-opening is free', async () => {
  const buyer = await seedUser(uid('b'));
  const ids = [];
  for (let i = 0; i < 11; i++) {
    const owner = await seedUser(uid('o'));
    ids.push((await processCreateListing(db, as(owner), LISTING(), NOW)).listingId);
  }
  for (let i = 0; i < 10; i++) await processOpenChat(db, as(buyer), { listingId: ids[i] }, NOW);
  await assert.rejects(processOpenChat(db, as(buyer), { listingId: ids[10] }, NOW), (e) => e.code === 'resource-exhausted');
  assert.equal((await processOpenChat(db, as(buyer), { listingId: ids[0] }, NOW)).created, false);
  assert.equal((await processOpenChat(db, as(buyer), { listingId: ids[10] }, later(1))).created, true);
});

test('T-17: block closes the room for both and stops new chats in either direction', async () => {
  const { owner, buyer, listingId } = await setup();
  const { roomId } = await processOpenChat(db, as(buyer), { listingId }, NOW);
  await assert.rejects(processBlockRoom(db, as(uid('x')), { roomId }), (e) => e.code === 'permission-denied');
  assert.deepEqual(await processBlockRoom(db, as(owner), { roomId }), { changed: true });
  assert.equal((await get(`talk_rooms/${roomId}`)).get('closedBy'), owner);
  assert.equal((await get(`market_blocks/${owner}_${buyer}`)).get('blocked'), buyer);
  assert.deepEqual(await processBlockRoom(db, as(buyer), { roomId }), { changed: false });
  const second = (await processCreateListing(db, as(owner), LISTING(), NOW)).listingId;
  await assert.rejects(processOpenChat(db, as(buyer), { listingId: second }, NOW), (e) => e.message === 'blocked');
  const theirs = (await processCreateListing(db, as(buyer), LISTING(), NOW)).listingId;
  await assert.rejects(processOpenChat(db, as(owner), { listingId: theirs }, NOW), (e) => e.message === 'blocked');
});

test('T-18: the message trigger keeps a monotonic summary and records who has spoken', async () => {
  const { owner, buyer, listingId } = await setup();
  const { roomId } = await processOpenChat(db, as(buyer), { listingId }, NOW);
  const t = NOW.getTime();
  assert.equal(await handleMessageCreated(db, roomId, msg(buyer, 'こんにちは\u0000！', t + 1000)), true);
  let room = (await get(`talk_rooms/${roomId}`)).data();
  assert.deepEqual([room.lastMessageText, room.lastSenderId, room.borrowerSent, room.lenderSent], ['こんにちは！', buyer, true, false]);
  await handleMessageCreated(db, roomId, msg(owner, 'x'.repeat(200), t + 3000));
  await handleMessageCreated(db, roomId, msg(buyer, 'older, processed late', t + 2000));
  room = (await get(`talk_rooms/${roomId}`)).data();
  assert.equal(room.lastMessageText, 'x'.repeat(80));
  assert.equal(room.lastSenderId, owner);
  assert.equal(room.lastMessageAt.toMillis(), t + 3000);
  assert.deepEqual([room.borrowerSent, room.lenderSent], [true, true]);
});

test('a message from a non-participant (or to an unknown room) changes nothing', async () => {
  const { buyer, listingId } = await setup();
  const { roomId } = await processOpenChat(db, as(buyer), { listingId }, NOW);
  assert.equal(await handleMessageCreated(db, roomId, msg(uid('x'), 'spoof', NOW.getTime() + 5)), false);
  assert.equal(await handleMessageCreated(db, roomId, msg('', 'empty sender', NOW.getTime() + 5)), false);
  assert.equal(await handleMessageCreated(db, uid('noroom'), msg(buyer, 'hi', NOW.getTime())), false);
  const room = (await get(`talk_rooms/${roomId}`)).data();
  assert.deepEqual([room.lastMessageText, room.lenderSent, room.borrowerSent], ['', false, false]);
});
