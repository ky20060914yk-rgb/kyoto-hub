// Helpers for emulator-backed tests. Run through tools/test_site.sh.
import { adminAuth } from '@/lib/server/admin';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';

export async function makeUser(email: string, verified: boolean, password = 'password123') {
  const user = await adminAuth.createUser({ email, password, emailVerified: verified });
  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) },
  );
  const { idToken } = (await res.json()) as { idToken: string };
  return { uid: user.uid, idToken };
}

export async function clearEmulators() {
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/kyodai-sns/accounts`, { method: 'DELETE' });
  const fs = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  await fetch(`http://${fs}/emulator/v1/projects/kyodai-sns/databases/(default)/documents`, { method: 'DELETE' });
}

export const req = (token?: string, body?: unknown, method = 'POST') =>
  new Request('http://localhost/api/x', {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
