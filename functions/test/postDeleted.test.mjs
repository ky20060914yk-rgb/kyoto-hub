// postDeleted.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, fakeDeps } from '../testlib/helpers.mjs';
import { handlePostDeleted, handlePostGone } from '../lib/postDeleted.js';

test('removes the author’s own files', async () => {
  const deps = fakeDeps();
  const removed = await handlePostDeleted(deps, { authorId: 'u1', filePaths: ['resources/u1/a.pdf', 'resources/u1/b.png'] });
  assert.deepEqual(removed, ['resources/u1/a.pdf', 'resources/u1/b.png']);
  assert.deepEqual(deps.removed, removed);
});

test('NEVER removes a path outside the author’s prefix (cross-user delete guard)', async () => {
  const deps = fakeDeps();
  const removed = await handlePostDeleted(deps, {
    authorId: 'attacker',
    filePaths: ['resources/victim/secret.pdf', 'resources/attacker/own.pdf', 'other/place.pdf', 42],
  });
  assert.deepEqual(removed, ['resources/attacker/own.pdf']);
  assert.deepEqual(deps.removed, ['resources/attacker/own.pdf']);
});

test('a missing authorId or non-list filePaths removes nothing and does not throw', async () => {
  const deps = fakeDeps();
  assert.deepEqual(await handlePostDeleted(deps, { filePaths: ['resources//x.pdf'] }), []);
  assert.deepEqual(await handlePostDeleted(deps, { authorId: 'u1', filePaths: 'nope' }), []);
  assert.deepEqual(deps.removed, []);
});

test('a failing remove (already gone) does not stop the others', async () => {
  const removed = [];
  const deps = { remove: async (p) => { if (p.endsWith('a.pdf')) throw new Error('gone'); removed.push(p); } };
  const out = await handlePostDeleted(deps, { authorId: 'u1', filePaths: ['resources/u1/a.pdf', 'resources/u1/b.pdf'] });
  assert.deepEqual(removed, ['resources/u1/b.pdf']);
  assert.deepEqual(out, ['resources/u1/a.pdf', 'resources/u1/b.pdf']);
});

test('a .. segment inside the author prefix is never removed', async () => {
  const deps = fakeDeps();
  const removed = await handlePostDeleted(deps, { authorId: 'u1', filePaths: ['resources/u1/../victim/x.pdf', 'resources/u1/ok.pdf'] });
  assert.deepEqual(removed, ['resources/u1/ok.pdf']);
});

const owned = (a) => ({ authorId: a, filePaths: [`resources/${a}/1_a.pdf`] });

test('handlePostGone: a post that exists in NEITHER collection has its files removed', async () => {
  const a = uid('a'); const deps = fakeDeps();
  assert.deepEqual(await handlePostGone(db, deps, uid('p'), owned(a)), [`resources/${a}/1_a.pdf`]);
  assert.deepEqual(deps.removed, [`resources/${a}/1_a.pdf`]);
});

test('handlePostGone: a hide (the doc moved to hidden_posts) keeps the files', async () => {
  const a = uid('a'); const id = uid('p'); const deps = fakeDeps();
  await db.doc(`hidden_posts/${id}`).set({ ...owned(a), university_id: 'kyoto_u' });
  assert.deepEqual(await handlePostGone(db, deps, id, owned(a)), []);
  assert.deepEqual(deps.removed, []);
});

test('handlePostGone: a restore (the doc is back in posts) keeps the files', async () => {
  const a = uid('a'); const id = uid('p'); const deps = fakeDeps();
  await db.doc(`posts/${id}`).set({ ...owned(a), university_id: 'kyoto_u' });
  assert.deepEqual(await handlePostGone(db, deps, id, owned(a)), []);
  assert.deepEqual(deps.removed, []);
});

test('handlePostGone keeps the author-prefix guard', async () => {
  const deps = fakeDeps();
  const out = await handlePostGone(db, deps, uid('p'), {
    authorId: 'attacker', filePaths: ['resources/victim/x.pdf', 'resources/attacker/y.pdf'],
  });
  assert.deepEqual(out, ['resources/attacker/y.pdf']);
  assert.deepEqual(deps.removed, ['resources/attacker/y.pdf']);
});
