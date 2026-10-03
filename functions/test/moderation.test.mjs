import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, seedPost, fakeDeps } from '../testlib/helpers.mjs';
import { hidePost, restorePost, removePost, closeTakedown, listQueue } from '../lib/moderation.js';
import { processDownload } from '../lib/download.js';
import { handlePostCreated } from '../lib/postCreated.js';
import { claimWelcome } from '../lib/welcome.js';

const OP = { operator: 'tester' };
const get = (path) => db.doc(path).get();
const balance = async (u) => (await get(`credit_balances/${u}`)).get('balance') ?? 0;
const mkPost = async () => {
  const a = uid('a'); const id = uid('p'); const path = `resources/${a}/1_a.pdf`;
  await seedPost(id, { authorId: a, filePaths: [path], subjectId: uid('c'), title: '2024 期末' });
  return { a, id, path };
};

test('operator hide moves the post unchanged into hidden_posts, notifies the author, and is idempotent', async () => {
  const { a, id } = await mkPost();
  const original = (await get(`posts/${id}`)).data();
  assert.deepEqual(await hidePost(db, id, OP), { changed: true });
  assert.equal((await get(`posts/${id}`)).exists, false);
  assert.deepEqual((await get(`hidden_posts/${id}`)).data(), original);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ status: q.status, hiddenBy: q.hiddenBy, transitions: q.transitions, university_id: q.university_id },
    { status: 'hidden', hiddenBy: 'operator', transitions: 1, university_id: 'kyoto_u' });
  const n = (await get(`notifications/mod_${id}_1`)).data();
  assert.deepEqual({ uid: n.uid, type: n.type, postId: n.postId, postTitle: n.postTitle, read: n.read, university_id: n.university_id },
    { uid: a, type: 'post_hidden', postId: id, postTitle: '2024 期末', read: false, university_id: 'kyoto_u' });
  assert.deepEqual(await hidePost(db, id, OP), { changed: false });
  assert.equal((await get(`moderation_queue/${id}`)).get('transitions'), 1);
});

test('a hidden post cannot be downloaded and nothing is charged', async () => {
  const { id } = await mkPost();
  const u = uid('d');
  await claimWelcome(db, u, `${u}@st.kyoto-u.ac.jp`); // balance 3
  await hidePost(db, id, OP);
  const deps = fakeDeps();
  await assert.rejects(processDownload(db, deps, u, { postId: id }), (e) => e.code === 'not-found');
  assert.equal(deps.signed.length, 0);
  assert.equal(await balance(u), 3);
});

test('restore moves it back byte-for-byte, notifies, turns auto-hide off, and the re-fired onPostCreated pays nothing twice', async () => {
  const { a, id, path } = await mkPost();
  await handlePostCreated(db, fakeDeps([path]), id); // +3 upload
  assert.equal(await balance(a), 3);
  const original = (await get(`posts/${id}`)).data();
  await hidePost(db, id, OP);
  assert.equal((await restorePost(db, id, OP)).changed, true);
  assert.deepEqual((await get(`posts/${id}`)).data(), original);
  assert.equal((await get(`hidden_posts/${id}`)).exists, false);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ status: q.status, autoHide: q.autoHide, needsReview: q.needsReview, transitions: q.transitions },
    { status: 'restored', autoHide: false, needsReview: false, transitions: 2 });
  assert.equal((await get(`notifications/mod_${id}_2`)).get('type'), 'post_restored');
  await handlePostCreated(db, fakeDeps([path]), id); // the restore re-creates posts/{id}
  assert.equal(await balance(a), 3);
});

test('restore discredits the reporters behind a report-hide, the requester behind a takedown-hide, nobody behind an operator hide', async () => {
  const seedHidden = async (hiddenBy, hiddenByUid, reporters) => {
    const { id } = await mkPost();
    await hidePost(db, id, OP);
    await db.doc(`moderation_queue/${id}`).set({ hiddenBy, hiddenByUid }, { merge: true });
    for (const [r, counted] of reporters) {
      await db.doc(`moderation_queue/${id}/reports/${r}`).set({ counted, university_id: 'kyoto_u' });
    }
    return id;
  };
  const r1 = uid('r'); const r2 = uid('r'); const r3 = uid('r'); const quiet = uid('r'); const req = uid('t');
  const byReports = await seedHidden('reports', null, [[r1, true], [r2, true], [r3, true], [quiet, false]]);
  assert.deepEqual((await restorePost(db, byReports, OP)).discredited.sort(), [r1, r2, r3].sort());
  for (const r of [r1, r2, r3]) assert.equal((await get(`moderation_actors/${r}`)).get('restoredReports'), 1);
  assert.equal((await get(`moderation_actors/${quiet}`)).exists, false);
  const byTakedown = await seedHidden('takedown', req, []);
  assert.deepEqual((await restorePost(db, byTakedown, OP)).discredited, [req]);
  assert.equal((await get(`moderation_actors/${req}`)).get('restoredTakedowns'), 1);
  assert.equal((await get(`moderation_actors/${req}`)).get('restoredReports'), undefined);
  const lone = uid('r');
  const byOperator = await seedHidden('operator', null, [[lone, true]]);
  assert.deepEqual((await restorePost(db, byOperator, OP)).discredited, []);
  assert.equal((await get(`moderation_actors/${lone}`)).exists, false);
});

