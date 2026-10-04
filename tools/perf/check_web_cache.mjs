#!/usr/bin/env node
// Fails (exit 1) if a deploy of this build with this firebase.json would let a
// returning visitor run STALE code (Plan 4, Ruling C-1). Two modes:
//
//   node check_web_cache.mjs [--dir ../../build/web] [--firebase-json ../../firebase.json]
//     Asks the Firebase Hosting emulator (firebase-tools, demo project, no
//     credentials) how every file and the key routes are served, then checks:
//     no response is `immutable` or cacheable for more than a day; everything
//     but *.png revalidates (`no-cache`); /, deep links, /about/, /robots.txt and
//     /sitemap.xml are answered by the right file; the built flutter_bootstrap.js
//     carries a per-build id and loads main.dart.js?v=<id> (C-2).
//
//   node check_web_cache.mjs --returning-user --v1 <build A> --v2 <build B>
//        [--v1-firebase-json <firebase.json A>] [--sandbox-sdk]
//     A real returning visitor in Chromium: load A (served with A's headers),
//     "deploy" B (B's headers = this repo's firebase.json) on the same origin,
//     open the app again. Fails if any file that changed between A and B was
//     taken from the browser cache instead of being fetched again.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { REPO, listFiles, probeHosting, sha1 } from './lib/hosting.mjs';
import { startServer } from './lib/server.mjs';
import { launch, newContext } from './lib/browser.mjs';

const { values: a } = parseArgs({
  options: {
    dir: { type: 'string', default: join(REPO, 'build', 'web') },
    'returning-user': { type: 'boolean', default: false },
    v1: { type: 'string' },
    v2: { type: 'string' },
    'sandbox-sdk': { type: 'boolean', default: false },
    'firebase-json': { type: 'string', default: join(REPO, 'firebase.json') },
    'v1-firebase-json': { type: 'string' },
  },
});

const MAX_IMAGE_AGE = 86400;
const maxAge = (cc) => { const m = /max-age=(\d+)/.exec(cc ?? ''); return m ? Number(m[1]) : null; };

/** Problems with how `table` (from probeHosting) serves a build; [] = OK. */
export function headerProblems(table) {
  const problems = [];
  for (const [path, e] of table) {
    const cc = e.cacheControl ?? '';
    if (e.status >= 300 && e.status < 400) continue; // a redirect carries no body to cache
    if (/immutable/.test(cc)) { problems.push(`${path}: immutable (${cc})`); continue; }
    if (!cc) { problems.push(`${path}: no Cache-Control (browsers then guess a lifetime)`); continue; }
    const age = maxAge(cc);
    if ((e.file ?? path).endsWith('.png')) {
      if (age === null || age > MAX_IMAGE_AGE) problems.push(`${path}: image cached for more than a day (${cc})`);
    } else if (!/no-cache/.test(cc) && age !== 0) {
      problems.push(`${path}: not revalidated (${cc}) — after a deploy a returning browser may keep the old file`);
    }
  }
  const expect = (path, file) => {
    const e = table.get(path);
    if (!e || e.status !== 200 || e.file !== file) problems.push(`${path}: expected ${file}, got ${e ? `${e.status} ${e.file}` : 'nothing'}`);
  };
  expect('/', '/index.html');
  expect('/no/such/deep/path', '/index.html');
  expect('/about/', '/about/index.html');
  expect('/robots.txt', '/robots.txt');
  expect('/sitemap.xml', '/sitemap.xml');
  const bare = table.get('/about');
  if (!(bare && ((bare.status === 200 && bare.file === '/about/index.html') || (bare.status === 301 && /\/about\/$/.test(bare.location ?? ''))))) {
    problems.push(`/about: expected the landing page or a redirect to /about/, got ${bare ? `${bare.status} ${bare.file ?? bare.location}` : 'nothing'}`);
  }
  return problems;
}

