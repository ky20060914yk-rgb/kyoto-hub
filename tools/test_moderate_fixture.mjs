// Pure asserts + emulator fixture for moderate.mjs (Plan 2B, Task 12).
//
//   node test_moderate_fixture.mjs                     # pure asserts
//   node test_moderate_fixture.mjs seed|listcheck|still-hidden|restored|deleted|closed|reports-kept|reports-stripped
//
// The emulator modes refuse to run unless FIRESTORE_EMULATOR_HOST is set.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseArgs, safeText } from './moderate.mjs';

const mode = process.argv[2];

if (!mode) {
  assert.deepEqual(parseArgs(['list', '--project', 'p']).opts, { command: 'list', apply: false, project: 'p' });
  const r = parseArgs(['restore', 'p1', '--project', 'p', '--apply', '--operator', 'me', '--note', 'ok']).opts;
  assert.deepEqual([r.command, r.target, r.apply, r.operator, r.note], ['restore', 'p1', true, 'me', 'ok']);
  for (const bad of [
    [], ['frob', '--project', 'p'], ['list'], ['restore', '--project', 'p'],
    ['restore', 'p1', '--project', 'p', '--apply'], // --apply without --operator
    ['list', '--project', 'p', '--apply', '--operator', 'x'], // list is read-only
    ['restore', 'p1', 'p2', '--project', 'p'], ['strip-legacy-reports', 'p1', '--project', 'p'],
  ]) {
    assert.ok(parseArgs(bad).error, JSON.stringify(bad));
  }
  assert.equal(safeText('ok\u001b[2Jbad\nline'), 'ok?[2Jbad?line');
  assert.equal(safeText('x'.repeat(130)).length, 121);
  assert.equal(safeText(undefined), '');
  assert.equal(parseArgs(['restore', 'p1', '--project', 'p', '--apply', '--operator', '--note']).error, '--apply requires --operator <name>');
  console.log('moderate pure: OK');
  process.exit(0);
}

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('refusing to run outside the emulator'); process.exit(1); }
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ projectId: 'demo-mod' });
const db = getFirestore();
const get = async (p) => (await db.doc(p).get());

if (mode === 'seed') {
  await db.doc('hidden_posts/ph').set({
    authorId: 'ua', university_id: 'kyoto_u', title: '2024 期末', subjectId: 'c_1', category: 'past_exam',
    filePaths: ['resources/ua/1.pdf'], reports: ['old1'],
  });
  await db.doc('moderation_queue/ph').set({
    postId: 'ph', authorId: 'ua', postTitle: '2024 期末', subjectId: 'c_1', status: 'hidden', priority: 'normal',
    reportCount: 3, countedReports: 3, takedownRequestIds: [], hiddenBy: 'reports', hiddenByUid: null,
    autoHide: true, transitions: 1, needsReview: true, university_id: 'kyoto_u',
  });
  for (const r of ['r1', 'r2', 'r3']) await db.doc(`moderation_queue/ph/reports/${r}`).set({ counted: true, university_id: 'kyoto_u' });
  await db.doc('posts/pv').set({ authorId: 'ub', university_id: 'kyoto_u', title: 'visible', subjectId: 'c_1', category: 'other' });
  await db.doc('posts/pk').set({ authorId: 'uc', university_id: 'kyoto_u', title: 'legacy', subjectId: 'c_1', category: 'other', reports: ['x', 'y'] });
  await db.doc('takedown_requests/t1').set({
    status: 'open', verified: false, role: 'instructor', requesterName: 'Evil\u001b[2J', contactEmail: 'a@b.jp',
    description: 'please remove', postIds: ['ph'], university_id: 'kyoto_u',
  });
  await db.doc('posts/px').set({ authorId: 'ux', university_id: 'kyoto_u', title: 'to hide', subjectId: 'c_1', category: 'other' });
  // The same id live AND hidden: hide must fail and overwrite nothing.
  await db.doc('posts/pdup').set({ authorId: 'ud', university_id: 'kyoto_u', title: 'live copy', subjectId: 'c_1', category: 'other' });
  await db.doc('hidden_posts/pdup').set({ authorId: 'ud', university_id: 'kyoto_u', title: 'hidden copy', subjectId: 'c_1', category: 'other' });
  // A queue entry whose post is gone: delete retires it.
  await db.doc('moderation_queue/pghost').set({ postId: 'pghost', authorId: 'ug', status: 'open', needsReview: true, university_id: 'kyoto_u' });
  await db.doc('credit_balances/ua').set({ balance: 7, university_id: 'kyoto_u' });
  console.log('fixture seeded');
  process.exit(0);
}

