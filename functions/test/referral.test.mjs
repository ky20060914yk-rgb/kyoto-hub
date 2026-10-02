import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, emailOf } from '../testlib/helpers.mjs';
import { claimWelcome } from '../lib/welcome.js';

const balDoc = async (u) => (await db.collection('credit_balances').doc(u).get()).data() ?? {};
const withPending = (u, code) => db.collection('users').doc(u).set({ pendingReferralCode: code, university_id: 'kyoto_u' });
const welcomed = async () => { const u = uid('r'); await claimWelcome(db, u, emailOf(u)); return { u, code: (await balDoc(u)).invitationCode }; };

test('a new user is issued a well-formed invitation code, registered for lookup', async () => {
  const { u, code } = await welcomed();
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  const reg = await db.collection('invitation_codes').doc(code).get();
  assert.equal(reg.get('uid'), u);
  assert.equal(reg.get('university_id'), 'kyoto_u');
});

test('a valid code pays the invitee +3 and the inviter +3, once, and is consumed', async () => {
  const ref = await welcomed();
  const inv = uid('i');
  await withPending(inv, ` ${ref.code.toLowerCase()} `); // typed sloppily
  assert.deepEqual(await claimWelcome(db, inv, emailOf(inv)), { granted: true, balance: 6 }); // 3 welcome + 3 referral
  assert.equal((await balDoc(ref.u)).balance, 6);
  assert.equal((await balDoc(ref.u)).referralsRewarded, 1);
  assert.equal((await balDoc(inv)).referredBy, ref.u);
  assert.equal((await db.collection('credits_ledger').doc(`referral_in_${inv}`).get()).get('delta'), 3);
  const out = await db.collection('credits_ledger').doc(`referral_out_${inv}`).get();
  assert.equal(out.get('delta'), 3);
  assert.equal(out.get('uid'), ref.u);
  assert.equal((await db.collection('users').doc(inv).get()).get('pendingReferralCode'), undefined);
  // a second claim changes nothing
  assert.deepEqual(await claimWelcome(db, inv, emailOf(inv)), { granted: false, balance: 6 });
  assert.equal((await balDoc(ref.u)).balance, 6);
});

test('an unknown code just gives the normal welcome and is cleared', async () => {
  const inv = uid('i');
  await withPending(inv, 'ZZZZZZ');
  assert.deepEqual(await claimWelcome(db, inv, emailOf(inv)), { granted: true, balance: 3 });
  assert.equal((await db.collection('users').doc(inv).get()).get('pendingReferralCode'), undefined);
});

test('self-referral pays nothing', async () => {
  const me = uid('s');
  await db.collection('invitation_codes').doc('SELF22').set({ uid: me, university_id: 'kyoto_u' });
  await withPending(me, 'SELF22');
  assert.deepEqual(await claimWelcome(db, me, emailOf(me)), { granted: true, balance: 3 });
});

test('a referrer who has not been welcomed (unverified) pays nothing', async () => {
  const ghost = uid('g'); const inv = uid('i');
  await db.collection('invitation_codes').doc('GHOST2').set({ uid: ghost, university_id: 'kyoto_u' });
  await withPending(inv, 'GHOST2');
  assert.deepEqual(await claimWelcome(db, inv, emailOf(inv)), { granted: true, balance: 3 });
  assert.equal((await balDoc(ghost)).balance, undefined);
});

test('the inviter is capped at 10 paid referrals', async () => {
  const ref = await welcomed();
  await db.collection('credit_balances').doc(ref.u).set({ referralsRewarded: 10 }, { merge: true });
  const inv = uid('i');
  await withPending(inv, ref.code);
  assert.deepEqual(await claimWelcome(db, inv, emailOf(inv)), { granted: true, balance: 3 }); // invitee gets no bonus either
  assert.equal((await balDoc(ref.u)).balance, 3);
});

test('an already-welcomed user cannot redeem a code afterwards', async () => {
  const ref = await welcomed();
  const late = uid('l');
  await claimWelcome(db, late, emailOf(late)); // welcomed first
  await withPending(late, ref.code);
  assert.deepEqual(await claimWelcome(db, late, emailOf(late)), { granted: false, balance: 3 });
  assert.equal((await balDoc(ref.u)).balance, 3);
});

