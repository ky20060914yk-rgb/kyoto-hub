// reviewCreated.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid } from '../testlib/helpers.mjs';
import { handleReviewCreated } from '../lib/reviewCreated.js';

const bal = async (u) => (await db.collection('credit_balances').doc(u).get()).get('balance') ?? 0;
// Seed `n` reviews of a course by OTHER users so the course is not scarce.
const crowd = async (courseKey, n) => {
  for (let i = 0; i < n; i++) {
    await db.collection('reviews').doc(uid('x')).set({ courseKey, authorId: uid('o'), university_id: 'kyoto_u' });
  }
};
// Create the review doc (the trigger fires after it exists) and run the handler.
const review = async (author, courseKey, now) => {
  const id = `${courseKey}_${author}`;
  await db.collection('reviews').doc(id).set({ courseKey, authorId: author, university_id: 'kyoto_u' });
  return handleReviewCreated(db, { id, authorId: author, courseKey }, now);
};

test('P2-12: each of a user\u2019s first 3 reviews earns +2, the 4th earns nothing (non-scarce courses)', async () => {
  const u = uid();
  const keys = [uid('ck'), uid('ck'), uid('ck'), uid('ck')];
  for (const k of keys) await crowd(k, 6); // 7 reviews each once ours lands -> not scarce
  for (let i = 0; i < 3; i++) {
    const r = await review(u, keys[i]);
    assert.deepEqual({ first: r.first, scarce: r.scarce, granted: r.granted }, { first: true, scarce: false, granted: 2 });
  }
  assert.equal(await bal(u), 6);
  const fourth = await review(u, keys[3]);
  assert.deepEqual({ first: fourth.first, granted: fourth.granted }, { first: false, granted: 0 });
  assert.equal(await bal(u), 6);
  assert.equal((await db.collection('credit_balances').doc(u).get()).get('reviewBonusesUsed'), 3);
  const led = await db.collection('credits_ledger').doc(`reviewfirst_${keys[0]}_${u}`).get();
  assert.equal(led.get('delta'), 2);
  assert.equal(led.get('reason'), 'first_review');
});

test('P2-13: a review on a thin course (total <= 5) earns +1 on top; the 5th review yes, the 6th no', async () => {
  const u = uid(); const thin = uid('ck'); const full = uid('ck');
  await crowd(thin, 4); // + ours = 5 -> still scarce
  await crowd(full, 5); // + ours = 6 -> not scarce
  const a = await review(u, thin);
  assert.deepEqual({ first: a.first, scarce: a.scarce, granted: a.granted }, { first: true, scarce: true, granted: 3 });
  const b = await review(u, full);
  assert.deepEqual({ first: b.first, scarce: b.scarce, granted: b.granted }, { first: true, scarce: false, granted: 2 });
  const led = await db.collection('credits_ledger').doc(`reviewscarce_${u}_${thin}`).get();
  assert.equal(led.get('delta'), 1);
  assert.equal(led.get('reason'), 'scarce_review');
});

test('after the first 3, only the scarce bonus remains', async () => {
  const u = uid();
  for (let i = 0; i < 3; i++) { const k = uid('ck'); await crowd(k, 6); await review(u, k); }
  const r = await review(u, uid('ck')); // a course with just this review
  assert.deepEqual({ first: r.first, scarce: r.scarce, granted: r.granted }, { first: false, scarce: true, granted: 1 });
  assert.equal(await bal(u), 7);
});

test('replaying the trigger, or deleting and re-posting the same review, pays once', async () => {
  const u = uid(); const k = uid('ck');
  await review(u, k);
  const again = await handleReviewCreated(db, { id: `${k}_${u}`, authorId: u, courseKey: k });
  assert.equal(again.granted, 0);
  await db.collection('reviews').doc(`${k}_${u}`).delete();
  const repost = await review(u, k);
  assert.equal(repost.granted, 0);
  assert.equal(await bal(u), 3); // +2 first +1 scarce, once
});

