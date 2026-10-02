import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, seedPost } from '../testlib/helpers.mjs';
import { jstDay } from '../lib/common.js';
import { processTakedown, parseTakedown } from '../lib/takedown.js';

const get = (path) => db.doc(path).get();
const FORM = (postIds, over = {}) => ({
  postIds, requesterName: '山田 太郎（理学研究科）', role: 'instructor', contactEmail: 'yamada@kyoto-u.ac.jp',
  description: '2024年度 線形代数A 期末試験の問題が無断で掲載されています。', ...over,
});
const verified = (u = uid('v')) => ({ uid: u, verified: true, email: `${u}@kyoto-u.ac.jp` });
const mk = async () => {
  const a = uid('a'); const id = uid('p');
  await seedPost(id, { authorId: a, filePaths: [`resources/${a}/1.pdf`] });
  return { a, id };
};
// The anonymous cap is ONE counter per JST day. Every test that files unverified
// requests uses its own far-future day, so the tests cannot exhaust each other's pool.
let n = 0;
const day = () => new Date(Date.UTC(2040, 0, ++n, 3));

test('a verified KU requester hides the named post at once, files a priority request, and notifies the author', async () => {
  const { a, id } = await mk(); const v = verified();
  const original = (await get(`posts/${id}`)).data();
  const r = await processTakedown(db, v, FORM([id]));
  assert.deepEqual(r.hidden, [id]);
  assert.equal((await get(`posts/${id}`)).exists, false);
  assert.deepEqual((await get(`hidden_posts/${id}`)).data(), original);
  const req = (await get(`takedown_requests/${r.requestId}`)).data();
  assert.deepEqual(
    { verified: req.verified, requesterUid: req.requesterUid, postIds: req.postIds, status: req.status, role: req.role, university_id: req.university_id },
    { verified: true, requesterUid: v.uid, postIds: [id], status: 'open', role: 'instructor', university_id: 'kyoto_u' });
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ priority: q.priority, hiddenBy: q.hiddenBy, hiddenByUid: q.hiddenByUid, takedownRequestIds: q.takedownRequestIds },
    { priority: 'takedown', hiddenBy: 'takedown', hiddenByUid: v.uid, takedownRequestIds: [r.requestId] });
  assert.equal((await get(`notifications/mod_${id}_1`)).get('uid'), a);
});

test('M-6: a signed-out requester only queues — the post stays visible and nobody is notified', async () => {
  const { id } = await mk();
  const r = await processTakedown(db, null, FORM([id]), day());
  assert.deepEqual(r.hidden, []);
  assert.equal((await get(`posts/${id}`)).exists, true);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ priority: q.priority, needsReview: q.needsReview, status: q.status },
    { priority: 'takedown', needsReview: true, status: 'open' });
  const req = (await get(`takedown_requests/${r.requestId}`)).data();
  assert.deepEqual({ verified: req.verified, requesterUid: req.requesterUid }, { verified: false, requesterUid: null });
  assert.equal((await db.collection('notifications').where('postId', '==', id).get()).size, 0);
});

test('M-6: a signed-in but unverified (or non-KU) requester also only queues', async () => {
  const { id } = await mk(); const u = uid('u');
  const r = await processTakedown(db, { uid: u, verified: false, email: `${u}@gmail.com` }, FORM([id]), day());
  assert.deepEqual(r.hidden, []);
  assert.equal((await get(`posts/${id}`)).exists, true);
});

test('no immediate hide for the post’s own author, an operator-cleared post, or a discredited requester (boundary: 1 restored still hides)', async () => {
  const own = await mk();
  assert.deepEqual((await processTakedown(db, verified(own.a), FORM([own.id]))).hidden, []);
  const cleared = await mk();
  await db.doc(`moderation_queue/${cleared.id}`).set({ postId: cleared.id, status: 'restored', autoHide: false });
  assert.deepEqual((await processTakedown(db, verified(), FORM([cleared.id]))).hidden, []);
  assert.equal((await get(`moderation_queue/${cleared.id}`)).get('needsReview'), true);
  const bad = uid('v');
  await db.doc(`moderation_actors/${bad}`).set({ restoredTakedowns: 2 });
  const p = await mk();
  assert.deepEqual((await processTakedown(db, verified(bad), FORM([p.id]))).hidden, []);
  for (const x of [own, cleared, p]) assert.equal((await get(`posts/${x.id}`)).exists, true);
  const once = uid('v');
  await db.doc(`moderation_actors/${once}`).set({ restoredTakedowns: 1 });
  const p2 = await mk();
  assert.deepEqual((await processTakedown(db, verified(once), FORM([p2.id]))).hidden, [p2.id]);
});

