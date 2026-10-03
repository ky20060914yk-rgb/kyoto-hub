import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, deleteObject, listAll } from 'firebase/storage';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules',
    storage: { rules: readFileSync('../storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});
after(() => env.cleanup());

const KU = { sub: 'u1', email: 'a@st.kyoto-u.ac.jp', email_verified: true };
const KU_UNVERIFIED = { sub: 'u2', email: 'b@st.kyoto-u.ac.jp', email_verified: false };
const OUTSIDER = { sub: 'u3', email: 'c@gmail.com', email_verified: true };
const st = (uid, claims) => env.authenticatedContext(uid, claims).storage();
const bytes = new Uint8Array([1, 2, 3]);
const pdf = { contentType: 'application/pdf' };

test('a verified KU user may upload a PDF or image under their own prefix', async () => {
  await assertSucceeds(uploadBytes(ref(st('u1', KU), 'resources/u1/1_a.pdf'), bytes, pdf));
  await assertSucceeds(uploadBytes(ref(st('u1', KU), 'resources/u1/2_a.png'), bytes, { contentType: 'image/png' }));
});

test('uploads to another user’s prefix, the bucket root, or other folders are denied', async () => {
  const s = st('u1', KU);
  await assertFails(uploadBytes(ref(s, 'resources/u2/1_a.pdf'), bytes, pdf));
  await assertFails(uploadBytes(ref(s, '1_a.pdf'), bytes, pdf)); // the old public root layout
  await assertFails(uploadBytes(ref(s, 'elsewhere/u1/a.pdf'), bytes, pdf));
  await assertFails(uploadBytes(ref(s, 'resources/u1/sub/dir/a.pdf'), bytes, pdf));
  await assertFails(uploadBytes(ref(s, 'resources/u1/../u2/a.pdf'), bytes, pdf)); // traversal-style name
  await assertFails(uploadBytes(ref(s, 'resources/u2/../u2/a.pdf'), bytes, pdf));
  await assertFails(uploadBytes(ref(s, 'resources/a.pdf'), bytes, pdf));
});

test('unverified, outsider and anonymous users cannot upload', async () => {
  await assertFails(uploadBytes(ref(st('u2', KU_UNVERIFIED), 'resources/u2/1_a.pdf'), bytes, pdf));
  await assertFails(uploadBytes(ref(st('u3', OUTSIDER), 'resources/u3/1_a.pdf'), bytes, pdf));
  await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), 'resources/u1/1_a.pdf'), bytes, pdf));
});

test('only PDFs and images, at most 20 MiB', async () => {
  const s = st('u1', KU);
  await assertFails(uploadBytes(ref(s, 'resources/u1/x.exe'), bytes, { contentType: 'application/x-msdownload' }));
  await assertFails(uploadBytes(ref(s, 'resources/u1/x.html'), bytes, { contentType: 'text/html' }));
  await assertSucceeds(uploadBytes(ref(s, 'resources/u1/exact.pdf'), new Uint8Array(20 * 1024 * 1024), pdf)); // boundary: exactly 20 MiB
  await assertFails(uploadBytes(ref(s, 'resources/u1/nomime.pdf'), bytes)); // no content type
  await assertFails(uploadBytes(ref(s, 'resources/u1/big.pdf'), new Uint8Array(20 * 1024 * 1024 + 1), pdf));
});

test('SVG (script-capable) and other image types are denied; png/jpeg/webp are allowed', async () => {
  const s = st('u1', KU);
  await assertFails(uploadBytes(ref(s, 'resources/u1/x.svg'), bytes, { contentType: 'image/svg+xml' }));
  await assertFails(uploadBytes(ref(s, 'resources/u1/x.gif'), bytes, { contentType: 'image/gif' }));
  await assertSucceeds(uploadBytes(ref(s, 'resources/u1/x.jpg'), bytes, { contentType: 'image/jpeg' }));
  await assertSucceeds(uploadBytes(ref(s, 'resources/u1/x.webp'), bytes, { contentType: 'image/webp' }));
});

test('NOBODY can read, overwrite or delete through the client SDK — not even the owner', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), 'resources/u1/seeded.pdf'), bytes, pdf);
  });
  await assertFails(getBytes(ref(st('u1', KU), 'resources/u1/seeded.pdf')));
  await assertFails(getBytes(ref(st('u3', OUTSIDER), 'resources/u1/seeded.pdf')));
  await assertFails(uploadBytes(ref(st('u1', KU), 'resources/u1/seeded.pdf'), bytes, pdf)); // overwrite
  await assertFails(deleteObject(ref(st('u1', KU), 'resources/u1/seeded.pdf')));
});

// --- listing photos (Plan 3, T-5) ---------------------------------------------

const jpeg = { contentType: 'image/jpeg' };

test('listing photos: a verified owner creates small images under their own listings/ prefix only', async () => {
  const s = st('u1', KU);
  await assertSucceeds(uploadBytes(ref(s, 'listings/u1/1_a.jpg'), bytes, jpeg));
  await assertSucceeds(uploadBytes(ref(s, 'listings/u1/2_a.webp'), new Uint8Array(2 * 1024 * 1024), { contentType: 'image/webp' })); // boundary
  await assertFails(uploadBytes(ref(s, 'listings/u1/big.jpg'), new Uint8Array(2 * 1024 * 1024 + 1), jpeg));
  await assertFails(uploadBytes(ref(s, 'listings/u2/1_a.jpg'), bytes, jpeg));
  await assertFails(uploadBytes(ref(s, 'listings/u1/sub/a.jpg'), bytes, jpeg));
  await assertFails(uploadBytes(ref(s, 'listings/u1/a.pdf'), bytes, pdf));
  await assertFails(uploadBytes(ref(s, 'listings/u1/a.svg'), bytes, { contentType: 'image/svg+xml' }));
  await assertFails(uploadBytes(ref(st('u2', KU_UNVERIFIED), 'listings/u2/a.jpg'), bytes, jpeg));
  await assertFails(uploadBytes(ref(st('u3', OUTSIDER), 'listings/u3/a.jpg'), bytes, jpeg));
});

test('listing photos: any KU address may read; outsiders and anonymous may not; nobody overwrites or deletes', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), 'listings/u1/seeded.jpg'), bytes, jpeg);
  });
  await assertSucceeds(getBytes(ref(st('u2', KU_UNVERIFIED), 'listings/u1/seeded.jpg')));
  await assertSucceeds(getBytes(ref(st('u1', KU), 'listings/u1/seeded.jpg')));
  await assertFails(getBytes(ref(st('u3', OUTSIDER), 'listings/u1/seeded.jpg')));
  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), 'listings/u1/seeded.jpg')));
  await assertFails(uploadBytes(ref(st('u1', KU), 'listings/u1/seeded.jpg'), bytes, jpeg));
  await assertFails(deleteObject(ref(st('u1', KU), 'listings/u1/seeded.jpg')));
});

test('listing photos: a KU address can GET a known object but cannot LIST the folders (no enumeration of every photo)', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), 'listings/u1/listed.jpg'), bytes, jpeg);
  });
  await assertSucceeds(getBytes(ref(st('u2', KU_UNVERIFIED), 'listings/u1/listed.jpg')));
  await assertFails(listAll(ref(st('u2', KU_UNVERIFIED), 'listings/u1')));
  await assertFails(listAll(ref(st('u1', KU), 'listings/u1')));
  await assertFails(listAll(ref(st('u1', KU), 'listings')));
});
