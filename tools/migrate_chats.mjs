// Move legacy talk-room chats from the `messages` ARRAY on `talk_rooms/{id}`
// into the `talk_rooms/{id}/messages/{msgId}` subcollection, and distrust every
// room that existed before the Plan 3 deploy (Plan 3, Task 14; spec §4.5.5).
//
// SAFE BY DESIGN (same conventions as migrate_storage.mjs)
//   * Dry-run is the DEFAULT. Nothing is written unless you pass --apply.
//   * --project is mandatory (no fallback to an ambient project). The first
//     lines printed are the project, EMULATOR vs LIVE, and the mode.
//   * Idempotent and crash-safe. Message ids are deterministic (`legacy_0000`,
//     … by array position). A room's array is deleted in the SAME batch that
//     writes its last messages and its "sealed" record, so a crash leaves a
//     room that a re-run simply finishes; one failing room never stops the run
//     (exit code 1 if any failed).
//   * PRE-DEPLOY ROOMS ARE UNTRUSTED. Before Plan 3 a room was client-writable,
//     so its summary (lastMessage*), its lenderSent/borrowerSent flags (which
//     unlock rating) and its listingId / listingType (which tie it to a listing)
//     may be forged. EVERY room that existed before the deploy is reset to the
//     empty state — also rooms that never had a messages array. listingId is
//     cleared, which makes the room a "legacy-room" that rateDeal refuses.
//   * A room is "pre-deploy" when its Firestore createTime (server-set, cannot be
//     forged) is earlier than the moment of the FIRST --apply run, which is
//     recorded in `admin_migrations/chats` (Admin-only: the catch-all rule denies
//     clients). Rooms already handled are recorded under
//     `admin_migrations/chats/rooms/{roomId}`, never on the room itself (a
//     pre-deploy client could have forged a marker there). So a re-run — even
//     weeks later, with real post-deploy chats in the database — leaves those
//     rooms alone. Run this BEFORE the hosting deploy (runbook step 5b).
//   * Messages keep only the four fields the new rules allow (senderId, text,
//     createdAt, university_id). The sender NAME is dropped: the app shows the
//     names from the room. Entries without a sender or text are skipped, and so
//     are entries whose sender is neither the room's lenderId nor borrowerId (a
//     pre-deploy client could forge them); those are counted as foreign-senders.
//   * A migrated room keeps a preview of its last legacy message and has both
//     read markers set to it, so migrated history is not "unread". The
//     lenderSent/borrowerSent flags are written false: the
//     onTalkMessageCreated trigger fires once per migrated message and sets them
//     again (it is monotonic and agrees with the preview), but the room stays a
//     legacy-room (no listingId), so it can never unlock a rating.
//   * Free text from the database (room ids, error messages) is printed through
//     safeText.
//
// Auth: Application Default Credentials ONLY (GOOGLE_APPLICATION_CREDENTIALS in
// YOUR shell, or `gcloud auth application-default login`). This tool never reads
// a key path and never stores a credential. FIRESTORE_EMULATOR_HOST targets the
// emulator.
//
// Usage:
//   node migrate_chats.mjs --project kyodai-sns            # dry run (report only)
//   node migrate_chats.mjs --project kyodai-sns --apply    # migrate + reset

import { pathToFileURL } from 'node:url';

const USAGE = `usage: node migrate_chats.mjs --project <id> [--apply]
  default is a DRY RUN (nothing is written). --apply moves each room's messages array into its messages subcollection
  and resets the summary / rating flags / listing link of every room that existed before the deploy.
  auth: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or gcloud application-default login).`;

export const MAX_TEXT = 1000; // firestore.rules: messages text <= 1000
const PREVIEW = 80; // functions/src/marketCore.ts MARKET.previewLength
const CHUNK = 400; // writes per batch (Firestore allows 500)

/** Control and invisible/bidi characters out, length bounded: database text is untrusted. */
export function safeText(v, max = 120) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\u115f\u1160\u2800\ufeff]/g, '?');
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

