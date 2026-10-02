import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, seedPost } from '../testlib/helpers.mjs';
import { processReport } from '../lib/report.js';

const get = (path) => db.doc(path).get();
const R = (postId, over = {}) => ({ postId, category: 'copyright', detail: '無断転載です', ...over });
const mk = async () => {
  const a = uid('a'); const id = uid('p');
  await seedPost(id, { authorId: a, filePaths: [`resources/${a}/1.pdf`], title: '期末' });
  return { a, id };
};

test('a report is recorded once per reporter, Admin-side, and alone does not hide the post', async () => {
  const { id } = await mk(); const r = uid('r');
  assert.deepEqual(await processReport(db, r, R(id)), { status: 'reported' });
  const rep = (await get(`moderation_queue/${id}/reports/${r}`)).data();
  assert.deepEqual({ reporterUid: rep.reporterUid, category: rep.category, detail: rep.detail, counted: rep.counted, university_id: rep.university_id },
    { reporterUid: r, category: 'copyright', detail: '無断転載です', counted: true, university_id: 'kyoto_u' });
  assert.equal((await get(`posts/${id}`)).exists, true);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ status: q.status, reportCount: q.reportCount, countedReports: q.countedReports, university_id: q.university_id },
    { status: 'open', reportCount: 1, countedReports: 1, university_id: 'kyoto_u' });
  assert.equal((await get(`moderation_actors/${r}`)).get('university_id'), 'kyoto_u');
  assert.deepEqual(await processReport(db, r, R(id)), { status: 'duplicate' });
  assert.equal((await get(`moderation_queue/${id}`)).get('reportCount'), 1);
});

test('the 3rd DISTINCT reporter hides the post (moved, not deleted), notifies the author once, credits untouched', async () => {
  const { a, id } = await mk();
  await db.doc(`credit_balances/${a}`).set({ balance: 7, university_id: 'kyoto_u' });
  const original = (await get(`posts/${id}`)).data();
  assert.equal((await processReport(db, uid('r'), R(id))).status, 'reported');
  assert.equal((await processReport(db, uid('r'), R(id))).status, 'reported');
  assert.equal((await processReport(db, uid('r'), R(id))).status, 'hidden');
  assert.equal((await get(`posts/${id}`)).exists, false);
  assert.deepEqual((await get(`hidden_posts/${id}`)).data(), original);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ status: q.status, hiddenBy: q.hiddenBy, transitions: q.transitions, needsReview: q.needsReview },
    { status: 'hidden', hiddenBy: 'reports', transitions: 1, needsReview: true });
  const notes = await db.collection('notifications').where('postId', '==', id).get();
  assert.equal(notes.size, 1);
  assert.deepEqual({ uid: notes.docs[0].get('uid'), type: notes.docs[0].get('type') }, { uid: a, type: 'post_hidden' });
  assert.equal((await get(`credit_balances/${a}`)).get('balance'), 7);
  assert.deepEqual(await processReport(db, uid('r'), R(id)), { status: 'already_hidden' });
});

test('one account cannot reach the threshold alone: re-reporting is a no-op', async () => {
  const { id } = await mk(); const r = uid('r');
  for (let i = 0; i < 4; i++) await processReport(db, r, R(id));
  assert.equal((await get(`posts/${id}`)).exists, true);
  assert.equal((await get(`moderation_queue/${id}`)).get('countedReports'), 1);
});

test('three reporters at once hide the post exactly once', async () => {
  const { id } = await mk();
  const rs = await Promise.all([1, 2, 3].map(() => processReport(db, uid('r'), R(id))));
  assert.equal(rs.filter((x) => x.status === 'hidden').length, 1);
  assert.equal((await get(`moderation_queue/${id}`)).get('transitions'), 1);
  assert.equal((await db.collection('notifications').where('postId', '==', id).get()).size, 1);
});

test('the author cannot report their own post', async () => {
  const { a, id } = await mk();
  await assert.rejects(processReport(db, a, R(id)), (e) => e.code === 'failed-precondition' && /own-post/.test(e.message));
  assert.equal((await get(`moderation_queue/${id}`)).exists, false);
});

test('M-9: a reporter with 3 restored report-hides is recorded but not counted; with 2 they still count', async () => {
  const { id } = await mk(); const bad = uid('r');
  await db.doc(`moderation_actors/${bad}`).set({ restoredReports: 3 });
  await processReport(db, uid('r'), R(id));
  await processReport(db, uid('r'), R(id));
  assert.deepEqual(await processReport(db, bad, R(id)), { status: 'reported' }); // silent
  assert.equal((await get(`posts/${id}`)).exists, true);
  assert.equal((await get(`moderation_queue/${id}/reports/${bad}`)).get('counted'), false);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ reportCount: q.reportCount, countedReports: q.countedReports }, { reportCount: 3, countedReports: 2 });
  const ok = uid('r');
  await db.doc(`moderation_actors/${ok}`).set({ restoredReports: 2 });
  assert.equal((await processReport(db, ok, R(id))).status, 'hidden');
});

test('M-8: a post an operator cleared is never re-hidden by reports — it is flagged for review', async () => {
  const { id } = await mk();
  await db.doc(`moderation_queue/${id}`).set({ postId: id, status: 'restored', autoHide: false, needsReview: false });
  for (let i = 0; i < 4; i++) assert.equal((await processReport(db, uid('r'), R(id))).status, 'reported');
  assert.equal((await get(`posts/${id}`)).exists, true);
  assert.equal((await get(`moderation_queue/${id}`)).get('needsReview'), true);
});

test('M-7: the 11th report of a JST day is refused and leaves no trace; the next day is fine', async () => {
  const r = uid('r'); const day = new Date('2027-01-20T03:00:00Z');
  for (let i = 0; i < 10; i++) { const { id } = await mk(); await processReport(db, r, R(id), day); }
  const { id } = await mk();
  await assert.rejects(processReport(db, r, R(id), day), (e) => e.code === 'resource-exhausted');
  assert.equal((await get(`moderation_queue/${id}/reports/${r}`)).exists, false);
  assert.equal((await processReport(db, r, R(id), new Date('2027-01-20T16:00:00Z'))).status, 'reported');
});

test('bad input is refused before anything is written', async () => {
  const { id } = await mk(); const r = uid('r');
  const bads = [R('a/b'), R(''), R(42), R(id, { category: 'spam' }), R(id, { category: undefined }), R(id, { detail: 'x'.repeat(501) })];
  for (const bad of bads) {
    await assert.rejects(processReport(db, r, bad), (e) => e.code === 'invalid-argument', JSON.stringify(bad));
  }
  await assert.rejects(processReport(db, r, R(uid('nope'))), (e) => e.code === 'not-found');
  assert.equal((await get(`moderation_actors/${r}`)).exists, false);
  assert.equal((await get(`moderation_queue/${id}`)).exists, false);
});
