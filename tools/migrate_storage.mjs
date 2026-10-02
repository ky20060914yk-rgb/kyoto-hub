// Move legacy PUBLIC post files to the private per-user layout (Plan 2A, Task 10).
//
// Legacy posts hold `fileNames: ['<ts>_<name>']` + public `fileUrls`, with the
// object at the BUCKET ROOT. The private bucket (storage.rules) only knows
// `resources/<uid>/<one flat segment>`, and downloads go through the
// `downloadResource` Function, which reads `posts.filePaths`. This script copies
// each object to `resources/<authorId>/<flat-name>` and rewrites the post.
//
// SAFE BY DESIGN
//   * Dry-run is the DEFAULT. Nothing is written unless you pass --apply.
//   * --project is mandatory (no fallback to an ambient project).
//   * Idempotent: posts that already have `filePaths` are skipped; an existing
//     destination object is never overwritten (it must match the source's
//     size + md5, otherwise the post is reported FAIL and left untouched).
//   * A post is only rewritten after EVERY copy of it is verified (dest exists,
//     same size and md5). A post with any missing/unsafe source is left alone.
//   * Old public objects are NEVER deleted unless you pass --delete-old (with
//     --apply), and only after the copy is verified and the post rewritten. Run
//     that as a second pass once the app works; it also cleans up posts that an
//     earlier run already migrated.
//   * Posts without an authorId are left alone with a warning.
//
// Auth: Application Default Credentials. Set GOOGLE_APPLICATION_CREDENTIALS to
// your service-account key file in YOUR shell; this script never reads a key
// path itself. FIRESTORE_EMULATOR_HOST / STORAGE_EMULATOR_HOST target emulators.
//
// Usage:
//   node migrate_storage.mjs --project kyodai-sns               # dry-run (report only)
//   node migrate_storage.mjs --project kyodai-sns --apply       # copy + rewrite posts
//   node migrate_storage.mjs --project kyodai-sns --apply --delete-old   # second pass
//   [--bucket <name>]  default: <project>.firebasestorage.app

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Same sanitisation as the client upload (AppStore.uploadFileToStorage): every
// char outside [\w.-] / kana / CJK becomes '_', keep the last 100 chars.
export function sanitizeName(name) {
  let safe = name.replace(/[^\w.\-぀-ヿ一-鿿]/g, '_');
  if (safe.length > 100) safe = safe.substring(safe.length - 100);
  return safe;
}

// Flat, unique destination file name. Names that sanitisation changes get a
// short hash of the ORIGINAL name so two different legacy names can never
// collapse onto one destination (which "skip if exists" would mistake for done).
export function destName(name) {
  const safe = sanitizeName(name);
  if (safe === name) return safe;
  return `${createHash('sha1').update(name).digest('hex').slice(0, 8)}_${safe}`;
}

function unsafeName(n) {
  return typeof n !== 'string' || n === '' || n.includes('/') || n.includes('..');
}

// planMigration is pure so it can be unit-tested without Firebase.
export function planMigration(post, bucketHas) {
  const names = Array.isArray(post.fileNames) ? post.fileNames : [];
  if (Array.isArray(post.filePaths) && post.filePaths.length > 0) {
    return { ok: true, moves: [], filePaths: post.filePaths, skip: true };
  }
  if (!post.authorId || typeof post.authorId !== 'string' || post.authorId.includes('/')) {
    return { ok: false, reason: `${post.id}: no authorId` };
  }
  if (names.length === 0) return { ok: false, reason: `${post.id}: no fileNames` };
  const moves = [];
  for (const n of names) {
    if (unsafeName(n)) return { ok: false, reason: `${post.id}: unsafe file name ${JSON.stringify(n)}` };
    if (!bucketHas(n)) return { ok: false, reason: `${post.id}: source object missing: ${n}` };
    const to = `resources/${post.authorId}/${destName(n)}`;
    if (!moves.some((m) => m.from === n)) moves.push({ from: n, to });
  }
  return { ok: true, moves, filePaths: names.map((n) => `resources/${post.authorId}/${destName(n)}`) };
}

// For the --delete-old second pass: root objects that an already-migrated post
// still has behind it (fileNames[i] -> filePaths[i] must be the planned dest).
export function cleanupCandidates(post, bucketHas) {
  const names = Array.isArray(post.fileNames) ? post.fileNames : [];
  const paths = Array.isArray(post.filePaths) ? post.filePaths : [];
  if (!post.authorId || paths.length === 0 || names.length !== paths.length) return [];
  const out = [];
  names.forEach((n, i) => {
    if (unsafeName(n) || !bucketHas(n)) return;
    const to = `resources/${post.authorId}/${destName(n)}`;
    if (paths[i] === to) out.push({ from: n, to });
  });
  return out;
}

const USAGE = `usage: node migrate_storage.mjs --project <id> [--apply] [--delete-old] [--bucket <name>]
  default is a DRY RUN (nothing is written). --apply performs the copy + post rewrite.
  --delete-old (needs --apply) also deletes the old public root objects after verification.
  auth: GOOGLE_APPLICATION_CREDENTIALS (Application Default Credentials).`;

