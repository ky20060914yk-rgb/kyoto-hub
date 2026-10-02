import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, emailOf } from '../testlib/helpers.mjs';
import { claimWelcome, welcomeKey } from '../lib/welcome.js';
import { readBalance, writeCredit } from '../lib/credits.js';

test('claimWelcome grants +3 once and records a ledger row', async () => {
  const u = uid();
  assert.deepEqual(await claimWelcome(db, u, emailOf(u)), { granted: true, balance: 3 });
  assert.deepEqual(await claimWelcome(db, u, emailOf(u)), { granted: false, balance: 3 });

  const led = await db.collection('credits_ledger').doc(`signup_${u}`).get();
  assert.equal(led.get('delta'), 3);
  assert.equal(led.get('balanceAfter'), 3);
  assert.equal(led.get('uid'), u);
  assert.equal(led.get('reason'), 'signup_bonus');
  assert.equal(led.get('university_id'), 'kyoto_u');
  assert.equal((await db.collection('credits_ledger').where('uid', '==', u).get()).size, 1);
});

test('concurrent claims grant exactly once', async () => {
  const u = uid();
  const rs = await Promise.all([claimWelcome(db, u, emailOf(u)), claimWelcome(db, u, emailOf(u)), claimWelcome(db, u, emailOf(u))]);
  assert.equal(rs.filter((r) => r.granted).length, 1);
  assert.equal((await db.collection('credit_balances').doc(u).get()).get('balance'), 3);
});

test('balance doc carries university_id and the welcome flag', async () => {
  const u = uid();
  await claimWelcome(db, u, emailOf(u));
  const b = await db.collection('credit_balances').doc(u).get();
  assert.equal(b.get('university_id'), 'kyoto_u');
  assert.equal(b.get('welcomeGranted'), true);
});

test('writeCredit refuses to take the balance below zero and writes nothing', async () => {
  const u = uid();
  await assert.rejects(
    db.runTransaction(async (tx) => {
      const cur = await readBalance(tx, db, u);
      writeCredit(tx, db, { uid: u, delta: -1, reason: 'download', ledgerId: `x_${u}` }, cur);
    }),
    (e) => e.code === 'failed-precondition' && /insufficient-credits/.test(e.message),
  );
  assert.equal((await db.collection('credit_balances').doc(u).get()).exists, false);
  assert.equal((await db.collection('credits_ledger').doc(`x_${u}`).get()).exists, false);
});

test('readBalance treats a missing doc as zero', async () => {
  const u = uid();
  const cur = await db.runTransaction((tx) => readBalance(tx, db, u));
  assert.deepEqual(cur, { balance: 0 });
});

test('writeCredit merges a patch into the balance doc without losing other fields', async () => {
  const u = uid();
  await claimWelcome(db, u, emailOf(u)); // welcomeGranted: true, balance 3
  await db.runTransaction(async (tx) => {
    const cur = await readBalance(tx, db, u);
    writeCredit(tx, db, { uid: u, delta: 2, reason: 'first_review', ledgerId: `fr_${u}` }, cur,
      { reviewBonusesUsed: 1 });
  });
  const b = await db.collection('credit_balances').doc(u).get();
  assert.equal(b.get('balance'), 5);
  assert.equal(b.get('welcomeGranted'), true);
  assert.equal(b.get('reviewBonusesUsed'), 1);
});

test('writeCredit twice with the same ledgerId rejects the second call and keeps the balance', async () => {
  const u = uid();
  const ev = { uid: u, delta: 2, reason: 'upload', ledgerId: `dup_${u}` };
  await db.runTransaction(async (tx) => writeCredit(tx, db, ev, await readBalance(tx, db, u)));
  await assert.rejects(
    db.runTransaction(async (tx) => writeCredit(tx, db, ev, await readBalance(tx, db, u))),
  );
  assert.equal((await db.collection('credit_balances').doc(u).get()).get('balance'), 2);
  assert.equal((await db.collection('credits_ledger').where('uid', '==', u).get()).size, 1);
});

test('writeCredit allows spending down to exactly zero', async () => {
  const u = uid();
  await db.collection('credit_balances').doc(u).set({ balance: 1 });
  await db.runTransaction(async (tx) => {
    writeCredit(tx, db, { uid: u, delta: -1, reason: 'download', ledgerId: `z_${u}` }, await readBalance(tx, db, u));
  });
  assert.equal((await db.collection('credit_balances').doc(u).get()).get('balance'), 0);
});

test('a patch cannot override the computed balance', async () => {
  const u = uid();
  await db.runTransaction(async (tx) => {
    writeCredit(tx, db, { uid: u, delta: 1, reason: 'upload', ledgerId: `p_${u}` },
      await readBalance(tx, db, u), { balance: 999 });
  });
  assert.equal((await db.collection('credit_balances').doc(u).get()).get('balance'), 1);
});

test('writeCredit rejects a non-integer or NaN delta', async () => {
  const u = uid();
  for (const delta of [1.5, NaN]) {
    await assert.rejects(
      db.runTransaction(async (tx) => {
        writeCredit(tx, db, { uid: u, delta, reason: 'upload', ledgerId: `n_${u}` }, await readBalance(tx, db, u));
      }),
      (e) => e.code === 'invalid-argument' && /bad-delta/.test(e.message),
    );
  }
  assert.equal((await db.collection('credit_balances').doc(u).get()).exists, false);
});

// ---- P2-15: welcome + referral are once per EMAIL, not per uid
const ledgerCount = async (u) => (await db.collection('credits_ledger').where('uid', '==', u).get()).size;

test('P2-15: the same email on a second uid (delete + re-signup) gets nothing', async () => {
  const a = uid(); const b = uid(); const email = emailOf(uid('shared'));
  assert.deepEqual(await claimWelcome(db, a, email), { granted: true, balance: 3 });
  assert.deepEqual(await claimWelcome(db, b, email), { granted: false, balance: 0 });
  assert.equal(await ledgerCount(b), 0);
  assert.equal((await db.collection('credit_balances').doc(b).get()).exists, false);
  const claim = await db.collection('welcome_claims').doc(welcomeKey(email)).get();
  assert.equal(claim.get('uid'), a);
  assert.equal(claim.get('university_id'), 'kyoto_u');
});

test('P2-15: the email match ignores case and surrounding whitespace', async () => {
  const a = uid(); const b = uid(); const c = uid(); const base = emailOf(uid('Case'));
  assert.equal((await claimWelcome(db, a, base)).granted, true);
  assert.equal((await claimWelcome(db, b, `  ${base.toUpperCase()} `)).granted, false);
  assert.equal((await claimWelcome(db, c, base.toLowerCase())).granted, false);
  assert.equal(await ledgerCount(b) + await ledgerCount(c), 0);
});

test('P2-15: concurrent claims by two uids with one email grant exactly once', async () => {
  const a = uid(); const b = uid(); const email = emailOf(uid('race'));
  const rs = await Promise.all([claimWelcome(db, a, email), claimWelcome(db, b, email)]);
  assert.equal(rs.filter((r) => r.granted).length, 1);
  const total = (await bal(a)) + (await bal(b));
  assert.equal(total, 3);
});

test('P2-15: different emails are unaffected', async () => {
  const a = uid(); const b = uid();
  assert.deepEqual(await claimWelcome(db, a, emailOf(a)), { granted: true, balance: 3 });
  assert.deepEqual(await claimWelcome(db, b, emailOf(b)), { granted: true, balance: 3 });
});
const bal = async (u) => (await db.collection('credit_balances').doc(u).get()).get('balance') ?? 0;
