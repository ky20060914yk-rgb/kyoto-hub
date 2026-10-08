import { describe, it, expect, beforeEach } from 'vitest';
import { adminDb } from '@/lib/server/admin';
import { claimWelcome, newCode } from '@/lib/server/welcome';
import { balanceRef, CREDITS } from '@/lib/server/credits';
import { clearEmulators } from './emu';

const bal = async (uid: string) => (await balanceRef(uid).get()).data();
const user = (uid: string, pendingReferralCode: string | null = null) =>
  adminDb.collection('users').doc(uid).set({ uid, pendingReferralCode });

describe('claimWelcome', () => {
  beforeEach(clearEmulators);

  it('codes use the unambiguous alphabet', () => {
    expect(newCode(() => 0)).toBe('AAAAAA');
    expect(newCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it('grants +3 once and issues a code', async () => {
    await user('a');
    const first = await claimWelcome('a');
    const again = await claimWelcome('a');
    expect(first).toMatchObject({ granted: true, balance: CREDITS.welcome });
    expect(again).toMatchObject({ granted: false, balance: CREDITS.welcome, invitationCode: first.invitationCode });
    expect((await adminDb.collection('invitation_codes').doc(first.invitationCode!).get()).data()?.uid).toBe('a');
  });

  it('pays both sides of a valid invitation', async () => {
    await user('inviter');
    const { invitationCode } = await claimWelcome('inviter');
    await user('invitee', invitationCode!.toLowerCase());
    const r = await claimWelcome('invitee');
    expect(r).toMatchObject({ referred: true, balance: CREDITS.welcome + CREDITS.referral });
    expect((await bal('inviter'))?.balance).toBe(CREDITS.welcome + CREDITS.referral);
    expect((await adminDb.collection('users').doc('invitee').get()).data()?.pendingReferralCode).toBeUndefined();
  });

  it('ignores unknown codes and self-referral', async () => {
    await user('x', 'ZZZZZZ');
    expect(await claimWelcome('x')).toMatchObject({ referred: false, balance: CREDITS.welcome });
  });

  it('caps an inviter at 10 paid invitations', async () => {
    await user('host');
    const { invitationCode } = await claimWelcome('host');
    await balanceRef('host').set({ referralsRewarded: CREDITS.referralCap }, { merge: true });
    await user('late', invitationCode);
    expect(await claimWelcome('late')).toMatchObject({ referred: false });
  });
});
