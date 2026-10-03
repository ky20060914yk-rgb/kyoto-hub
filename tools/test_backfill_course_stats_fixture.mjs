// Pure asserts + emulator fixture for backfill_course_stats.mjs (Plan 2B, Task 11).
//
//   node test_backfill_course_stats_fixture.mjs                       # pure asserts
//   node test_backfill_course_stats_fixture.mjs seed|unchanged|check|pruned
//   node test_backfill_course_stats_fixture.mjs run <stdout-substring> [tool args]
//
// The emulator modes refuse to run unless FIRESTORE_EMULATOR_HOST is set.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseArgs, diffStats } from './backfill_course_stats.mjs';

const mode = process.argv[2];

if (!mode) {
  assert.deepEqual(parseArgs(['--project', 'p']), { opts: { apply: false, pruneOrphans: false, project: 'p' } });
  assert.equal(parseArgs(['--project', 'p', '--apply']).opts.apply, true);
  for (const bad of [[], ['--apply'], ['--project', 'p', '--prune-orphans'], ['--project', 'p', '--apply', '--dry-run'],
    ['--project', 'p', '--frobnicate'], ['--project', '--apply']]) {
    assert.ok(parseArgs(bad).error, JSON.stringify(bad));
  }
  assert.deepEqual(diffStats({ m: { y: 1, x: 2 }, aggregatedAt: { seconds: 1 } }, { m: { x: 2, y: 1 } }), []);
  assert.deepEqual(diffStats({ reviewCount: 99, pinned: true }, { reviewCount: 2 }), ['pinned', 'reviewCount']);
  assert.deepEqual(diffStats(undefined, { reviewCount: 0 }), ['reviewCount']);
  console.log('backfill_course_stats pure: OK');
  process.exit(0);
}

if (mode === 'run') {
  const [want, ...args] = process.argv.slice(3);
  const r = spawnSync(process.execPath, ['backfill_course_stats.mjs', ...args], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (r.status !== 0) { console.error(`FAILED: tool exited ${r.status}`); process.exit(1); }
  if (!r.stdout.includes(want)) { console.error(`FAILED: output lacks "${want}"`); process.exit(1); }
  process.exit(0);
}

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('refusing to run outside the emulator'); process.exit(1); }
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ projectId: 'demo-cstats' });
const db = getFirestore();

const K1 = '線形代数a|山田太郎';
const KS = 'river/coastal|後藤'; // C1: a '/' in the courseKey
const KS_SLUG = 'river%2Fcoastal|後藤';
const KBAD = '__bad__'; // slug is a reserved doc id: skipped, never aborts
const KGONE = 'gone|nobody'; // has an aggregate but no reviews or posts any more
const R = (ck, over) => ({
  courseKey: ck, authorId: 'x', university_id: 'kyoto_u', rakutan: 'raku', attendance: 'none',
  grading: 'exam_only', pastExam: 'as_is', bringIn: 'no', helpfulBy: [], ...over,
});

if (mode === 'seed') {
  for (const [id, ck] of [['c_x', K1], ['c_y', K1], ['c_s', KS]]) {
    await db.doc(`courses/${id}`).set({ id, courseKey: ck, name: 'n', university_id: 'kyoto_u' });
  }
  await db.doc(`reviews/${K1}_u1`).set(R(K1, { rating: 5, updatedAt: '2026-09-01T00:00:00.000' }));
  await db.doc(`reviews/${K1}_u2`).set(R(K1, { rating: 3, rakutan: 'muzu', attendance: 'heavy', updatedAt: '2026-09-02T00:00:00.000' }));
  await db.doc(`reviews/${KS_SLUG}_u3`).set(R(KS, { rating: 4, updatedAt: '2026-09-03T00:00:00.000' }));
  await db.doc('posts/p1').set({ authorId: 'u1', subjectId: 'c_x', category: 'past_exam', university_id: 'kyoto_u' });
  await db.doc('posts/p2').set({ authorId: 'u1', subjectId: 'c_x', category: 'other', university_id: 'kyoto_u' });
  await db.doc('posts/p3').set({ authorId: 'u2', subjectId: 'c_y', category: 'test_prep', university_id: 'kyoto_u' });
  await db.doc('posts/p4').set({ authorId: 'u2', subjectId: 'c_missing', category: 'past_exam', university_id: 'kyoto_u' });
  await db.doc('hidden_posts/h1').set({ authorId: 'u3', subjectId: 'c_x', category: 'past_exam', university_id: 'kyoto_u' });
  await db.doc('reviews/bad_u9').set(R(KBAD, { rating: 4, updatedAt: '2026-09-04T00:00:00.000' }));
  // A client-forged aggregate (old rules) and a stale one.
  await db.doc(`course_stats/${K1}`).set({ courseKey: K1, university_id: 'kyoto_u', reviewCount: 99, score: 100, pinned: true });
  await db.doc(`course_stats/${KGONE}`).set({ courseKey: KGONE, university_id: 'kyoto_u', reviewCount: 5, ratingSum: 20 });
  // An orphan: its id is not the slug of its courseKey, so no Function ever writes it.
  await db.doc('course_stats/forged_id').set({ courseKey: 'something else', reviewCount: 3 });
  console.log('fixture seeded');
  process.exit(0);
}

const failures = [];
const eq = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  else console.log(`  ok  ${label}`);
};
const stats = async (id) => (await db.doc(`course_stats/${id}`).get()).data();

if (mode === 'unchanged') {
  eq('dry run left the forged K1 doc alone', (await stats(K1))?.reviewCount, 99);
  eq('dry run wrote no slash doc', await stats(KS_SLUG), undefined);
} else if (mode === 'check') {
  const k1 = await stats(K1);
  eq('K1 reviewCount', k1.reviewCount, 2);
  eq('K1 ratingSum', k1.ratingSum, 8);
  eq('K1 score', k1.score, 55);
  eq('K1 pastExamPostCount (hidden h1 excluded)', k1.pastExamPostCount, 1);
  eq('K1 resourcePostCount (across c_x and c_y)', k1.resourcePostCount, 2);
  eq('K1 lastReviewAt', k1.lastReviewAt, '2026-09-02T00:00:00.000');
  eq('K1 forged field gone', k1.pinned, undefined);
  eq('K1 university_id', k1.university_id, 'kyoto_u');
  const ks = await stats(KS_SLUG);
  eq('slash doc under the slugged id', ks?.reviewCount, 1);
  eq('slash doc keeps the raw courseKey', ks?.courseKey, KS);
  const gone = await stats(KGONE);
  eq('stale aggregate zeroed', [gone.reviewCount, gone.ratingSum, gone.score], [0, 0, 50]);
  eq('orphan kept without --prune-orphans', (await stats('forged_id'))?.reviewCount, 3);
  eq('no aggregate for the orphan\'s key', await stats('something else'), undefined);
  eq('no aggregate for the unusable key', (await db.collection('course_stats').where('courseKey', '==', KBAD).get()).size, 0);
  for (const d of (await db.collection('course_stats').get()).docs) eq(`id "${d.id}" has no /`, d.id.includes('/'), false);
} else if (mode === 'pruned') {
  eq('orphan pruned', await stats('forged_id'), undefined);
  eq('K1 untouched by pruning', (await stats(K1)).reviewCount, 2);
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
if (failures.length) { console.error(`FAILED:\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log(`${mode}: assertions passed`);
process.exit(0);
