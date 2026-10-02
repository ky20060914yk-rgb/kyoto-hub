// Planner unit tests + emulator fixture for migrate_storage.mjs (Plan 2A, Task 10).
//
//   node test_migrate_storage_fixture.mjs                 # pure planner asserts
//   node test_migrate_storage_fixture.mjs seed|unchanged|migrated|deleted
//   node test_migrate_storage_fixture.mjs run <exit> <totals-substring> [tool args]
//
// The emulator modes refuse to run unless the Firestore + Storage emulators are
// configured, so they can never touch a real project.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { planMigration, destName, cleanupCandidates, copyBody } from './migrate_storage.mjs';

const mode = process.argv[2];

if (!mode) {
  // A post with two files, both present at the root.
  let plan = planMigration({ id: 'p1', authorId: 'u1', fileNames: ['1_a.pdf', '2_b.png'] }, (n) => true);
  assert.deepEqual(plan, {
    ok: true,
    moves: [
      { from: '1_a.pdf', to: 'resources/u1/1_a.pdf' },
      { from: '2_b.png', to: 'resources/u1/2_b.png' },
    ],
    filePaths: ['resources/u1/1_a.pdf', 'resources/u1/2_b.png'],
  });

  // A missing source makes the whole post un-migratable (never half-migrated).
  plan = planMigration({ id: 'p2', authorId: 'u1', fileNames: ['1_a.pdf', 'gone.pdf'] }, (n) => n !== 'gone.pdf');
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /gone\.pdf/);

  // Already migrated -> nothing to do.
  assert.deepEqual(planMigration({ id: 'p3', authorId: 'u1', fileNames: ['a.pdf'], filePaths: ['resources/u1/a.pdf'] }, () => true),
    { ok: true, moves: [], filePaths: ['resources/u1/a.pdf'], skip: true });

  // No files, or no author -> not migratable, with a reason.
  assert.equal(planMigration({ id: 'p4', authorId: 'u1', fileNames: [] }, () => true).ok, false);
  assert.equal(planMigration({ id: 'p5', fileNames: ['a.pdf'] }, () => true).ok, false);

  // A name that would escape the prefix is refused.
  assert.equal(planMigration({ id: 'p6', authorId: 'u1', fileNames: ['../x.pdf'] }, () => true).ok, false);
  assert.equal(planMigration({ id: 'p7', authorId: 'u1', fileNames: ['a/b.pdf'] }, () => true).ok, false);

  // Destinations are ONE flat segment of the client's sanitised alphabet.
  const FLAT = /^resources\/u1\/[\w.\-぀-ヿ一-鿿]+$/;
  const odd = ['1_my exam (1).pdf', '2_過去問 2020.pdf', '3_a#b?.png', ' .pdf', 'x'.repeat(300) + '.pdf'];
  plan = planMigration({ id: 'p8', authorId: 'u1', fileNames: odd }, () => true);
  assert.equal(plan.ok, true);
  for (const to of plan.filePaths) assert.match(to, FLAT);
  assert.equal(new Set(plan.filePaths).size, odd.length);
  // Two different legacy names that sanitise identically must not collide.
  assert.notEqual(destName('a b.pdf'), destName('a_b.pdf'));
  assert.equal(destName('a_b.pdf'), 'a_b.pdf');
  // filePaths stay positionally aligned with fileNames (duplicates included).
  plan = planMigration({ id: 'p9', authorId: 'u1', fileNames: ['a.pdf', 'a.pdf'] }, () => true);
  assert.deepEqual(plan.filePaths, ['resources/u1/a.pdf', 'resources/u1/a.pdf']);
  assert.equal(plan.moves.length, 1);

  // Second-pass cleanup only for objects whose post points at the planned dest.
  assert.deepEqual(cleanupCandidates({ authorId: 'u1', fileNames: ['a.pdf'], filePaths: ['resources/u1/a.pdf'] }, () => true),
    [{ from: 'a.pdf', to: 'resources/u1/a.pdf' }]);
  assert.deepEqual(cleanupCandidates({ authorId: 'u1', fileNames: ['a.pdf'], filePaths: ['resources/u1/other.pdf'] }, () => true), []);

  // copy body keeps the standard headers and drops only the token.
  assert.deepEqual(copyBody({ contentType: 'image/png', cacheControl: 'x', metadata: { firebaseStorageDownloadTokens: 't', a: '1' } }, 'f.png'),
    { metadata: { a: '1', migratedFrom: 'f.png' }, contentType: 'image/png', cacheControl: 'x' });

  console.log('migrate_storage planner: OK');
  process.exit(0);
}

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.STORAGE_EMULATOR_HOST) {
  console.error('refusing to run outside the Firestore + Storage emulators');
  process.exit(1);
}
const PROJECT = 'demo-mstore';
const BUCKET = `${PROJECT}.firebasestorage.app`;

