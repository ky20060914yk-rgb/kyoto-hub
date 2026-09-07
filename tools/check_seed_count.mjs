// Emulator test helper: asserts the `courses` collection was seeded with > 1000 docs.
// Relies on FIRESTORE_EMULATOR_HOST being set by `firebase emulators:exec`.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: 'demo-seed' });
const db = getFirestore();
const snap = await db.collection('courses').count().get();
const n = snap.data().count;
console.log('seeded', n);
if (n <= 1000) process.exit(1);

// M1: every seeded course must carry a `category`, otherwise the picker falls
// back to CourseRepository's '専門/教養' default for the whole catalog.
const sample = await db.collection('courses').limit(200).get();
const missing = sample.docs.filter((d) => !d.data().category);
console.log(`sampled ${sample.size} docs, ${missing.length} missing category`);
if (missing.length > 0) process.exit(1);

// C3: the seed must publish a catalog version for the client's staleness check.
const meta = await db.collection('meta').doc('catalog').get();
console.log('meta/catalog', JSON.stringify(meta.data() ?? null));
if (!meta.exists || typeof meta.data().version !== 'number') process.exit(1);

process.exit(0);
