// Helpers for emulator-backed tests. Run through tools/test_site.sh.
import { adminAuth } from '@/lib/server/admin';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-site-test';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';

/**
 * Creates the user and returns an ID token. The Auth emulator issues unsigned
 * tokens and the Admin SDK accepts them when FIREBASE_AUTH_EMULATOR_HOST is set,
 * so the token is built here for the test project.
 */
export async function makeUser(email: string, verified: boolean, password = 'password123') {
  const user = await adminAuth.createUser({ email, password, emailVerified: verified });
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const idToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: now, iat: now, exp: now + 3600,
    sub: user.uid, user_id: user.uid, email, email_verified: verified, firebase: { identities: {}, sign_in_provider: 'password' },
  })}.`;
  return { uid: user.uid, idToken };
}

export async function clearEmulators() {
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  const fs = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  await fetch(`http://${fs}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

export const req = (token?: string, body?: unknown, method = 'POST') =>
  new Request('http://localhost/api/x', {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
