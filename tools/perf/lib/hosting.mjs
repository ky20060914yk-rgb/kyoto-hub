// Ask the REAL Firebase Hosting emulator (firebase-tools / superstatic) how it
// would serve a build: Cache-Control, Content-Type and which file answers each
// path (a static file, or index.html through the `**` rewrite). The emulator is
// started with `emulators:exec` under a throwaway demo-* project and a temporary
// firebase.json whose `public` points at the build: nothing is deployed and no
// credentials are read. Used by measure_web.mjs and check_web_cache.mjs (Plan 4).
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../../..');

/** Paths that are not files but whose answer matters (rewrite, directories, crawlers). */
export const PROBE_EXTRA = ['/', '/about', '/about/', '/robots.txt', '/sitemap.xml', '/no/such/deep/path', '/index.html?x=1'];

export const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

/** Every file under `dir` as a URL path ('/main.dart.js'); dotfiles skipped like Hosting's `**\/.*` ignore. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith('.')) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push('/' + relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Returns Map<path, {status, location, cacheControl, contentType, file}> where
 * `file` is the build file whose bytes were served ('/index.html' for a rewrite).
 */
export function probeHosting({ buildDir, firebaseJson = join(REPO, 'firebase.json'), port = 5055 }) {
  const abs = resolve(buildDir);
  const hosting = JSON.parse(readFileSync(firebaseJson, 'utf8')).hosting;
  if (!hosting) throw new Error(`${firebaseJson} has no hosting section`);
  // Next to the build (same drive on Windows, so `public` can be relative); dot-named, removed below.
  const tmp = mkdtempSync(join(dirname(abs), '.hosting-probe-'));
  try {
    const cfg = {
      hosting: { ...hosting, public: relative(tmp, abs).split(sep).join('/') },
      emulators: { hosting: { port }, ui: { enabled: false } },
    };
    writeFileSync(join(tmp, 'firebase.json'), JSON.stringify(cfg, null, 2));
    writeFileSync(join(tmp, 'paths.json'), JSON.stringify([...listFiles(abs), ...PROBE_EXTRA]));
    copyFileSync(join(HERE, 'probe.mjs'), join(tmp, 'probe.mjs'));
    const win = process.platform === 'win32';
    const r = spawnSync('firebase', ['emulators:exec', '--only', 'hosting', '--project', 'demo-perf', win ? '"node probe.mjs"' : 'node probe.mjs'], {
      cwd: tmp, encoding: 'utf8', shell: win, maxBuffer: 64 << 20, env: { ...process.env, PROBE_ORIGIN: `http://127.0.0.1:${port}` },
    });
    if (r.status !== 0) throw new Error(`hosting emulator probe failed (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);
    const raw = JSON.parse(readFileSync(join(tmp, 'table.json'), 'utf8'));
    const bySha = new Map(listFiles(abs).map((f) => [sha1(readFileSync(join(abs, f))), f]));
    const table = new Map();
    for (const [p, e] of Object.entries(raw)) table.set(p, { ...e, file: bySha.get(e.sha1) ?? null });
    return table;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
