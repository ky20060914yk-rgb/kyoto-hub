// Chromium driven through playwright-core + CDP for applied-throttling loads (Plan 4).
// The metric Lighthouse cannot see: when Flutter draws its first frame (the
// engine's `flutter-first-frame` window event). Lab values only.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

export const PROFILES = {
  // The numbers Lighthouse uses for "devtools" throttling of its mobile preset.
  mobile: {
    context: { viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true },
    net: { latency: 562.5, downloadThroughput: (1474.56 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 }, cpu: 4,
  },
  desktop: {
    context: { viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    net: { latency: 40, downloadThroughput: (10240 * 1024) / 8, uploadThroughput: (10240 * 1024) / 8 }, cpu: 1,
  },
};

const SANDBOX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const chromePath = () => process.env.CHROME_PATH || (existsSync(SANDBOX_CHROME) ? SANDBOX_CHROME : undefined);

export async function launch() {
  // Chrome never proxies loopback by default; Playwright's own `proxy` option would
  // force it to (it appends <-loopback>), so the flag is passed directly.
  const args = ['--no-sandbox'];
  if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`);
  return chromium.launch({ executablePath: chromePath(), headless: true, args, env: chromeEnv() });
}

/** Sandbox only: CHROME_HOME = a HOME whose .pki/nssdb trusts the egress proxy's CA (README). */
export const chromeEnv = () => (process.env.CHROME_HOME ? { ...process.env, HOME: process.env.CHROME_HOME } : process.env);

// Records the moments we report; runs before any page script.
const INIT = () => {
  window.__perf = { firstFrame: null, fcp: null, lcpTag: null };
  addEventListener('flutter-first-frame', () => { window.__perf.firstFrame ??= performance.now(); });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) => {
    const e = l.getEntries().at(-1);
    if (e) window.__perf.lcpTag = `${e.element?.tagName ?? '?'}:${(e.element?.textContent ?? '').trim().slice(0, 24)}`;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
};

export async function newContext(browser, profileName, extra = {}) {
  const ctx = await browser.newContext({ ...PROFILES[profileName].context, locale: 'ja-JP', ...extra });
  await ctx.addInitScript(INIT);
  return ctx;
}

/**
 * One throttled navigation in `page`. Returns { firstFrame, fcp, lcpTag, bytes,
 * requests, hosts, fonts: {count, bytes, families}, failed } (ms from navigation start).
 */
export async function measureNavigation(ctx, page, url, profileName, { timeoutMs = 120000, settleMs = 5000 } = {}) {
  const p = PROFILES[profileName];
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...p.net });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
  const urls = new Map();
  let bytes = 0;
  let requests = 0;
  const fonts = { count: 0, bytes: 0, families: {} };
  const hosts = {};
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.startsWith('data:')) return;
    requests++;
    urls.set(e.requestId, e.request.url);
    const h = new URL(e.request.url).host;
    hosts[h] = (hosts[h] ?? 0) + 1;
  });
  cdp.on('Network.loadingFinished', (e) => {
    bytes += e.encodedDataLength;
    const u = urls.get(e.requestId) ?? '';
    const m = u.match(/fonts\.gstatic\.com\/s\/([a-z0-9]+)\//);
    if (m) { fonts.count++; fonts.bytes += e.encodedDataLength; fonts.families[m[1]] = (fonts.families[m[1]] ?? 0) + 1; }
  });
  await page.goto(url, { waitUntil: 'commit' });
  let failed = null;
  try {
    await page.waitForFunction(() => window.__perf && window.__perf.firstFrame !== null, null, { timeout: timeoutMs, polling: 100 });
  } catch {
    failed = 'no-first-frame';
  }
  await page.waitForTimeout(settleMs); // let the fallback fonts arrive (counted, not timed)
  const perf = await page.evaluate(() => window.__perf);
  await cdp.detach().catch(() => {});
  return { ...perf, bytes, requests, hosts, fonts, failed };
}
