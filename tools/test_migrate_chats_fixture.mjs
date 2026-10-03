// Pure asserts + emulator fixture for migrate_chats.mjs (Plan 3, Task 14).
//
//   node test_migrate_chats_fixture.mjs                         # pure asserts
//   node test_migrate_chats_fixture.mjs seed|unchanged|partial|seedpost|migrated
//   node test_migrate_chats_fixture.mjs run <exit> <stdout-substring> [tool args]
//
// The emulator modes refuse to run unless FIRESTORE_EMULATOR_HOST is set.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseArgs, planRoom, ms, needsReset, RESET, safeText } from './migrate_chats.mjs';

const mode = process.argv[2];

if (!mode) {
  assert.deepEqual(parseArgs(['--project', 'p']), { opts: { apply: false, project: 'p' } });
  assert.equal(parseArgs(['--project', 'p', '--apply']).opts.apply, true);
  for (const bad of [[], ['--apply'], ['--project'], ['--project', '--apply'], ['--project', 'p', '--apply', '--dry-run'], ['--project', 'p', '--x']]) {
    assert.ok(parseArgs(bad).error, JSON.stringify(bad));
  }
  assert.equal(planRoom({ lenderId: 'a', borrowerId: 'b' }), null); // no array: nothing to move
  const plan = planRoom({
    lenderId: 'a', borrowerId: 'b', createdAt: '2026-09-01T09:00:00.000',
    messages: [
      { id: 'msg_1', senderId: 'a', senderName: 'A', text: '貸せます', createdAt: '2026-09-01T10:00:00.000' },
      { senderId: '', text: 'no sender' },
      { senderId: 'b', text: '   ' },
      { senderId: 'x/y', text: 'path sender' },
      { senderId: 'b', text: 'お願いします\u0000', createdAt: 'garbage' },
      { senderId: 'b', text: 'x'.repeat(1200), createdAt: '2026-09-01T09:30:00.000' }, // goes back in time
    ],
  });
  assert.deepEqual(plan.messages.map((m) => [m.id, m.senderId, m.text.length]), [['legacy_0000', 'a', 4], ['legacy_0004', 'b', 6], ['legacy_0005', 'b', 1000]]);
  assert.equal(plan.skipped, 3);
  const t0 = ms('2026-09-01T10:00:00.000');
  assert.equal(t0, Date.UTC(2026, 8, 1, 1)); // no offset = JST
  assert.deepEqual(plan.messages.map((m) => m.createdAtMs), [t0, t0 + 1, t0 + 2]); // order kept, never backwards
  assert.deepEqual(plan.summary, {
    lenderSent: true, borrowerSent: true, lastMessageText: 'x'.repeat(80), lastSenderId: 'b', lastMessageAtMs: t0 + 2,
  });
  const quiet = planRoom({ lenderId: 'a', borrowerId: 'b', messages: [] });
  assert.deepEqual(quiet.summary, { lenderSent: false, borrowerSent: false, lastMessageText: '', lastSenderId: '', lastMessageAtMs: null });
  // The reset is the empty summary + no rating flags + no listing link, nothing else.
  assert.deepEqual({ ...RESET }, {
    lastMessageText: '', lastSenderId: '', lastMessageAt: null, lenderSent: false, borrowerSent: false, listingId: '', listingType: '',
  });
  // pre-deploy = created before the first --apply and not yet sealed; never applied = everything.
  assert.equal(needsReset({ createMs: 5, startedMs: null, sealed: false }), true);
  assert.equal(needsReset({ createMs: 5, startedMs: 10, sealed: false }), true);
  assert.equal(needsReset({ createMs: 10, startedMs: 10, sealed: false }), false);
  assert.equal(needsReset({ createMs: 11, startedMs: 10, sealed: false }), false); // post-deploy room
  assert.equal(needsReset({ createMs: 5, startedMs: 10, sealed: true }), false); // already handled
  // Database text never reaches the terminal raw: ESC, bidi override, zero-width.
  assert.equal(safeText('a\u001b[2Jb'), 'a?[2Jb');
  assert.equal(safeText(`x${String.fromCharCode(0x202e)}y${String.fromCharCode(0x200b)}z`), 'x?y?z');
  assert.equal(safeText('y'.repeat(200)).length, 121);
  console.log('migrate_chats pure: OK');
  process.exit(0);
}