export function parseArgs(argv) {
  const opts = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') opts.project = argv[++i];
    else if (a === '--apply') opts.apply = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else return { error: `unknown argument: ${a}` };
  }
  if (!opts.project || opts.project.startsWith('--')) return { error: 'missing --project' };
  if (opts.apply && opts.dryRun) return { error: '--apply and --dry-run are mutually exclusive' };
  delete opts.dryRun;
  return { opts };
}

const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
// Legacy times are Dart `DateTime.now().toIso8601String()` from browsers in
// Japan: local time WITHOUT an offset. Read them as JST (+09:00) wherever this
// tool runs; an explicit Z / offset is respected.
export const ms = (v) => {
  if (typeof v !== 'string' || v === '') return null;
  const t = Date.parse(/([zZ]|[+-]\d\d:?\d\d)$/.test(v) ? v : `${v}+09:00`);
  return Number.isNaN(t) ? null : t;
};

/**
 * Pure: what migrating one room's legacy array means. `null` when the room has
 * no array (nothing to move; the caller still resets a pre-deploy room).
 * Otherwise the message docs (createdAt as epoch ms; a missing/garbled time
 * falls back to the previous message's, else the room's, else 0 — order is
 * preserved by +1 ms), the number skipped, and the summary of the history.
 */
export function planRoom(room) {
  if (!Array.isArray(room?.messages)) return null;
  const base = ms(room.createdAt) ?? 0;
  const messages = [];
  let skipped = 0;
  let foreign = 0;
  let prev = base;
  room.messages.forEach((m, i) => {
    const senderId = typeof m?.senderId === 'string' ? m.senderId : '';
    const text = typeof m?.text === 'string' ? m.text.replace(CONTROLS, '').trim().slice(0, MAX_TEXT) : '';
    if (!senderId || !text) { skipped++; return; }
    // A pre-deploy client could append a message "from" anybody: only the two parties of the room are migrated.
    if (senderId.includes('/') || (senderId !== room.lenderId && senderId !== room.borrowerId)) { skipped++; foreign++; return; }
    const at = Math.max(ms(m.createdAt) ?? prev, prev);
    prev = at + 1;
    messages.push({ id: `legacy_${String(i).padStart(4, '0')}`, senderId, text, createdAtMs: at });
  });
  const last = messages[messages.length - 1];
  const summary = {
    lenderSent: messages.some((m) => m.senderId === room.lenderId),
    borrowerSent: messages.some((m) => m.senderId === room.borrowerId),
    lastMessageText: last ? last.text.replace(/\s+/g, ' ').slice(0, PREVIEW) : '',
    lastSenderId: last ? last.senderId : '',
    lastMessageAtMs: last ? last.createdAtMs : null,
  };
  return { messages, skipped, foreign, summary };
}

/**
 * Pure: the fields every pre-deploy room is reset to (T-18: the summary and the
 * Sent flags are Function-owned; listingId links a room to a listing and so to
 * rating — a pre-deploy room is never trusted for either).
 */
export const RESET = Object.freeze({
  lastMessageText: '', lastSenderId: '', lastMessageAt: null,
  lenderSent: false, borrowerSent: false,
  listingId: '', listingType: '',
});

/**
 * Pure: is this room pre-deploy and not yet handled? `startedMs` is when the
 * first --apply began (null = never applied: every room is pre-deploy);
 * `createMs` is the room's Firestore createTime.
 */
export function needsReset({ createMs, startedMs, sealed }) {
  if (sealed) return false;
  return startedMs === null || createMs < startedMs;
}

