import { describe, it, expect, beforeEach } from 'vitest';
import { adminDb } from '@/lib/server/admin';
import { readBalance, writeCredit, grantReviewBonuses, balanceRef, ledgerRef, jstDay, CREDITS } from '@/lib/server/credits';
import { clearEmulators } from './emu';

const run = <T>(fn: Parameters<typeof adminDb.runTransaction<T>>[0]) => adminDb.runTransaction(fn);

describe('credits', () => {
  beforeEach(clearEmulators);

  it('jstDay is UTC+9', () => {
    expect(jstDay(new Date('2026-10-07T15:30:00Z'))).toBe('2026-10-08');
    expect(jstDay(new Date('2026-10-07T14:59:00Z'))).toBe('2026-10-07');
  });

  it('writeCredit updates balance and appends a ledger row', async () => {
    await run(async (tx) => writeCredit(tx, { uid: 'u1', delta: 3, reason: 'signup_bonus', ledgerId: 'signup_u1' }, await readBalance(tx, 'u1')));
    expect((await balanceRef('u1').get()).data()?.balance).toBe(3);
    expect((await ledgerRef('signup_u1').get()).data()).toMatchObject({ uid: 'u1', delta: 3, balanceAfter: 3 });
  });

  it('refuses a negative balance', async () => {
    await expect(run(async (tx) => writeCredit(tx, { uid: 'u2', delta: -1, reason: 'download', ledgerId: 'dl' }, await readBalance(tx, 'u2'))))
      .rejects.toThrow('クレジットが足りません');
  });

  it('a reused ledger id aborts (idempotent grants)', async () => {
    const once = () => run(async (tx) => writeCredit(tx, { uid: 'u3', delta: 3, reason: 'x', ledgerId: 'same' }, await readBalance(tx, 'u3')));
    await once();
    await expect(once()).rejects.toThrow();
    expect((await balanceRef('u3').get()).data()?.balance).toBe(3);
  });

  it('first three reviews earn +2 each, the fourth nothing', async () => {
    const day = new Date('2026-10-08T03:00:00Z');
    const results = [];
    for (const id of ['r1', 'r2', 'r3', 'r4']) {
      results.push(await run((tx) => grantReviewBonuses(tx, { id, authorId: 'u4' }, 99, day)));
    }
    expect(results.map((r) => r.first)).toEqual([true, true, true, false]);
    expect((await balanceRef('u4').get()).data()?.balance).toBe(3 * CREDITS.firstReviews);
  });

  it('scarce bonus only while total <= 5, and stacks with first', async () => {
    const a = await run((tx) => grantReviewBonuses(tx, { id: 's1', authorId: 'u5' }, 5));
    const b = await run((tx) => grantReviewBonuses(tx, { id: 's2', authorId: 'u5' }, 6));
    expect(a).toMatchObject({ first: true, scarce: true, granted: 3 });
    expect(b).toMatchObject({ first: true, scarce: false, granted: 2 });
  });

  it('caps review grants at 5 per JST day', async () => {
    const day = new Date('2026-10-08T03:00:00Z');
    let granted = 0;
    for (let i = 0; i < 6; i++) granted += (await run((tx) => grantReviewBonuses(tx, { id: `c${i}`, authorId: 'u6' }, 1, day))).granted;
    // 3 × (first 2 + scarce 1) would be 9 grants; the cap stops at 5 grants.
    const led = await adminDb.collection('credits_ledger').where('uid', '==', 'u6').get();
    expect(led.size).toBe(CREDITS.reviewDailyCap);
    expect(granted).toBe((await balanceRef('u6').get()).data()?.balance);
  });

  it('does not pay the same review twice', async () => {
    await run((tx) => grantReviewBonuses(tx, { id: 'same', authorId: 'u7' }, 1));
    const again = await run((tx) => grantReviewBonuses(tx, { id: 'same', authorId: 'u7' }, 1));
    expect(again.granted).toBe(0);
  });
});
