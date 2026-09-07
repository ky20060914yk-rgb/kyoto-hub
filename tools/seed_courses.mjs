// Seed the `courses` collection from tools/courses.json.
//
// Auth: uses Application Default Credentials. Either
//   `firebase login` + `firebase use kyodai-sns` then run with FIRESTORE via
//   GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key, or run
//   against the emulator with FIRESTORE_EMULATOR_HOST=localhost:8080.
//
// Usage:
//   node seed_courses.mjs --project kyodai-sns            # real project
//   FIRESTORE_EMULATOR_HOST=localhost:8080 node seed_courses.mjs --project demo
//   node seed_courses.mjs --project kyodai-sns --dry-run

import { readFile } from 'node:fs/promises';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const pi = args.indexOf('--project');
const projectId = (pi >= 0 ? args[pi + 1] : undefined) || process.env.GCLOUD_PROJECT;
const dryRun = args.includes('--dry-run');
if (!projectId) { console.error('missing --project'); process.exit(1); }

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
initializeApp({
  projectId,
  credential: keyPath ? cert(JSON.parse(await readFile(keyPath, 'utf-8'))) : applicationDefault(),
});
const db = getFirestore();

const courses = JSON.parse(await readFile(new URL('./courses.json', import.meta.url), 'utf-8'));
console.log(`${courses.length} courses to seed (dryRun=${dryRun})`);

let written = 0;
for (let i = 0; i < courses.length; i += 400) {
  const chunk = courses.slice(i, i + 400);
  if (dryRun) { written += chunk.length; continue; }
  const batch = db.batch();
  for (const c of chunk) {
    if (!c.id) { console.warn('skipping course with no id'); continue; }
    batch.set(db.collection('courses').doc(c.id), { ...c, university_id: 'kyoto_u' }, { merge: true });
  }
  await batch.commit();
  written += chunk.length;
  console.log(`  ${written}/${courses.length}`);
}

// Bump the catalog version (C3). CourseRepository loads `courses` from the
// on-device Firestore cache and only goes back to the server when this version
// differs from the one it last loaded at. Without the bump, a client that
// already cached the previous catalog would keep serving it forever.
if (!dryRun) {
  const metaRef = db.collection('meta').doc('catalog');
  const prev = await metaRef.get();
  const version = ((prev.exists ? prev.data().version : 0) || 0) + 1;
  await metaRef.set({
    version,
    courseCount: courses.length,
    seededAt: new Date().toISOString(),
  }, { merge: true });
  console.log(`meta/catalog.version -> ${version}`);
}
console.log('done');
