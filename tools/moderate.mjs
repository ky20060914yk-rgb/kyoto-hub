// Moderation CLI (Plan 2B, M-5). There is NO admin UI and NO admin callable:
// the operator is whoever holds the project's credentials and runs this on
// their own machine. Every state change goes through the same code the Cloud
// Functions use (functions/lib/moderation.js, with the Functions' own
// firebase-admin — M-17), so notifications, discredit counters and the
// moderation_log audit row are identical to an automatic hide.
//
// SAFE BY DESIGN
//   * Every mutating command is a DRY RUN unless --apply is given; the dry run
//     reads the current state and prints what WOULD happen.
//   * --project is mandatory. --apply requires --operator <name>, recorded in
//     moderation_log. No command touches a credit (spec §4.3, M-4).
//   * Queue text (titles, names, descriptions) is attacker-supplied: it is
//     printed through safeText, so a crafted takedown form cannot inject
//     terminal escape sequences into the operator's shell.
//
// Auth: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS in YOUR
// shell, or `gcloud auth application-default login`). FIRESTORE_EMULATOR_HOST
// targets the emulator. Build first: npm --prefix functions run build
//
// Usage:
//   node moderate.mjs list --project <id>
//   node moderate.mjs hide    <postId>    --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs restore <postId>    --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs delete  <postId>    --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs close   <requestId> --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs strip-legacy-reports --project <id> [--apply --operator <name>]
//
// Textbook market (Plan 3, T-19/T-20) — same safety rules:
//   node moderate.mjs market-list --project <id>
//   node moderate.mjs listing-hide    <listingId> --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs listing-restore <listingId> --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs listing-remove  <listingId> --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs case-close      <caseId>    --project <id> [--apply --operator <name>] [--note <text>]
//   A case is a participant's report about a chat (harassment / no_show / fraud);
//   read the room's messages in the console, then act (e.g. disable the account
//   in Firebase Authentication) and close the case.
//
//   restore on a hidden post = move it back + notify the author; on a visible
//   queued post = acknowledge (it stays up and is never auto-hidden again).

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const MARKET_TARGETED = new Set(['listing-hide', 'listing-restore', 'listing-remove', 'case-close']);
const TARGETED = new Set(['hide', 'restore', 'delete', 'close', ...MARKET_TARGETED]);
const COMMANDS = new Set([...TARGETED, 'list', 'strip-legacy-reports', 'market-list']);
const USAGE = `usage: node moderate.mjs <list|hide|restore|delete|close|strip-legacy-reports|market-list|listing-hide|listing-restore|listing-remove|case-close> [id] --project <id> [--apply --operator <name>] [--note <text>]
  every mutating command is a DRY RUN unless --apply (with --operator) is given.
  first: npm --prefix functions run build   (this tool runs the compiled moderation code)`;

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) return { error: `unknown command: ${command ?? '(none)'}` };
  const opts = { command, apply: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--project') opts.project = rest[++i];
    else if (a === '--operator') opts.operator = rest[++i];
    else if (a === '--note') opts.note = rest[++i];
    else if (a === '--apply') opts.apply = true;
    else if (!a.startsWith('--') && TARGETED.has(command) && opts.target === undefined) opts.target = a;
    else return { error: `unknown argument: ${a}` };
  }
  if (!opts.project || opts.project.startsWith('--')) return { error: 'missing --project' };
  if (TARGETED.has(command) && !opts.target) return { error: `${command} needs an id` };
  if ((command === 'list' || command === 'market-list') && opts.apply) return { error: `${command} is read-only` };
  if (opts.apply && (!opts.operator || opts.operator.startsWith('--'))) return { error: '--apply requires --operator <name>' };
  return { opts };
}

/** Control, bidi-override and invisible characters out, length bounded: queue text is attacker-supplied. */
export function safeText(v, max = 120) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\u115f\u1160\u2800\ufeff]/g, '?');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Remove the legacy `reports` arrays (they publish who reported whom, M-3).
 * One failing document never stops the run (it is counted); with --apply one
 * `moderation_log` row records the operator and the totals. `strip` is
 * injectable so the failure path can be tested.
 */