if (mode === 'run') {
  const [exit, want, ...args] = process.argv.slice(3);
  const r = spawnSync(process.execPath, ['migrate_chats.mjs', ...args], { encoding: 'utf8', env: process.env });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (String(r.status) !== exit) { console.error(`FAILED: tool exited ${r.status}, expected ${exit}`); process.exit(1); }
  if (!r.stdout.includes(want)) { console.error(`FAILED: output lacks "${want}"`); process.exit(1); }
  if (!/^project: \S+ {2}target: EMULATOR {2}mode: /.test(r.stdout)) { console.error('FAILED: no project/target/mode header'); process.exit(1); }
  process.exit(0);
}

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('refusing to run outside the emulator'); process.exit(1); }
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: 'demo-chats' });
const db = getFirestore();
const room = async (id) => (await db.doc(`talk_rooms/${id}`).get()).data();
const msgs = async (id) => (await db.collection(`talk_rooms/${id}/messages`).orderBy('createdAt').get()).docs;
const EMPTY = { lastMessageText: '', lastSenderId: '', lastMessageAt: null, lenderSent: false, borrowerSent: false, listingId: '', listingType: '' };

if (mode === 'seed') {
  await db.doc('talk_rooms/old1').set({
    id: 'old1', lenderId: 'a', borrowerId: 'b', bookTitle: '本', university_id: 'kyoto_u', createdAt: '2026-09-01T09:00:00.000',
    messages: [
      { id: 'msg_1', senderId: 'a', senderName: 'A', text: '貸せます', createdAt: '2026-09-01T10:00:00.000' },
      { id: 'msg_2', senderId: 'b', senderName: 'B', text: 'ありがとう', createdAt: '2026-09-01T10:05:00.000' },
    ],
  });
  await db.doc('talk_rooms/old_empty').set({ id: 'old_empty', lenderId: 'a', borrowerId: 'c', university_id: 'kyoto_u', messages: [] });
  await db.doc('talk_rooms/big').set({
    id: 'big', lenderId: 'a', borrowerId: 'd', university_id: 'kyoto_u', createdAt: '2026-09-02T09:00:00.000',
    messages: Array.from({ length: 450 }, (_, i) => ({ senderId: i % 2 ? 'a' : 'd', text: `m${i}`, createdAt: `2026-09-02T10:00:${String(i % 60).padStart(2, '0')}.000` })),
  });
  // PRE-DEPLOY rooms without an array were client-writable: `new1` and `forged` claim a listing, a preview and
  // that both sides spoke (which would unlock rating). They are untrusted and must be reset too.
  await db.doc('talk_rooms/new1').set({
    id: 'new1', listingId: 'L', listingType: 'sell', lenderId: 'a', borrowerId: 'e', lastMessageText: 'keep', lastSenderId: 'a',
    lastMessageAt: Timestamp.fromMillis(Date.now() + 365 * 86400000), lenderSent: true, borrowerSent: true, university_id: 'kyoto_u',
  });
  await db.doc('talk_rooms/forged').set({
    id: 'forged', listingId: 'l_x', lenderId: 'a', borrowerId: 'f', lenderSent: true, borrowerSent: true, lastMessageText: 'fake', university_id: 'kyoto_u',
  });
  console.log('fixture seeded');
  process.exit(0);
}

