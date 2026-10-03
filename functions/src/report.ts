import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { MODERATION, UNIVERSITY_ID, emailKey, isDocId, jstDay } from './common.js';
import {
  actorRef, hiddenRef, hideInTx, num, postRef, queueRef, readQueue, reportRef, writeQueue,
} from './moderation.js';

export const REPORT_CATEGORIES = ['copyright', 'unrelated', 'inappropriate', 'other'] as const;
export type ReportStatus = 'reported' | 'hidden' | 'duplicate' | 'already_hidden';

/**
 * `reportPost` (M-2, M-3, M-7, M-8, M-9). One report per (post, reporter), at
 * moderation_queue/{postId}/reports/{uid} — Admin-only, so a client can neither
 * forge a count nor learn who reported. The post is hidden once
 * MODERATION.reportHideThreshold DISTINCT counted reporters have reported it,
 * unless an operator already cleared it. Never touches a credit.
 */
/** The verified caller. Identity for reports, caps and discredit is the MAILBOX (emailKey); uid is kept for operators. */
export interface Reporter { uid: string; email: string }

export async function processReport(
  db: Firestore,
  reporter: Reporter,
  input: Record<string, unknown>,
  now: Date = new Date(),
): Promise<{ status: ReportStatus }> {
  const postId = input?.postId;
  if (!isDocId(postId)) throw new HttpsError('invalid-argument', 'bad post id');
  const category = input.category;
  if (typeof category !== 'string' || !(REPORT_CATEGORIES as readonly string[]).includes(category)) {
    throw new HttpsError('invalid-argument', 'bad category');
  }
  const detail = typeof input.detail === 'string' ? input.detail.trim() : '';
  if (detail.length > MODERATION.maxDetail) throw new HttpsError('invalid-argument', 'detail too long');
  const { uid } = reporter;
  const key = emailKey(reporter.email);
  if (!reporter.email.trim()) throw new HttpsError('permission-denied', 'email required');
  const day = jstDay(now);

  return db.runTransaction(async (tx) => {
    const postSnap = await tx.get(postRef(db, postId));
    const hiddenSnap = await tx.get(hiddenRef(db, postId));
    const mine = await tx.get(reportRef(db, postId, key));
    const actorSnap = await tx.get(actorRef(db, key));
    const queueSnap = await tx.get(queueRef(db, postId));

    if (!postSnap.exists) {
      if (hiddenSnap.exists) return { status: 'already_hidden' as const };
      throw new HttpsError('not-found', 'post not found');
    }
    const post = postSnap.data()!;
    if (post.authorId === uid) throw new HttpsError('failed-precondition', 'own-post');
    if (mine.exists) return { status: 'duplicate' as const };

    const actor = actorSnap.data() ?? {};
    const usedToday = actor.reportDay === day ? num(actor.reportsToday) : 0;
    if (usedToday >= MODERATION.reportDailyCap) throw new HttpsError('resource-exhausted', 'report-limit');
    // M-9: a discredited reporter is recorded but silently not counted.
    const counted = num(actor.restoredReports) < MODERATION.discreditRestoredReports;

    const q = readQueue(queueSnap, postId, post);
    q.reportCount += 1;
    if (counted) q.countedReports += 1;
    tx.create(reportRef(db, postId, key), {
      postId, reporterUid: uid, category, detail, counted,
      createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
    });
    tx.set(actorRef(db, key), { reportDay: day, reportsToday: usedToday + 1, university_id: UNIVERSITY_ID }, { merge: true });

    let status: ReportStatus = 'reported';
    if (q.autoHide && q.countedReports >= MODERATION.reportHideThreshold) {
      hideInTx(tx, db, q, post, 'reports', null, 'system');
      status = 'hidden';
    } else if (!q.autoHide) {
      q.needsReview = true; // M-8: an operator-cleared post only goes back to review
    }
    writeQueue(tx, db, q, !queueSnap.exists);
    return { status };
  });
}