if (mode === 'run') {
  const [, , , code, expect, ...rest] = process.argv;
  const r = spawnSync('node', ['migrate_storage.mjs', '--project', PROJECT, ...rest], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  assert.equal(r.status, Number(code), `exit code ${r.status}`);
  assert.ok(r.stdout.includes(expect), `output lacks ${expect}`);
  process.exit(0);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const { getStorage } = await import('firebase-admin/storage');
initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
const db = getFirestore();
const bucket = getStorage().bucket();

const ODD = '3_my exam (1).pdf';
const ODD_DEST = `resources/u2/${destName(ODD)}`;
const body = (n) => Buffer.from(`content of ${n}`);
const exists = async (n) => (await bucket.file(n).exists())[0];
const token = async (n) => (await bucket.file(n).getMetadata())[0].metadata?.firebaseStorageDownloadTokens;
const post = async (id) => (await db.doc(`posts/${id}`).get()).data();

if (mode === 'seed') {
  for (const n of ['1_a.pdf', '2_b.png', ODD, '4_x.pdf', '5_c.pdf']) {
    await bucket.file(n).save(body(n), { contentType: 'application/pdf', metadata: { metadata: { firebaseStorageDownloadTokens: `tok-${n}` } } });
  }
  await bucket.file('resources/u3/5_c.pdf').save(body('5_c.pdf'), { metadata: { metadata: { firebaseStorageDownloadTokens: 'tok-old-run' } } }); // (token left by an earlier run)
  // already migrated earlier
  await db.doc('posts/p1').set({ authorId: 'u1', fileNames: ['1_a.pdf', '2_b.png'], fileUrls: ['https://x/1', 'https://x/2'], title: 'one' });
  await db.doc('posts/p2').set({ authorId: 'u1', fileNames: ['1_a.pdf', 'gone.pdf'], fileUrls: ['https://x/1', 'https://x/g'] });
  await db.doc('posts/p3').set({ authorId: 'u2', fileNames: [ODD], fileUrls: ['https://x/3'] });
  await db.doc('posts/p4').set({ fileNames: ['4_x.pdf'], fileUrls: ['https://x/4'] }); // no author
  await db.doc('posts/p5').set({ authorId: 'u3', fileNames: ['5_c.pdf'], filePaths: ['resources/u3/5_c.pdf'] });
  console.log('seeded');
} else if (mode === 'unchanged') {
  // After a dry run: nothing written anywhere.
  for (const id of ['p1', 'p2', 'p3', 'p4']) assert.equal((await post(id)).filePaths, undefined, id);
  assert.ok((await post('p1')).fileUrls);
  assert.equal(await exists('resources/u1/1_a.pdf'), false);
  assert.equal(await exists(ODD_DEST), false);
  // The seeded sources really carry a token (so the later no-token asserts mean something).
  assert.equal(await token('1_a.pdf'), 'tok-1_a.pdf');
  assert.equal(await token('resources/u3/5_c.pdf'), 'tok-old-run'); // dry run does not strip either
  console.log('unchanged: OK');
} else if (mode === 'migrated' || mode === 'deleted') {
  const p1 = await post('p1');
  assert.deepEqual(p1.filePaths, ['resources/u1/1_a.pdf', 'resources/u1/2_b.png']);
  assert.equal(p1.fileUrls, undefined);
  assert.deepEqual(p1.fileNames, ['1_a.pdf', '2_b.png']);
  assert.equal(p1.title, 'one');
  assert.deepEqual((await post('p3')).filePaths, [ODD_DEST]);
  assert.match(ODD_DEST, /^resources\/u2\/[^/]+$/);
  assert.deepEqual((await post('p3')).fileNames, [ODD]);
  for (const [id, key] of [['p2', 'filePaths'], ['p4', 'filePaths']]) assert.equal((await post(id))[key], undefined, id);
  assert.ok((await post('p2')).fileUrls);
  assert.ok((await post('p4')).fileUrls);
  // Copies are byte-identical.
  assert.equal((await bucket.file('resources/u1/2_b.png').download())[0].toString(), body('2_b.png').toString());
  assert.equal((await bucket.file(ODD_DEST).download())[0].toString(), body(ODD).toString());
  // No legacy download token survives on the private destinations (nor after re-runs).
  for (const d of ['resources/u1/1_a.pdf', 'resources/u1/2_b.png', ODD_DEST, 'resources/u3/5_c.pdf']) assert.equal(await token(d), undefined, d);
  // Copies keep their content type (not octet-stream).
  assert.equal((await bucket.file('resources/u1/1_a.pdf').getMetadata())[0].contentType, 'application/pdf');
  // Unmigratable posts' sources stay put in both modes.
  assert.equal(await exists('4_x.pdf'), true);
  if (mode === 'migrated') {
    for (const n of ['1_a.pdf', '2_b.png', ODD, '5_c.pdf']) assert.equal(await exists(n), true, n);
  } else {
    // Old objects deleted, except 1_a.pdf which p2 (a FAILed, untouched post) still needs.
    for (const n of ['2_b.png', ODD, '5_c.pdf']) assert.equal(await exists(n), false, n);
    assert.equal(await exists('1_a.pdf'), true);
    assert.equal(await exists('resources/u1/1_a.pdf'), true);
    assert.equal(await exists('resources/u3/5_c.pdf'), true);
  }
  console.log(`${mode}: OK`);
} else if (mode === 'stripfail') {
  // The already-migrated post p5 could not be stripped: its old object must survive --delete-old.
  assert.equal(await exists('5_c.pdf'), true);
  assert.equal(await token('resources/u3/5_c.pdf'), 'tok-old-run');
  console.log('stripfail: OK');
} else {
  console.error('unknown mode');
  process.exit(1);
}
