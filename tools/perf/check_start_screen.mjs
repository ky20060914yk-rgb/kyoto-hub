#!/usr/bin/env node
// Browser checks of the start screen and the start-up failure paths (Plan 4,
// Task 2) against a local build served like Firebase Hosting. Exit 1 on any
// failed check. Lab only: no deploy, no credentials, no production.
//   node check_start_screen.mjs [--dir ../../build/web] [--sandbox-sdk]
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO, probeHosting } from './lib/hosting.mjs';
import { startServer } from './lib/server.mjs';
import { launch, newContext } from './lib/browser.mjs';

const { values: a } = parseArgs({
  options: {
    dir: { type: 'string', default: join(REPO, 'build', 'web') },
    'sandbox-sdk': { type: 'boolean', default: false },
  },
});
const dir = resolve(a.dir);
const srv = await startServer({
  dir, table: probeHosting({ buildDir: dir }),
  sdkDir: a['sandbox-sdk'] ? join(REPO, 'tools', 'perf', 'node_modules', 'firebase') : null,
});
const browser = await launch();
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const state = (page) => page.evaluate(() => {
  const s = document.getElementById('start');
  return s ? { state: s.getAttribute('data-state'), reason: s.getAttribute('data-reason') } : { state: 'removed' };
});
const firstFrame = (page, timeout = 120000) =>
  page.waitForFunction(() => window.__perf && window.__perf.firstFrame !== null, null, { timeout, polling: 200 }).then(() => true, () => false);

try {
  // 1. Normal start: branded screen first, gone after the first frame, Japanese fallback fonts only.
  {
    const ctx = await newContext(browser, 'desktop');
    const page = await ctx.newPage();
    await page.goto(srv.origin + '/', { waitUntil: 'domcontentloaded' });
    check((await page.textContent('#start h1')) === '京大InfoHub', 'start screen shows the brand before any script ran');
    check(await page.isVisible('#start .start__status'), 'loading status is visible');
    check(await firstFrame(page), 'the app draws its first frame');
    await page.waitForTimeout(1500);
    check((await state(page)).state === 'removed', 'start screen is removed after the first frame');
    check(await page.evaluate(() => performance.getEntriesByName('kyotohub-first-frame').length === 1), 'performance mark kyotohub-first-frame exists (R-1)');
    await ctx.close();
  }
  // 2. Firebase SDK unreachable (school / company filter): failure screen, then retry works.
  {
    const ctx = await newContext(browser, 'desktop');
    const page = await ctx.newPage();
    await page.route('**/firebasejs/**', (r) => r.abort('blockedbyclient'));
    await page.goto(srv.origin + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('start')?.getAttribute('data-state') === 'failed', null, { timeout: 45000 }).catch(() => {});
    const s = await state(page);
    check(s.state === 'failed' && /^firebase-/.test(s.reason ?? ''), `SDK blocked -> failure screen (reason ${s.reason})`);
    check(await page.isVisible('#start-retry'), 'retry button visible');
    check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'start-retry'), 'retry button has focus');
    check(await page.isVisible('#start .start__contact'), 'contact text visible');
    await page.unroute('**/firebasejs/**');
    await page.click('#start-retry');
    check(await firstFrame(page), 'after unblocking, 再読み込み starts the app');
    await ctx.close();
  }
  // 3. flutter_bootstrap.js cannot load: failure screen at once.
  {
    const ctx = await newContext(browser, 'desktop');
    const page = await ctx.newPage();
    await page.route('**/flutter_bootstrap.js', (r) => r.abort('connectionrefused'));
    await page.goto(srv.origin + '/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const s = await state(page);
    check(s.state === 'failed' && s.reason === 'bootstrap', `bootstrap blocked -> failure screen (reason ${s.reason})`);
    await ctx.close();
  }
  // 4. main.dart.js never arrives: the 60 s watchdog shows the failure screen; the 8 s hint comes first.
  {
    const ctx = await newContext(browser, 'desktop');
    const page = await ctx.newPage();
    await page.route('**/main.dart.js*', () => { /* never answered */ });
    await page.goto(srv.origin + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(9000);
    check((await state(page)).state === 'slow', 'after 8 s: the "30 秒ほど" hint is shown');
    await page.waitForTimeout(52000);
    const s = await state(page);
    check(s.state === 'failed' && s.reason === 'timeout', `after 60 s: failure screen (reason ${s.reason})`);
    await ctx.close();
  }
  // 4b. The one-time asset refresh stalls (FontManifest.json never answers): the 5 s cap lets the engine start anyway.
  {
    const ctx = await newContext(browser, 'desktop');
    const page = await ctx.newPage();
    let stalled = 0; // only the bootstrap's refresh request hangs; the engine's own later request goes through
    await page.route('**/assets/FontManifest.json', (r) => { if (stalled++ === 0) return; r.continue(); });
    const t0 = Date.now();
    await page.goto(srv.origin + '/', { waitUntil: 'domcontentloaded' });
    const started = await firstFrame(page, 40000);
    check(started, `refresh stalled: the app still starts (first frame after ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    check(await page.evaluate(() => !document.getElementById('start') || document.getElementById('start').getAttribute('data-state') !== 'failed'), 'refresh stalled: no failure screen');
    await ctx.close();
  }
  // 5. Without JavaScript: the brand, the description and the noscript text are still there.
  {
    const ctx = await newContext(browser, 'desktop', { javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(srv.origin + '/', { waitUntil: 'load' });
    check((await page.textContent('#start h1')) === '京大InfoHub', 'no JS: brand visible');
    check((await page.content()).includes('JavaScript を有効にしてください'), 'no JS: noscript text present');
    await page.goto(srv.origin + '/about/', { waitUntil: 'load' });
    check((await page.textContent('h1')) === '京大InfoHub' && (await page.isVisible('a.cta')), 'no JS: /about/ is complete (heading + アプリを開く)');
    await ctx.close();
  }
  // 6. L-1: links into the app keep working — a sign-in-link style query and an old deep path both start the app.
  for (const path of ['/?mode=signIn&oobCode=TEST&apiKey=TEST&lang=ja', '/course/123']) {
    const ctx = await newContext(browser, 'desktop');
    const page = await ctx.newPage();
    await page.goto(srv.origin + path, { waitUntil: 'domcontentloaded' });
    check(await firstFrame(page), `${path} starts the app (not the landing page)`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await srv.close();
}
console.log(failures ? `${failures} check(s) failed` : 'all start-screen checks passed');
process.exit(failures ? 1 : 0);
