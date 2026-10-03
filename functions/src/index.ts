import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { REGION, requireKuVerified, attachmentDisposition, universityVerifiedUid } from './common.js';
import { claimWelcome } from './welcome.js';
import { processDownload } from './download.js';
import { handlePostCreated } from './postCreated.js';
import { handleReviewCreated } from './reviewCreated.js';
import { handlePostGone } from './postDeleted.js';
import { processReport } from './report.js';
import { processTakedown, type TakedownCaller } from './takedown.js';
import { handlePostWritten, handleReviewWritten } from './courseStats.js';

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

// Hide/restore MOVE posts between `posts` and `hidden_posts` (Plan 2B, M-1):
// files are removed only when the post exists in neither collection.
export const onPostDeleted = onDocumentDeleted({ ...opts, document: 'posts/{postId}' }, async (event) => {
  const data = event.data?.data();
  if (data) await handlePostGone(db, storageDeps, event.params.postId, data);
});

export const onHiddenPostDeleted = onDocumentDeleted({ ...opts, document: 'hidden_posts/{postId}' }, async (event) => {
  const data = event.data?.data();
  if (data) await handlePostGone(db, storageDeps, event.params.postId, data);
});

export const reportPost = onCall(opts, async (req) =>
  processReport(db, requireKuVerified(req.auth), (req.data ?? {}) as Record<string, unknown>));

// The ONE callable that accepts a signed-out caller (a rights-holder has no app
// account). Classified, never trusted: only a verified KU token may hide (M-6).
export const submitTakedown = onCall(opts, async (req) => {
  const auth = req.auth ?? null;
  const caller: TakedownCaller | null = auth
    ? { uid: auth.uid, verified: universityVerifiedUid(auth) !== null, email: String(auth.token.email ?? '') }
    : null;
  return processTakedown(db, caller, (req.data ?? {}) as Record<string, unknown>);
});

// course_stats is Function-maintained (M-11): every relevant write recounts its course.
export const onReviewWritten = onDocumentWritten({ ...opts, document: 'reviews/{reviewId}' }, async (event) => {
  await handleReviewWritten(db, event.data?.before?.data(), event.data?.after?.data());
});

export const onPostWritten = onDocumentWritten({ ...opts, document: 'posts/{postId}' }, async (event) => {
  await handlePostWritten(db, event.data?.before?.data(), event.data?.after?.data());
});
