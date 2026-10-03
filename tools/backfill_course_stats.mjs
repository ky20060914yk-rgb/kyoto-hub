// Authoritative recount of EVERY `course_stats` doc (Plan 2B, Task 11).
//
// From Plan 2B on, `course_stats` is written ONLY by the onReviewWritten /
// onPostWritten Cloud Functions (a full recount per course). This tool runs the
// SAME recount — functions/lib/courseStats.js, loaded together with the
// Functions' own firebase-admin (M-17) — over every course that has reviews,
// posts or an aggregate. Run it once after the 2B deploy to replace the
// client-written (forgeable) Phase-1/2A aggregates; re-run any time to repair
// drift. It replaces tools/backfill_post_counts.mjs.
//
// SAFE BY DESIGN (same conventions as migrate_storage.mjs)
//   * Dry run is the DEFAULT: it prints which fields of which course WOULD
//     change and writes nothing. --apply writes.
//   * --project is mandatory (no fallback to an ambient project).
//   * Idempotent: a recount, not a delta; a second --apply reports changed=0.
//   * --prune-orphans (needs --apply) also deletes aggregates whose doc id is
//     not the slug of their own courseKey: no Function can ever write those
//     (they were forged under the old client-writable rules).
//
// Auth: Application Default Credentials — GOOGLE_APPLICATION_CREDENTIALS set in
// YOUR shell, or `gcloud auth application-default login`. This script never
// reads a key path itself. FIRESTORE_EMULATOR_HOST targets the emulator.
//
// Usage (build the Functions first, from the repo root: npm --prefix functions run build):
//   node backfill_course_stats.mjs --project kyodai-sns                          # dry run
//   node backfill_course_stats.mjs --project kyodai-sns --apply                  # write
//   node backfill_course_stats.mjs --project kyodai-sns --apply --prune-orphans  # + delete orphans

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const USAGE = `usage: node backfill_course_stats.mjs --project <id> [--apply] [--prune-orphans]
  default is a DRY RUN (nothing is written). --apply writes the recounts.
  --prune-orphans (needs --apply) deletes aggregates no Function can own.
  first: npm --prefix functions run build   (this tool runs the compiled trigger code)`;

export function parseArgs(argv) {
  const opts = { apply: false, pruneOrphans: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') opts.project = argv[++i];
    else if (a === '--apply') opts.apply = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--prune-orphans') opts.pruneOrphans = true;
    else return { error: `unknown argument: ${a}` };
  }
  if (!opts.project || opts.project.startsWith('--')) return { error: 'missing --project' };
  if (opts.apply && opts.dryRun) return { error: '--apply and --dry-run are mutually exclusive' };
  if (opts.pruneOrphans && !opts.apply) return { error: '--prune-orphans requires --apply' };
  delete opts.dryRun;
  return { opts };
}

// Firestore does not preserve map key order, so compare canonically.
const canon = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  : JSON.stringify(v));
/** Control characters out, length bounded: ids and keys come from user-written data. */
const safeText = (v, max = 120) => {
  const t = String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');
  return t.length > max ? `${t.slice(0, max)}…` : t;
};
const IGNORED = new Set(['aggregatedAt']);

/** Sorted names of the fields whose stored value differs from the recount. */
export function diffStats(stored, next) {
  const keys = new Set([...Object.keys(stored ?? {}), ...Object.keys(next)]);
  return [...keys].filter((k) => !IGNORED.has(k) && canon(stored?.[k]) !== canon(next[k])).sort();
}

async function main() {
  const { opts, error } = parseArgs(process.argv.slice(2));
  if (error) {
    console.error(`${error}\n${USAGE}`);
    process.exit(2);
  }
  const fnRequire = createRequire(new URL('../functions/package.json', import.meta.url));
  let stats;
  try {
    stats = fnRequire('./lib/courseStats.js');
  } catch {
    console.error('functions/lib/courseStats.js not found: run `npm --prefix functions run build` first');
    process.exit(2);
  }
  const common = fnRequire('./lib/common.js');
  const { isDocId } = common;
  const { reviewSlug } = fnRequire('./lib/reviewCreated.js');
  const { initializeApp, applicationDefault } = fnRequire('firebase-admin/app');
  const { getFirestore } = fnRequire('firebase-admin/firestore');

  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  console.log(`project: ${safeText(opts.project, 80)}  target: ${emulator ? 'EMULATOR' : 'LIVE'}`);
  console.log(`mode: ${opts.apply ? 'APPLY' : 'DRY RUN (no changes; pass --apply to write)'}${opts.pruneOrphans ? ' + PRUNE-ORPHANS' : ''}`);
  initializeApp({ projectId: opts.project, credential: applicationDefault() });
  const db = getFirestore();

  // Course keys no Function can write (slug is not a valid doc id: too long, `__x__`, ...)
  // are SKIPPED and reported, never an abort: recomputeCourseStats throws on them.
  const usable = (k) => isDocId(reviewSlug(k));
  const keys = new Set();
  const skipped = new Set();
  const add = (k) => {
    if (typeof k !== 'string' || k === '') return;
    if (usable(k)) keys.add(k); else skipped.add(k);
  };
  for (const d of (await db.collection('reviews').select('courseKey').get()).docs) add(d.get('courseKey'));
  const orphans = [];
  for (const d of (await db.collection('course_stats').get()).docs) {
    const ck = d.get('courseKey');
    if (typeof ck === 'string' && ck !== '' && usable(ck) && stats.statsRef(db, ck).id === d.id) add(ck);
    else orphans.push(d.id);
  }
  const subjects = new Set();
  for (const d of (await db.collection('posts').select('subjectId').get()).docs) {
    const s = d.get('subjectId');
    if (isDocId(s)) subjects.add(s);
  }
  for (const s of subjects) add((await db.collection('courses').doc(s).get()).get('courseKey'));

  const tot = { courses: 0, changed: 0, unchanged: 0, orphans: orphans.length, pruned: 0, skipped: skipped.size, failed: 0 };
  for (const k of [...skipped].sort()) console.log(`SKIP unusable courseKey "${safeText(k)}" (its slug is not a valid document id)`);
  for (const ck of [...keys].sort()) {
    tot.courses++;
    try {
      const ref = stats.statsRef(db, ck);
      const diff = diffStats((await ref.get()).data(), await stats.computeCourseStats(db, ck));
      if (diff.length === 0) { tot.unchanged++; continue; }
      tot.changed++;
      console.log(`${opts.apply ? 'RECOUNT' : 'WOULD RECOUNT'} course_stats/${safeText(ref.id)}: ${diff.join(', ')}`);
      if (opts.apply) await stats.recomputeCourseStats(db, ck);
    } catch (e) {
      tot.failed++;
      console.log(`FAILED course "${safeText(ck)}": ${safeText(e.message, 200)}`);
    }
  }
  for (const id of orphans) {
    console.log(`${opts.pruneOrphans ? 'PRUNE' : 'ORPHAN (kept; --apply --prune-orphans deletes it)'} course_stats/${safeText(id)}`);
    if (opts.pruneOrphans) { await db.collection('course_stats').doc(id).delete(); tot.pruned++; }
  }
  console.log(`totals: courses=${tot.courses} changed=${tot.changed} unchanged=${tot.unchanged} orphans=${tot.orphans} pruned=${tot.pruned} skipped=${tot.skipped} failed=${tot.failed}`);
  if (tot.failed > 0) process.exitCode = 1;
  console.log(tot.failed > 0 ? 'done WITH FAILURES' : opts.apply ? 'done' : 'done (dry run: nothing written)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
