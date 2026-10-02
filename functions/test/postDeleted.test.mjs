// postDeleted.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDeps } from '../testlib/helpers.mjs';
import { handlePostDeleted } from '../lib/postDeleted.js';

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