export async function stripLegacyReports(db, FieldValue, opts, strip = (ref) => ref.update({ reports: FieldValue.delete() })) {
  let candidates = 0; let stripped = 0; let failed = 0;
  for (const c of ['posts', 'hidden_posts']) {
    for (const d of (await db.collection(c).get()).docs) {
      if (d.get('reports') === undefined) continue;
      candidates++;
      const len = Array.isArray(d.get('reports')) ? d.get('reports').length : '?';
      console.log(`${opts.apply ? 'STRIP' : 'WOULD STRIP'} ${c}/${safeText(d.id, 60)} reports (${len} entries)`);
      if (!opts.apply) continue;
      try { await strip(d.ref); stripped++; } catch (e) {
        failed++;
        console.error(`  FAILED ${c}/${safeText(d.id, 60)}: ${safeText(e?.message, 200)}`);
      }
    }
  }
  if (opts.apply) {
    await db.collection('moderation_log').add({
      action: 'strip_legacy_reports', target: 'posts+hidden_posts', by: `operator:${opts.operator}`,
      note: `candidates=${candidates} stripped=${stripped} failed=${failed}`,
      at: FieldValue.serverTimestamp(), university_id: 'kyoto_u',
    });
  }
  return { candidates, stripped, failed };
}

async function describeMarket(db, cmd, id) {
  if (cmd === 'case-close') {
    const c = await db.collection('market_cases').doc(id).get();
    if (!c.exists) return `NOT FOUND (${safeText(id, 60)})`;
    return c.get('status') === 'closed' ? 'NOTHING TO DO (already closed)' : `WOULD CLOSE case ${safeText(id, 60)} (${safeText(c.get('category'), 20)})`;
  }
  const l = await db.collection('textbook_listings').doc(id).get();
  if (!l.exists) {
    const q = await db.collection('market_queue').doc(id).get();
    if (cmd === 'listing-remove' && q.exists && q.get('status') === 'removed') return `NOTHING TO DO (${safeText(id, 60)} is already removed)`;
    return `NOT FOUND (${safeText(id, 60)})`;
  }
  const label = `${safeText(id, 60)} "${safeText(l.get('title'))}" by ${safeText(l.get('ownerId'), 40)} (${safeText(l.get('status'), 10)})`;
  switch (cmd) {
    case 'listing-hide': return l.get('status') === 'hidden' ? `NOTHING TO DO (${safeText(id, 60)} is already hidden)` : `WOULD HIDE listing ${label} (owner notified)`;
    case 'listing-restore': return l.get('status') === 'hidden'
      ? `WOULD RESTORE listing ${label} (owner notified, its reporters discredited)`
      : `WOULD ACKNOWLEDGE listing ${label} (stays as is, auto-hide off)`;
    default: return `WOULD DELETE listing ${label} (photos removed by the trigger)`;
  }
}

async function describe(db, cmd, id) {
  if (MARKET_TARGETED.has(cmd)) return describeMarket(db, cmd, id);
  if (cmd === 'close') {
    const r = await db.collection('takedown_requests').doc(id).get();
    if (!r.exists) return `NOT FOUND (${safeText(id, 60)})`;
    return r.get('status') === 'closed' ? 'NOTHING TO DO (already closed)' : `WOULD CLOSE takedown request ${safeText(id, 60)}`;
  }
  const [p, h, q] = await Promise.all(['posts', 'hidden_posts', 'moderation_queue'].map((c) => db.collection(c).doc(id).get()));
  if (!p.exists && !h.exists) {
    if (q.exists && cmd !== 'hide') return `WOULD RETIRE the leftover queue entry of ${safeText(id, 60)} (the post is already gone)`;
    return `NOT FOUND (${safeText(id, 60)})`;
  }
  if (p.exists && h.exists && cmd !== 'delete') return `WOULD FAIL: ${safeText(id, 60)} exists in BOTH posts and hidden_posts (resolve by hand; nothing is overwritten)`;
  const doc = p.exists ? p : h;
  const label = `${safeText(id, 60)} "${safeText(doc.get('title') ?? q.get('postTitle'))}" by ${safeText(doc.get('authorId'), 40)}`;
  switch (cmd) {
    case 'hide': return p.exists ? `WOULD HIDE ${label} (author notified)` : `NOTHING TO DO (${safeText(id, 60)} is already hidden)`;
    case 'restore': return h.exists
      ? `WOULD RESTORE ${label} (hidden -> visible, author notified, its hiders discredited)`
      : `WOULD ACKNOWLEDGE ${label} (stays visible, auto-hide off)`;
    default: return `WOULD DELETE ${label} (${p.exists ? 'visible' : 'hidden'}; files removed by the trigger; credits kept)`;
  }
}

