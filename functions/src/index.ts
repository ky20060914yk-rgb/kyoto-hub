import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { REGION, requireKuVerified, attachmentDisposition } from './common.js';
import { claimWelcome } from './welcome.js';
import { processDownload } from './download.js';
import { handlePostCreated } from './postCreated.js';
import { handleReviewCreated } from './reviewCreated.js';
import { handlePostDeleted } from './postDeleted.js';

initializeApp();
const db = getFirestore();
const bucket = () => getStorage().bucket();

// Real Storage-backed implementations of the injected dependencies.
const storageDeps = {
  sign: async (path: string, o: { filename: string; expiresMs: number }) => {
    const [url] = await bucket().file(path).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + o.expiresMs,
      responseDisposition: attachmentDisposition(o.filename),
    });
    return url;
  },
  exists: async (path: string) => (await bucket().file(path).exists())[0],
  remove: async (path: string) => { await bucket().file(path).delete({ ignoreNotFound: true }); },
};

const opts = { region: REGION, maxInstances: 10 } as const; // cost guard

export const claimWelcomeCredits = onCall(opts, async (req) => {
  const uid = requireKuVerified(req.auth);
  return claimWelcome(db, uid, String(req.auth?.token.email ?? ''));
});

export const downloadResource = onCall(opts, async (req) => {
  const uid = requireKuVerified(req.auth);
  const postId = req.data?.postId;
  const fi = req.data?.fileIndex;
  if (typeof postId !== 'string' || postId === '') throw new HttpsError('invalid-argument', 'bad post id');
  if (fi !== undefined && fi !== null && typeof fi !== 'number') throw new HttpsError('invalid-argument', 'bad file index');
  return processDownload(db, storageDeps, uid, { postId, fileIndex: fi ?? undefined });
});

export const onPostCreated = onDocumentCreated({ ...opts, document: 'posts/{postId}' }, async (event) => {
  await handlePostCreated(db, storageDeps, event.params.postId);
});

export const onReviewCreated = onDocumentCreated({ ...opts, document: 'reviews/{reviewId}' }, async (event) => {
  const d = event.data?.data();
  await handleReviewCreated(db, {
    id: event.params.reviewId,
    authorId: String(d?.authorId ?? ''),
    courseKey: String(d?.courseKey ?? ''),
  });
});

export const onPostDeleted = onDocumentDeleted({ ...opts, document: 'posts/{postId}' }, async (event) => {
  const data = event.data?.data();
  if (data) await handlePostDeleted(storageDeps, data);
});
