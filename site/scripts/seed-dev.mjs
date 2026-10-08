// Seeds the local emulators with the real course catalog (tools/courses.json) and a few reviews.
// Usage (emulators running): FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-dev.mjs
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Refusing to seed without FIRESTORE_EMULATOR_HOST');
const db = getFirestore(initializeApp({ projectId: 'kyodai-sns' }));
const courses = JSON.parse(readFileSync(new URL('../../tools/courses.json', import.meta.url), 'utf8'));
for (let i = 0; i < courses.length; i += 400) {
  const b = db.batch();
  for (const c of courses.slice(i, i + 400)) b.set(db.collection('courses').doc(c.id), c);
  await b.commit();
}
console.log(`seeded ${courses.length} courses`);