if (mode === 'seedpost') {
  // A room created by the deployed Functions AFTER the first --apply: a re-run must never touch it.
  await db.doc('talk_rooms/post1').set({
    id: 'post1', listingId: 'l_L2_u', listingType: 'give', lenderId: 'a', borrowerId: 'g', lastMessageText: 'real', lastSenderId: 'g',
    lastMessageAt: Timestamp.fromMillis(Date.now() - 1000), lenderSent: true, borrowerSent: true, university_id: 'kyoto_u',
  });
  console.log('post-deploy room seeded');
  process.exit(0);
}

const checks = {
  unchanged: async () => {
    // A dry run writes nothing: arrays intact, nothing reset, no state, no sealed records.
    assert.equal((await room('old1')).messages.length, 2);
    assert.equal((await msgs('old1')).length, 0);
    assert.equal((await room('new1')).listingId, 'L');
    assert.equal((await room('forged')).lenderSent, true);
    assert.equal((await db.doc('admin_migrations/chats').get()).exists, false);
    assert.equal((await db.collection('admin_migrations/chats/rooms').get()).size, 0);
  },
  partial: async () => {
    // The injected failure hit the FINAL batch of `big`: some messages exist, the array is intact, `big` is not sealed.
    assert.equal((await room('big')).messages.length, 450);
    assert.equal((await msgs('big')).length, 400);
    assert.equal((await db.doc('admin_migrations/chats/rooms/big').get()).exists, false);
    assert.equal((await room('old1')).messages, undefined); // the other rooms still migrated
    assert.equal((await room('new1')).listingId, ''); // and the array-less pre-deploy rooms were reset
  },
  migrated: async () => {
    const r = await room('old1');
    assert.equal(r.messages, undefined);
    const m = await msgs('old1');
    assert.deepEqual(m.map((d) => d.id), ['legacy_0000', 'legacy_0001']);
    assert.deepEqual(Object.keys(m[0].data()).sort(), ['createdAt', 'senderId', 'text', 'university_id']);
    assert.equal(m[0].get('createdAt').toMillis(), Date.UTC(2026, 8, 1, 1));
    // preview of the history, but a legacy room: no listing link, no rating flags (the trigger sets the flags
    // again for migrated messages; without a listingId rateDeal refuses the room anyway).
    assert.deepEqual([r.lastMessageText, r.lastSenderId, r.lenderSent, r.borrowerSent, r.listingId], ['ありがとう', 'b', false, false, '']);
    assert.equal(r.lastMessageAt.toMillis(), Date.UTC(2026, 8, 1, 1, 5));
    assert.equal(r.lenderReadAt.toMillis(), r.lastMessageAt.toMillis()); // history is not "unread"
    const e = await room('old_empty');
    assert.deepEqual([e.messages, e.lastMessageAt, e.lenderSent, e.listingId], [undefined, null, false, '']);
    const big = await room('big');
    assert.equal(big.messages, undefined);
    assert.equal(big.listingId, '');
    assert.equal((await msgs('big')).length, 450);
    // Untrusted pre-deploy rooms without an array: reset completely, nothing else touched.
    assert.deepEqual(await room('new1'), { id: 'new1', lenderId: 'a', borrowerId: 'e', university_id: 'kyoto_u', ...EMPTY });
    assert.deepEqual(await room('forged'), { id: 'forged', lenderId: 'a', borrowerId: 'f', university_id: 'kyoto_u', ...EMPTY });
    // The room created after the first --apply is exactly as the Functions left it.
    const p = await room('post1');
    assert.deepEqual([p.listingId, p.lastMessageText, p.lenderSent, p.borrowerSent, p.lastSenderId], ['l_L2_u', 'real', true, true, 'g']);
    assert.equal((await db.doc('admin_migrations/chats/rooms/post1').get()).exists, false);
    assert.equal((await db.collection('admin_migrations/chats/rooms').get()).size, 5); // the five pre-deploy rooms
  },
};
if (!checks[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
await checks[mode]();
console.log(`${mode}: assertions passed`);
process.exit(0);
