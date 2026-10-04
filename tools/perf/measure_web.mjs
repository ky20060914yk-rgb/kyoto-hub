#!/usr/bin/env node
// Repeatable LAB measurement of the Flutter web build (Plan 4). Serves a build
// the way firebase.json says (asked of the Hosting emulator) with CDN-like
// compression and ETag revalidation on 127.0.0.1, then reports, per profile,
// the median and range of N runs of:
//   - time to the app's FIRST FLUTTER FRAME (cold = empty cache, warm = second
//     load in the same browser), the metric Lighthouse cannot see;
//   - FCP (the HTML start screen), transfer bytes, requests, fallback fonts;
//   - optionally Lighthouse 13 (simulated throttling) score / FCP / LCP / TBT / SI;
//   - optionally landing -> dwell -> app (the prefetch case).
// Never deploys, never reads credentials, never talks to production.
//
//   node measure_web.mjs [--dir ../../build/web] [--build "--no-web-resources-cdn"]
//        [--runs 3] [--profiles mobile,desktop] [--lighthouse] [--path /] [--static]
//        [--landing /about/ --dwell 15000] [--sandbox-sdk] [--firebase-json ../../firebase.json]
//        [--label name] [--out results.json]
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO, probeHosting } from './lib/hosting.mjs';
import { startServer } from './lib/server.mjs';
import { chromeEnv, chromePath, launch, measureNavigation, newContext } from './lib/browser.mjs';

const { values: a } = parseArgs({
  options: {
    dir: { type: 'string', default: join(REPO, 'build', 'web') },
    build: { type: 'string' },
    runs: { type: 'string', default: '3' },
    profiles: { type: 'string', default: 'mobile,desktop' },
    lighthouse: { type: 'boolean', default: false },
    path: { type: 'string', default: '/' },
    static: { type: 'boolean', default: false }, // --path is a static page: no Flutter frame expected
    landing: { type: 'string' },
    dwell: { type: 'string', default: '15000' },
    'sandbox-sdk': { type: 'boolean', default: false },
    'firebase-json': { type: 'string', default: join(REPO, 'firebase.json') },
    label: { type: 'string', default: 'build' },
    out: { type: 'string' },
  },
});