test('restore on a visible queued post acknowledges it: stays visible, no notification, auto-hide off', async () => {
  const { id } = await mkPost();
  await db.doc(`moderation_queue/${id}`).set({ postId: id, status: 'open', needsReview: true, priority: 'takedown', transitions: 0 });
  assert.equal((await restorePost(db, id, OP)).changed, false);
  assert.equal((await get(`posts/${id}`)).exists, true);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ status: q.status, autoHide: q.autoHide, needsReview: q.needsReview },
    { status: 'restored', autoHide: false, needsReview: false });
  assert.equal((await db.collection('notifications').where('postId', '==', id).get()).size, 0);
});

test('remove deletes a hidden or a visible post, notifies, and never claws back credits (M-4)', async () => {
  const { a, id, path } = await mkPost();
  await handlePostCreated(db, fakeDeps([path]), id); // +3
  await hidePost(db, id, OP);
  assert.deepEqual(await removePost(db, id, OP), { removedFrom: 'hidden_posts' });
  assert.equal((await get(`hidden_posts/${id}`)).exists, false);
  assert.equal((await get(`posts/${id}`)).exists, false);
  assert.equal((await get(`moderation_queue/${id}`)).get('status'), 'removed');
  assert.equal((await get(`notifications/mod_${id}_2`)).get('type'), 'post_removed');
  assert.equal(await balance(a), 3);
  assert.equal((await get(`credits_ledger/upload_${id}`)).get('delta'), 3);
  const v = await mkPost();
  assert.deepEqual(await removePost(db, v.id, OP), { removedFrom: 'posts' });
  assert.equal((await get(`posts/${v.id}`)).exists, false);
  assert.equal((await get(`notifications/mod_${v.id}_1`)).get('type'), 'post_removed');
});

test('operator actions need an operator name and a valid id; unknown ids are not-found; nothing changes', async () => {
  const { id } = await mkPost();
  for (const fn of [hidePost, restorePost, removePost]) {
    await assert.rejects(fn(db, id, { operator: '' }), (e) => e.code === 'invalid-argument');
    await assert.rejects(fn(db, id, { operator: 'x'.repeat(51) }), (e) => e.code === 'invalid-argument');
    await assert.rejects(fn(db, 'a/b', OP), (e) => e.code === 'invalid-argument');
    await assert.rejects(fn(db, uid('nope'), OP), (e) => e.code === 'not-found');
  }
  assert.equal((await get(`posts/${id}`)).exists, true);
  assert.equal((await get(`moderation_queue/${id}`)).exists, false);
});

test('restore refuses when a live post already holds the id (never overwrites)', async () => {
  const { id } = await mkPost();
  await hidePost(db, id, OP);
  await db.doc(`posts/${id}`).set({ authorId: 'someone', university_id: 'kyoto_u' });
  await assert.rejects(restorePost(db, id, OP), (e) => e.code === 'failed-precondition');
  assert.equal((await get(`hidden_posts/${id}`)).exists, true);
  assert.equal((await get(`posts/${id}`)).get('authorId'), 'someone');
});

test('every action leaves an audit row naming its actor', async () => {
  const { id } = await mkPost();
  await hidePost(db, id, { operator: 'alice', note: 'checked the PDF' });
  await restorePost(db, id, { operator: 'bob' });
  const rows = (await db.collection('moderation_log').where('target', '==', id).get()).docs.map((d) => d.data());
  assert.deepEqual(rows.map((r) => r.by).sort(), ['operator:alice', 'operator:bob']);
  assert.ok(rows.some((r) => r.note === 'checked the PDF'));
  assert.ok(rows.every((r) => r.university_id === 'kyoto_u'));
});

