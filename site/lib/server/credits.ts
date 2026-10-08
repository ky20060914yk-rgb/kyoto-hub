import 'server-only';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from './admin';
import { HttpError } from '@/lib/http-error';

/** Credit amounts — redesign spec §4.3 and 2A plan P2-1..P2-14. */
export const CREDITS = {
  welcome: 3,
  upload: 3,
  firstReviews: 2, // each of a user's first `firstReviewCount` reviews (P2-12)
  firstReviewCount: 3,
  scarceReview: 1, // review on a course with <= `scarceThreshold` reviews (P2-13)
  scarceThreshold: 5,
  reviewDailyCap: 5, // review-bonus grants per JST day (P2-14)
  referral: 3, // each side of a successful invitation (P2-2)
  referralCap: 10,
  requestFulfilled: 3,
  downloadCost: 1,
  dailyGrantCap: 3, // upload / request grants per JST day (P2-3)
} as const;

/** `YYYY-MM-DD` in Asia/Tokyo (UTC+9, no DST). */
export const jstDay = (now: Date = new Date()) => new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

export type Balance = {
  balance: number;
  welcomeGranted?: boolean;
  invitationCode?: string;
  referredBy?: string;
  referralsRewarded?: number;
  reviewBonusesUsed?: number;
  reviewGrantDay?: string;
  reviewGrantsToday?: number;
  uploadGrantDay?: string;
  uploadGrantsToday?: number;
};

export type CreditEvent = { uid: string; delta: number; reason: string; ledgerId: string; refId?: string };

export const balanceRef = (uid: string) => adminDb.collection('credit_balances').doc(uid);
export const ledgerRef = (id: string) => adminDb.collection('credits_ledger').doc(id);

export async function readBalance(tx: Transaction, uid: string): Promise<Balance> {
  const snap = await tx.get(balanceRef(uid));
  const d = (snap.exists ? snap.data() : {}) as Partial<Balance>;
  return { ...d, balance: Number.isInteger(d.balance) ? (d.balance as number) : 0 };
}

/**
 * The ONLY writer of credit_balances / credits_ledger. All reads of the
 * transaction must already be done. The ledger row is created (not set), so a
 * reused ledger id aborts the transaction: grants are idempotent by id.
 */
export function writeCredit(tx: Transaction, ev: CreditEvent, cur: Balance, patch: Partial<Balance> = {}): Balance {
  const next: Balance = { ...cur, ...patch, balance: cur.balance + ev.delta };
  if (next.balance < 0) throw new HttpError(409, 'クレジットが足りません。資料をアップロードするかレビューを書くと増えます。');
  tx.set(balanceRef(ev.uid), { ...next, university_id: 'kyoto_u' });
  tx.create(ledgerRef(ev.ledgerId), {
    uid: ev.uid,
    delta: ev.delta,
    reason: ev.reason,
    refId: ev.refId ?? null,
    balanceAfter: next.balance,
    createdAt: FieldValue.serverTimestamp(),
    university_id: 'kyoto_u',
  });
  return next;
}

export type ReviewBonus = { first: boolean; scarce: boolean; granted: number; capped: boolean };

/**
 * Review incentives (P2-12/13/14), run inside the review-write transaction.
 * `total` = the course's review count including this review, counted from
 * `reviews` (never from the aggregate). Ledger ids are keyed by the review id,
 * so delete + re-post of the same course never pays twice.
 */
export async function grantReviewBonuses(
  tx: Transaction, review: { id: string; authorId: string }, total: number, now: Date = new Date(),
): Promise<ReviewBonus> {
  const out: ReviewBonus = { first: false, scarce: false, granted: 0, capped: false };
  const firstLed = await tx.get(ledgerRef(`reviewfirst_${review.id}`));
  const scarceLed = await tx.get(ledgerRef(`reviewscarce_${review.id}`));
  let cur = await readBalance(tx, review.authorId);

  const day = jstDay(now);
  let used = cur.reviewGrantDay === day ? cur.reviewGrantsToday ?? 0 : 0;
  let bonuses = cur.reviewBonusesUsed ?? 0;
  const grant = (delta: number, reason: string, ledgerId: string) => {
    if (used >= CREDITS.reviewDailyCap) {
      out.capped = true;
      return false;
    }
    used += 1;
    cur = writeCredit(tx, { uid: review.authorId, delta, reason, ledgerId, refId: review.id }, cur,
      { reviewGrantDay: day, reviewGrantsToday: used, reviewBonusesUsed: bonuses });
    out.granted += delta;
    return true;
  };

  if (!firstLed.exists && bonuses < CREDITS.firstReviewCount) {
    bonuses += 1;
    if (grant(CREDITS.firstReviews, 'first_review', `reviewfirst_${review.id}`)) out.first = true;
    else bonuses -= 1;
  }
  if (!scarceLed.exists && total <= CREDITS.scarceThreshold) {
    if (grant(CREDITS.scarceReview, 'scarce_review', `reviewscarce_${review.id}`)) out.scarce = true;
  }
  return out;
}
