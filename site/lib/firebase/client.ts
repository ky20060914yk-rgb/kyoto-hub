import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

// Public web config (same as lib/firebase_options.dart `web`). Not a secret.
const config = {
  apiKey: 'AIzaSyA7Qa34Mlbab6fswJOYOP7-6cxGrM6Dk-k',
  authDomain: 'kyodai-sns.firebaseapp.com',
  projectId: 'kyodai-sns',
  storageBucket: 'kyodai-sns.firebasestorage.app',
  messagingSenderId: '932624635949',
  appId: '1:932624635949:web:34f33e93087e2b641ac0a4',
};

export const firebaseApp = getApps()[0] ?? initializeApp(config);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);

const g = globalThis as { __emu?: boolean };
if (process.env.NEXT_PUBLIC_USE_EMULATORS === '1' && !g.__emu) {
  g.__emu = true;
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}