test('M-7: 3 takedowns per signed-in requester per JST day, then resource-exhausted; the next day is fine', async () => {
  const v = verified(); const d = new Date('2027-01-21T03:00:00Z');
  for (let i = 0; i < 3; i++) await processTakedown(db, v, FORM([]), d);
  await assert.rejects(processTakedown(db, v, FORM([]), d), (e) => e.code === 'resource-exhausted');
  await processTakedown(db, v, FORM([]), new Date('2027-01-21T16:00:00Z'));
});

test('M-7: the unverified + anonymous pool is 20 per JST day for everyone together; verified requesters are not in it', async () => {
  const d = day();
  for (let i = 0; i < 20; i++) await processTakedown(db, null, FORM([]), d);
  await assert.rejects(processTakedown(db, null, FORM([]), d), (e) => e.code === 'resource-exhausted');
  await assert.rejects(processTakedown(db, { uid: uid('u'), verified: false, email: 'x@gmail.com' }, FORM([]), d),
    (e) => e.code === 'resource-exhausted');
  await processTakedown(db, verified(), FORM([]), d);
  assert.equal((await get(`moderation_meta/takedown_anon_${jstDay(d)}`)).get('count'), 20);
});

test('unknown post ids stay on the request only; an already-hidden post gets the request but no second hide or notice', async () => {
  const { id } = await mk(); const ghost = uid('nope');
  await processTakedown(db, verified(), FORM([id]));
  const r = await processTakedown(db, verified(), FORM([id, ghost]));
  assert.deepEqual(r.hidden, []);
  assert.equal((await get(`moderation_queue/${ghost}`)).exists, false);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.equal(q.transitions, 1);
  assert.equal(q.takedownRequestIds.length, 2);
  assert.equal((await db.collection('notifications').where('postId', '==', id).get()).size, 1);
});

test('parseTakedown refuses malformed forms, and nothing is written for them', async () => {
  const bads = [
    FORM(['a/b']), FORM(Array.from({ length: 6 }, (_, i) => `p${i}`)), FORM('p1'),
    FORM([], { requesterName: '' }), FORM([], { requesterName: 'x'.repeat(101) }),
    FORM([], { role: 'police' }), FORM([], { contactEmail: 'not-an-email' }),
    FORM([], { contactEmail: `${'a'.repeat(196)}@x.jp` }),
    FORM([], { description: '短い' }), FORM([], { description: 'x'.repeat(2001) }),
  ];
  for (const f of bads) {
    assert.throws(() => parseTakedown(f), (e) => e.code === 'invalid-argument', JSON.stringify(f).slice(0, 80));
  }
  const d = day();
  for (const f of bads) await assert.rejects(processTakedown(db, null, f, d), (e) => e.code === 'invalid-argument');
  assert.equal((await get(`moderation_meta/takedown_anon_${jstDay(d)}`)).exists, false);
  assert.deepEqual(parseTakedown(FORM(['p1', 'p1'])).postIds, ['p1']);
});

test('the stored request is trimmed and whitelisted: a client cannot claim to be verified or smuggle fields', async () => {
  const r = await processTakedown(db, null,
    { ...FORM(['x1', 'x1']), requesterName: '  名前  ', injected: 'ignored', verified: true, status: 'closed' }, day());
  const req = (await get(`takedown_requests/${r.requestId}`)).data();
  assert.equal(req.requesterName, '名前');
  assert.deepEqual(req.postIds, ['x1']);
  assert.equal(req.injected, undefined);
  assert.equal(req.verified, false);
  assert.equal(req.status, 'open');
});