if (mode === 'listcheck') {
  const r = spawnSync(process.execPath, ['moderate.mjs', 'list', '--project', 'demo-mod'], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('ph'), 'queue lists the hidden post');
  assert.ok(r.stdout.includes('UNVERIFIED'), 'request shows it is unverified');
  assert.ok(r.stdout.includes('Evil?[2J'), 'escape sequence neutralised');
  assert.ok(!r.stdout.includes('\u001b'), 'no raw ESC reaches the terminal');
  console.log('listcheck: assertions passed');
  process.exit(0);
}

const checks = {
  'dry-clean': async () => { // every dry run so far must have written nothing
    for (const id of ['px', 'pv', 'pk']) assert.equal((await get(`posts/${id}`)).exists, true, id);
    assert.equal((await get('hidden_posts/px')).exists, false);
    assert.equal((await get('takedown_requests/t1')).get('status'), 'open');
    assert.equal((await get('moderation_queue/pghost')).get('status'), 'open');
    assert.equal((await db.collection('moderation_log').get()).size, 0);
    assert.equal((await db.collection('notifications').get()).size, 0);
    assert.equal((await get('moderation_queue/px')).exists, false);
  },
  'hidden-x': async () => {
    assert.equal((await get('posts/px')).exists, false);
    assert.equal((await get('hidden_posts/px')).get('title'), 'to hide');
    const q = (await get('moderation_queue/px')).data();
    assert.deepEqual([q.status, q.hiddenBy, q.transitions], ['hidden', 'operator', 1]);
    const n = (await get('notifications/mod_px_1')).data();
    assert.deepEqual([n.uid, n.type], ['ux', 'post_hidden']);
    assert.equal((await db.collection('moderation_log').where('target', '==', 'px').get()).docs[0].get('by'), 'operator:tester');
  },
  'dup-untouched': async () => {
    assert.equal((await get('posts/pdup')).get('title'), 'live copy');
    assert.equal((await get('hidden_posts/pdup')).get('title'), 'hidden copy');
    assert.equal((await get('moderation_queue/pdup')).exists, false);
  },
  'ghost-retired': async () => {
    const q = (await get('moderation_queue/pghost')).data();
    assert.deepEqual([q.status, q.needsReview], ['removed', false]);
  },
  'still-hidden': async () => {
    assert.equal((await get('hidden_posts/ph')).exists, true);
    assert.equal((await get('posts/ph')).exists, false);
    assert.equal((await get('moderation_queue/ph')).get('status'), 'hidden');
  },
  restored: async () => {
    assert.equal((await get('posts/ph')).get('title'), '2024 期末');
    assert.equal((await get('hidden_posts/ph')).exists, false);
    const q = (await get('moderation_queue/ph')).data();
    assert.deepEqual([q.status, q.autoHide, q.transitions], ['restored', false, 2]);
    const n = (await get('notifications/mod_ph_2')).data();
    assert.deepEqual([n.uid, n.type, n.university_id], ['ua', 'post_restored', 'kyoto_u']);
    for (const r of ['r1', 'r2', 'r3']) assert.equal((await get(`moderation_actors/${r}`)).get('restoredReports'), 1);
    const log = (await db.collection('moderation_log').where('target', '==', 'ph').get()).docs.map((d) => d.get('by'));
    assert.deepEqual(log, ['operator:tester']);
    assert.equal((await get('credit_balances/ua')).get('balance'), 7); // M-4
  },
  deleted: async () => {
    assert.equal((await get('posts/pv')).exists, false);
    assert.equal((await get('moderation_queue/pv')).get('status'), 'removed');
    const n = (await get('notifications/mod_pv_1')).data();
    assert.deepEqual([n.uid, n.type], ['ub', 'post_removed']);
  },
  closed: async () => {
    assert.equal((await get('takedown_requests/t1')).get('status'), 'closed');
    assert.equal((await get('takedown_requests/t1')).get('closedBy'), 'tester');
  },
  'reports-kept': async () => {
    assert.deepEqual((await get('posts/pk')).get('reports'), ['x', 'y']);
    assert.deepEqual((await get('posts/ph')).get('reports'), ['old1']);
  },
  'reports-stripped': async () => {
    assert.equal((await get('posts/pk')).get('reports'), undefined);
    assert.equal((await get('posts/ph')).get('reports'), undefined);
    assert.equal((await get('posts/pk')).get('title'), 'legacy');
  },
};
if (!checks[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
await checks[mode]();
console.log(`${mode}: assertions passed`);
process.exit(0);
