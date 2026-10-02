import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { UNIVERSITY_ID } from './common.js';

export interface Balance {
  balance: number;
  welcomeGranted?: boolean;
  invitationCode?: string; // this user's own code (issued by claimWelcome, P2-2)
  referredBy?: string; // inviter uid, set once
  referralsRewarded?: number; // invitations by this user that have paid out (cap)
  reviewBonusesUsed?: number; // how many first-3-reviews bonuses (P2-12) have been paid
  reviewGrantDay?: string; // JST day of the last review-bonus grant (P2-14 cap)
  reviewGrantsToday?: number;
  uploadGrantDay?: string; // JST day of the last capped grant
  uploadGrantsToday?: number; // grants already issued on that day
}

export interface CreditEvent {
  uid: string;
  delta: number;
  reason: string; // signup_bonus | download | download_free | upload | first_review | scarce_review | request_fulfilled | referral_in | referral_out
  ledgerId: string; // deterministic => the caller can make the grant idempotent
  refId?: string; // postId / requestId the event is about
}

export const balanceRef = (db: Firestore, uid: string): DocumentReference =>
  db.collection('credit_balances').doc(uid);

export const ledgerRef = (db: Firestore, ledgerId: string): DocumentReference =>
  db.collection('credits_ledger').doc(ledgerId);

export async function readBalance(tx: Transaction, db: Firestore, uid: string): Promise<Balance> {
  const snap = await tx.get(balanceRef(db, uid));
  const d = (snap.exists ? snap.data() : {}) as Partial<Balance>;
  return { ...d, balance: Number.isInteger(d.balance) ? (d.balance as number) : 0 };
}

/**
 * The ONLY writer of `credit_balances` / `credits_ledger`. Updates the balance
 * and appends one ledger row in the caller's transaction. Every read the
 * transaction needs must already have happened (Firestore forbids read-after-
 * write). Throws if the new balance would be negative.
 */
export function writeCredit(
  tx: Transaction,
  db: Firestore,
  ev: CreditEvent,
  cur: Balance,
  patch: Partial<Balance> = {},
): Balance {
  const next: Balance = { ...cur, ...patch, balance: cur.balance + ev.delta };
  if (next.balance < 0) throw new HttpsError('failed-precondition', 'insufficient-credits');
  tx.set(balanceRef(db, ev.uid), { ...next, university_id: UNIVERSITY_ID });
  tx.create(ledgerRef(db, ev.ledgerId), {
    uid: ev.uid,
    delta: ev.delta,
    reason: ev.reason,
    refId: ev.refId ?? null,
    balanceAfter: next.balance,
    createdAt: FieldValue.serverTimestamp(),
    university_id: UNIVERSITY_ID,
  });
  return next;
}