async function main() {
  const { opts, error } = parseArgs(process.argv.slice(2));
  if (error) {
    console.error(`${error}\n${USAGE}`);
    process.exit(2);
  }
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  console.log(`project: ${safeText(opts.project, 80)}  target: ${emulator ? 'EMULATOR' : 'LIVE'}  mode: ${opts.apply ? 'APPLY' : 'DRY RUN (no changes; pass --apply to write)'}`);
  initializeApp({ projectId: opts.project, credential: applicationDefault() });
  const db = getFirestore();

  // The moment of the first --apply: rooms created after it are post-deploy and never touched.
  const stateRef = db.doc('admin_migrations/chats');
  let startedMs = null;
  const existing = await stateRef.get();
  if (existing.exists) startedMs = existing.get('startedAt')?.toMillis?.() ?? null;
  if (opts.apply && startedMs === null) {
    startedMs = await db.runTransaction(async (tx) => {
      const s = await tx.get(stateRef);
      if (s.exists && s.get('startedAt')) return s.get('startedAt').toMillis();
      tx.set(stateRef, { startedAt: FieldValue.serverTimestamp(), university_id: 'kyoto_u' });
      return null;
    });
    if (startedMs === null) startedMs = (await stateRef.get()).get('startedAt').toMillis();
  }
  const sealedRef = (id) => db.doc(`admin_migrations/chats/rooms/${id}`);

  const tot = { rooms: 0, migrate: 0, reset: 0, skip: 0, messages: 0, skippedMessages: 0, foreign: 0, failed: 0 };
  for (const doc of (await db.collection('talk_rooms').get()).docs) {
    tot.rooms++;
    const sealed = (await sealedRef(doc.id).get()).exists;
    if (!needsReset({ createMs: doc.createTime.toMillis(), startedMs, sealed })) { tot.skip++; continue; }
    const plan = planRoom(doc.data());
    const id = safeText(doc.id, 80);
    if (plan) {
      tot.migrate++;
      tot.messages += plan.messages.length;
      tot.skippedMessages += plan.skipped;
      tot.foreign += plan.foreign;
      console.log(`${opts.apply ? 'MIGRATE' : 'WOULD MIGRATE'} talk_rooms/${id}: ${plan.messages.length} message(s), ${plan.skipped} skipped${plan.foreign ? ` (${plan.foreign} from a non-participant)` : ''}`);
    } else {
      tot.reset++;
      console.log(`${opts.apply ? 'RESET' : 'WOULD RESET'} talk_rooms/${id}: summary, rating flags and listing link cleared`);
    }
    if (!opts.apply) continue;
    try {
      const msgWrites = (plan?.messages ?? []).map((m) => (b) => b.set(doc.ref.collection('messages').doc(m.id), {
        senderId: m.senderId, text: m.text, createdAt: Timestamp.fromMillis(m.createdAtMs), university_id: 'kyoto_u',
      }));
      // The room update (array delete) and the sealed record ALWAYS share the FINAL batch.
      const at = plan?.summary.lastMessageAtMs == null ? null : Timestamp.fromMillis(plan.summary.lastMessageAtMs);
      const finalWrites = [
        (b) => b.update(doc.ref, plan
          ? {
            ...RESET,
            messages: FieldValue.delete(),
            lastMessageText: plan.summary.lastMessageText,
            lastSenderId: plan.summary.lastSenderId,
            lastMessageAt: at,
            lenderReadAt: at,
            borrowerReadAt: at,
          }
          : { ...RESET }),
        (b) => b.set(sealedRef(doc.id), { sealedAt: FieldValue.serverTimestamp(), migrated: !!plan, university_id: 'kyoto_u' }),
      ];
      const batches = [];
      for (let i = 0; i < msgWrites.length; i += CHUNK) batches.push(msgWrites.slice(i, i + CHUNK));
      if (batches.length > 0 && batches[batches.length - 1].length < CHUNK) batches[batches.length - 1].push(...finalWrites);
      else batches.push(finalWrites);
      for (let i = 0; i < batches.length; i++) {
        const batch = db.batch();
        for (const w of batches[i]) w(batch);
        if (process.env.MIGRATE_CHATS_TEST_FAIL === doc.id && i === batches.length - 1 && emulator) {
          throw new Error('injected failure before the final batch'); // test hook, emulator only
        }
        await batch.commit();
      }
    } catch (e) {
      tot.failed++;
      console.log(`FAIL talk_rooms/${id}: ${safeText(e?.message, 200)}`);
    }
  }
  console.log(`totals: rooms=${tot.rooms} migrate=${tot.migrate} reset=${tot.reset} skip=${tot.skip} messages=${tot.messages} skipped-messages=${tot.skippedMessages} foreign-senders=${tot.foreign} failed=${tot.failed}`);
  console.log(opts.apply ? 'done' : 'done (dry run: nothing written)');
  if (tot.failed > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`FAILED: ${safeText(e?.message, 300)}`); process.exit(1); });
}
