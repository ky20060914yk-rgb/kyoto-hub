// Pure asserts + emulator fixture for the market commands of moderate.mjs (Plan 3, Task 15).
//
//   node test_moderate_market_fixture.mjs                 # pure asserts
//   node test_moderate_market_fixture.mjs seed|listcheck|dry-clean|hidden|restored|removed|remove-once|closed|closed-once
//
// The emulator modes refuse to run unless FIRESTORE_EMULATOR_HOST is set.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseArgs, safeText } from './moderate.mjs';

const mode = process.argv[2];
const BIDI = String.fromCharCode(0x202e);

if (!mode) {
  assert.deepEqual(parseArgs(['market-list', '--project', 'p']).opts, { command: 'market-list', apply: false, project: 'p' });
  const r = parseArgs(['listing-restore', 'L1', '--project', 'p', '--apply', '--operator', 'me']).opts;
  assert.deepEqual([r.command, r.target, r.apply, r.operator], ['listing-restore', 'L1', true, 'me']);
  for (const bad of [
    ['market-list'], ['market-list', '--project', 'p', '--apply', '--operator', 'x'], ['listing-hide', '--project', 'p'],
    ['case-close', 'c1', '--project', 'p', '--apply'], ['listing-remove', 'a', 'b', '--project', 'p'], ['market-list', 'x', '--project', 'p'],
    ['listing-remove', 'a', '--project', 'p', '--apply', '--operator', '--note'], // --apply needs a real operator name
  ]) {
    assert.ok(parseArgs(bad).error, JSON.stringify(bad));
  }
  // Attacker text (titles, case details) never reaches the terminal raw: ESC, bidi override, zero-width.
  assert.equal(safeText(`a\u001b[2J${BIDI}b${String.fromCharCode(0x200b)}c`), 'a?[2J?b?c');
  console.log('moderate market pure: OK');
  process.exit(0);
}

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('refusing to run outside the emulator'); process.exit(1); }
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: 'demo-mod' });
const db = getFirestore();
const get = (p) => db.doc(p).get();
const logged = async (action) => (await db.collection('moderation_log').where('action', '==', action).get()).size;

if (mode === 'seed') {
  const exp = Timestamp.fromMillis(Date.now() + 10 * 86400000);
  await db.doc('textbook_listings/L1').set({ id: 'L1', ownerId: 'own1', title: `Evil\u001b[2J${BIDI}本`, status: 'hidden', type: 'sell', expiresAt: exp, university_id: 'kyoto_u' });
  await db.doc('market_queue/L1').set({
    listingId: 'L1', ownerId: 'own1', title: `Evil${BIDI}本`, status: 'hidden', reportCount: 3, countedReports: 3, hiddenBy: 'reports',
    statusBeforeHide: 'active', autoHide: true, transitions: 1, needsReview: true, university_id: 'kyoto_u',
  });
  for (const k of ['k1', 'k2', 'k3']) await db.doc(`market_queue/L1/reports/${k}`).set({ counted: true, university_id: 'kyoto_u' });
  await db.doc('textbook_listings/L2').set({ id: 'L2', ownerId: 'own2', title: '普通の本', status: 'active', type: 'give', expiresAt: exp, university_id: 'kyoto_u' });
  await db.doc('market_cases/R1_borrower').set({
    roomId: 'R1', category: 'harassment', status: 'open', priority: 'high', reporterUid: 'b1', reportedUid: 'own2',
    detail: `しつこい\u001b[31m${BIDI}`, university_id: 'kyoto_u',
  });
  console.log('fixture seeded');
  process.exit(0);
}

if (mode === 'listcheck') {
  const r = spawnSync(process.execPath, ['moderate.mjs', 'market-list', '--project', 'demo-mod'], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.startsWith('project: demo-mod  target: EMULATOR  mode: DRY RUN'), 'project / target / mode are printed first');
  assert.ok(r.stdout.includes('L1'), 'the hidden listing is listed');
  assert.ok(r.stdout.includes('HIGH'), 'the harassment case is high priority');
  assert.ok(!r.stdout.includes('\u001b'), 'no raw ESC reaches the terminal');
  assert.ok(!r.stdout.includes(BIDI), 'no bidi override reaches the terminal');
  console.log('listcheck: assertions passed');
  process.exit(0);
}

const checks = {
  'dry-clean': async () => {
    assert.equal((await get('textbook_listings/L1')).get('status'), 'hidden');
    assert.equal((await get('textbook_listings/L2')).get('status'), 'active');
    assert.equal((await get('market_cases/R1_borrower')).get('status'), 'open');
    assert.equal((await db.collection('moderation_log').get()).size, 0);
    assert.equal((await db.collection('notifications').get()).size, 0);
  },
  hidden: async () => {
    assert.equal((await get('textbook_listings/L2')).get('status'), 'hidden');
    assert.equal((await get('notifications/mkt_L2_1')).get('type'), 'listing_hidden');
  },
  restored: async () => {
    assert.equal((await get('textbook_listings/L1')).get('status'), 'active');
    assert.equal((await get('market_queue/L1')).get('autoHide'), false);
    for (const k of ['k1', 'k2', 'k3']) assert.equal((await get(`moderation_actors/${k}`)).get('restoredReports'), 1);
    assert.equal((await get('notifications/mkt_L1_2')).get('type'), 'listing_restored');
  },
  removed: async () => {
    assert.equal((await get('textbook_listings/L2')).exists, false);
    assert.equal((await get('notifications/mkt_L2_2')).get('type'), 'listing_removed');
  },
  // A repeated remove (a crash-and-retry) succeeds without a second notice, a second audit row or a transition.
  'remove-once': async () => {
    assert.equal((await get('notifications/mkt_L2_3')).exists, false);
    assert.equal(await logged('listing_remove'), 1);
    assert.equal((await get('market_queue/L2')).get('transitions'), 2);
  },
  closed: async () => {
    const c = (await get('market_cases/R1_borrower')).data();
    assert.deepEqual([c.status, c.closedBy], ['closed', 'tester']);
    const by = (await db.collection('moderation_log').get()).docs.map((d) => d.get('by'));
    assert.ok(by.length >= 4 && by.every((b) => b === 'operator:tester'), JSON.stringify(by));
  },
  'closed-once': async () => {
    assert.equal(await logged('case_close'), 1);
  },
};
if (!checks[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
await checks[mode]();
console.log(`${mode}: assertions passed`);
process.exit(0);