test('a review whose id does not match slug(courseKey)_authorId earns nothing (forged courseSlug)', async () => {
  const u = uid(); const k = uid('ck');
  const id = `forged_${u}`;
  await db.collection('reviews').doc(id).set({ courseKey: k, courseSlug: 'forged', authorId: u, university_id: 'kyoto_u' });
  const r = await handleReviewCreated(db, { id, authorId: u, courseKey: k });
  assert.equal(r.granted, 0);
  assert.equal(await bal(u), 0);
  // ...and another author's id is not accepted either
  const other = await handleReviewCreated(db, { id: `${k}_someone`, authorId: u, courseKey: k });
  assert.equal(other.granted, 0);
});

test('a courseKey with / and % is slugged like the client (%->%25, /->%2F)', async () => {
  const u = uid(); const k = `fbl/pbl 100%|${uid()}`;
  const id = `${k.replaceAll('%', '%25').replaceAll('/', '%2F')}_${u}`;
  await db.collection('reviews').doc(id).set({ courseKey: k, authorId: u, university_id: 'kyoto_u' });
  const r = await handleReviewCreated(db, { id, authorId: u, courseKey: k });
  assert.equal(r.granted, 3);
});

test('delete + repost of the same course never re-pays the scarce bonus (author+course key)', async () => {
  const u = uid(); const k = uid('ck');
  await review(u, k);
  await db.collection('reviews').doc(`${k}_${u}`).delete();
  const repost = await review(u, k);
  assert.equal(repost.scarce, false);
  assert.equal((await db.collection('credits_ledger').doc(`reviewscarce_${u}_${k}`).get()).get('delta'), 1);
  assert.equal(await bal(u), 3);
});

test('P2-14: at most 5 review-bonus grants per JST day; the cap resets the next day', async () => {
  const u = uid();
  const day1 = new Date('2026-10-03T03:00:00Z');
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await review(u, uid('ck'), day1)); // 4 thin courses
  // r1: first+scarce (2 grants), r2: 2 (4), r3: first = 5th grant, its scarce is capped, r4: capped
  assert.deepEqual(results.map((r) => r.granted), [3, 3, 2, 0]);
  assert.equal(results[2].capped, true);
  assert.equal(await bal(u), 8);
  const next = await review(u, uid('ck'), new Date('2026-10-03T16:00:00Z')); // 01:00 JST next day
  assert.deepEqual({ first: next.first, scarce: next.scarce, granted: next.granted }, { first: false, scarce: true, granted: 1 });
});

test('an empty author id or course key grants nothing it should not', async () => {
  assert.equal((await handleReviewCreated(db, { id: 'x', authorId: '', courseKey: 'k' })).granted, 0);
  const r = await handleReviewCreated(db, { id: 'y', authorId: uid(), courseKey: '' });
  assert.equal(r.scarce, false); // no count query on an empty key
});

test('a capped first-review bonus releases its slot: reviewBonusesUsed unchanged, +2 still earned after the reset', async () => {
  const u = uid();
  const day1 = new Date('2026-10-03T03:00:00Z');
  await db.collection('credit_balances').doc(u).set({
    balance: 4, university_id: 'kyoto_u', reviewBonusesUsed: 1, reviewGrantDay: '2026-10-03', reviewGrantsToday: 5,
  });
  const k1 = uid('ck'); await crowd(k1, 6);
  const r1 = await review(u, k1, day1);
  assert.deepEqual({ first: r1.first, granted: r1.granted, capped: r1.capped }, { first: false, granted: 0, capped: true });
  const b1 = (await db.collection('credit_balances').doc(u).get()).data();
  assert.equal(b1.reviewBonusesUsed, 1); // the refused grant did not consume a slot
  assert.equal(b1.balance, 4);
  const k2 = uid('ck'); await crowd(k2, 6);
  const r2 = await review(u, k2, new Date('2026-10-03T16:00:00Z')); // next JST day
  assert.deepEqual({ first: r2.first, granted: r2.granted }, { first: true, granted: 2 });
  assert.equal((await db.collection('credit_balances').doc(u).get()).get('reviewBonusesUsed'), 2);
});
