// Emulator test helper: asserts the `courses` collection was seeded with > 1000 docs.
// Relies on FIRESTORE_EMULATOR_HOST being set by `firebase emulators:exec`.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: 'demo-seed' });
const snap = await getFirestore().collection('courses').count().get();
const n = snap.data().count;
console.log('seeded', n);
process.exit(n > 1000 ? 0 : 1);