export function parseArgs(argv) {
  const opts = { apply: false, deleteOld: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') opts.project = argv[++i];
    else if (a === '--bucket') opts.bucket = argv[++i];
    else if (a === '--apply') opts.apply = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--delete-old') opts.deleteOld = true;
    else return { error: `unknown argument: ${a}` };
  }
  if (!opts.project || opts.project.startsWith('--')) return { error: 'missing --project' };
  if (opts.apply && opts.dryRun) return { error: '--apply and --dry-run are mutually exclusive' };
  if (opts.deleteOld && !opts.apply) return { error: '--delete-old requires --apply' };
  opts.bucket = opts.bucket || `${opts.project}.firebasestorage.app`;
  return { opts };
}

async function main() {
  const { opts, error } = parseArgs(process.argv.slice(2));
  if (error) {
    console.error(`${error}\n${USAGE}`);
    process.exit(2);
  }
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  const { getStorage } = await import('firebase-admin/storage');

  const emulator = !!(process.env.FIRESTORE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST);
  console.log(`project: ${opts.project}  bucket: ${opts.bucket}  target: ${emulator ? 'EMULATOR' : 'LIVE'}`);
  console.log(`mode: ${opts.apply ? 'APPLY' : 'DRY RUN (no changes; pass --apply to write)'}${opts.deleteOld ? ' + DELETE-OLD' : ''}`);

  initializeApp({ projectId: opts.project, storageBucket: opts.bucket, credential: applicationDefault() });
  const db = getFirestore();
  const bucket = getStorage().bucket();

  // Root objects only (delimiter '/'), listed once.
  const [rootFiles] = await bucket.getFiles({ delimiter: '/', autoPaginate: true });
  const root = new Set(rootFiles.map((f) => f.name).filter((n) => !n.endsWith('/')));
  const bucketHas = (n) => root.has(n);

  const sameObject = async (a, b) => {
    const [[ma], [mb]] = await Promise.all([a.getMetadata(), b.getMetadata()]);
    return String(ma.size) === String(mb.size) && ma.md5Hash === mb.md5Hash;
  };

  const snap = await db.collection('posts').get();
  const tot = { migrated: 0, skipped: 0, failed: 0, deleted: 0, copied: 0, existed: 0 };
  const deletable = new Set();   // root names safe to delete (verified + post rewritten)
  const protectedNames = new Set(); // root names still needed by a post we could not migrate

  for (const doc of snap.docs) {
    const post = { id: doc.id, ...doc.data() };
    const plan = planMigration(post, bucketHas);
    if (!plan.ok) {
      tot.failed++;
      for (const n of Array.isArray(post.fileNames) ? post.fileNames : []) protectedNames.add(n);
      console.log(`FAIL ${plan.reason}`);
      if (!post.authorId) console.warn(`WARN ${post.id}: authorId missing, post left untouched`);
      continue;
    }
    if (plan.skip) {
      tot.skipped++;
      console.log(`SKIP (already migrated) ${post.id}`);
      if (opts.deleteOld) {
        for (const m of cleanupCandidates(post, bucketHas)) {
          const dst = bucket.file(m.to);
          const [exists] = await dst.exists();
          if (exists && (await sameObject(bucket.file(m.from), dst))) deletable.add(m.from);
          else console.log(`  keep ${m.from}: destination ${m.to} missing or differs`);
        }
      }
      continue;
    }
    console.log(`MIGRATE ${post.id} (${plan.moves.length} file(s))`);
    for (const m of plan.moves) console.log(`  ${m.from} -> ${m.to}`);
    if (!opts.apply) { tot.migrated++; continue; }

    let ok = true;
    for (const m of plan.moves) {
      try {
        const src = bucket.file(m.from);
        const dst = bucket.file(m.to);
        const [exists] = await dst.exists();
        if (exists) tot.existed++;
        else { await src.copy(dst); tot.copied++; }
        if (!(await sameObject(src, dst))) throw new Error(`verification failed (size/md5) for ${m.to}`);
      } catch (e) {
        ok = false;
        console.log(`FAIL ${post.id}: ${e.message}`);
        break;
      }
    }
    if (!ok) {
      tot.failed++;
      for (const m of plan.moves) protectedNames.add(m.from);
      continue;
    }
    await doc.ref.update({ filePaths: plan.filePaths, fileUrls: FieldValue.delete() });
    tot.migrated++;
    for (const m of plan.moves) deletable.add(m.from);
  }

  if (opts.apply && opts.deleteOld) {
    for (const n of deletable) {
      if (protectedNames.has(n)) { console.log(`keep ${n}: still referenced by an unmigrated post`); continue; }
      await bucket.file(n).delete();
      tot.deleted++;
      console.log(`DELETED ${n}`);
    }
  } else if (opts.deleteOld === false && opts.apply) {
    console.log('old public objects kept (re-run with --apply --delete-old once the app works)');
  }

  console.log(`totals: migrate=${tot.migrated} skip=${tot.skipped} fail=${tot.failed} copied=${tot.copied} dest-existed=${tot.existed} deleted=${tot.deleted}`);
  console.log(opts.apply ? 'done' : 'done (dry run: nothing written)');
  if (tot.failed > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