test('closeTakedown closes an open request once; unknown ids are not-found', async () => {
  const rid = uid('t');
  await db.doc(`takedown_requests/${rid}`).set({ status: 'open', university_id: 'kyoto_u' });
  assert.deepEqual(await closeTakedown(db, rid, OP), { changed: true });
  assert.equal((await get(`takedown_requests/${rid}`)).get('status'), 'closed');
  assert.deepEqual(await closeTakedown(db, rid, OP), { changed: false });
  await assert.rejects(closeTakedown(db, uid('t'), OP), (e) => e.code === 'not-found');
});

test('listQueue: takedown-priority entries first, plus entries that need review, plus open requests', async () => {
  const a = uid('q'); const b = uid('q'); const c = uid('q'); const done = uid('q'); const rid = uid('t');
  await db.doc(`moderation_queue/${a}`).set({ postId: a, status: 'open', priority: 'normal' });
  await db.doc(`moderation_queue/${b}`).set({ postId: b, status: 'hidden', priority: 'takedown' });
  await db.doc(`moderation_queue/${c}`).set({ postId: c, status: 'restored', priority: 'normal', needsReview: true });
  await db.doc(`moderation_queue/${done}`).set({ postId: done, status: 'removed', priority: 'takedown' });
  await db.doc(`takedown_requests/${rid}`).set({ status: 'open', description: 'x' });
  const { queue, requests } = await listQueue(db, 500);
  const mine = queue.map((x) => x.postId).filter((id) => [a, b, c, done].includes(id));
  assert.equal(mine[0], b);
  assert.deepEqual(mine.slice(1).sort(), [a, c].sort()); // `done` (removed, no review) is not listed
  assert.ok(requests.some((r) => r.id === rid));
});

test('readQueue takes author/title from the LIVE post, not a stale queue doc (state follows the id)', async () => {
  const { a, id } = await mkPost();
  await db.doc(`moderation_queue/${id}`).set({ postId: id, authorId: 'stale_author', postTitle: 'stale title', subjectId: 'stale', status: 'open' });
  await hidePost(db, id, OP);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ authorId: q.authorId, postTitle: q.postTitle }, { authorId: a, postTitle: '2024 期末' });
  assert.equal((await get(`notifications/mod_${id}_1`)).get('uid'), a);
});

test('hide never overwrites an existing hidden_posts doc (create, not set)', async () => {
  const { id } = await mkPost();
  await db.doc(`hidden_posts/${id}`).set({ authorId: 'squatter', university_id: 'kyoto_u' });
  await assert.rejects(hidePost(db, id, OP));
  assert.equal((await get(`hidden_posts/${id}`)).get('authorId'), 'squatter');
  assert.equal((await get(`posts/${id}`)).exists, true);
});

test('restore/remove of a post that is in neither collection retire its queue entry instead of throwing', async () => {
  for (const fn of [restorePost, removePost]) {
    const id = uid('gone');
    await db.doc(`moderation_queue/${id}`).set({ postId: id, authorId: 'x', status: 'hidden', needsReview: true, university_id: 'kyoto_u' });
    await fn(db, id, OP);
    const q = (await get(`moderation_queue/${id}`)).data();
    assert.deepEqual({ status: q.status, needsReview: q.needsReview }, { status: 'removed', needsReview: false });
    assert.equal((await db.collection('moderation_log').where('target', '==', id).get()).size, 1);
    assert.equal((await db.collection('notifications').where('postId', '==', id).get()).size, 0);
    assert.ok(!(await listQueue(db, 500)).queue.some((e) => e.postId === id));
    await fn(db, id, OP); // idempotent
    assert.equal((await db.collection('moderation_log').where('target', '==', id).get()).size, 1);
  }
  await assert.rejects(removePost(db, uid('never'), OP), (e) => e.code === 'not-found');
});

test('restore logs each discredit increment', async () => {
  const { id } = await mkPost();
  const u = uid('tk');
  await db.doc(`moderation_queue/${id}`).set({ postId: id, status: 'open', hiddenBy: 'takedown', hiddenByUid: u });
  await hidePost(db, id, OP);
  await db.doc(`moderation_queue/${id}`).update({ hiddenBy: 'takedown', hiddenByUid: u });
  await restorePost(db, id, OP);
  const rows = (await db.collection('moderation_log').where('target', '==', u).get()).docs.map((d) => d.data());
  assert.deepEqual(rows.map((r) => r.action), ['discredit']);
  assert.match(rows[0].note, /restoredTakedowns/);
});