/** Problems with the BUILT flutter_bootstrap.js (C-2); [] = OK. */
export function bootstrapProblems(src) {
  const problems = [];
  if (src.includes('{{')) problems.push('flutter_bootstrap.js: a template token was not substituted (Flutter changed its tokens?)');
  if (!/var kyotoHubBuild = "\d+"/.test(src)) problems.push('flutter_bootstrap.js: no numeric per-build id (built with --pwa-strategy=none?)');
  if (!src.includes("b.mainJsPath += '?v='")) problems.push('flutter_bootstrap.js: main.dart.js is not loaded with ?v=<build id>');
  return problems;
}

async function returningUser(v1, v2, sdkDir, fj1, fj2) {
  const t1 = probeHosting({ buildDir: v1, firebaseJson: fj1 });
  const t2 = probeHosting({ buildDir: v2, firebaseJson: fj2 });
  const log = [];
  const srv = await startServer({ dir: v1, table: t1, sdkDir, onRequest: (p, s) => log.push([p, s]) });
  const browser = await launch();
  try {
    const ctx = await newContext(browser, 'desktop');
    const page = await ctx.newPage();
    const visit = async () => {
      log.length = 0;
      await page.goto(srv.origin + '/', { waitUntil: 'commit' });
      await page.waitForFunction(() => window.__perf && window.__perf.firstFrame !== null, null, { timeout: 120000 });
      await page.waitForTimeout(3000);
      const requested = new Map();
      for (const [p, s] of log) requested.set(p, [...(requested.get(p) ?? []), s]);
      return { requested, title: await page.title() };
    };
    const first = await visit();
    srv.swap({ dir: v2, table: t2 }); // the "deploy"
    const second = await visit();
    const hash = (dir, f) => { try { return sha1(readFileSync(join(dir, f))); } catch { return null; } };
    const changed = listFiles(v1).filter((f) => first.requested.has(f) && hash(v1, f) !== hash(v2, f));
    // A 304 is only ever sent for the CURRENT file's ETag, so 200 or 304 both mean "has v2".
    const stale = changed.filter((f) => !(second.requested.get(f) ?? []).some((st) => st === 200 || st === 304));
    console.log(`v1 title: ${first.title}\nv2 title: ${second.title}`);
    console.log(`files used by v1 that changed in v2: ${changed.join(', ') || 'none'}`);
    for (const f of changed) console.log(`  ${f}: second visit ${second.requested.has(f) ? `fetched (${second.requested.get(f).join(', ')})` : 'NOT requested (taken from cache)'}`);
    return stale;
  } finally {
    await browser.close();
    await srv.close();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (a['returning-user']) {
    if (!a.v1 || !a.v2) { console.error('--returning-user needs --v1 <dir> --v2 <dir>'); process.exit(2); }
    const sdkDir = a['sandbox-sdk'] ? join(REPO, 'tools', 'perf', 'node_modules', 'firebase') : null;
    const fj2 = resolve(a['firebase-json']);
    const stale = await returningUser(resolve(a.v1), resolve(a.v2), sdkDir, a['v1-firebase-json'] ? resolve(a['v1-firebase-json']) : fj2, fj2);
    if (stale.length) { console.log(`STALE: a returning visitor kept ${stale.join(', ')} from v1`); process.exit(1); }
    console.log('OK: every changed file was fetched again after the deploy');
  } else {
    const dir = resolve(a.dir);
    const problems = [
      ...headerProblems(probeHosting({ buildDir: dir, firebaseJson: resolve(a['firebase-json']) })),
      ...bootstrapProblems(readFileSync(join(dir, 'flutter_bootstrap.js'), 'utf8')),
    ];
    for (const p of problems) console.log(`FAIL ${p}`);
    if (problems.length) { console.log(`${problems.length} problem(s): a deploy of this build could serve stale code`); process.exit(1); }
    console.log('OK: every response revalidates (images: at most a day), routes answer the right files');
  }
}
