import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { db, uid, as, keyOf, get, NOW, DAY, later, LISTING, seedUser } from '../testlib/market.mjs';
import { processCreateListing } from '../lib/listings.js';
import { processOpenChat, handleMessageCreated } from '../lib/chat.js';
import { removeListing } from '../lib/marketModeration.js';
import { roomIdFor } from '../lib/chat.js';
import { processRateDeal, refreshReputation, aggregateRatings } from '../lib/ratings.js';

/** A market room in which both parties have spoken (the rating precondition). */
const deal = async ({ owner, buyer, talk = true } = {}) => {
  owner = owner ?? await seedUser(uid('o'));
  buyer = buyer ?? await seedUser(uid('b'));
  const { listingId } = await processCreateListing(db, as(owner), LISTING(), NOW);
  const { roomId } = await processOpenChat(db, as(buyer), { listingId }, NOW);
  if (talk) {
    await handleMessageCreated(db, roomId, { senderId: buyer, text: 'hi', createdAt: Timestamp.fromMillis(NOW.getTime() + 1) });
    await handleMessageCreated(db, roomId, { senderId: owner, text: 'hello', createdAt: Timestamp.fromMillis(NOW.getTime() + 2) });
  }
  return { owner, buyer, roomId };
};
const rate = (u, roomId, stars, comment = '', now = NOW) => processRateDeal(db, as(u), { roomId, stars, comment }, now);
const profile = async (u) => (await get(`market_profiles/${u}`)).data();

test('rating needs a market room where BOTH sides spoke; only its two parties may rate', async () => {
  const silent = await deal({ talk: false });
  await assert.rejects(rate(silent.buyer, silent.roomId, 5), (e) => e.message === 'no-exchange');
  await handleMessageCreated(db, silent.roomId, { senderId: silent.buyer, text: 'hi', createdAt: Timestamp.fromMillis(NOW.getTime() + 1) });
  await assert.rejects(rate(silent.buyer, silent.roomId, 5), (e) => e.message === 'no-exchange'); // one side is not enough
  const d = await deal();
  await assert.rejects(rate(uid('x'), d.roomId, 5), (e) => e.code === 'permission-denied');
  await db.doc('talk_rooms/legacy_room').set({ lenderId: d.owner, borrowerId: d.buyer, lenderSent: true, borrowerSent: true });
  await assert.rejects(rate(d.buyer, 'legacy_room', 5), (e) => e.message === 'legacy-room');
});

test('stars must be an integer 1..5 and the comment at most 60 characters', async () => {
  const d = await deal();
  for (const s of [0, 6, 4.5, '5', null]) await assert.rejects(rate(d.buyer, d.roomId, s), (e) => e.code === 'invalid-argument', String(s));
  await assert.rejects(rate(d.buyer, d.roomId, 5, 'x'.repeat(61)), (e) => e.code === 'invalid-argument');
  assert.equal((await rate(d.buyer, d.roomId, 5, 'x'.repeat(60))).status, 'rated'); // boundary
});

test('T-10: one immutable rating per (room, side): a second call is a duplicate and changes nothing', async () => {
  const d = await deal();
  assert.deepEqual(await rate(d.buyer, d.roomId, 2, 'うーん'), { status: 'rated', revealed: false });
  assert.deepEqual(await rate(d.buyer, d.roomId, 5, '最高'), { status: 'duplicate', revealed: false });
  const r = (await get(`market_ratings/${d.roomId}_borrower`)).data();
  assert.deepEqual([r.stars, r.comment, r.raterUid, r.rateeUid, r.raterKey, r.rateeKey, r.university_id],
    [2, 'うーん', d.buyer, d.owner, keyOf(d.buyer), keyOf(d.owner), 'kyoto_u']);
});

test('T-11: blind until both rated — a lone rating does not count; the second reveals both at once', async () => {
  const d = await deal();
  await rate(d.buyer, d.roomId, 1, 'ひどい');
  assert.equal((await profile(d.owner)).ratingCount, 0); // the owner cannot see a low score coming
  assert.deepEqual(await rate(d.owner, d.roomId, 4, 'よかった'), { status: 'rated', revealed: true });
  const o = await profile(d.owner); const b = await profile(d.buyer);
  assert.deepEqual([o.ratingCount, o.ratingSum, b.ratingCount, b.ratingSum], [1, 1, 1, 4]);
  assert.deepEqual(o.recentComments.map((c) => [c.stars, c.comment]), [[1, 'ひどい']]);
  assert.equal(o.recentComments[0].raterUid, undefined); // comments never name the rater
});

test('T-11: a one-sided rating counts after 14 days (lazy: on the next refresh)', async () => {
  const d = await deal();
  await rate(d.buyer, d.roomId, 3);
  assert.equal((await refreshReputation(db, d.owner, later(13.9))).ratingCount, 0);
  assert.equal((await refreshReputation(db, d.owner, later(14))).ratingCount, 1); // boundary: exactly 14 days
  assert.equal((await profile(d.owner)).ratingSum, 3);
});

