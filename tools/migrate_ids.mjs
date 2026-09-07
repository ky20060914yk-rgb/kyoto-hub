// Rewrite legacy course ids to the hashed catalog ids (C2).
//
// Phase 1 replaced the hard-coded 10k-line `KulasisDataset` with a Firestore
// `courses` collection whose document ids are content hashes
// (`c_<sha1(courseKey|day|period)[:16]>`). Everything already stored in
// production still points at the OLD ids:
//
//   * `user_timetables/{uid}.timetable`  — every slot value
//   * `posts/{id}.subjectId`
//   * `requests/{id}.subjectId`
//   * `textbook_requests/{id}.subjectId`
//
// Left alone, every registered timetable cell and every uploaded past exam
// would point at a course that no longer exists.
//
// The old id -> new id table is rebuilt from the retired dataset itself, read
// straight out of git (`git show <REF>:lib/services/kulasis_dataset.dart`), so
// this script stays self-contained and re-runnable with nothing committed
// alongside it. The courseKey/hash pipeline below MUST stay byte-identical to
// `tools/build_courses.py`; every run re-derives the whole table and checks it
// against courses.json, refusing to continue if the match rate collapses.
// `--verify-only` performs just that check and touches no Firestore data.
//
// `ku_custom_*` ids were per-user hand-added courses that never existed in the
// dataset; they have no mapping and are left untouched (and counted).
//
// The script is idempotent: a value that already looks like a new id (`c_`)
// is skipped, so a re-run after a partial failure is safe.
//
// Auth: identical to seed_courses.mjs — Application Default Credentials, or
// GOOGLE_APPLICATION_CREDENTIALS, or FIRESTORE_EMULATOR_HOST for the emulator.
//
// Usage:
//   node migrate_ids.mjs --project kyodai-sns --dry-run   # report only
//   node migrate_ids.mjs --project kyodai-sns             # rewrite
//   node migrate_ids.mjs --project kyodai-sns --check-live # + verify the seed ran
//   FIRESTORE_EMULATOR_HOST=localhost:8080 node migrate_ids.mjs --project demo
//   node migrate_ids.mjs --verify-only                   # id table check only

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const projectId = flag('--project') || process.env.GCLOUD_PROJECT;
const dryRun = args.includes('--dry-run');
// The commit that still carried the retired dataset.
const datasetRef = flag('--dataset-ref', '7941776');
// Rebuild + check the id table and stop, without touching Firestore at all.
const verifyOnly = args.includes('--verify-only');
// Sample target newIds against the live `courses` collection before writing —
// catches "migration ran before the seed". Ignored under --verify-only.
const checkLive = args.includes('--check-live');
if (!projectId && !verifyOnly) { console.error('missing --project'); process.exit(1); }

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// --- the tools/build_courses.py pipeline, reproduced exactly ----------------

// Mirrors build_courses.FABRICATED_LECTURERS.
const FABRICATED_LECTURERS = new Set([
  '橘 邦英 教授', '佐藤 彰彦 教授', '中村 健太郎 教授', '高橋 正樹 教授', '山本 哲也 教授', '小林 義明 教授',
  '安藤 智子 教授', '木村 慎一 教授', '井上 剛 教授', '佐々木 健 教授', '渡辺 浩 教授',
  '山極 壽一 教授', '加藤 裕樹 教授', '吉田 拓也 教授', '松本 隆 教授', '藤田 茂 教授',
  '長谷川 勝 教授', '清水 博 教授', '岡田 秀樹 教授', '三浦 健 教授', '坂本 龍 教授',
  '西田 幾多郎 教授', '河野 哲也 教授', '中川 聡 教授', '杉山 英樹 教授', '原田 實 教授',
  '川崎 勉 教授', '平野 薫 教授', '大野 誠 教授', '竹内 敬 教授', '石川 陽一 教授',
  '本庶 佑 特命教授', '山中 伸弥 教授', '福井 次郎 教授', '前田 裕 教授', '橋本 卓 教授',
  '桑野 隆 教授', '市川 寛 教授', '田村 研一 教授', '野口 豊 教授',
  '生田 久美子 教授', '大浦 容子 教授', '楠見 孝 教授',
  '京大教養部 教授', '国際高等教育院 講師', '全学共通科目 担当教員',
]);
const UNKNOWN_LECTURER = '担当教員不明';
const VALID_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

