import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import { CREDITS, jstDay } from './common.js';
import { ledgerRef, readBalance, writeCredit } from './credits.js';

export interface PostDeps { exists(path: string): Promise<boolean> }
export interface PostCreatedResult {
  valid: boolean; duplicate: boolean; granted: number; capped: boolean; fulfilled: boolean;
}

const INVALID: PostCreatedResult = { valid: false, duplicate: false, granted: 0, capped: false, fulfilled: false };
// Server-assigned creation time: the client-written `created_at_ts` is forgeable.
const createMillis = (d: DocumentSnapshot): number => d.createTime?.toMillis() ?? 0;
const yearKey = (v: unknown): string => String(v ?? null);

/**
 * Validates a freshly created post and pays the upload credit. The doc is
 * client-created (P2-9) so this is where the server decides it is real: every
 * file must live under the author's own prefix AND exist. An invalid post is
 * deleted (its `onPostDeleted` cleanup is prefix-guarded — see postDeleted.ts).
 */
export async function handlePostCreated(
  db: Firestore,
  deps: PostDeps,
  postId: string,
  now: Date = new Date(),
): Promise<PostCreatedResult> {
  const ref = db.collection('posts').doc(postId);
  const snap = await ref.get();
  const post = snap.data();
  if (!post) return INVALID;

  const authorId = String(post.authorId ?? '');
  const subjectOk = typeof post.subjectId === 'string' && post.subjectId !== '';
  const paths: unknown = post.filePaths;
  const prefix = `resources/${authorId}/`;
  const wellFormed = authorId !== '' && subjectOk && Array.isArray(paths) && paths.length >= 1 && paths.length <= 5 &&
    paths.every((p) => typeof p === 'string' && p.startsWith(prefix) && p.length > prefix.length &&
      !p.split('/').includes('..'));
  const present = wellFormed && (await Promise.all((paths as string[]).map((p) => deps.exists(p)))).every(Boolean);
  if (!present) {
    await ref.delete();
    return INVALID;
  }

  // Duplicate past exam: same course + year + category already exists from an
  // earlier post, ordered by SERVER createTime (ties broken by id so two
  // simultaneous uploads pay only one). The year is compared in code so a
  // missing / string / float year cannot dodge the check.
  let duplicate = false;
  if (post.category === 'past_exam') {
    const same = await db.collection('posts')
      .where('subjectId', '==', post.subjectId)
      .where('category', '==', 'past_exam')
      .get();
    const mine = createMillis(snap);
    const myYear = yearKey(post.year);
    duplicate = same.docs.some((d) => {
      if (d.id === postId || yearKey(d.get('year')) !== myYear) return false;
      const theirs = createMillis(d);
      return theirs < mine || (theirs === mine && d.id < postId);
    });
  }

  const requestId = typeof post.requestId === 'string' && post.requestId !== '' ? post.requestId : null;

  const out = await db.runTransaction(async (tx) => {
    const reqRef = requestId ? db.collection('requests').doc(requestId) : null;
    const reqSnap = reqRef ? await tx.get(reqRef) : null;
    const upLed = await tx.get(ledgerRef(db, `upload_${postId}`));
    const fuLed = requestId ? await tx.get(ledgerRef(db, `fulfill_${requestId}`)) : null;
    let cur = await readBalance(tx, db, authorId);

    const day = jstDay(now);
    let used = cur.uploadGrantDay === day ? cur.uploadGrantsToday ?? 0 : 0;
    let granted = 0;
    let capped = false;
    let fulfilled = false;
    const grant = (delta: number, reason: string, ledgerId: string, refId: string) => {
      if (used >= CREDITS.dailyGrantCap) { capped = true; return; }
      used += 1;
      cur = writeCredit(tx, db, { uid: authorId, delta, reason, ledgerId, refId }, cur,
        { uploadGrantDay: day, uploadGrantsToday: used });
      granted += delta;
    };

    if (reqRef && reqSnap?.exists) {
      const r = reqSnap.data()!;
      if (r.isFulfilled !== true && r.authorId !== authorId && !fuLed?.exists) {
        tx.update(reqRef, { isFulfilled: true, fulfilledPostId: postId });
        fulfilled = true; // the requester gets their free download even if the credit is capped
        grant(CREDITS.requestFulfilled, 'request_fulfilled', `fulfill_${requestId}`, requestId!);
      }
    }
    if (!duplicate && !upLed.exists) grant(CREDITS.upload, 'upload', `upload_${postId}`, postId);
    return { granted, capped, fulfilled };
  });

  return { valid: true, duplicate, ...out };
}