test('T-10: one friend trading again and again counts once (newest rating per rater mailbox)', async () => {
  const owner = await seedUser(uid('o')); const friend = await seedUser(uid('b'));
  for (const [i, stars] of [5, 5, 4].entries()) {
    const d = await deal({ owner, buyer: friend });
    await rate(friend, d.roomId, stars, '', later(i + 1)); // the last deal is the newest
    await rate(owner, d.roomId, 5, '', later(i + 1));
  }
  const p = await profile(owner);
  assert.deepEqual([p.ratingCount, p.ratingSum], [1, 4]);
});

test('T-12: reputation follows the MAILBOX — a re-signup (new uid, same address) gets it back on its first listing', async () => {
  const d = await deal();
  await rate(d.buyer, d.roomId, 2);
  await rate(d.owner, d.roomId, 5);
  assert.equal((await profile(d.owner)).ratingCount, 1);
  const reborn = await seedUser(uid('o'));
  await processCreateListing(db, as(reborn, `${d.owner}@st.kyoto-u.ac.jp`), LISTING(), NOW);
  const p = await profile(reborn);
  assert.deepEqual([p.ratingCount, p.ratingSum], [1, 2]);
});

test('refreshReputation is a full recount: a forged public profile is overwritten', async () => {
  const d = await deal();
  await db.doc(`market_profiles/${d.owner}`).set({ ratingCount: 99, ratingSum: 495, pinned: true });
  await refreshReputation(db, d.owner, NOW);
  const p = await profile(d.owner);
  assert.deepEqual([p.ratingCount, p.ratingSum, p.pinned, p.university_id], [0, 0, undefined, 'kyoto_u']);
});

test('aggregateRatings ignores malformed stars and keeps the 5 newest comments, newest first', () => {
  const at = (d) => Timestamp.fromMillis(NOW.getTime() - d * DAY);
  const rs = [
    { raterKey: 'a', stars: 9, revealed: true, createdAt: at(1) },
    { raterKey: 'b', stars: 2.5, revealed: true, createdAt: at(1) },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({ raterKey: `k${i}`, stars: 4, comment: `c${i}`, revealed: true, createdAt: at(i) })),
  ];
  const out = aggregateRatings(rs, NOW);
  assert.equal(out.ratingCount, 6);
  assert.deepEqual(out.recentComments.map((c) => c.comment), ['c1', 'c2', 'c3', 'c4', 'c5']);
});

test('I-1: a forged / pre-deploy room (array-less, invented listingId and Sent flags) never unlocks a rating', async () => {
  const d = await deal();
  const listingId = (await db.collection('textbook_listings').where('ownerId', '==', d.owner).limit(1).get()).docs[0].id;
  const stranger = await seedUser(uid('o'));
  const forge = async (roomId, room) => {
    await db.doc(`talk_rooms/${roomId}`).set({ lenderSent: true, borrowerSent: true, ...room });
    await assert.rejects(rate(room.borrowerId, roomId, 5), (e) => e.message === 'legacy-room', roomId);
  };
  await forge('forged1', { lenderId: d.owner, borrowerId: d.buyer, listingId: uid('nolisting') }); // listing does not exist
  await forge('forged2', { lenderId: stranger, borrowerId: d.buyer, listingId }); // listing is someone else's
  await forge(`l_${listingId}_zzz`, { lenderId: d.owner, borrowerId: d.buyer, listingId }); // id is not roomIdFor(listing, borrower)
  const buyer2 = await seedUser(uid('b'));
  await forge(roomIdFor(listingId, buyer2), { lenderId: stranger, borrowerId: buyer2, listingId }); // well-formed id, but the listing's owner is not the room's lender
  assert.equal((await get(`market_ratings/forged1_borrower`)).exists, false);
  assert.equal((await rate(d.buyer, d.roomId, 5)).status, 'rated'); // the legit room still works
});

test('I-1: a room whose listing an operator removed can still be rated (tombstone owner)', async () => {
  const d = await deal();
  const listingId = (await db.collection('textbook_listings').where('ownerId', '==', d.owner).limit(1).get()).docs[0].id;
  await removeListing(db, listingId, { operator: 'tester' });
  assert.equal((await get(`textbook_listings/${listingId}`)).exists, false);
  assert.equal((await rate(d.buyer, d.roomId, 4)).status, 'rated');
  assert.equal(d.roomId, roomIdFor(listingId, d.buyer));
});

test('I-3: once the other side\'s rating is 14 days old you cannot answer it (13.9 days accepted, exactly 14 refused)', async () => {
  const a = await deal();
  await rate(a.buyer, a.roomId, 1, 'ひどい');
  assert.equal((await rate(a.owner, a.roomId, 5, '', later(13.9))).status, 'rated');
  const b = await deal();
  await rate(b.buyer, b.roomId, 1, 'ひどい');
  await assert.rejects(rate(b.owner, b.roomId, 5, '', later(14)), (e) => e.message === 'rating-closed');
  assert.equal((await get(`market_ratings/${b.roomId}_lender`)).exists, false);
});

test('self guard: the same mailbox on both sides cannot rate itself', async () => {
  const d = await deal();
  await db.doc(`market_identities/${d.buyer}`).set({ key: keyOf(d.owner) });
  await assert.rejects(processRateDeal(db, as(d.buyer, `${d.owner}@st.kyoto-u.ac.jp`), { roomId: d.roomId, stars: 5 }, NOW), (e) => e.message === 'self');
  assert.equal((await get(`market_ratings/${d.roomId}_borrower`)).exists, false);
});