test('if every candidate code is taken the claim aborts instead of overwriting', async () => {
  await db.collection('invitation_codes').doc('AAAAAA').set({ uid: 'someone', university_id: 'kyoto_u' });
  const u = uid('c');
  await assert.rejects(claimWelcome(db, u, emailOf(u), () => 0), (e) => e.code === 'aborted'); // rand 0 -> 'AAAAAA' x5
  assert.equal((await db.collection('credit_balances').doc(u).get()).exists, false);
});

test('the 11th invitee still gets +3 but the inviter gets nothing more (cap boundary)', async () => {
  const ref = await welcomed();
  await db.collection('credit_balances').doc(ref.u).set({ referralsRewarded: 9 }, { merge: true });
  const a = uid('i'); const b = uid('i');
  await withPending(a, ref.code);
  assert.deepEqual(await claimWelcome(db, a, emailOf(a)), { granted: true, balance: 6 }); // 10th pays
  await withPending(b, ref.code);
  assert.deepEqual(await claimWelcome(db, b, emailOf(b)), { granted: true, balance: 3 }); // 11th: welcome only
  assert.equal((await balDoc(ref.u)).referralsRewarded, 10);
  assert.equal((await balDoc(ref.u)).balance, 6);
  assert.equal((await db.collection('credits_ledger').doc(`referral_out_${b}`).get()).exists, false);
});

test('concurrent claims by the same invitee pay exactly once', async () => {
  const ref = await welcomed();
  const inv = uid('i');
  await withPending(inv, ref.code);
  const rs = await Promise.all(Array.from({ length: 5 }, () => claimWelcome(db, inv, emailOf(inv))));
  assert.equal(rs.filter((r) => r.granted).length, 1);
  assert.equal((await balDoc(inv)).balance, 6);
  assert.equal((await balDoc(ref.u)).balance, 6);
  assert.equal((await balDoc(ref.u)).referralsRewarded, 1);
});

test('concurrent invitees of one inviter never exceed the cap or lose updates', async () => {
  const ref = await welcomed();
  await db.collection('credit_balances').doc(ref.u).set({ referralsRewarded: 8 }, { merge: true });
  const invs = Array.from({ length: 5 }, () => uid('i'));
  await Promise.all(invs.map((i) => withPending(i, ref.code)));
  const rs = await Promise.all(invs.map((i) => claimWelcome(db, i, emailOf(i))));
  assert.equal(rs.filter((r) => r.balance === 6).length, 2);
  assert.equal(rs.filter((r) => r.balance === 3).length, 3);
  assert.equal((await balDoc(ref.u)).referralsRewarded, 10);
  assert.equal((await balDoc(ref.u)).balance, 3 + 6);
});

test('self-referral via the real issued code leaves no referral trace', async () => {
  const me = uid('s');
  // the user's own code can only exist after welcome, so seed one pointing at them beforehand
  await db.collection('invitation_codes').doc('SELFB2').set({ uid: me, university_id: 'kyoto_u' });
  await withPending(me, 'selfb2');
  assert.deepEqual(await claimWelcome(db, me, emailOf(me)), { granted: true, balance: 3 });
  const b = await balDoc(me);
  assert.equal(b.referredBy, undefined);
  assert.equal(b.referralsRewarded, undefined);
  assert.equal((await db.collection('credits_ledger').doc(`referral_in_${me}`).get()).exists, false);
  assert.equal((await db.collection('credits_ledger').doc(`referral_out_${me}`).get()).exists, false);
});

test('P2-15: re-signup with the same email and a referral code pays the inviter nothing', async () => {
  const ref = await welcomed();
  const first = uid('i'); const again = uid('i'); const email = emailOf(uid('dup'));
  await withPending(first, ref.code);
  assert.deepEqual(await claimWelcome(db, first, email), { granted: true, balance: 6 });
  assert.equal((await balDoc(ref.u)).balance, 6);
  // account deleted, re-registered under a new uid with the same address + code
  await withPending(again, ref.code);
  assert.deepEqual(await claimWelcome(db, again, email), { granted: false, balance: 0 });
  assert.equal((await balDoc(ref.u)).balance, 6);
  assert.equal((await balDoc(ref.u)).referralsRewarded, 1);
  assert.equal((await db.collection('credits_ledger').doc(`referral_out_${again}`).get()).exists, false);
  assert.equal((await db.collection('credits_ledger').doc(`referral_in_${again}`).get()).exists, false);
  assert.equal((await db.collection('credits_ledger').doc(`signup_${again}`).get()).exists, false);
  assert.equal((await balDoc(again)).invitationCode, undefined);
});
