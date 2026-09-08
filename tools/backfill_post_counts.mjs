// Authoritative recount of the `course_stats` post counters (Task 8 fix round 1).
//
// Task 8 started maintaining two counters on `course_stats/{courseKey}`:
//
//   pastExamPostCount  — # of posts with category 'past_exam'
//   resourcePostCount  — # of posts with category 'test_prep' or 'other'
//
// They are driven client-side by `FieldValue.increment` from
// `AppStore._bumpPostCountFor`. Every post that already existed when that
// shipped never issued its `+1`, so the stored totals start at 0 (or, once one
// of those old posts is deleted, go NEGATIVE). This script recounts from the
// `posts` collection itself and writes the true totals.
//
// It writes PLAIN INTEGERS, not `FieldValue.increment` — this is a recount, not
// a delta, so a re-run recomputes exactly the same totals (idempotent). Run it
// ONCE after the Task 8 client deploys; running it again later is harmless but
// will lose any bumps that land between the read and the write.
//
// courseKey resolution: `posts/{id}.subjectId` is a `courses/{id}` document id
// (post-C2 migration), and the courseKey lives on that course doc. Posts whose
// subjectId resolves to no course, or to a course with an empty courseKey, are
// counted as skipped and reported.
//
// The other `course_stats` fields (reviewCount, the bucket maps, lastReviewAt)
// are NOT touched: every write is `set(..., { merge: true })` carrying only the
// two counters plus the doc's own identity fields.
//
// Auth: identical to seed_courses.mjs / migrate_ids.mjs — Application Default
// Credentials, or GOOGLE_APPLICATION_CREDENTIALS, or FIRESTORE_EMULATOR_HOST
// for the emulator.
//
// Usage:
//   node backfill_post_counts.mjs --project kyodai-sns --dry-run   # report only
//   node backfill_post_counts.mjs --project kyodai-sns             # write
//   FIRESTORE_EMULATOR_HOST=localhost:8080 node backfill_post_counts.mjs --project demo

import { readFile } from 'node:fs/promises';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const projectId = flag('--project') || process.env.GCLOUD_PROJECT;
const dryRun = args.includes('--dry-run');
const universityId = flag('--university', 'kyoto_u');
if (!projectId) { console.error('missing --project'); process.exit(1); }

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
initializeApp({
  projectId,
  credential: keyPath ? cert(JSON.parse(await readFile(keyPath, 'utf-8'))) : applicationDefault(),
});
const db = getFirestore();

// --- 1. read every post, group by subjectId ---------------------------------

const postsSnap = await db.collection('posts').get();
// subjectId -> { pastExam, resource }
const bySubject = new Map();
let malformed = 0;
for (const d of postsSnap.docs) {
  const data = d.data() || {};
  const subjectId = typeof data.subjectId === 'string' ? data.subjectId : '';
  if (!subjectId) { malformed += 1; continue; }
  const entry = bySubject.get(subjectId) || { pastExam: 0, resource: 0 };
  // Mirrors PostCategoryX.fromString: anything that is not 'past_exam' or
  // 'test_prep' reads as 'other', and 'other' counts toward resourcePostCount.
  if (data.category === 'past_exam') entry.pastExam += 1;
  else entry.resource += 1;
  bySubject.set(subjectId, entry);
}
console.log(`posts: ${postsSnap.size} documents, ${bySubject.size} distinct subjectIds, ${malformed} without a subjectId`);

// --- 2. resolve subjectId -> courseKey, tally per courseKey -----------------

// courseKey -> { pastExamPostCount, resourcePostCount }
const byCourseKey = new Map();
const unresolved = [];
for (const [subjectId, counts] of bySubject) {
  const courseDoc = await db.collection('courses').doc(subjectId).get();
  const ck = courseDoc.exists ? courseDoc.data()?.courseKey : undefined;
  if (typeof ck !== 'string' || ck === '') {
    unresolved.push([subjectId, counts.pastExam + counts.resource]);
    continue;
  }
  // Several course docs can share one courseKey (the same lecture in different
  // slots), so the totals accumulate rather than overwrite.
  const acc = byCourseKey.get(ck) || { pastExamPostCount: 0, resourcePostCount: 0 };
  acc.pastExamPostCount += counts.pastExam;
  acc.resourcePostCount += counts.resource;
  byCourseKey.set(ck, acc);
}
console.log(`resolved: ${byCourseKey.size} courseKeys, ${unresolved.length} subjectIds with no course / no courseKey`);
for (const [subjectId, n] of unresolved.slice(0, 20)) {
  console.log(`  unresolved courses/${subjectId} (${n} post(s) not counted)`);
}
if (unresolved.length > 20) console.log(`  ... and ${unresolved.length - 20} more`);

// --- 3. write the recounted totals ------------------------------------------

const writes = [];
for (const [courseKey, totals] of byCourseKey) {
  writes.push([
    db.collection('course_stats').doc(courseKey),
    {
      courseKey,
      university_id: universityId,
      pastExamPostCount: totals.pastExamPostCount,
      resourcePostCount: totals.resourcePostCount,
    },
  ]);
}

if (dryRun) {
  console.log('--- DRY RUN, nothing written ---');
  for (const [ref, data] of writes.slice(0, 20)) {
    console.log(`  course_stats/${ref.id}: pastExam=${data.pastExamPostCount} resource=${data.resourcePostCount}`);
  }
  if (writes.length > 20) console.log(`  ... and ${writes.length - 20} more`);
} else {
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const [ref, data] of writes.slice(i, i + 400)) batch.set(ref, data, { merge: true });
    await batch.commit();
  }
  console.log('--- backfill applied ---');
}
console.log(`  course_stats docs written: ${dryRun ? 0 : writes.length} (of ${writes.length} computed)`);
console.log('done');
