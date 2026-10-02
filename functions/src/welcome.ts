import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { CREDITS, UNIVERSITY_ID } from './common.js';
import { readBalance, writeCredit, type Balance } from './credits.js';
import { newCode, normalizeCode } from './referral.js';

/**
 * One-time welcome grant + invitation-code issue + (optional) referral payout,
 * all in a single transaction (every read first, then every write). Idempotent:
 * the flag lives on the balance doc, and an already-welcomed user can never
 * redeem a code afterwards.
 */
export async function claimWelcome(
  db: Firestore,
  uid: string,
  rand: () => number = Math.random,
): Promise<{ granted: boolean; balance: number }> {
  return db.runTransaction(async (tx) => {
    const cur = await readBalance(tx, db, uid);
    if (cur.welcomeGranted) return { granted: false, balance: cur.balance };

    // ---- reads
    const userRef = db.collection('users').doc(uid);
    const pending = normalizeCode((await tx.get(userRef)).get('pendingReferralCode'));

    const candidates = Array.from({ length: 5 }, () => newCode(rand));
    const taken = await Promise.all(candidates.map((c) => tx.get(db.collection('invitation_codes').doc(c))));
    const myCode = candidates.find((_, i) => !taken[i].exists);
    if (!myCode) throw new HttpsError('aborted', 'could not allocate an invitation code');

    let referrerUid: string | null = null;
    let referrerBal: Balance | null = null;
    if (pending) {
      const owner = await tx.get(db.collection('invitation_codes').doc(pending));
      const ownerUid = owner.exists ? String(owner.get('uid') ?? '') : '';
      if (ownerUid && ownerUid !== uid) {
        const rb = await readBalance(tx, db, ownerUid);
        if (rb.welcomeGranted && (rb.referralsRewarded ?? 0) < CREDITS.referralCap) {
          referrerUid = ownerUid;
          referrerBal = rb;
        }
      }
    }

    // ---- writes
    let next = writeCredit(
      tx, db,
      { uid, delta: CREDITS.welcome, reason: 'signup_bonus', ledgerId: `signup_${uid}` },
      cur,
      { welcomeGranted: true, invitationCode: myCode, ...(referrerUid ? { referredBy: referrerUid } : {}) },
    );
    tx.create(db.collection('invitation_codes').doc(myCode), {
      uid, university_id: UNIVERSITY_ID, createdAt: FieldValue.serverTimestamp(),
    });
    if (referrerUid && referrerBal) {
      next = writeCredit(
        tx, db,
        { uid, delta: CREDITS.referral, reason: 'referral_in', ledgerId: `referral_in_${uid}`, refId: referrerUid },
        next,
      );
      writeCredit(
        tx, db,
        { uid: referrerUid, delta: CREDITS.referral, reason: 'referral_out', ledgerId: `referral_out_${uid}`, refId: uid },
        referrerBal,
        { referralsRewarded: (referrerBal.referralsRewarded ?? 0) + 1 },
      );
    }
    if (pending) tx.set(userRef, { pendingReferralCode: FieldValue.delete() }, { merge: true });
    return { granted: true, balance: next.balance };
  });
}
