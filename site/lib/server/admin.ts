import 'server-only';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Credentials: Application Default Credentials on App Hosting, emulators
// locally (FIREBASE_*_EMULATOR_HOST). Never a key file in the repo.
export const adminApp =
  getApps()[0] ??
  initializeApp({
    // Tests run under their own emulator project (GCLOUD_PROJECT=demo-site-test) so they never touch dev data.
    projectId: process.env.GCLOUD_PROJECT ?? 'kyodai-sns',
    storageBucket: 'kyodai-sns.firebasestorage.app',
  });
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
export const adminBucket = getStorage(adminApp).bucket();
