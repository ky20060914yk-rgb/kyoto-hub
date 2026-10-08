import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './admin';
import { CREDITS, readBalance, writeCredit, type Balance } from './credits';
import { HttpError } from '@/lib/http-error';

// Unambiguous alphabet: no 0/O, 1/I/L.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A 6-character invitation code. Not a secret — redemption is guarded by caps. */
export const newCode = (rand: () => number = Math.random) =>
  Array.from({ length: 6 }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join('');

export const normalizeCode = (raw: unknown) => String(raw ?? '').trim().toUpperCase();

/**
 * One-time welcome grant + own invitation code + optional referral payout, in
 * one transaction (2A plan P2-2). Idempotent: once welcomed, never again, and a
 * welcomed user can never redeem a code afterwards.
 */
export async function claimWelcome(uid: string, rand: () => number = Math.random) {
  return adminDb.runTransaction(async (tx) => {
    const cur = await readBalance(tx, uid);
    if (cur.welcomeGranted) return { granted: false, balance: cur.balance, invitationCode: cur.invitationCode ?? null };

    // ---- reads
    const userRef = adminDb.collection('users').doc(uid);
    const pending = normalizeCode((await tx.get(userRef)).get('pendingReferralCode') ?? '');
    const candidates = Array.from({ length: 5 }, () => newCode(rand));
    const taken = await Promise.all(candidates.map((c) => tx.get(adminDb.collection('invitation_codes').doc(c))));
    const myCode = candidates.find((_, i) => !taken[i].exists);
    if (!myCode) throw new HttpError(503, '招待コードを発行できませんでした。もう一度お試しください。');

    let referrerUid: string | null = null;
    let referrerBal: Balance | null = null;
    if (pending) {
      const owner = await tx.get(adminDb.collection('invitation_codes').doc(pending));
      const ownerUid = owner.exists ? String(owner.get('uid') ?? '') : '';
      if (ownerUid && ownerUid !== uid) {
        const rb = await readBalance(tx, ownerUid);
        if (rb.welcomeGranted && (rb.referralsRewarded ?? 0) < CREDITS.referralCap) {
          referrerUid = ownerUid;
          referrerBal = rb;
        }
      }
    }

    // ---- writes
    let next = writeCredit(tx, { uid, delta: CREDITS.welcome, reason: 'signup_bonus', ledgerId: `signup_${uid}` }, cur,
      { welcomeGranted: true, invitationCode: myCode, ...(referrerUid ? { referredBy: referrerUid } : {}) });
    tx.create(adminDb.collection('invitation_codes').doc(myCode), {
      uid, university_id: 'kyoto_u', createdAt: FieldValue.serverTimestamp(),
    });
    if (referrerUid && referrerBal) {
      next = writeCredit(tx, { uid, delta: CREDITS.referral, reason: 'referral_in', ledgerId: `referral_in_${uid}`, refId: referrerUid }, next);
      writeCredit(tx, { uid: referrerUid, delta: CREDITS.referral, reason: 'referral_out', ledgerId: `referral_out_${uid}`, refId: uid },
        referrerBal, { referralsRewarded: (referrerBal.referralsRewarded ?? 0) + 1 });
    }
    tx.set(userRef, { pendingReferralCode: FieldValue.delete(), isVerified: true, invitationCode: myCode }, { merge: true });
    return { granted: true, balance: next.balance, invitationCode: myCode, referred: !!referrerUid };
  });
}
