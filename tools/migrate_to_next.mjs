// Cutover migration for the Next.js site (docs/cutover.md, spec 2026-10-08 §8).
//
// Legacy Flutter documents only know `subjectId` (a courses/{id} doc id) and,
// for posts, public download URLs in `fileUrls`. The Next.js site reads
// `courseKey` and serves files from the private `resources/` prefix. This script:
//
//   posts     — sets courseId / courseKey / dedupKey / hidden, copies every file
//               behind `fileUrls` to resources/{postId}/{i}_{name} and records
//               `filePaths`. The original objects are NOT deleted (do that by
//               hand once the new site has been verified).
//   requests  — sets courseId / courseKey.
//   course_stats — recounts pastExamPostCount / resourcePostCount from the
//               visible posts (plain integers: re-running gives the same result).
//
// Idempotent: posts that already have `filePaths` and `courseKey` are skipped.
// Dry run by default; pass --apply to write.
//
// Auth: Application Default Credentials / GOOGLE_APPLICATION_CREDENTIALS, or the
// emulators via FIRESTORE_EMULATOR_HOST + FIREBASE_STORAGE_EMULATOR_HOST.
//
// Usage:
//   node migrate_to_next.mjs --project kyodai-sns            # report only
//   node migrate_to_next.mjs --project kyodai-sns --apply    # write

import { readFile } from 'node:fs/promises';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const projectId = flag('--project') || process.env.GCLOUD_PROJECT;
const apply = args.includes('--apply');
const bucketName = flag('--bucket', 'kyodai-sns.firebasestorage.app');
if (!projectId) { console.error('missing --project'); process.exit(1); }

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
initializeApp({
  projectId,
  storageBucket: bucketName,
  ...(emulated ? {} : { credential: keyPath ? cert(JSON.parse(await readFile(keyPath, 'utf-8'))) : applicationDefault() }),
});
const db = getFirestore();
const bucket = getStorage().bucket();

// Same rules as site/lib/domain/review.ts#slug and resource.ts#safeFileName / dedupKey.
const slug = (k) => k.replaceAll('%', '%25').replaceAll('/', '%2F');
const safeFileName = (n) => ((n.normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()) || 'file').slice(-100);
const dedupKey = (courseKey, p) => `${courseKey}|${p.category === 'past_exam' ? 'past_exam' : 'test_prep'}|${p.year ?? '-'}|${p.examType ?? '-'}`;

/** Object path inside the bucket from a Firebase download URL (…/o/<encoded path>?alt=media…). */
export function objectPath(url) {
  try {
    const m = new URL(url).pathname.match(/\/o\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

const courseCache = new Map();
async function course(id) {
  if (!id) return null;
  if (!courseCache.has(id)) {
    const d = (await db.collection('courses').doc(String(id)).get()).data();
    courseCache.set(id, d?.courseKey ? { id: String(id), courseKey: d.courseKey } : null);
  }
  return courseCache.get(id);
}

const report = { posts: 0, postsMigrated: 0, postsSkipped: 0, filesCopied: 0, missingFiles: [], unresolved: [], requests: 0, requestsMigrated: 0 };

// --- posts -------------------------------------------------------------------
const posts = await db.collection('posts').get();
report.posts = posts.size;
for (const doc of posts.docs) {
  const p = doc.data();
  if (p.courseKey && Array.isArray(p.filePaths) && p.filePaths.length) { report.postsSkipped++; continue; }
  const c = await course(p.courseId ?? p.subjectId);
  if (!c) { report.unresolved.push(`posts/${doc.id}`); continue; }
  const urls = Array.isArray(p.fileUrls) ? p.fileUrls : [];
  const names = Array.isArray(p.fileNames) ? p.fileNames : [];
  const filePaths = [];
  const fileNames = [];
  for (let i = 0; i < urls.length; i++) {
    const from = objectPath(urls[i]);
    const name = safeFileName(names[i] ?? from?.split('/').pop() ?? `file${i}`);
    const to = `resources/${doc.id}/${i}_${name}`;
    if (!from) { report.missingFiles.push(`${doc.id}#${i} (bad url)`); continue; }
    if (apply) {
      const [exists] = await bucket.file(from).exists();
      if (!exists) { report.missingFiles.push(`${doc.id}#${i} ${from}`); continue; }
      await bucket.file(from).copy(bucket.file(to));
    }
    filePaths.push(to);
    fileNames.push(name);
    report.filesCopied++;
  }
  const reports = Array.isArray(p.reports) ? p.reports : [];
  if (apply) {
    await doc.ref.set({
      courseId: c.id, courseKey: c.courseKey, filePaths, fileNames, hidden: reports.length >= 3 || p.hidden === true,
      dedupKey: dedupKey(c.courseKey, p), university_id: 'kyoto_u',
    }, { merge: true });
  }
  report.postsMigrated++;
}

// --- requests ----------------------------------------------------------------
const requests = await db.collection('requests').get();
report.requests = requests.size;
for (const doc of requests.docs) {
  const r = doc.data();
  if (r.courseKey) continue;
  const c = await course(r.courseId ?? r.subjectId);
  if (!c) { report.unresolved.push(`requests/${doc.id}`); continue; }
  if (apply) await doc.ref.set({ courseId: c.id, courseKey: c.courseKey }, { merge: true });
  report.requestsMigrated++;
}

// --- course_stats post counters ------------------------------------------------
const counts = new Map();
for (const doc of (await db.collection('posts').get()).docs) {
  const p = doc.data();
  const c = p.courseKey ? { courseKey: p.courseKey } : await course(p.courseId ?? p.subjectId);
  if (!c || p.hidden === true || (Array.isArray(p.reports) && p.reports.length >= 3)) continue;
  const cur = counts.get(c.courseKey) ?? { pastExamPostCount: 0, resourcePostCount: 0 };
  if (p.category === 'past_exam') cur.pastExamPostCount++;
  else cur.resourcePostCount++;
  counts.set(c.courseKey, cur);
}
if (apply) {
  for (const [courseKey, v] of counts) {
    await db.collection('course_stats').doc(slug(courseKey)).set({ courseKey, university_id: 'kyoto_u', ...v }, { merge: true });
  }
}

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report, statsCourses: counts.size }, null, 2));