export const median = (xs) => { const s = [...xs].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
export const fmt = (xs, unit = '') => {
  const v = xs.filter((x) => Number.isFinite(x));
  if (!v.length) return 'n/a';
  return `${Math.round(median(v))}${unit} (${Math.round(Math.min(...v))}–${Math.round(Math.max(...v))})`;
};

if (a.build !== undefined) {
  const args = ['build', 'web', '--release', ...a.build.split(' ').filter(Boolean)];
  console.log(`$ flutter ${args.join(' ')}`);
  const r = spawnSync('flutter', args, { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const dir = resolve(a.dir);
if (!existsSync(join(dir, 'index.html'))) { console.error(`no build at ${dir}`); process.exit(2); }

let sdkDir = null;
if (a['sandbox-sdk']) {
  sdkDir = join(REPO, 'tools', 'perf', 'node_modules', 'firebase');
  if (!existsSync(sdkDir)) { console.error('--sandbox-sdk needs `npm install` in tools/perf (firebase package)'); process.exit(2); }
}

console.log('asking the Hosting emulator how firebase.json serves this build ...');
const table = probeHosting({ buildDir: dir, firebaseJson: resolve(a['firebase-json']) });
const srv = await startServer({ dir, table, sdkDir });
const url = srv.origin + a.path;
const runs = Number(a.runs);
const results = { label: a.label, dir, date: new Date().toISOString(), chrome: chromePath() ?? 'playwright default', runs, profiles: {} };
const browser = await launch();
try {
  // Discarded warm-up: fills the server's compression cache.
  { const ctx = await newContext(browser, 'desktop'); const pg = await ctx.newPage(); await measureNavigation(ctx, pg, url, 'desktop', { settleMs: 1000 }); await ctx.close(); }
  for (const profile of a.profiles.split(',')) {
    const r = { cold: [], warm: [], landing: [] };
    for (let i = 0; i < runs; i++) {
      const ctx = await newContext(browser, profile);
      const p1 = await ctx.newPage();
      const opt = a.static ? { timeoutMs: 1, settleMs: 2000 } : {};
      r.cold.push(await measureNavigation(ctx, p1, url, profile, opt));
      await p1.close();
      const p2 = await ctx.newPage();
      r.warm.push(await measureNavigation(ctx, p2, url, profile, opt));
      await ctx.close();
      if (a.landing) {
        const c2 = await newContext(browser, profile);
        const pl = await c2.newPage();
        const land = await measureNavigation(c2, pl, srv.origin + a.landing, profile, { timeoutMs: 1, settleMs: Number(a.dwell) });
        const app = await measureNavigation(c2, pl, url, profile);
        r.landing.push({ landingFcp: land.fcp, ...app });
        await c2.close();
      }
      console.log(`${profile} run ${i + 1}: cold ${Math.round(r.cold.at(-1).firstFrame ?? NaN)} ms, warm ${Math.round(r.warm.at(-1).firstFrame ?? NaN)} ms` +
        (a.landing ? `, after landing ${Math.round(r.landing.at(-1).firstFrame ?? NaN)} ms` : ''));
    }
    results.profiles[profile] = r;
  }
} finally {
  await browser.close();
}

if (a.lighthouse) {
  const { default: lighthouse } = await import('lighthouse');
  const { launch: launchChrome } = await import('chrome-launcher');
  const { default: desktopConfig } = await import('lighthouse/core/config/desktop-config.js');
  const flags = ['--headless=new', '--no-sandbox'];
  if (process.env.HTTPS_PROXY) flags.push(`--proxy-server=${process.env.HTTPS_PROXY}`);
  for (const profile of a.profiles.split(',')) {
    const lh = [];
    for (let i = 0; i < runs; i++) {
      const chrome = await launchChrome({ chromePath: chromePath(), chromeFlags: flags, envVars: chromeEnv() });
      try {
        const rr = await lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance'] },
          profile === 'desktop' ? desktopConfig : undefined);
        const au = rr.lhr.audits;
        lh.push({ score: rr.lhr.categories.performance.score, fcp: au['first-contentful-paint'].numericValue, lcp: au['largest-contentful-paint'].numericValue,
          tbt: au['total-blocking-time'].numericValue, si: au['speed-index'].numericValue, bytes: au['total-byte-weight'].numericValue });
      } finally {
        await chrome.kill();
      }
    }
    results.profiles[profile].lighthouse = lh;
  }
}
await srv.close();

console.log(`\n## ${a.label} — LAB values (127.0.0.1, applied throttling; see tools/README.md "web performance")`);
console.log('| profile | load | first Flutter frame ms | FCP ms | KiB | requests | fallback fonts (count / KiB) |');
console.log('|---|---|---|---|---|---|---|');
for (const [profile, r] of Object.entries(results.profiles)) {
  for (const load of ['cold', 'warm', 'landing']) {
    const xs = r[load];
    if (!xs.length) continue;
    const failed = xs.filter((x) => x.failed).length;
    console.log(`| ${profile} | ${load === 'landing' ? `after ${a.landing} + ${a.dwell} ms` : load} | ${a.static && load !== 'landing' ? 'n/a (static page)' : `${fmt(xs.map((x) => x.firstFrame ?? NaN))}${failed ? ` (${failed} failed)` : ''}`} | ${fmt(xs.map((x) => (load === 'landing' ? x.landingFcp : x.fcp) ?? NaN))} | ${fmt(xs.map((x) => x.bytes / 1024))} | ${fmt(xs.map((x) => x.requests))} | ${fmt(xs.map((x) => x.fonts.count))} / ${fmt(xs.map((x) => x.fonts.bytes / 1024))} |`);
  }
  if (r.lighthouse) {
    const l = r.lighthouse;
    console.log(`| ${profile} | Lighthouse | score ${fmt(l.map((x) => x.score * 100))} · FCP ${fmt(l.map((x) => x.fcp))} · LCP* ${fmt(l.map((x) => x.lcp))} · TBT ${fmt(l.map((x) => x.tbt))} · SI ${fmt(l.map((x) => x.si))} | | ${fmt(l.map((x) => x.bytes / 1024))} | | |`);
  }
}
const fam = {};
for (const r of Object.values(results.profiles)) for (const x of [...r.cold]) for (const [k, n] of Object.entries(x.fonts.families)) fam[k] = Math.max(fam[k] ?? 0, n);
console.log(`fallback font families (max requests per cold load): ${JSON.stringify(fam)}`);
console.log('* Lighthouse LCP/FCP time the HTML start screen, not the canvas; the first-frame column is the app.');
if (a.out) writeFileSync(a.out, JSON.stringify(results, null, 2));
