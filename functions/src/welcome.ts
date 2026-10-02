import type { Firestore } from 'firebase-admin/firestore';
import { CREDITS } from './common.js';
import { readBalance, writeCredit } from './credits.js';

/** One-time welcome grant. Idempotent: the flag lives on the balance doc. */
export async function claimWelcome(
  db: Firestore,
  uid: string,
): Promise<{ granted: boolean; balance: number }> {
  return db.runTransaction(async (tx) => {
    const cur = await readBalance(tx, db, uid);
    if (cur.welcomeGranted) return { granted: false, balance: cur.balance };
    const next = writeCredit(
      tx,
      db,
      { uid, delta: CREDITS.welcome, reason: 'signup_bonus', ledgerId: `signup_${uid}` },
      cur,
      { welcomeGranted: true },
    );
    return { granted: true, balance: next.balance };
  });
}
