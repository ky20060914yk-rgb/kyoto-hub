import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { db, uid, as, keyOf, get, NOW, DAY, later, LISTING, seedUser } from '../testlib/market.mjs';
import { processCreateListing } from '../lib/listings.js';
import { processOpenChat, handleMessageCreated } from '../lib/chat.js';
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
