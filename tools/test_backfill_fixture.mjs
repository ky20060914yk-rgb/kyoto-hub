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
// C1 — a courseKey containing '/'. 17 courses in the deployed catalog carry one
// (`river/coastalengineering|後藤仁志`). '/' is a path separator in a document id,
// so `db.collection('course_stats').doc(courseKey)` THREW while the script was
// still building its ref list — before any batch.commit() — and the whole
// backfill wrote NOTHING and exited non-zero. The script slugs the id now
// (same escape as `Review.slug`), so it must write here.
const COURSE_ID_3 = 'c_slash';
const COURSE_KEY_SLASH = 'river/coastalengineering|後藤仁志';
const COURSE_KEY_SLASH_SLUG = 'river%2Fcoastalengineering|後藤仁志';

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
  // C1 fixture: a course whose courseKey has a '/', plus two posts on it.
  await db.doc(`courses/${COURSE_ID_3}`).set({
    id: COURSE_ID_3, courseKey: COURSE_KEY_SLASH, university_id: 'kyoto_u',
    name: 'River/Coastal Engineering',
  });
  await db.doc('posts/p5').set({
    authorId: 'u3', university_id: 'kyoto_u', subjectId: COURSE_ID_3,
    category: 'past_exam', title: '2023期末',
  });
  await db.doc('posts/p6').set({
    authorId: 'u3', university_id: 'kyoto_u', subjectId: COURSE_ID_3,
    category: 'test_prep', title: 'まとめ',
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

// C1 — the slash course must have been written, under the SLUGGED document id,
// and the script must not have thrown on its way there (a throw would have
// aborted before any commit, so the assertions above would have failed too).
const slashSnap = await db.doc(`course_stats/${COURSE_KEY_SLASH_SLUG}`).get();
if (!slashSnap.exists) {
  console.error(`FAILED: course_stats/${COURSE_KEY_SLASH_SLUG} was not written`);
  process.exit(1);
}
const ss = slashSnap.data();
eq('slash pastExamPostCount', ss.pastExamPostCount, 1);
eq('slash resourcePostCount', ss.resourcePostCount, 1);
// The RAW key stays in the field; only the document id is escaped.
eq('slash courseKey field is unescaped', ss.courseKey, COURSE_KEY_SLASH);

// The orphan post must NOT have produced a stats doc of its own; the two real
// courseKeys must have produced exactly one doc each.
const allStats = await db.collection('course_stats').get();
eq('course_stats doc count', allStats.size, 2);
// No document id may contain a path separator.
for (const d of allStats.docs) {
  eq(`doc id "${d.id}" has no /`, d.id.includes('/'), false);
}

if (failures.length > 0) {
  console.error('FAILED:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('backfill assertions passed');
process.exit(0);