// build_courses.normalize_text
const normalizeText = (s) => (s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
// build_courses._key_norm
const keyNorm = (s) => (s || '').normalize('NFKC').replace(/\s+/g, '').trim().toLowerCase();
// build_courses.course_key
const courseKey = (name, lecturer) => `${keyNorm(name)}|${keyNorm(lecturer)}`;
// build_courses.doc_id
const docId = (ck, day, period) =>
  'c_' + createHash('sha1').update(`${ck}|${day}|${period}`, 'utf8').digest('hex').slice(0, 16);
// build_courses._clean_lecturer
const cleanLecturer = (raw) => {
  const v = normalizeText(raw);
  if (!v || v === '担当教員未定' || v === '未定' || FABRICATED_LECTURERS.has(v)) return UNKNOWN_LECTURER;
  return v;
};
// build_courses._clean_period
const cleanPeriod = (raw) => {
  const m = String(raw ?? '').match(/\d+/);
  if (!m) return 1;
  const p = parseInt(m[0], 10);
  return p >= 1 && p <= 5 ? p : 1;
};

// --- recover the retired dataset from git ------------------------------------

// A Dart single-quoted literal, escapes included.
const S = "'((?:[^'\\\\]|\\\\.)*)'";
const SUBJECT_RE = new RegExp(
  `Subject\\(\\s*id:\\s*${S},\\s*name:\\s*${S},\\s*faculty:\\s*${S},` +
  `\\s*dayOfWeek:\\s*${S},\\s*period:\\s*(\\d+),\\s*lecturer:\\s*${S}`,
  'g',
);
const unescapeDart = (s) => s.replace(/\\(.)/g, '$1');

function loadLegacyDataset() {
  const path = 'lib/services/kulasis_dataset.dart';
  let src;
  try {
    src = execFileSync('git', ['show', `${datasetRef}:${path}`], {
      cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    console.error(`could not read ${datasetRef}:${path} out of git — run this inside the repo`);
    throw e;
  }
  const out = [];
  for (const m of src.matchAll(SUBJECT_RE)) {
    out.push({
      id: unescapeDart(m[1]),
      name: unescapeDart(m[2]),
      faculty: unescapeDart(m[3]),
      dayOfWeek: unescapeDart(m[4]),
      period: parseInt(m[5], 10),
      lecturer: unescapeDart(m[6]),
    });
  }
  return out;
}

/// oldId -> newId, for every legacy course that survives build_courses.py's
/// filters (weekend slots are dropped there, so they have no new id).
function buildIdMap(legacy) {
  const map = new Map();
  let skippedDay = 0;
  for (const s of legacy) {
    if (!VALID_DAYS.has(s.dayOfWeek)) { skippedDay += 1; continue; }
    const name = normalizeText(s.name);
    if (!name) continue;
    const period = cleanPeriod(s.period);
    const ck = courseKey(name, cleanLecturer(s.lecturer));
    map.set(s.id, docId(ck, s.dayOfWeek, period));
  }
  return { map, skippedDay };
}

// --- main --------------------------------------------------------------------

const legacy = loadLegacyDataset();
if (legacy.length < 9000) {
  console.error(`only parsed ${legacy.length} legacy subjects — the dataset format changed, refusing to run`);
  process.exit(1);
}
const { map: idMap, skippedDay } = buildIdMap(legacy);
console.log(`legacy dataset: ${legacy.length} subjects, ${idMap.size} mapped, ${skippedDay} weekend rows without a new id`);

// Verify the reproduction against the generated catalog: every new id we
// produce must actually exist in courses.json. This is the guard that the
// courseKey/hash pipeline above still matches build_courses.py.
const catalog = JSON.parse(await readFile(new URL('./courses.json', import.meta.url), 'utf-8'));
const catalogIds = new Set(catalog.map((c) => c.id));
let hit = 0;
const unresolved = [];
for (const [oldId, newId] of idMap) {
  if (catalogIds.has(newId)) hit += 1;
  else unresolved.push([oldId, newId]);
}
const rate = hit / idMap.size;
console.log(`id reproduction check: ${hit}/${idMap.size} (${(rate * 100).toFixed(2)}%) resolve to a course in courses.json`);
// This is a one-off production run: anything below 100% means at least one
// legacy id would be rewritten to a course that does not exist in the catalog,
// which is strictly worse than leaving it alone. Abort and name the offenders.
if (rate < 1.0) {
  console.error(`the courseKey/hash reproduction does not match build_courses.py — ${unresolved.length} legacy id(s) map to a non-existent course, refusing to run:`);
  for (const [oldId, newId] of unresolved.slice(0, 50)) {
    console.error(`  ${oldId} -> ${newId} (not in courses.json)`);
  }
  if (unresolved.length > 50) console.error(`  ... and ${unresolved.length - 50} more`);
  process.exit(1);
}

if (verifyOnly) { console.log('verify-only: OK'); process.exit(0); }

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
initializeApp({
  projectId,
  credential: keyPath ? cert(JSON.parse(await readFile(keyPath, 'utf-8'))) : applicationDefault(),
});
const db = getFirestore();

// --check-live: before touching anything, confirm the target project actually
// holds the catalog this migration is mapping into. Without this, a migration
// run before `seed_courses.mjs` would happily rewrite every timetable cell to a
// `courses/{newId}` doc that does not exist yet.
if (checkLive) {
  const sample = [...idMap.values()].filter((v, i, a) => a.indexOf(v) === i).slice(0, 20);
  const missingLive = [];
  for (const newId of sample) {
    const d = await db.collection('courses').doc(newId).get();
    if (!d.exists) missingLive.push(newId);
  }
  console.log(`--check-live: sampled ${sample.length} target ids, ${missingLive.length} missing from courses/ in ${projectId}`);
  if (missingLive.length > 0) {
    console.error('target catalog is missing sampled course docs — run seed_courses.mjs first, refusing to run:');
    for (const id of missingLive) console.error(`  courses/${id}`);
    process.exit(1);
  }
}

const stats = {
  timetableDocs: 0, timetableCells: 0,
  posts: 0, requests: 0, textbookRequests: 0,
  custom: 0, unmapped: 0, alreadyNew: 0,
};

/// Translates one stored course id. Returns null when nothing should change.
function translate(value) {
  if (typeof value !== 'string' || value === '') return null;
  if (value.startsWith('c_')) { stats.alreadyNew += 1; return null; }   // idempotent
  if (value.startsWith('ku_custom_')) { stats.custom += 1; return null; }
  const next = idMap.get(value);
  if (!next) { stats.unmapped += 1; return null; }
  return next;
}

/// Applies `writes` ([ref, data]) in batches, or counts them under --dry-run.
async function commit(writes) {
  if (dryRun) return;
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const [ref, data] of writes.slice(i, i + 400)) batch.set(ref, data, { merge: true });
    await batch.commit();
  }
}

// 1. user_timetables: rewrite the values of the `timetable` map.
{
  const snap = await db.collection('user_timetables').get();
  const writes = [];
  for (const d of snap.docs) {
    const tt = d.data().timetable;
    if (!tt || typeof tt !== 'object') continue;
    const next = {};
    let changed = 0;
    for (const [slot, value] of Object.entries(tt)) {
      const t = translate(value);
      next[slot] = t ?? value;
      if (t) changed += 1;
    }
    if (changed > 0) {
      writes.push([d.ref, { timetable: next }]);
      stats.timetableDocs += 1;
      stats.timetableCells += changed;
    }
  }
  await commit(writes);
}

// 2. posts / requests / textbook_requests: rewrite `subjectId`.
for (const [collection, statKey] of [
  ['posts', 'posts'], ['requests', 'requests'], ['textbook_requests', 'textbookRequests'],
]) {
  const snap = await db.collection(collection).get();
  const writes = [];
  for (const d of snap.docs) {
    const next = translate(d.data().subjectId);
    if (!next) continue;
    writes.push([d.ref, { subjectId: next }]);
    stats[statKey] += 1;
  }
  await commit(writes);
}

console.log(dryRun ? '--- DRY RUN, nothing written ---' : '--- migration applied ---');
console.log(`  user_timetables : ${stats.timetableDocs} docs, ${stats.timetableCells} cells rewritten`);
console.log(`  posts           : ${stats.posts}`);
console.log(`  requests        : ${stats.requests}`);
console.log(`  textbook_requests: ${stats.textbookRequests}`);
console.log(`  already migrated : ${stats.alreadyNew}`);
console.log(`  ku_custom_* left alone: ${stats.custom}`);
console.log(`  legacy ids with no mapping: ${stats.unmapped}`);
console.log('done');
