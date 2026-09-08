// Emulator fixture + assertions for backfill_post_counts.mjs.
//
//   node test_backfill_fixture.mjs seed    # a course + posts pointing at it
//   node test_backfill_fixture.mjs check   # assert the recounted course_stats
//
// Relies on FIRESTORE_EMULATOR_HOST being set by `firebase emulators:exec`, so
// it can never touch a real project.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('refusing to run outside the emulator');
  process.exit(1);
}

initializeApp({ projectId: 'demo-backfill' });
const db = getFirestore();
const mode = process.argv[2];

const COURSE_ID = 'c_x';
const COURSE_KEY = '線形代数a|山田太郎';
// A second course doc sharing the SAME courseKey (the same lecture in another
// slot) — its posts must accumulate onto the one stats doc, not overwrite it.
const COURSE_ID_2 = 'c_y';
// A post pointing at a course that does not exist: must be skipped, not crash.
const ORPHAN_ID = 'c_missing';

if (mode === 'seed') {
  await db.doc(`courses/${COURSE_ID}`).set({
    id: COURSE_ID, courseKey: COURSE_KEY, university_id: 'kyoto_u', name: '線形代数A',
  });
  await db.doc(`courses/${COURSE_ID_2}`).set({
    id: COURSE_ID_2, courseKey: COURSE_KEY, university_id: 'kyoto_u', name: '線形代数A',
  });
  await db.doc('posts/p1').set({
    authorId: 'u1', university_id: 'kyoto_u', subjectId: COURSE_ID,
    category: 'past_exam', title: '2024年度期末',
  });
  await db.doc('posts/p2').set({
    authorId: 'u1', university_id: 'kyoto_u', subjectId: COURSE_ID,
    category: 'other', title: 'ノート',
  });
  await db.doc('posts/p3').set({
    authorId: 'u2', university_id: 'kyoto_u', subjectId: COURSE_ID_2,
    category: 'test_prep', title: '対策',
  });
  await db.doc('posts/p4').set({
    authorId: 'u2', university_id: 'kyoto_u', subjectId: ORPHAN_ID,
    category: 'past_exam', title: 'orphan',
  });
  // A stats doc that already carries review data AND a wrong (negative) counter
  // — the backfill must fix the counters and leave reviewCount alone.
  await db.doc(`course_stats/${COURSE_KEY}`).set({
    courseKey: COURSE_KEY, university_id: 'kyoto_u',
    reviewCount: 7, ratingSum: 28, pastExamPostCount: -1,
  });
  console.log('fixture seeded');
  process.exit(0);
}

if (mode !== 'check') { console.error(`unknown mode ${mode}`); process.exit(1); }

const failures = [];
const eq = (label, actual, expected) => {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
  else console.log(`  ok  ${label} = ${actual}`);
};

const snap = await db.doc(`course_stats/${COURSE_KEY}`).get();
if (!snap.exists) {
  console.error(`FAILED: course_stats/${COURSE_KEY} was not written`);
  process.exit(1);
}
const s = snap.data();
// p1 (past_exam) -> 1 ; p2 (other) + p3 (test_prep) -> 2 ; p4 orphan -> skipped
eq('pastExamPostCount', s.pastExamPostCount, 1);
eq('resourcePostCount', s.resourcePostCount, 2);
eq('courseKey', s.courseKey, COURSE_KEY);
eq('university_id', s.university_id, 'kyoto_u');
// merge:true — the review aggregate must survive untouched.
eq('reviewCount preserved', s.reviewCount, 7);
eq('ratingSum preserved', s.ratingSum, 28);

// The orphan post must NOT have produced a stats doc of its own.
const orphanStats = await db.collection('course_stats').get();
eq('course_stats doc count', orphanStats.size, 1);

if (failures.length > 0) {
  console.error('FAILED:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('backfill assertions passed');
process.exit(0);