async function main() {
  const { opts, error } = parseArgs(process.argv.slice(2));
  if (error) {
    console.error(`${error}\n${USAGE}`);
    process.exit(2);
  }
  const fnRequire = createRequire(new URL('../functions/package.json', import.meta.url));
  let mod;
  let market;
  try {
    mod = fnRequire('./lib/moderation.js');
    market = fnRequire('./lib/marketModeration.js');
  } catch {
    console.error('functions/lib/moderation.js / marketModeration.js not found: run `npm --prefix functions run build` first');
    process.exit(2);
  }
  const { initializeApp, applicationDefault } = fnRequire('firebase-admin/app');
  const { getFirestore, FieldValue } = fnRequire('firebase-admin/firestore');

  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  console.log(`project: ${safeText(opts.project, 80)}  target: ${emulator ? 'EMULATOR' : 'LIVE'}  mode: ${opts.apply ? `APPLY as ${safeText(opts.operator, 50)}` : 'DRY RUN'}`);
  initializeApp({ projectId: opts.project, credential: applicationDefault() });
  const db = getFirestore();

  if (opts.command === 'list') {
    const { queue, requests } = await mod.listQueue(db, 200);
    console.log(`QUEUE (${queue.length})`);
    for (const q of queue) {
      console.log(`  ${q.priority === 'takedown' ? 'TAKEDOWN' : 'report  '} ${q.status.padEnd(8)} ${safeText(q.postId, 60)}`
        + ` reports=${q.reportCount} counted=${q.countedReports} hiddenBy=${q.hiddenBy ?? '-'}`
        + ` review=${q.needsReview ? 'yes' : 'no'} "${safeText(q.postTitle)}"`);
    }
    console.log(`OPEN TAKEDOWN REQUESTS (${requests.length})`);
    for (const r of requests) {
      const ids = (Array.isArray(r.postIds) ? r.postIds : []).map((x) => safeText(x, 60)).join(', ');
      console.log(`  ${safeText(r.id, 40)} ${r.verified ? 'verified' : 'UNVERIFIED'} ${safeText(r.role, 20)}`
        + ` ${safeText(r.requesterName, 40)} <${safeText(r.contactEmail, 80)}> posts=[${ids}]`);
      console.log(`    ${safeText(r.description, 300)}`);
    }
    return;
  }

  if (opts.command === 'market-list') {
    const { listings, cases } = await market.listMarketQueue(db, 200);
    console.log(`LISTINGS (${listings.length})`);
    for (const q of listings) {
      console.log(`  ${safeText(q.status, 8).padEnd(8)} ${safeText(q.listingId, 60)} reports=${q.reportCount} counted=${q.countedReports}`
        + ` hiddenBy=${safeText(q.hiddenBy ?? '-', 10)} review=${q.needsReview ? 'yes' : 'no'} owner=${safeText(q.ownerId, 40)} "${safeText(q.title)}"`);
    }
    console.log(`OPEN CASES (${cases.length})`);
    for (const c of cases) {
      console.log(`  ${c.priority === 'high' ? 'HIGH  ' : 'normal'} ${safeText(c.id, 80)} ${safeText(c.category, 20)}`
        + ` reporter=${safeText(c.reporterUid, 40)} reported=${safeText(c.reportedUid, 40)} room=${safeText(c.roomId, 80)}`);
      console.log(`    ${safeText(c.detail, 300)}`);
    }
    return;
  }

  if (opts.command === 'strip-legacy-reports') {
    const out = await stripLegacyReports(db, FieldValue, opts);
    console.log(`totals: candidates=${out.candidates} stripped=${out.stripped} failed=${out.failed}`);
    if (out.failed > 0) { console.error(`FAILED: ${out.failed} document(s) could not be stripped; re-run to retry`); process.exit(1); }
    console.log(opts.apply ? 'done' : 'done (dry run: nothing written)');
    return;
  }

  if (!opts.apply) {
    console.log(await describe(db, opts.command, opts.target));
    console.log('done (dry run: nothing written)');
    return;
  }
  const fn = {
    hide: mod.hidePost, restore: mod.restorePost, delete: mod.removePost, close: mod.closeTakedown,
    'listing-hide': market.hideListing, 'listing-restore': market.restoreListing,
    'listing-remove': market.removeListing, 'case-close': market.closeCase,
  }[opts.command];
  console.log(await describe(db, opts.command, opts.target));
  const out = await fn(db, opts.target, { operator: opts.operator, note: opts.note ?? '' });
  console.log(`${opts.command.toUpperCase()} ${safeText(opts.target, 60)}: ${JSON.stringify(out)}`);
  console.log('done');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`FAILED: ${safeText(e.code, 40)} ${safeText(e.message, 300)}`); process.exit(1); });
}
