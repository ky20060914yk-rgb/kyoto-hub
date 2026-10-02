import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid } from '../testlib/helpers.mjs';
import { claimWelcome } from '../lib/welcome.js';
import { readBalance, writeCredit } from '../lib/credits.js';

test('claimWelcome grants +3 once and records a ledger row', async () => {
  const u = uid();
  assert.deepEqual(await claimWelcome(db, u), { granted: true, balance: 3 });
  assert.deepEqual(await claimWelcome(db, u), { granted: false, balance: 3 });

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
  const rs = await Promise.all([claimWelcome(db, u), claimWelcome(db, u), claimWelcome(db, u)]);
  assert.equal(rs.filter((r) => r.granted).length, 1);
  assert.equal((await db.collection('credit_balances').doc(u).get()).get('balance'), 3);
});

test('balance doc carries university_id and the welcome flag', async () => {
  const u = uid();
  await claimWelcome(db, u);
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
  await claimWelcome(db, u); // welcomeGranted: true, balance 3
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
