// reviewCreated.ts
import type { Firestore } from 'firebase-admin/firestore';
import { CREDITS, jstDay } from './common.js';
import { ledgerRef, readBalance, writeCredit } from './credits.js';

/** Same escape as the client's `Review.slug` (lib/models/review.dart). */
export const reviewSlug = (courseKey: string): string =>
  courseKey.replaceAll('%', '%25').replaceAll('/', '%2F');

export interface ReviewRef { id: string; authorId: string; courseKey: string }
export interface ReviewBonusResult { first: boolean; scarce: boolean; granted: number; capped: boolean }

/**
 * Review incentives (P2-12/13/14). Runs after a review doc is created.
 *  - first: each of the author's first CREDITS.firstReviewCount reviews pays +2
 *  - scarce: a review on a course with <= CREDITS.scarceThreshold reviews pays +1
 * The course's review total is counted from `reviews` (server-side) - never
 * from `course_stats`, which any verified client can write. The first-3 grant is
 * keyed by the review id and the scarce grant by author + course slug, so a
 * replayed trigger or delete + re-post pays once. A review whose id is not
 * `<slug(courseKey)>_<authorId>` earns nothing.
 * Both kinds share a per-JST-day cap.
 */
export async function handleReviewCreated(
  db: Firestore,
  review: ReviewRef,
  now: Date = new Date(),
): Promise<ReviewBonusResult> {
  const none: ReviewBonusResult = { first: false, scarce: false, granted: 0, capped: false };
  if (!review.authorId) return none;
  // The rules pin the id to the client-supplied `courseSlug`, which they cannot
  // verify against `courseKey`. Pay only when the id is exactly the one the
  // client derives from the real courseKey: otherwise a forged slug would mint
  // a fresh review id (and ledger rows) for a course already reviewed.
  const slug = reviewSlug(review.courseKey ?? '');
  if (!review.courseKey || review.id !== `${slug}_${review.authorId}`) return none;

  const agg = await db.collection('reviews').where('courseKey', '==', review.courseKey).count().get();
  const total = agg.data().count;

  // Keyed by author + course (not review id) so delete + repost can never re-pay.
  const scarceId = `reviewscarce_${review.authorId}_${slug}`;
  return db.runTransaction(async (tx) => {
    const firstLed = await tx.get(ledgerRef(db, `reviewfirst_${review.id}`));
    const scarceLed = await tx.get(ledgerRef(db, scarceId));
    let cur = await readBalance(tx, db, review.authorId);

    const day = jstDay(now);
    let used = cur.reviewGrantDay === day ? cur.reviewGrantsToday ?? 0 : 0;
    let bonuses = cur.reviewBonusesUsed ?? 0;
    const out = { ...none };
    const grant = (delta: number, reason: string, ledgerId: string): boolean => {
      if (used >= CREDITS.reviewDailyCap) { out.capped = true; return false; }
      used += 1;
      cur = writeCredit(tx, db, { uid: review.authorId, delta, reason, ledgerId, refId: review.id }, cur,
        { reviewGrantDay: day, reviewGrantsToday: used, reviewBonusesUsed: bonuses });
      out.granted += delta;
      return true;
    };

    if (!firstLed.exists && bonuses < CREDITS.firstReviewCount) {
      bonuses += 1; // reserve the slot; released below if the daily cap refused the grant
      if (grant(CREDITS.firstReviews, 'first_review', `reviewfirst_${review.id}`)) out.first = true;
      else bonuses -= 1;
    }
    if (!scarceLed.exists && total <= CREDITS.scarceThreshold) {
      if (grant(CREDITS.scarceReview, 'scarce_review', scarceId)) out.scarce = true;
    }
    return out;
  });
}
