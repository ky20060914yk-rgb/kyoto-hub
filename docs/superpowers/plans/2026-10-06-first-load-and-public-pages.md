# Plan 4 — First-Load Performance & Public Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Flutter Web (no Next.js migration) and fix what the 2026-10-04 measurements found: replace the plain loading text with a branded, accessible start screen that works without JavaScript and turns into a visible failure screen (retry button, contact text) instead of a permanent blank page when the Firebase SDK or the engine cannot start; never run `runApp` without Firebase; add a static public landing page `/about/` that prefetches the app while the visitor reads; add `robots.txt`, `sitemap.xml`, real OGP/Twitter tags with a 1200×630 share image, `viewport`, `canonical`, `lang` and `theme-color`; **remove a measured stale-code bug** (after a deploy, returning visitors keep running the old `main.dart.js` and the old tree-shaken icon font, even after reloading twice); stop the engine from downloading Chinese fallback-font subsets for Japanese text; and add a repeatable lab measurement and cache-check toolset so before/after numbers are comparable.

**Architecture:** The app stays at `/` (Ruling L-1); everything new is either a static file in `web/` that `flutter build web` copies into `build/web` (`about/index.html`, `robots.txt`, `sitemap.xml`, `og-image.png`), a change to `web/index.html` (head tags + start screen, inline CSS/JS only), a custom `web/flutter_bootstrap.js` (Flutter's documented bootstrap template: stock loader call + failure reporting + per-build `main.dart.js?v=<id>` + one-time asset refresh), the `hosting.headers` of `firebase.json` (everything `no-cache`, images one day), or a small Dart startup guard (`lib/startup/`) that wraps `Firebase.initializeApp` in a 30 s timeout and tells the page through `dart:js_interop` when start-up failed. No route, URL, auth flow, service-worker scope, Firestore read or rule changes. Lab tooling lives in `tools/perf/` with its own `package.json`; it asks the **Firebase Hosting emulator** how `firebase.json` serves a build (so header/rewrite semantics come from firebase-tools, not a re-implementation), serves the build on 127.0.0.1 with CDN-like precompression and ETag/304, and drives the preinstalled Chromium through playwright-core + CDP.

**Tech Stack:** Flutter 3.41.9 / Dart ^3.11.5 (`dart:js_interop` from the SDK, no new Dart package); HTML/CSS/vanilla JS in `web/`; Node 22 with `lighthouse@13.5.0`, `playwright-core@1.56.1`, `chrome-launcher@1.2.2` (and `firebase@12.19.0` as the sandbox-only SDK stand-in) in `tools/perf/`; firebase-tools' Hosting emulator.

**Evidence:** `docs/analysis/2026-10-04-flutter-web-vs-nextjs-measurements.md` (cold first frame ≈ 19 s on throttled mobile; 3.0 MB / 34 requests; Lighthouse LCP times the HTML loading text; CJK fallback fonts fetched at runtime incl. SC/HK subsets; no robots/sitemap/viewport; 64×64 favicon as `og:image`; blank page when the SDK cannot load; `immutable` caching of unhashed files flagged as UNVERIFIED). This plan's dry run **verified** the caching risk (see Dry-run results) and re-measured everything with the tool from Task 1.

**Relation to Plans 2A / 2B / 3 — all three are implemented on `master-wf96b2`, NONE is deployed.** Plan 4 is independent of their Functions, rules, indexes and data steps: it changes only the web bundle (`web/`, `lib/main.dart`, `lib/startup/`) and the `hosting` part of `firebase.json`. Its build contains the 2A/2B/3 client, so **Plan 4 can never be deployed on its own before the 2A + 2B + 3 backend steps**. The recommended order (Deploy section): implement Plan 4 first, then run the existing combined 2A + 2B + 3 runbook unchanged, with Plan 4's checks added to PRE and a verification step after step 6 — Plan 4's hosting files ride step 6's `firebase deploy --only hosting`. That order also fixes the combined runbook's step 8: the dry run measured that under today's production headers "reload the app twice" does **not** give returning testers the new code; with Plan 4's bootstrap one normal reload does.

**Commit as soon as a task is green.** The implementation container can restart and lose uncommitted work: each task ends with its own commit step — run it the moment the task's verification passes, before starting the next task. Never batch several tasks into one commit.

## Global Constraints

- Flutter `3.41.9` at `/opt/tools/flutter/bin` (`export PATH=/opt/tools/flutter/bin:$PATH CI=true`), Dart `^3.11.5`. **No new Dart dependency** (`dart:js_interop` is part of the SDK). No new npm dependency in `functions/`, `firestore-tests/` or `tools/package.json`; the measurement tools have their own `tools/perf/package.json` (Ruling M-1), never imported by app code.
- Baselines on the branch at the commit that adds this plan: functions **220**, rules **138**, storage rules **9**, `flutter test` **181**, `flutter analyze` **21 issues**. Plan 4 changes no Function and no rule: those three stay 220 / 138 / 9; `flutter test` becomes **194** (+5 startup, +8 static-page tests); `flutter analyze` stays **21** (no new lints).
- Emulator suites: `bash tools/test_functions.sh`, `bash tools/test_rules.sh`, `bash tools/test_storage_rules.sh` (and the four tool suites) are unchanged; they export the Windows `JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"`, which on the Linux implementation box is a symlink to a JDK 21 — **never edit the scripts for it**. The Hosting emulator used by `tools/perf` needs no Java.
- **No user data, no course/review/listing content on any public page** (Ruling L-2): static marketing copy only; the landing page reads nothing from Firestore and loads no app code.
- **Do not break existing links:** `/`, every deep path and every query string keep serving the app (`index.html`) exactly as before; the Firebase-reserved `/__/…` namespace and the Auth action handler on `kyodai-sns.firebaseapp.com` are untouched; the service-worker file and scope are unchanged; no new domain (Auth authorized domains unchanged).
- Copy tone = the app's existing copy (です・ます, short sentences, 「京大生」, 「アプリはお金を扱いません」); facts must match the app (3 credits on verification, 1 credit per download, reviews free, no money in the market, takedown form reachable signed-out from the login screen).
- The contact address has ONE source: `kOperatorContactEmail` in `lib/config/contact.dart` (ships empty). The static pages get it only through `node tools/sync_web_contact.mjs` (Ruling C-3); `flutter test` fails while they disagree.
- Lab tooling: Chromium is the preinstalled `/opt/pw-browsers/chromium-1194` (**never** `playwright install`); measurements are lab values and are labelled as such; no credentials, no production access, no `--project kyodai-sns`.
- Commit scope: `web/`, `lib/`, `test/`, `tools/` (never `tools/node_modules/` or `tools/perf/node_modules/` — the root `.gitignore` already ignores `node_modules/`), `firebase.json`, `docs/`. Never `build/`, never `.superpowers/`.
- PowerShell 5.1 is the user's shell: every command in Deploy / Manual E2E is a single line, no `&&`, no bash `\` continuations (`;` chains); `curl.exe` (not the `curl` alias of `Invoke-WebRequest`).
- **Production side effects: none from the implementation environment.** No `firebase deploy`, no `gcloud`, no tool run against `kyodai-sns`. The Deploy section is the user's runbook.

## Rulings (the plan decides; each can be reversed cheaply — every one is also listed under "Owner decisions to confirm")

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| L-1 | **The app stays at `/`; the landing page is a separate static page at `/about/`** (linked from the start screen, used for shares, listed in the sitemap). Rejected: landing at `/` with the app moved to `/app/`. | Lowest risk, verified: the e-mail verification link uses Firebase's default action handler on `kyodai-sns.firebaseapp.com` with no `continueUrl` (`sendEmailVerification()` without `ActionCodeSettings`), so it never points at a hosting path; password sign-in has no redirect; the legacy sign-in-link handler reads `window.location.href` of whatever app URL is open; bookmarks, the PWA `start_url: "."`, the market share text (`https://kyodai-info.web.app/`) and the service worker scope `/` all assume the app at `/`. Moving the app would need `--base-href /app/`, a post-build directory shuffle in the user's PowerShell build, redirects for every old URL, and an extra click for every returning user. The dry run proved `/`, `/?mode=signIn&oobCode=…`, `/course/123` still start the app and `/about` → 301 `/about/` (Task 4/6 checks). | Move the app to `/app/` later (base href + redirects + start_url); `/about/` keeps working |
| L-2 | **Public = static marketing text only.** `/about/` and the start screen describe the app (from the onboarding copy) and contain no user data, no course names, no counts. `robots.txt` allows all and points to the sitemap; `sitemap.xml` lists exactly `/` and `/about/`. Every app deep path keeps `canonical` = `/`. | Nothing is publicly readable by design (every rule requires a KU account); publishing course data is a product/privacy decision that does not exist yet (report §1.6). | Add pages (e.g. a course index from `courses.json`) after an owner decision |
| S-1 | **No `runApp` without Firebase.** `main()` awaits `initializeBeforeRunApp`: `Firebase.initializeApp` with a **30 s** timeout; on error or timeout it calls `window.kyotoHubBootFailed(reason)` and returns without starting the app (a late success is ignored; the page offers a reload). | Before: an SDK that cannot load (school/company filter, outage) left `main()` awaiting forever → blank page (report §2; the dry run saw `initializeApp` **hang**, not throw, when the SDK is blocked). Not starting is the only state in which auth behaviour cannot be wrong: no `AppStore`, no `authStateChanges` listener, no email-link handling runs on a half-initialised Firebase. 30 s ≫ the few seconds the SDK takes on the lab's slow mobile profile; the page watchdog (S-2) is the outer bound. | Constant `kFirebaseInitTimeout` |
| S-2 | **Start screen states:** `loading` (brand, one-line description, spinner, `role=status`) → after **8 s** `slow` (「通信環境によっては 30 秒ほど…」) → `failed` on a signal (`bootstrap` script error, `engine`/`loader` errors from the bootstrap, `firebase-error`/`firebase-timeout` from Dart) or after **60 s** without a first frame (`timeout`). The failed state shows the cause in plain words, a focused 再読み込み button and the contact text (C-3). The first Flutter frame (`flutter-first-frame`) always removes the screen, even after a failure was shown. No global `error`/`unhandledrejection` hooks (benign errors would show false failures). | Lab cold mobile first frame is ≈ 19 s, so 60 s is a 3× margin; 8 s is when the plain spinner starts to look broken. | Constants `SLOW_MS` / `FAIL_MS` in `web/index.html` |
| S-3 | **Start screen = plain HTML/CSS in `index.html`, works without JS** (`<noscript>` text), system Japanese fonts (no web-font download), `lang="ja"`, `prefers-reduced-motion`, selectable text, positioned above Flutter's view until the first frame; the engine replaces our `viewport` meta with its own (it always does in full-page mode), so the tag only serves the pre-JS screen and crawlers. | The plain loading text was the LCP element and the only content for 19 s; a crawler/link preview now sees the brand and description. | Revert `web/index.html` |
| C-1 | **`firebase.json` headers: `**` → `Cache-Control: no-cache`; `**/*.png` → `public, max-age=86400`.** Nothing `immutable`. The two rules overlap only for PNGs, so either merge order is safe (worst case PNGs are revalidated too). | Verified in the dry run: no file in `build/web` is content-hashed, and the current rules give `main.dart.js`, `assets/**` (incl. the tree-shaken icon font), `canvaskit/**`, `flutter.js`, `manifest.json` **and every rewritten deep path, `/robots.txt`, `/sitemap.xml`, `/about/`** `max-age=31536000, immutable`, while `/` gets no `Cache-Control` at all. A returning visitor then ran the old `main.dart.js` after a deploy, even after two reloads. `no-cache` = revalidate with the ETag (304, a few hundred bytes) on every load. Measured cost: warm mobile first frame 4.45 s → 5.21 s in the lab (562 ms emulated RTT); desktop no worse (0.99 → 0.86 s). | Versioned file names via a post-build step (adds a build step to the user's PowerShell runbook) |
| C-2 | **Per-build URL + one-time asset refresh (custom `web/flutter_bootstrap.js`).** Flutter writes a fresh random number into `{{flutter_service_worker_version}}` on every build; the bootstrap uses it as the build id: `main.dart.js` is loaded as `main.dart.js?v=<id>`, and when the id differs from `localStorage['kyotohub.build']` the asset manifests and every font in `FontManifest.json` are fetched once with `cache: 'reload'` before the engine initialises. | Headers (C-1) cannot reach copies browsers already hold under the old `immutable, max-age=1y`; verified: with C-1 alone a returning visitor still kept `main.dart.js` and `MaterialIcons-Regular.otf` from the old build; with C-2 every changed file was fetched again. The icon font is tree-shaken per build (pre-2A tree 15,800 B vs today 16,980 B), so the 2A/2B/3 screens would show missing icons for returning users. Cost: one extra small request per asset on the first visit after each deploy. The token is deprecated with Flutter's service worker; `check_web_cache.mjs` fails the deploy check if a future Flutter stops substituting it. | Drop the refresh after a year (all old `immutable` copies expired); replace the id source if Flutter removes the token |
| C-3 | **Contact address: one source, `kOperatorContactEmail`.** `tools/sync_web_contact.mjs` writes it between `<!-- contact:begin -->` / `<!-- contact:end -->` in `web/index.html` and `web/about/index.html` (empty → fallback text 「マイページ → お問い合わせ」; non-address values refused); `flutter test` fails while a page disagrees with the constant. | The static pages cannot read a Dart constant, and the failure screen is shown exactly when the app (and its お問い合わせ screen) cannot open. A build-time `--web-define` would add a second flag the user must remember next to the existing "edit contact.dart" checklist item. | `--dart-define` + `--web-define` with the same value |
| F-1 | **Fonts: no bundled font; the page reports `navigator.language === 'ja'` to the engine.** Measured: Flutter's fallback-font picker prefers Noto Sans JP only when `navigator.language` is exactly `'ja'` (engine `font_fallbacks.dart` `_selectFont`); with `ja-JP` (typical on Android/iOS Safari) it downloaded 9 Noto Sans **SC** + 3 **HK** + 1 JP subsets (434 KiB incl. Roboto), with `ja` 18 JP subsets (293 KiB, −32%). The override touches only `navigator.language`; Flutter takes the app locale from `navigator.languages`, which stays untouched. | Bundling a Japanese font cannot cover user-written kanji (the fallback would still run) and a useful subset costs ≥ 1 MB per weight; the override is 3 lines and also gives Japanese glyph forms. (On the sign-up screen the SC and JP renderings were not visibly different; the gain claimed is bytes.) | Delete the 3 lines |
| P-1 | **Landing prefetch:** 1 s after `load`, `/about/` reads the deployed `flutter_bootstrap.js` and adds `<link rel=prefetch>` for `main.dart.js?v=<id>` and the CanvasKit `.js`/`.wasm` variant the loader will pick (gstatic CDN in production, `/canvaskit/` for `--no-web-resources-cdn` builds); skipped with Data Saver or on 2G. | Measured: after a 15 s dwell the app's first frame on click-through is 8.2 s instead of 18.9 s cold (mobile lab). URLs come from the deployed bootstrap, so they follow Flutter upgrades. Cost: ≈ 2.3 MB for a visitor who never opens the app. | Remove the script, or restrict to `connection.type === 'wifi'` |
| R-1 | **Real-user timing: local only.** On the first frame the page sets `performance.mark('kyotohub-first-frame')` and logs `[kyotohub] first frame N ms` to the console. Nothing is sent anywhere. | Zero privacy cost, no dependency, useful for support ("open the console") and for the lab tool. Sending the number (Analytics / Performance Monitoring) is an owner decision (no analytics without one). | Send the mark via GA4 or Firebase Performance after a decision |
| W-1 | **`--wasm`: measured, NOT adopted in this plan.** Lab cold first frame mobile −7% (16.7 → 15.5 s, SDK served un-throttled in this comparison), desktop −10%; the failure path (S-1/S-2) works under dart2wasm too. | Not exercised under dart2wasm: sign-in, Firestore, Functions, Storage (no credentials), Safari/iOS (WebKit falls back to dart2js, not measured); C-2 versions `mainJsPath` only and P-1 prefetches the dart2js build. | A small follow-up: version `mainWasmPath`/`jsSupportRuntimePath`, prefetch skwasm, smoke-test signed-in flows |
| D-1 | **Deferred loading: measured, NOT adopted.** By source map, all of `lib/views/**` is 4.3% of `main.dart.js` (≈ 85 KB raw, ≈ 30 KB brotli ≈ 0.2 s on the lab mobile link); the rest is framework, web engine, Dart runtime and plugins that load anyway. | Deferring every screen would add `loadLibrary()` awaits at ~39 navigation sites for < 0.2 s. | Re-measure when `lib/views` grows past ~15% |
| M-1 | **Lab tools in `tools/perf/`** with their own pinned `package.json` (Lighthouse 13.5.0, playwright-core 1.56.1, chrome-launcher 1.2.2, firebase 12.19.0 for the sandbox SDK stand-in). The Hosting emulator is the source of truth for header/rewrite semantics; the local server adds brotli-11/gzip-9 and ETag/304. | Keeps the user's `tools/` install (firebase-admin only) unchanged; Lighthouse alone cannot see the canvas, so the first-frame metric needs a browser driver. | Merge into `tools/package.json` |
| X-1 | **Manifest polish:** `name`/`short_name` 「京大InfoHub」, `theme_color` `#0F4C81`, `background_color` `#F8FAFC` (was `kyodai_info_hub` / `#0175C2`); meta description no longer advertises 教科書の貸借 (v1 has no lending, spec §3). | The installed-app name and splash colour now match the app; the old description was wrong. | Revert `web/manifest.json` |

## Adversarial / risk surfaces → mitigations → tests

| Surface | Risk / attack | Mitigation | Test (task) |
|---|---|---|---|
| Firebase SDK unreachable | Blank page forever (filters, outages) | S-1 timeout → `firebase-timeout`, S-2 failure screen with retry | `startup_test` (T2); `check_start_screen` case 2 (T3) |
| Slow phone | False "failed" on a slow but working load | 30 s Dart / 60 s page; the first frame always removes the screen | `startup_test` "just inside the timeout" (T2); case 4 (T3) |
| Late Firebase success | App starting after the failure UI, half-initialised | `initializeBeforeRunApp` returns false once, ignores late completion | `startup_test` "a hang is cut … late success changes nothing" (T2) |
| Engine / bootstrap failure | Blank page | `onerror` on the script tag, `catch` in the bootstrap, watchdog | case 3 (bootstrap), case 4 (`main.dart.js` never arrives) (T3) |
| Deploy → stale code | Returning visitors run old `main.dart.js` with new bootstrap; old icon font | C-1 headers + C-2 per-build URL and asset refresh | `check_web_cache` header mode + `--returning-user` (T5); static test C-1 (T5) |
| Flutter upgrade | Bootstrap tokens renamed → syntax error → no app | `bootstrapProblems` fails the pre-deploy check; the watchdog shows the failure screen | `check_web_cache` (T5); static bootstrap test (T3/T5) |
| Old links | Email/sign-in links, bookmarks, PWA start, deep paths broken | L-1: no path moves; only new static files | `check_start_screen` case 6; route checks in `check_web_cache` (T5) |
| Public pages leak data | Course/review/user data on an unauthenticated page | L-2 static copy only; the landing loads no app code and reads nothing | static test "no app code" (T4); sitemap = 2 URLs (T4) |
| Duplicate / junk indexing | Crawlers index every deep path as a page | App paths keep `canonical` = `/`; robots/sitemap are real files (no soft-200 HTML) | crawler curl (Dry-run results); route checks (T5) |
| Contact injection | Markup in the address breaks or hijacks the page | `sync_web_contact.mjs` accepts only a plain address | tool refuses (T7) |
| Mobile data | Prefetch burns 2.3 MB for non-clickers | Data Saver / 2G skip, starts 1 s after `load` | static test `c.saveData` (T4); owner decision |
| Locale side effects | Overriding `navigator.language` changes the app locale | Only `.language` is overridden; Flutter reads `.languages` | static test F-1, `check_start_screen` case 1 (T6) |
| Privacy | Timing telemetry | R-1: nothing leaves the device | n/a |

## File Structure

**Created**
- `lib/startup/startup.dart` — `initializeBeforeRunApp`, `kFirebaseInitTimeout`
- `lib/startup/boot_signal.dart`, `boot_signal_stub.dart`, `boot_signal_web.dart` — `reportBootFailure(reason)` → `window.kyotoHubBootFailed`
- `test/startup/startup_test.dart`, `test/web/static_pages_test.dart`
- `web/flutter_bootstrap.js` — bootstrap template (Flutter tokens + failure reporting + C-2)
- `web/about/index.html`, `web/robots.txt`, `web/sitemap.xml`, `web/og-image.png` (generated)
- `tools/perf/package.json` (+ generated `package-lock.json`), `tools/perf/lib/{hosting,probe,server,browser}.mjs`, `tools/perf/measure_web.mjs`, `tools/perf/check_start_screen.mjs`, `tools/perf/check_web_cache.mjs`, `tools/perf/make_og_image.mjs`
- `tools/sync_web_contact.mjs`

**Modified**
- `lib/main.dart` (startup guard only), `web/index.html` (rewritten), `web/manifest.json`, `firebase.json` (`hosting.headers` only), `tools/README.md` (new section)

**Unchanged on purpose:** every Function, rule, index, Storage rule and data tool; `AppStore` and every screen; `lib/config/contact.dart` (still empty; the owner sets it); `firebase.json` rewrites, `public`, `site` and every non-hosting key; `pubspec.yaml`.

---

### Task 1: `tools/perf` — the lab server, the Hosting-emulator oracle and `measure_web.mjs`

**Files:**
- Create: `tools/perf/package.json`, `tools/perf/lib/hosting.mjs`, `tools/perf/lib/probe.mjs`, `tools/perf/lib/server.mjs`, `tools/perf/lib/browser.mjs`, `tools/perf/measure_web.mjs` (and the generated `tools/perf/package-lock.json`)

**Interfaces:**
- Produces (`lib/hosting.mjs`): `REPO`, `PROBE_EXTRA`, `sha1(buf)`, `listFiles(dir) → string[]` (URL paths, dotfiles skipped), `probeHosting({buildDir, firebaseJson?, port?}) → Map<path, {status, location, cacheControl, contentType, file}>` (`file` = the build file whose bytes answered, `'/index.html'` for a rewrite).
- Produces (`lib/server.mjs`): `startServer({dir, table, port?, sdkDir?, onRequest?}) → {origin, swap({dir, table}), close()}`.
- Produces (`lib/browser.mjs`): `PROFILES` (`mobile`, `desktop`), `chromePath()`, `chromeEnv()`, `launch()`, `newContext(browser, profile, extra?)`, `measureNavigation(ctx, page, url, profile, {timeoutMs, settleMs}) → {firstFrame, fcp, lcpTag, bytes, requests, hosts, fonts:{count, bytes, families}, failed}`.
- CLI: `node tools/perf/measure_web.mjs [--dir] [--build "<flutter args>"] [--runs 3] [--profiles mobile,desktop] [--lighthouse] [--path /] [--static] [--landing /about/ --dwell 15000] [--sandbox-sdk] [--firebase-json] [--label] [--out]`.

- [ ] **Step 1: Create `tools/perf/package.json`**

```json
{
  "name": "kyodai-info-perf",
  "private": true,
  "type": "module",
  "description": "Lab-only web performance measurement and cache checks (Plan 4). Never deploys, never reads credentials.",
  "dependencies": {
    "chrome-launcher": "1.2.2",
    "firebase": "12.19.0",
    "lighthouse": "13.5.0",
    "playwright-core": "1.56.1"
  }
}
```

- [ ] **Step 2: Create `tools/perf/lib/hosting.mjs`**

```js
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
```

- [ ] **Step 3: Create `tools/perf/lib/probe.mjs`**

```js
// Runs INSIDE `firebase emulators:exec --only hosting` (copied next to the
// temporary firebase.json by hosting.mjs): GETs every path in paths.json
// uncompressed and records what the emulator answered into table.json.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const origin = process.env.PROBE_ORIGIN;
const paths = JSON.parse(readFileSync('paths.json', 'utf8'));
const table = {};
for (const p of paths) {
  const [path, query] = p.split('?');
  const url = origin + path.split('/').map((s) => encodeURIComponent(s)).join('/') + (query ? `?${query}` : '');
  const res = await fetch(url, { headers: { 'accept-encoding': 'identity' }, redirect: 'manual' });
  const body = Buffer.from(await res.arrayBuffer());
  table[p] = {
    status: res.status,
    location: res.headers.get('location'),
    cacheControl: res.headers.get('cache-control'),
    contentType: res.headers.get('content-type'),
    sha1: createHash('sha1').update(body).digest('hex'),
  };
}
writeFileSync('table.json', JSON.stringify(table));
console.log(`probed ${paths.length} paths`);
```

- [ ] **Step 4: Create `tools/perf/lib/server.mjs`**

```js
// A local stand-in for Firebase Hosting used only for lab measurements (Plan 4).
// Routing and Cache-Control come from the Hosting emulator's answers (hosting.mjs),
// so firebase.json is interpreted by firebase-tools itself, not re-implemented.
// What this server adds, because the emulator lacks it: brotli q11 / gzip -9
// precompressed bodies (like a CDN edge; the emulator compresses at a low level)
// and ETag + 304 revalidation (the emulator always answers 200).
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { sha1 } from './hosting.mjs';

const COMPRESSIBLE = /\.(html|js|mjs|json|css|wasm|otf|ttf|frag|txt|xml|svg|symbols)$|\/NOTICES$|\/$/;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.png': 'image/png', '.otf': 'font/otf', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.css': 'text/css; charset=utf-8',
};
const GSTATIC_SDK = 'https://www.gstatic.com/firebasejs/';
const SDK_PREFIX = '/__sdk/firebasejs/';

function variants(buf, compressible) {
  const v = { raw: buf, etag: `"${sha1(buf)}"` };
  if (compressible) {
    v.br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    v.gzip = gzipSync(buf, { level: 9 });
  }
  return v;
}

/**
 * startServer({ dir, table, port, sdkDir, onRequest }) -> { origin, swap({dir, table}), close() }.
 * `swap` replaces the served build in place (a "deploy" for check_web_cache.mjs);
 * `onRequest(path, status)` sees every answered request.
 * `sdkDir` (sandbox only): the `firebase` npm package directory. The Firebase JS SDK
 * the app loads from www.gstatic.com is then served same-origin under /__sdk/ and
 * the URL in main.dart.js is rewritten — the sandbox denies www.gstatic.com.
 * Production and the user's machine never need this.
 */
export async function startServer({ dir, table, port = 0, sdkDir = null, onRequest = () => {} }) {
  let cache = new Map();
  let deep = table.get('/no/such/deep/path');
  let origin = '';
  const bodyOf = (file) => {
    if (cache.has(file)) return cache.get(file);
    let buf = readFileSync(join(dir, file));
    if (sdkDir && /\/main\.dart\.(js|mjs)$/.test(file)) buf = Buffer.from(buf.toString('utf8').split(GSTATIC_SDK).join(origin + SDK_PREFIX));
    const v = variants(buf, COMPRESSIBLE.test(file));
    cache.set(file, v);
    return v;
  };
  const server = createServer((req, res) => {
    res.on('finish', () => onRequest(decodeURIComponent(new URL(req.url, 'http://x').pathname), res.statusCode));
    const url = new URL(req.url, 'http://x');
    let pathname = decodeURIComponent(url.pathname);
    let entry;
    let file;
    let cacheControl;
    if (sdkDir && pathname.startsWith(SDK_PREFIX)) {
      const name = pathname.split('/').pop();
      const p = join(sdkDir, name);
      if (!/^[\w.-]+\.js$/.test(name) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
      if (!cache.has(pathname)) {
        const src = readFileSync(p, 'utf8').split(GSTATIC_SDK).join(origin + SDK_PREFIX);
        cache.set(pathname, variants(Buffer.from(src), true));
      }
      file = pathname;
      cacheControl = 'public, max-age=31536000'; // what gstatic sends for a versioned SDK file
    } else {
      entry = table.get(pathname + url.search) ?? table.get(pathname) ?? deep;
      if (entry.status >= 300 && entry.status < 400) { res.writeHead(entry.status, { location: entry.location }); res.end(); return; }
      if (entry.status !== 200 || !entry.file) { res.writeHead(entry.status); res.end(); return; }
      file = entry.file;
      cacheControl = entry.cacheControl;
    }
    const v = file.startsWith(SDK_PREFIX) ? cache.get(file) : bodyOf(file);
    const ext = (file.match(/\.[a-z0-9]+$/) ?? [''])[0];
    const headers = { 'content-type': TYPES[ext] ?? 'application/octet-stream', etag: v.etag, vary: 'Accept-Encoding' };
    if (cacheControl) headers['cache-control'] = cacheControl;
    if (req.headers['if-none-match'] === v.etag) { res.writeHead(304, headers); res.end(); return; }
    const ae = String(req.headers['accept-encoding'] ?? '');
    let body = v.raw;
    if (v.br && /\bbr\b/.test(ae)) { body = v.br; headers['content-encoding'] = 'br'; }
    else if (v.gzip && /\bgzip\b/.test(ae)) { body = v.gzip; headers['content-encoding'] = 'gzip'; }
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  // Bodies are compressed on first request and kept: measure_web.mjs makes one
  // discarded warm-up load first, so compression time never lands in a measurement.
  const swap = (next) => { dir = next.dir; table = next.table; deep = table.get('/no/such/deep/path'); cache = new Map(); };
  return { origin, swap, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}
```

- [ ] **Step 5: Create `tools/perf/lib/browser.mjs`**

```js
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
```

- [ ] **Step 6: Create `tools/perf/measure_web.mjs`**

```js
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
```

- [ ] **Step 7: Install and record the BEFORE numbers (sandbox flags; see the README section of Task 8 for `CHROME_HOME`)**

Run:
```bash
npm --prefix tools/perf install
export PATH=/opt/tools/flutter/bin:$PATH CI=true
flutter build web --release --no-web-resources-cdn
node tools/perf/measure_web.mjs --runs 3 --lighthouse --sandbox-sdk --label before --out /tmp/perf-before.json
```
Expected: `package-lock.json` created; the tool prints "asking the Hosting emulator …", one line per run and a table with every first-frame cell a number (no "failed"); mobile cold ≈ 18.8 s, desktop cold ≈ 2.8 s (lab; see Dry-run results for the exact values). `flutter test` is untouched (181).

- [ ] **Step 8: Commit (now — before the next task)**

```bash
git add tools/perf/package.json tools/perf/package-lock.json tools/perf/lib tools/perf/measure_web.mjs
git commit -m "feat(tools): tools/perf lab measurement — Hosting-emulator header oracle, CDN-like local server, first-Flutter-frame timing, Lighthouse (Plan 4)"
```

---

### Task 2: Startup guard — never `runApp` without Firebase, report the failure to the page

**Files:**
- Create: `lib/startup/startup.dart`, `lib/startup/boot_signal.dart`, `lib/startup/boot_signal_stub.dart`, `lib/startup/boot_signal_web.dart`, `test/startup/startup_test.dart`
- Modify: `lib/main.dart`

**Interfaces:**
- Produces: `Future<bool> initializeBeforeRunApp({required Future<void> Function() initFirebase, required void Function(String reason) onFailure, Duration timeout = kFirebaseInitTimeout})`; `const kFirebaseInitTimeout = Duration(seconds: 30)`; `void reportBootFailure(String reason)` (web: calls `window.kyotoHubBootFailed(reason)` if defined; elsewhere a no-op). Failure reasons: `firebase-error`, `firebase-timeout`.
- Consumed by: `lib/main.dart`; `web/index.html` (Task 3) defines `window.kyotoHubBootFailed`.

- [ ] **Step 1: Write the failing test**

Create `test/startup/startup_test.dart`:

```dart
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/startup/boot_signal.dart';
import 'package:kyoto_exam_hub/startup/startup.dart';

void main() {
  test('success: ready, no failure reported', () async {
    final failures = <String>[];
    final ready = await initializeBeforeRunApp(initFirebase: () async {}, onFailure: failures.add);
    expect(ready, isTrue);
    expect(failures, isEmpty);
  });

  test('an init error is reported as firebase-error and the app must not start', () async {
    final failures = <String>[];
    final ready = await initializeBeforeRunApp(
      initFirebase: () async => throw StateError('SDK script blocked'),
      onFailure: failures.add,
    );
    expect(ready, isFalse);
    expect(failures, ['firebase-error']);
  });

  test('a hang is cut at the timeout and reported once as firebase-timeout', () async {
    final failures = <String>[];
    final never = Completer<void>();
    final ready = await initializeBeforeRunApp(
      initFirebase: () => never.future,
      onFailure: failures.add,
      timeout: const Duration(milliseconds: 50),
    );
    expect(ready, isFalse);
    expect(failures, ['firebase-timeout']);
    never.complete(); // a late success changes nothing
    await Future<void>.delayed(Duration.zero);
    expect(failures, ['firebase-timeout']);
  });

  test('just inside the timeout still counts as ready', () async {
    final failures = <String>[];
    final ready = await initializeBeforeRunApp(
      initFirebase: () => Future<void>.delayed(const Duration(milliseconds: 10)),
      onFailure: failures.add,
      timeout: const Duration(milliseconds: 500),
    );
    expect(ready, isTrue);
    expect(failures, isEmpty);
  });

  test('the default timeout is 30 s (S-1) and reportBootFailure is a no-op off the web', () {
    expect(kFirebaseInitTimeout, const Duration(seconds: 30));
    reportBootFailure('firebase-error'); // must not throw on the VM
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `flutter test test/startup/startup_test.dart`
Expected: FAIL — compilation error, `package:kyoto_exam_hub/startup/startup.dart` does not exist.

- [ ] **Step 3: Create the startup files**

Create `lib/startup/startup.dart`:

```dart
import 'dart:async';

/// What `main()` must finish before `runApp` (Plan 4, Ruling S-1).
///
/// Firebase has to be initialised before the first `AppStore` / Firestore /
/// Auth call, so the app is never started without it. Before Plan 4 a Firebase
/// JS SDK that could not load (school or company filters on gstatic.com, an
/// outage) left `main()` awaiting forever and the page blank. Now a failure or
/// a hang longer than [timeout] calls [onFailure] (index.html then shows its
/// failure screen with a retry button) and returns false; the caller must then
/// NOT start the app, so no auth code ever runs against a half-initialised
/// Firebase. A late success after the timeout is ignored (the page offers a
/// reload instead).
Future<bool> initializeBeforeRunApp({
  required Future<void> Function() initFirebase,
  required void Function(String reason) onFailure,
  Duration timeout = kFirebaseInitTimeout,
}) async {
  try {
    await initFirebase().timeout(timeout);
    return true;
  } on TimeoutException {
    onFailure('firebase-timeout');
  } catch (_) {
    onFailure('firebase-error');
  }
  return false;
}

/// Lab cold mobile (Plan 4 dry run): Firebase finishes a few seconds after
/// `main()` starts; 30 s leaves a wide margin for a slow phone line, and the
/// page's own 60 s watchdog stays the outer bound.
const Duration kFirebaseInitTimeout = Duration(seconds: 30);
```

Create `lib/startup/boot_signal.dart`:

```dart
// Tells the host page (web/index.html) that start-up failed, so it shows its
// failure screen instead of a blank page (Plan 4). No-op off the web.
export 'boot_signal_stub.dart' if (dart.library.js_interop) 'boot_signal_web.dart';
```

Create `lib/startup/boot_signal_stub.dart`:

```dart
void reportBootFailure(String reason) {}
```

Create `lib/startup/boot_signal_web.dart`:

```dart
import 'dart:js_interop';

@JS('kyotoHubBootFailed')
external JSFunction? get _kyotoHubBootFailed;

/// Calls `window.kyotoHubBootFailed(reason)` defined by web/index.html, if present.
void reportBootFailure(String reason) {
  _kyotoHubBootFailed?.callAsFunction(null, reason.toJS);
}
```

- [ ] **Step 4: Use the guard in `lib/main.dart`**

Replace:

```dart
import 'views/onboarding/onboarding_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  FirebaseFirestore.instance.settings = const Settings(
```

with:

```dart
import 'views/onboarding/onboarding_screen.dart';
import 'startup/boot_signal.dart';
import 'startup/startup.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final ready = await initializeBeforeRunApp(
    initFirebase: () => Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    ),
    onFailure: reportBootFailure,
  );
  // Without Firebase nothing may start (no AppStore, no auth listener): the
  // page's start screen shows the failure state and a reload button (Plan 4).
  if (!ready) return;
  FirebaseFirestore.instance.settings = const Settings(
```

Nothing else in `main.dart` changes (the Firestore settings, `runApp` and `KyotoExamHubApp` stay byte-identical).

- [ ] **Step 5: Run to verify it passes**

Run: `flutter test` then `flutter analyze`
Expected: PASS — 181 existing + 5 new = **186**; analyzer **21 issues** (none new).

- [ ] **Step 6: Commit (now — before the next task)**

```bash
git add lib/startup lib/main.dart test/startup/startup_test.dart
git commit -m "feat(web): never runApp without Firebase — 30 s init timeout, failure reported to the page instead of a blank screen (Plan 4)"
```

---

### Task 3: The start screen and a failure-reporting bootstrap

**Files:**
- Modify (rewrite): `web/index.html`
- Create: `web/flutter_bootstrap.js` (first version; Task 5 replaces it), `test/web/static_pages_test.dart` (first version; later tasks extend it), `tools/perf/check_start_screen.mjs` (first version; Tasks 4 and 6 extend it)

**Interfaces:**
- Produces: `window.kyotoHubBootFailed(reason)`; `#start[data-state="loading"|"slow"|"failed"]`, `#start[data-reason]`, `#start-retry`; `performance.mark('kyotohub-first-frame')`; the contact markers `<!-- contact:begin -->…<!-- contact:end -->` (Task 7). Reasons used: `bootstrap`, `engine`, `loader`, `firebase-error`, `firebase-timeout`, `timeout`.
- Consumes: the engine's `flutter-first-frame` window event; `reportBootFailure` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `test/web/static_pages_test.dart`:

```dart
// Static, crawler-facing web files (Plan 4). These run on the VM with dart:io:
// they read files in web/ and firebase.json; they never build or serve anything.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

String read(String path) => File(path).readAsStringSync();

void main() {
  final index = read('web/index.html');

  test('index.html: language, viewport, canonical, share tags, start screen hooks', () {
    expect(index, contains('<html lang="ja">'));
    expect(index, contains('<meta name="viewport" content="width=device-width, initial-scale=1">'));
    expect(index, contains('<link rel="canonical" href="https://kyodai-info.web.app/">'));
    expect(index, contains('<meta property="og:image" content="https://kyodai-info.web.app/og-image.png">'));
    expect(index, contains('<meta name="twitter:card" content="summary_large_image">'));
    expect(index, contains('<meta name="theme-color" content="#0F4C81">'));
    expect(index.contains('content="https://kyodai-info.web.app/favicon.png"'), isFalse);
    expect(index.contains('貸借'), isFalse, reason: 'lending is not offered (spec §3)');
    expect(index, contains('id="start" data-state="loading"'));
    expect(index, contains("addEventListener('flutter-first-frame'"));
    expect(index, contains('window.kyotoHubBootFailed = function'));
    expect(index, contains('<script src="flutter_bootstrap.js" async onerror="window.kyotoHubBootFailed(\'bootstrap\')"></script>'));
  });

  test('flutter_bootstrap.js template keeps the stock tokens and reports failures', () {
    final boot = read('web/flutter_bootstrap.js');
    expect(boot, startsWith('{{flutter_js}}\n{{flutter_build_config}}\n'));
    expect(boot, contains('serviceWorkerVersion: {{flutter_service_worker_version}}'));
    expect(boot, contains("window.kyotoHubBootFailed('engine')"));
    expect(boot, contains("window.kyotoHubBootFailed('loader')"));
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `flutter test test/web/static_pages_test.dart`
Expected: FAIL — 2 tests: `index.html` lacks `<html lang="ja">` (first failed expectation); `web/flutter_bootstrap.js` does not exist (`PathNotFoundException`).

- [ ] **Step 3: Rewrite `web/index.html`**

Replace the whole file with:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <!--
    `flutter build web --base-href` replaces $FLUTTER_BASE_HREF. The app is
    served at the site root (Plan 4, Ruling L-1), so it stays "/".
  -->
  <base href="$FLUTTER_BASE_HREF">

  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0F4C81">
  <meta name="color-scheme" content="light">
  <title>京大InfoHub — 京大生専用の授業レビュー・過去問共有・教科書マーケット</title>
  <meta name="description" content="京大InfoHub は京大生専用のアプリです。授業レビュー、過去問・資料の共有、教科書の譲り合い・売買ができます。@st.kyoto-u.ac.jp のメールアドレスで登録・認証した京大生だけが使えます。">
  <link rel="canonical" href="https://kyodai-info.web.app/">

  <!-- Open Graph / link previews: a real 1200x630 image (web/og-image.png, Plan 4 Task 5) -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="京大InfoHub">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:url" content="https://kyodai-info.web.app/">
  <meta property="og:title" content="京大InfoHub — 京大生専用の授業レビュー・過去問共有・教科書マーケット">
  <meta property="og:description" content="授業レビュー、過去問・資料の共有、教科書の譲り合い・売買。京大のメールで認証した京大生だけが使えるアプリです。">
  <meta property="og:image" content="https://kyodai-info.web.app/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="京大InfoHub — 京大生専用の授業レビュー・過去問共有・教科書マーケット">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="京大InfoHub — 京大生専用の授業レビュー・過去問共有・教科書マーケット">
  <meta name="twitter:description" content="授業レビュー、過去問・資料の共有、教科書の譲り合い・売買。京大のメールで認証した京大生だけが使えるアプリです。">
  <meta name="twitter:image" content="https://kyodai-info.web.app/og-image.png">

  <!-- iOS meta tags & icons -->
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black">
  <meta name="apple-mobile-web-app-title" content="京大InfoHub">
  <link rel="apple-touch-icon" href="icons/Icon-192.png">
  <link rel="icon" type="image/png" href="favicon.png">
  <link rel="manifest" href="manifest.json">

  <style>
    /* Start screen (Plan 4, Task 2): visible without JavaScript, removed on Flutter's first frame. */
    :root {
      --brand: #0F4C81; --ink: #1E293B; --muted: #475569; --bg: #F8FAFC; --card: #FFFFFF;
      --line: #E2E8F0; --warn-bg: #FEF2F2; --warn-line: #FCA5A5; --warn-ink: #991B1B;
    }
    html, body { margin: 0; padding: 0; background: var(--bg); }
    #start {
      position: fixed; inset: 0; z-index: 1; overflow-y: auto; touch-action: pan-y;
      -webkit-user-select: text; user-select: text;
      display: flex; align-items: center; justify-content: center; padding: 24px 16px; box-sizing: border-box;
      background: var(--bg); color: var(--ink); transition: opacity .2s ease;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, "Noto Sans JP", sans-serif;
    }
    #start.start--gone { opacity: 0; pointer-events: none; }
    .start__card { width: 100%; max-width: 420px; background: var(--card); border-radius: 16px; padding: 28px 24px; box-sizing: border-box; box-shadow: 0 4px 20px rgba(0, 0, 0, .05); text-align: center; }
    .start__logo { width: 64px; height: 64px; margin: 0 auto 12px; }
    .start__card h1 { margin: 0; font-size: 22px; line-height: 1.3; }
    .start__lead { margin: 8px 0 20px; font-size: 14px; line-height: 1.6; color: var(--muted); }
    .start__status { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 28px; font-size: 14px; font-weight: 600; }
    .start__spinner { width: 20px; height: 20px; flex: none; border: 3px solid var(--line); border-top-color: var(--brand); border-radius: 50%; animation: start-spin .8s linear infinite; }
    .start__slow { margin: 10px 0 0; font-size: 13px; line-height: 1.6; color: var(--muted); }
    .start__fail { margin-top: 4px; padding: 16px; border: 1px solid var(--warn-line); border-radius: 12px; background: var(--warn-bg); color: var(--warn-ink); text-align: left; }
    .start__fail h2 { margin: 0 0 8px; font-size: 16px; }
    .start__fail p { margin: 0 0 12px; font-size: 13px; line-height: 1.6; }
    .start__retry { display: block; width: 100%; padding: 12px; border: 0; border-radius: 10px; background: var(--brand); color: #FFFFFF; font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
    .start__retry:focus-visible, .start__about a:focus-visible { outline: 3px solid #93C5FD; outline-offset: 2px; }
    .start__contact { margin: 12px 0 0 !important; color: var(--ink); word-break: break-all; }
    .start__contact a { color: var(--brand); }
    .start__about { margin: 20px 0 0; font-size: 13px; }
    .start__about a { color: var(--brand); }
    #start .start__slow, #start .start__fail { display: none; }
    #start[data-state="slow"] .start__slow { display: block; }
    #start[data-state="failed"] .start__status { display: none; }
    #start[data-state="failed"] .start__fail { display: block; }
    @keyframes start-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .start__spinner { animation-duration: 3s; } #start { transition: none; } }
  </style>
</head>
<body>
  <div id="start" data-state="loading">
    <main class="start__card">
      <svg class="start__logo" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <rect width="64" height="64" rx="12" fill="#0F4C81"/>
        <path d="M32 19 50 28 32 37 14 28Z" fill="#FFFFFF"/>
        <path d="M22 33v7c0 3 4.5 6 10 6s10-3 10-6v-7l-10 5Z" fill="#FFFFFF" opacity=".85"/>
      </svg>
      <h1>京大InfoHub</h1>
      <p class="start__lead">京大生専用の授業レビュー・過去問共有・教科書マーケット</p>
      <div class="start__status" role="status" aria-live="polite">
        <span class="start__spinner" aria-hidden="true"></span>
        <span>アプリを読み込んでいます…</span>
      </div>
      <p class="start__slow" role="status">通信環境によっては 30 秒ほどかかることがあります。このままお待ちください。</p>
      <div class="start__fail" role="alert">
        <h2>アプリを起動できませんでした</h2>
        <p>通信が不安定か、学内・社内などのネットワークで Google のサーバー（gstatic.com）への接続が制限されている可能性があります。電波の良い場所や別のネットワークで、もう一度お試しください。</p>
        <button id="start-retry" class="start__retry" type="button">再読み込み</button>
        <p class="start__contact"><!-- contact:begin -->解決しない場合は、アプリが開けるときに「マイページ → お問い合わせ」からご連絡ください。<!-- contact:end --></p>
      </div>
      <noscript><p class="start__lead">京大InfoHub を使うには JavaScript を有効にしてください。</p></noscript>
      <p class="start__about"><a href="about/">京大InfoHub について</a></p>
    </main>
  </div>

  <script>
    (function () {
      var start = document.getElementById('start');
      var done = false;
      var SLOW_MS = 8000;     // S-2: "this can take ~30 s" hint
      var FAIL_MS = 60000;    // S-2: no first frame by then = failure screen
      var slowTimer = setTimeout(function () {
        if (start.getAttribute('data-state') === 'loading') start.setAttribute('data-state', 'slow');
      }, SLOW_MS);
      var failTimer = setTimeout(function () { fail('timeout'); }, FAIL_MS);

      function fail(reason) {
        if (done || start.getAttribute('data-state') === 'failed') return;
        clearTimeout(slowTimer);
        clearTimeout(failTimer);
        start.setAttribute('data-state', 'failed');
        start.setAttribute('data-reason', reason);
        try { console.warn('[kyotohub] start-up failed: ' + reason); } catch (e) {}
        var retry = document.getElementById('start-retry');
        if (retry) retry.focus();
      }
      // Called by flutter_bootstrap.js (engine/loader errors), the <script>
      // onerror below, and lib/main.dart (Firebase did not initialise).
      window.kyotoHubBootFailed = function (reason) { fail(String(reason || 'unknown')); };

      // The first Flutter frame always wins, even after a failure was shown.
      window.addEventListener('flutter-first-frame', function () {
        done = true;
        clearTimeout(slowTimer);
        clearTimeout(failTimer);
        try {
          performance.mark('kyotohub-first-frame');
          console.info('[kyotohub] first frame ' + Math.round(performance.now()) + ' ms'); // R-1: local only
        } catch (e) {}
        start.classList.add('start--gone');
        setTimeout(function () { if (start.parentNode) start.parentNode.removeChild(start); }, 250);
      }, { once: true });

      document.getElementById('start-retry').addEventListener('click', function () { location.reload(); });
    })();
  </script>
  <script src="flutter_bootstrap.js" async onerror="window.kyotoHubBootFailed('bootstrap')"></script>
</body>
</html>
```

- [ ] **Step 4: Create `web/flutter_bootstrap.js`**

```js
{{flutter_js}}
{{flutter_build_config}}
// Plan 4 (Task 3): the stock loader call plus failure reporting. When the
// engine or the loader fails, index.html's start screen shows its failure state
// (retry button, contact text) instead of leaving a blank page. The service
// worker settings are the stock ones (Flutter's worker is a self-unregistering
// stub; keeping the call keeps the clean-up of any old registration).
_flutter.loader.load({
  serviceWorkerSettings: {
    serviceWorkerVersion: {{flutter_service_worker_version}},
  },
  onEntrypointLoaded: async function (engineInitializer) {
    try {
      const appRunner = await engineInitializer.initializeEngine();
      await appRunner.runApp();
    } catch (e) {
      if (window.kyotoHubBootFailed) window.kyotoHubBootFailed('engine');
      throw e;
    }
  },
}).catch(function (e) {
  if (window.kyotoHubBootFailed) window.kyotoHubBootFailed('loader');
  console.error(e);
});
```

- [ ] **Step 5: Create `tools/perf/check_start_screen.mjs`**

```js
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
  // 5. Without JavaScript: the brand, the description and the noscript text are still there.
  {
    const ctx = await newContext(browser, 'desktop', { javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(srv.origin + '/', { waitUntil: 'load' });
    check((await page.textContent('#start h1')) === '京大InfoHub', 'no JS: brand visible');
    check((await page.content()).includes('JavaScript を有効にしてください'), 'no JS: noscript text present');
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
```

- [ ] **Step 6: Run to verify it passes**

Run:
```bash
flutter test
flutter analyze
flutter build web --release --no-web-resources-cdn
node tools/perf/check_start_screen.mjs --sandbox-sdk
```
Expected: `flutter test` **188**; analyzer **21**; the build prints no template warning; `check_start_screen` prints 17 `ok` lines and "all start-screen checks passed" (≈ 2½ minutes: case 4 waits for the 60 s watchdog). Case 2 must report `reason firebase-timeout` (the blocked SDK makes `initializeApp` hang).

- [ ] **Step 7: Commit (now — before the next task)**

```bash
git add web/index.html web/flutter_bootstrap.js test/web/static_pages_test.dart tools/perf/check_start_screen.mjs
git commit -m "feat(web): branded start screen without JS, 8 s hint, failure screen with retry instead of a blank page, first-frame mark (Plan 4)"
```

---

### Task 4: Public pages — `/about/`, robots, sitemap, share image, manifest

**Files:**
- Create: `web/about/index.html`, `web/robots.txt`, `web/sitemap.xml`, `tools/perf/make_og_image.mjs`, `web/og-image.png` (generated)
- Modify: `web/manifest.json`, `test/web/static_pages_test.dart`, `tools/perf/check_start_screen.mjs`

**Interfaces:**
- Produces: `https://kyodai-info.web.app/about/` (static, canonical to itself, CTA `href="/"`), `/robots.txt`, `/sitemap.xml` (`/`, `/about/`), `/og-image.png` (1200×630, < 100 KB). The landing reads `/flutter_bootstrap.js` to prefetch (P-1); from Task 5 on it also reads `kyotoHubBuild`.

- [ ] **Step 1: Write the failing tests**

In `test/web/static_pages_test.dart`, replace:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
```

with:

```dart
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
```

and insert before the final closing `}` of `main()` (after the `flutter_bootstrap.js template keeps …` test):

```dart
  test('about/: static page with its own canonical, a link to the app and no app code', () {
    final about = read('web/about/index.html');
    expect(about, contains('<html lang="ja">'));
    expect(about, contains('<link rel="canonical" href="https://kyodai-info.web.app/about/">'));
    expect(about, contains('<a class="cta" href="/">'));
    expect(about.contains('<script src='), isFalse, reason: 'the landing must not start the app');
    expect(about, contains('c.saveData'), reason: 'P-1: no prefetch with Data Saver');
  });

  test('robots.txt and sitemap.xml list only public pages', () {
    expect(read('web/robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: https://kyodai-info.web.app/sitemap.xml\n');
    final locs = RegExp(r'<loc>([^<]+)</loc>').allMatches(read('web/sitemap.xml')).map((m) => m.group(1)).toList();
    expect(locs, ['https://kyodai-info.web.app/', 'https://kyodai-info.web.app/about/']);
  });

  test('og-image.png is a 1200x630 PNG under 100 KB', () {
    final bytes = File('web/og-image.png').readAsBytesSync();
    expect(bytes.length, lessThan(100 * 1024));
    expect(bytes.sublist(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
    final ihdr = ByteData.sublistView(Uint8List.fromList(bytes), 16, 24);
    expect([ihdr.getUint32(0), ihdr.getUint32(4)], [1200, 630]);
  });
```

In `tools/perf/check_start_screen.mjs`, in case 5, insert after the line `    check((await page.content()).includes('JavaScript を有効にしてください'), 'no JS: noscript text present');`:

```js
    await page.goto(srv.origin + '/about/', { waitUntil: 'load' });
    check((await page.textContent('h1')) === '京大InfoHub' && (await page.isVisible('a.cta')), 'no JS: /about/ is complete (heading + アプリを開く)');
```

- [ ] **Step 2: Run to verify it fails**

Run: `flutter test test/web/static_pages_test.dart`
Expected: FAIL — the 3 new tests (`web/about/index.html`, `web/robots.txt`, `web/og-image.png` not found); the 2 Task 3 tests still pass.

- [ ] **Step 3: Create the pages**

Create `web/about/index.html`:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0F4C81">
  <meta name="color-scheme" content="light">
  <title>京大InfoHub について — 京大生専用の授業レビュー・過去問共有・教科書マーケット</title>
  <meta name="description" content="京大InfoHub は京大生専用のアプリです。授業レビュー、過去問・資料の共有、教科書の譲り合い・売買ができます。@st.kyoto-u.ac.jp のメールアドレスで登録・認証した京大生だけが使えます。">
  <link rel="canonical" href="https://kyodai-info.web.app/about/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="京大InfoHub">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:url" content="https://kyodai-info.web.app/about/">
  <meta property="og:title" content="京大InfoHub — 京大生専用の授業レビュー・過去問共有・教科書マーケット">
  <meta property="og:description" content="授業レビュー、過去問・資料の共有、教科書の譲り合い・売買。京大のメールで認証した京大生だけが使えるアプリです。">
  <meta property="og:image" content="https://kyodai-info.web.app/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="京大InfoHub — 京大生専用の授業レビュー・過去問共有・教科書マーケット">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="京大InfoHub — 京大生専用の授業レビュー・過去問共有・教科書マーケット">
  <meta name="twitter:description" content="授業レビュー、過去問・資料の共有、教科書の譲り合い・売買。京大のメールで認証した京大生だけが使えるアプリです。">
  <meta name="twitter:image" content="https://kyodai-info.web.app/og-image.png">
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="apple-touch-icon" href="/icons/Icon-192.png">
  <style>
    :root { --brand: #0F4C81; --ink: #1E293B; --muted: #475569; --bg: #F8FAFC; --card: #FFFFFF; --line: #E2E8F0; }
    html { background: var(--bg); }
    body {
      margin: 0; color: var(--ink); background: var(--bg); line-height: 1.7;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, "Noto Sans JP", sans-serif;
    }
    .wrap { max-width: 720px; margin: 0 auto; padding: 0 16px; }
    header { padding: 40px 0 24px; text-align: center; }
    .logo { width: 56px; height: 56px; }
    h1 { margin: 8px 0 4px; font-size: 26px; line-height: 1.3; }
    .lead { margin: 0 auto 20px; max-width: 34em; color: var(--muted); font-size: 15px; }
    .cta { display: inline-block; padding: 14px 28px; border-radius: 12px; background: var(--brand); color: #FFFFFF; font-weight: 700; font-size: 16px; text-decoration: none; }
    .cta:focus-visible, a:focus-visible { outline: 3px solid #93C5FD; outline-offset: 2px; }
    .note { margin: 10px 0 0; font-size: 13px; color: var(--muted); }
    section { margin: 0 0 16px; padding: 20px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
    h2 { margin: 0 0 8px; font-size: 18px; }
    ul { margin: 0; padding-left: 1.2em; }
    li { margin: 4px 0; }
    p { margin: 0 0 8px; }
    a { color: var(--brand); }
    .contact { word-break: break-all; }
    footer { padding: 16px 0 40px; text-align: center; font-size: 13px; color: var(--muted); }
  </style>
</head>
<body>
  <header class="wrap">
    <svg class="logo" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="12" fill="#0F4C81"/>
      <path d="M32 19 50 28 32 37 14 28Z" fill="#FFFFFF"/>
      <path d="M22 33v7c0 3 4.5 6 10 6s10-3 10-6v-7l-10 5Z" fill="#FFFFFF" opacity=".85"/>
    </svg>
    <h1>京大InfoHub</h1>
    <p class="lead">京大生専用の授業レビュー・過去問共有・教科書マーケットです。京大生どうしで授業の情報を持ち寄り、使わなくなった教科書を譲り合えます。</p>
    <a class="cta" href="/">アプリを開く（ログイン・新規登録）</a>
    <p class="note">@st.kyoto-u.ac.jp のメールアドレスで登録できます。初回の読み込みには少し時間がかかります。</p>
  </header>

  <main class="wrap">
    <section>
      <h2>できること</h2>
      <ul>
        <li><strong>授業レビュー</strong> — 京大生の授業レビューを読んだり、自分で書いたりできます。閲覧・投稿はずっと無料です。</li>
        <li><strong>過去問・資料の共有</strong> — 過去問やテスト対策の資料を共有できます。ダウンロードは 1 件につき 1 クレジットで、メール認証を完了すると 3 クレジットがもらえます。クレジットは購入できません。</li>
        <li><strong>教科書マーケット</strong> — 使わなくなった教科書を譲ったり売ったり、欲しい本を「買いたい」で探せます。</li>
        <li><strong>時間割</strong> — 履修中の授業を登録して、授業ごとの情報にすぐたどり着けます。</li>
      </ul>
    </section>

    <section>
      <h2>京大生だけの場所です</h2>
      <p>登録には @st.kyoto-u.ac.jp のメールアドレスと、そのアドレスでのメール認証が必要です。レビュー・資料・出品は、認証した京大生にだけ表示されます。このページにも、利用者の投稿や個人情報は載せていません。</p>
    </section>

    <section>
      <h2>安心して使うために</h2>
      <ul>
        <li>アプリはお金を扱いません。教科書の代金は受け渡しのときに直接やりとりします。</li>
        <li>不適切な投稿や出品は通報でき、運営が確認します。</li>
        <li>担当教員・権利者の方へ: 掲載資料の削除依頼は、アプリのログイン画面にある「担当教員・権利者の方へ（掲載資料の削除依頼）」から、ログインせずに送れます。</li>
      </ul>
      <p class="contact"><!-- contact:begin -->お問い合わせは、アプリの「マイページ → お問い合わせ」からどうぞ。<!-- contact:end --></p>
    </section>
  </main>

  <footer class="wrap">
    <a href="/">アプリを開く</a> · 京大InfoHub
  </footer>

  <script>
    // P-1: while the visitor reads, fetch the app's two big downloads into the
    // HTTP cache (main.dart.js and the CanvasKit engine the loader will pick),
    // so "アプリを開く" starts faster. Skipped with Data Saver or on 2G. URLs
    // come from the deployed flutter_bootstrap.js, so they follow Flutter upgrades.
    (function () {
      var c = navigator.connection;
      if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return;
      function hint(href, cors) {
        var l = document.createElement('link');
        l.rel = 'prefetch';
        l.href = href;
        if (cors) l.crossOrigin = 'anonymous';
        document.head.appendChild(l);
      }
      function go() {
        fetch('/flutter_bootstrap.js').then(function (r) { return r.ok ? r.text() : ''; }).then(function (src) {
          var m = /_flutter\.buildConfig\s*=\s*(\{.*?\});/.exec(src);
          if (!m) return;
          var cfg = JSON.parse(m[1]);
          var js = (cfg.builds || []).filter(function (b) { return b.compileTarget === 'dart2js'; })[0];
          if (js && js.mainJsPath) hint('/' + js.mainJsPath, false);
          // Same choice as flutter.js: the "chromium" CanvasKit on Blink with
          // ImageDecoder + Intl.v8BreakIterator + Intl.Segmenter, else the full one.
          var blink = navigator.vendor === 'Google Inc.' || navigator.userAgent.indexOf('Edg/') >= 0;
          var chromium = blink && typeof ImageDecoder !== 'undefined' && typeof Intl.v8BreakIterator !== 'undefined' && typeof Intl.Segmenter !== 'undefined';
          var base = cfg.useLocalCanvasKit ? '/canvaskit/' : 'https://www.gstatic.com/flutter-canvaskit/' + cfg.engineRevision + '/';
          if (chromium) base += 'chromium/';
          hint(base + 'canvaskit.js', true);
          hint(base + 'canvaskit.wasm', true);
        }).catch(function () { /* prefetch is only a hint */ });
      }
      if (document.readyState === 'complete') setTimeout(go, 1000);
      else window.addEventListener('load', function () { setTimeout(go, 1000); });
    })();
  </script>
</body>
</html>
```

Create `web/robots.txt` (exactly these 4 lines, with a trailing newline):

```text
User-agent: *
Allow: /

Sitemap: https://kyodai-info.web.app/sitemap.xml
```

Create `web/sitemap.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- Only pages that anyone can read (Plan 4, Ruling L-2). Nothing behind the login is listed. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://kyodai-info.web.app/</loc></url>
  <url><loc>https://kyodai-info.web.app/about/</loc></url>
</urlset>
```

Replace `web/manifest.json` with:

```json
{
    "name": "京大InfoHub",
    "short_name": "京大InfoHub",
    "start_url": ".",
    "display": "standalone",
    "background_color": "#F8FAFC",
    "theme_color": "#0F4C81",
    "description": "京大生専用の授業レビュー・過去問共有・教科書マーケット「京大InfoHub」",
    "orientation": "portrait-primary",
    "prefer_related_applications": false,
    "icons": [
        {
            "src": "icons/Icon-192.png",
            "sizes": "192x192",
            "type": "image/png"
        },
        {
            "src": "icons/Icon-512.png",
            "sizes": "512x512",
            "type": "image/png"
        },
        {
            "src": "icons/Icon-maskable-192.png",
            "sizes": "192x192",
            "type": "image/png",
            "purpose": "maskable"
        },
        {
            "src": "icons/Icon-maskable-512.png",
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "maskable"
        }
    ]
}
```

- [ ] **Step 4: Create `tools/perf/make_og_image.mjs` and generate the image**

```js
#!/usr/bin/env node
// Renders the link-preview image web/og-image.png (1200x630) from the HTML
// below with headless Chromium (Plan 4, Task 5). Deterministic for a given
// Chromium build and font version: the only font is Noto Sans JP from Google
// Fonts, subset to exactly the characters used (no local font is involved), and
// the script refuses to write unless the font loaded. Re-run only to change the
// image; commit the PNG. Static marketing text only, no user content.
//   node make_og_image.mjs [--out ../../web/og-image.png]
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO } from './lib/hosting.mjs';
import { launch } from './lib/browser.mjs';

const { values: a } = parseArgs({ options: { out: { type: 'string', default: join(REPO, 'web', 'og-image.png') } } });

const TITLE = '京大InfoHub';
const LEAD = '京大生専用の授業レビュー・過去問共有・教科書マーケット';
const BADGE = '@st.kyoto-u.ac.jp で認証した京大生だけが使えます';
const HOST = 'kyodai-info.web.app';
const text = [...new Set([...(TITLE + LEAD + BADGE + HOST)])].join('');
const css = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@500;800&text=${encodeURIComponent(text)}&display=block`;

const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><link rel="stylesheet" href="${css}">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body { background: #0F4C81; color: #FFFFFF; font-family: 'Noto Sans JP'; position: relative; }
  .band { position: absolute; right: -160px; top: -120px; width: 620px; height: 900px; background: #135A97; transform: rotate(18deg); }
  .box { position: absolute; left: 88px; top: 96px; right: 88px; }
  .logo { width: 112px; height: 112px; }
  h1 { margin: 28px 0 0; font-size: 104px; font-weight: 800; line-height: 1.1; letter-spacing: 1px; }
  p { margin: 20px 0 0; font-size: 34px; font-weight: 500; line-height: 1.4; white-space: nowrap; }
  .badge { position: absolute; left: 88px; bottom: 72px; padding: 12px 24px; border-radius: 999px; background: #FFFFFF; color: #0F4C81; font-size: 28px; font-weight: 800; }
  .host { position: absolute; right: 88px; bottom: 82px; font-size: 28px; font-weight: 500; color: #CFE0F1; }
</style></head><body>
<div class="band"></div>
<div class="box">
  <svg class="logo" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#FFFFFF"/>
    <path d="M32 19 50 28 32 37 14 28Z" fill="#0F4C81"/><path d="M22 33v7c0 3 4.5 6 10 6s10-3 10-6v-7l-10 5Z" fill="#0F4C81" opacity=".85"/></svg>
  <h1>${TITLE}</h1>
  <p>${LEAD}</p>
</div>
<div class="badge">${BADGE}</div>
<div class="host">${HOST}</div>
</body></html>`;

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  const ok = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check("800 104px 'Noto Sans JP'", '京大') && document.fonts.check("500 34px 'Noto Sans JP'", '授業');
  });
  if (!ok) throw new Error('Noto Sans JP did not load (network?) — refusing to write an image with a fallback font');
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
  if (png.length > 100 * 1024) throw new Error(`og image is ${png.length} B (> 100 KB)`);
  writeFileSync(a.out, png);
  console.log(`wrote ${a.out}: ${png.length} B, sha256 ${createHash('sha256').update(png).digest('hex')}`);
} finally {
  await browser.close();
}
```

Run: `node tools/perf/make_og_image.mjs`
Expected: `wrote …/web/og-image.png: ~59 KB, sha256 …` (dry run: 59,118 B, sha256 `67ae04707b93189043864b381434119bfdcf2c4ae21ab83b7bb4b2f3f0e4b6db` with Chromium 141 and the Google Fonts subset of that day; another Chromium/font version gives other bytes — acceptable as long as the test passes). Open the PNG and check by eye: logo, 「京大InfoHub」, the one-line description on ONE line, the white badge and the host name, nothing overlapping. A run without network refuses to write ("Noto Sans JP did not load").

- [ ] **Step 5: Run to verify it passes**

Run:
```bash
flutter test
flutter analyze
flutter build web --release --no-web-resources-cdn
ls build/web/about/index.html build/web/robots.txt build/web/sitemap.xml build/web/og-image.png
node tools/perf/check_start_screen.mjs --sandbox-sdk
```
Expected: `flutter test` **191**; analyzer **21**; the four files are in `build/web`; `check_start_screen` 17 `ok`, all passed.

- [ ] **Step 6: Commit (now — before the next task)**

```bash
git add web/about/index.html web/robots.txt web/sitemap.xml web/og-image.png web/manifest.json tools/perf/make_og_image.mjs test/web/static_pages_test.dart tools/perf/check_start_screen.mjs
git commit -m "feat(web): public /about/ landing with prefetch, robots.txt, sitemap.xml, 1200x630 share image, manifest name/colours (Plan 4)"
```

---

### Task 5: No stale code after a deploy — headers, per-build URL, asset refresh, `check_web_cache.mjs`

**Files:**
- Modify: `firebase.json` (`hosting.headers` only), `web/flutter_bootstrap.js` (replaced), `web/about/index.html` (prefetch URL), `test/web/static_pages_test.dart`
- Create: `tools/perf/check_web_cache.mjs`

**Interfaces:**
- Produces: `headerProblems(table) → string[]`, `bootstrapProblems(src) → string[]`; CLI `node tools/perf/check_web_cache.mjs [--dir] [--firebase-json]` and `--returning-user --v1 <dir> --v2 <dir> [--v1-firebase-json] [--sandbox-sdk]`; `var kyotoHubBuild` in the built bootstrap; `localStorage['kyotohub.build']`.

- [ ] **Step 1: Write the failing checks**

In `test/web/static_pages_test.dart`, replace:

```dart
import 'dart:io';
```

with:

```dart
import 'dart:convert';
import 'dart:io';
```

replace the whole test `flutter_bootstrap.js template keeps the stock tokens and reports failures` (from `  test('flutter_bootstrap.js template keeps` through its closing `  });`) with:

```dart
  test('flutter_bootstrap.js template: stock tokens, per-build URL, asset refresh, failure reports', () {
    final boot = read('web/flutter_bootstrap.js');
    expect(boot, startsWith('{{flutter_js}}\n{{flutter_build_config}}\n'));
    expect(boot, contains('var kyotoHubBuild = {{flutter_service_worker_version}};'));
    expect(boot, contains("b.mainJsPath += '?v=' + encodeURIComponent(build);"), reason: 'C-2: a new URL per build');
    expect(boot, contains("fetch(path, { cache: 'no-cache' })"), reason: 'C-2: refresh assets cached as immutable');
    expect(boot, contains("window.kyotoHubBootFailed('engine')"));
    expect(boot, contains("window.kyotoHubBootFailed('loader')"));
  });
```

and insert before the final closing `}` of `main()`:

```dart
  test('C-1: firebase.json revalidates everything except images; nothing is immutable', () {
    final hosting = (jsonDecode(read('firebase.json')) as Map<String, dynamic>)['hosting'] as Map<String, dynamic>;
    final rules = {
      for (final h in (hosting['headers'] as List).cast<Map<String, dynamic>>())
        h['source'] as String: {
          for (final kv in (h['headers'] as List).cast<Map<String, dynamic>>()) kv['key']: kv['value'],
        },
    };
    expect(rules, {
      '**': {'Cache-Control': 'no-cache'},
      '**/*.png': {'Cache-Control': 'public, max-age=86400'},
    });
    expect(read('firebase.json').contains('immutable'), isFalse);
  });
```

Create `tools/perf/check_web_cache.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify they fail (and that the risk is real)**

Run:
```bash
flutter test test/web/static_pages_test.dart
flutter build web --release --no-web-resources-cdn
node tools/perf/check_web_cache.mjs
```
Expected: `flutter test` FAILS the 2 changed/new tests (bootstrap has no `kyotoHubBuild`; `firebase.json` still has `immutable`). `check_web_cache` exits 1 with 41 `FAIL` lines (dry run): 37 `immutable` (`/main.dart.js`, every `/assets/…` and `/canvaskit/…`, PNGs, `/flutter.js`, `/manifest.json`, `/about`, `/about/`, `/robots.txt`, `/sitemap.xml`, `/no/such/deep/path`, …), `/` and `/about/index.html` without `Cache-Control`, and the two `flutter_bootstrap.js` problems.

Optional, the browser proof (≈ 3 min; needs a second build whose `main.dart.js` differs — e.g. a copy of the tree with the `MaterialApp` `title` edited, built the same way):
`node tools/perf/check_web_cache.mjs --returning-user --v1 build/web --v2 <copy>/build/web --sandbox-sdk` → `STALE: a returning visitor kept /main.dart.js from v1` (exit 1).

- [ ] **Step 3: Change the headers in `firebase.json`**

Replace:

```json
    "headers": [
      {
        "source": "**/!(index.html|flutter_bootstrap.js|flutter_service_worker.js)",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "max-age=31536000, immutable"
          }
        ]
      },
      {
        "source": "@(index.html|flutter_bootstrap.js|flutter_service_worker.js)",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "max-age=0, no-cache, no-store, must-revalidate"
          }
        ]
      }
    ],
```

with:

```json
    "headers": [
      {
        "source": "**",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "no-cache"
          }
        ]
      },
      {
        "source": "**/*.png",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "public, max-age=86400"
          }
        ]
      }
    ],
```

- [ ] **Step 4: Replace `web/flutter_bootstrap.js`**

```js
{{flutter_js}}
{{flutter_build_config}}
// Plan 4 (Tasks 2 and 3): the stock loader call plus
//  - failure reporting: when the engine or the loader fails, index.html's start
//    screen shows its failure state instead of a blank page;
//  - C-2, no stale code after a deploy: every build gets a new id (Flutter puts
//    a fresh random number into the service-worker token on each build).
//    main.dart.js is loaded as main.dart.js?v=<id>, and when the id differs
//    from the one this browser last started, the Flutter asset files (manifests
//    and the tree-shaken icon fonts) are re-downloaded once with
//    cache: 'no-cache' (revalidation ignores a copy cached as immutable; verified in Chromium). Both escape copies that older deploys cached as
//    "immutable" for a year, which no header change can reach.
// The service-worker settings are the stock ones (Flutter's worker is a
// self-unregistering stub; keeping the call keeps the clean-up of an old one).
var kyotoHubBuild = {{flutter_service_worker_version}};
var REFRESH_MS = 5000;
(function () {
  var build = String(kyotoHubBuild);
  _flutter.buildConfig.builds.forEach(function (b) {
    if (b.mainJsPath) b.mainJsPath += '?v=' + encodeURIComponent(build);
  });
  var KEY = 'kyotohub.build';
  var seen = null;
  try { seen = window.localStorage.getItem(KEY); } catch (e) { /* storage blocked: refresh every time */ }
  var refreshed = Promise.resolve();
  if (seen !== build) {
    var reload = function (path) { return fetch(path, { cache: 'no-cache' }); };
    refreshed = Promise.all([reload('assets/AssetManifest.bin.json'), reload('assets/AssetManifest.bin'), reload('assets/FontManifest.json')])
      .then(function (r) { return r[2].ok ? r[2].json() : []; })
      .then(function (families) {
        var files = [];
        (families || []).forEach(function (f) { (f.fonts || []).forEach(function (x) { if (x.asset) files.push(reload('assets/' + x.asset)); }); });
        // The framework's own shaders are not in the manifests.
        ['assets/shaders/ink_sparkle.frag', 'assets/shaders/stretch_effect.frag'].forEach(function (p) { files.push(reload(p).catch(function () {})); });
        return Promise.all(files);
      })
      .then(function () { try { window.localStorage.setItem(KEY, build); } catch (e) {} })
      .catch(function () { /* best effort: the engine still loads the files itself */ });
  }
  _flutter.loader.load({
    serviceWorkerSettings: {
      serviceWorkerVersion: kyotoHubBuild,
    },
    onEntrypointLoaded: async function (engineInitializer) {
      try {
        // Never let a stalled refresh hold the engine back: wait at most REFRESH_MS.
        await Promise.race([refreshed, new Promise(function (r) { setTimeout(r, REFRESH_MS); })]);
        const appRunner = await engineInitializer.initializeEngine();
        await appRunner.runApp();
      } catch (e) {
        if (window.kyotoHubBootFailed) window.kyotoHubBootFailed('engine');
        throw e;
      }
    },
  }).catch(function (e) {
    if (window.kyotoHubBootFailed) window.kyotoHubBootFailed('loader');
    console.error(e);
  });
})();
```

- [ ] **Step 5: Prefetch the versioned URL from `/about/`**

In `web/about/index.html`, replace:

```js
          var cfg = JSON.parse(m[1]);
          var js = (cfg.builds || []).filter(function (b) { return b.compileTarget === 'dart2js'; })[0];
          if (js && js.mainJsPath) hint('/' + js.mainJsPath, false);
```

with:

```js
          var cfg = JSON.parse(m[1]);
          var id = /kyotoHubBuild = "([^"]*)"/.exec(src); // C-2: the app loads main.dart.js?v=<build id>
          var js = (cfg.builds || []).filter(function (b) { return b.compileTarget === 'dart2js'; })[0];
          if (js && js.mainJsPath) hint('/' + js.mainJsPath + (id ? '?v=' + encodeURIComponent(id[1]) : ''), false);
```

- [ ] **Step 6: Run to verify it passes**

Run:
```bash
flutter test
flutter analyze
flutter build web --release --no-web-resources-cdn
node tools/perf/check_web_cache.mjs
node tools/perf/check_start_screen.mjs --sandbox-sdk
```
Expected: `flutter test` **192**; analyzer **21**; `check_web_cache`: `OK: every response revalidates (images: at most a day), routes answer the right files` (exit 0); `check_start_screen` all passed.

Returning-user proof across the header change (≈ 4 min). Make an "old deploy" stand-in from the commit before Task 3 with one icon changed so its tree-shaken icon font differs:
```bash
P=$(git log --format=%h -1 -- lib/startup/startup.dart)   # Task 2's commit: old index.html, stock bootstrap
mkdir -p /tmp/p4old && git archive $P | tar -x -C /tmp/p4old
sed -i 's/Icons.school_rounded,/Icons.local_library_rounded,/' /tmp/p4old/lib/views/auth/signup_screen.dart
(cd /tmp/p4old && flutter pub get >/dev/null && flutter build web --release --no-web-resources-cdn)
git show $P:firebase.json > /tmp/p4old/firebase.old.json
node tools/perf/check_web_cache.mjs --returning-user --v1 /tmp/p4old/build/web --v1-firebase-json /tmp/p4old/firebase.old.json --v2 build/web --sandbox-sdk
rm -rf /tmp/p4old
```
Expected: `files used by v1 that changed in v2: /assets/fonts/MaterialIcons-Regular.otf, /flutter_bootstrap.js, /main.dart.js`, each `fetched (200…)` and `OK: every changed file was fetched again after the deploy` (exit 0). (Dry run, same commands with the CURRENT bootstrap and only the new headers: `STALE … MaterialIcons-Regular.otf, /main.dart.js` — that is why C-2 exists.)

- [ ] **Step 7: Commit (now — before the next task)**

```bash
git add firebase.json web/flutter_bootstrap.js web/about/index.html test/web/static_pages_test.dart tools/perf/check_web_cache.mjs
git commit -m "fix(hosting): no stale code after a deploy — revalidate everything, main.dart.js?v=<build>, one-time asset refresh, check_web_cache.mjs (Plan 4)"
```

---

### Task 6: Japanese fallback fonts (F-1)

**Files:**
- Modify: `web/index.html`, `test/web/static_pages_test.dart`, `tools/perf/check_start_screen.mjs`

- [ ] **Step 1: Write the failing checks**

In `test/web/static_pages_test.dart`, insert before the final closing `}` of `main()`:

```dart
  test('F-1: the page reports "ja" to the fallback-font picker, before the bootstrap', () {
    final i = index.indexOf("Object.defineProperty(navigator, 'language', { configurable: true, get: function () { return 'ja'; } });");
    expect(i, greaterThan(0));
    expect(i, lessThan(index.indexOf('<script src="flutter_bootstrap.js"')));
    expect(index.contains("defineProperty(navigator, 'languages'"), isFalse, reason: 'the app locale source stays untouched');
  });
```

In `tools/perf/check_start_screen.mjs`, case 1: insert after `    const page = await ctx.newPage();` (the FIRST occurrence, in case 1):

```js
    const fonts = new Set();
    page.on('request', (r) => { const m = /fonts\.gstatic\.com\/s\/([a-z0-9]+)\//.exec(r.url()); if (m) fonts.add(m[1]); });
```

and insert after the line `    check(await page.evaluate(() => performance.getEntriesByName('kyotohub-first-frame').length === 1), 'performance mark kyotohub-first-frame exists (R-1)');`:

```js
    check(await page.evaluate(() => navigator.language === 'ja'), 'F-1: navigator.language reads "ja" for the font picker');
    await page.waitForTimeout(4000);
    check(fonts.size > 0 && [...fonts].every((f) => f === 'notosansjp' || f === 'roboto'), `F-1: only Noto Sans JP / Roboto fallback fonts (${[...fonts].join(', ')})`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `flutter test test/web/static_pages_test.dart`, then `flutter build web --release --no-web-resources-cdn` and `node tools/perf/check_start_screen.mjs --sandbox-sdk`
Expected: the F-1 test FAILS (no `defineProperty`); `check_start_screen` FAILS `navigator.language reads "ja"` and `only Noto Sans JP / Roboto fallback fonts (roboto, notosanssc, notosanshk, notosansjp)` (the tool's contexts use locale `ja-JP`).

- [ ] **Step 3: Add the override to `web/index.html`**

Insert directly after the line `    (function () {` of the inline start-screen script (before `      var start = document.getElementById('start');`):

```js
      // F-1: Flutter's fallback-font picker prefers Noto Sans JP only when
      // navigator.language is exactly "ja"; "ja-JP" (typical on Android/iOS) or
      // any other value made it download Chinese (SC/HK) subsets instead. The UI
      // is Japanese for everyone, so the page reports "ja". navigator.languages,
      // from which Flutter takes the app locale, is not touched.
      try {
        Object.defineProperty(navigator, 'language', { configurable: true, get: function () { return 'ja'; } });
      } catch (e) { /* older browsers: keep the browser's value */ }

```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
flutter test
flutter analyze
flutter build web --release --no-web-resources-cdn
node tools/perf/check_start_screen.mjs --sandbox-sdk
node tools/perf/check_web_cache.mjs
```
Expected: `flutter test` **193**; analyzer **21**; `check_start_screen` 20 `ok` lines, all passed (fonts `roboto, notosansjp`); `check_web_cache` OK.

- [ ] **Step 5: Commit (now — before the next task)**

```bash
git add web/index.html test/web/static_pages_test.dart tools/perf/check_start_screen.mjs
git commit -m "perf(web): report navigator.language 'ja' to Flutter's font picker — Japanese fallback subsets only, -32% font bytes (Plan 4)"
```

---

### Task 7: One source for the contact address on the static pages (C-3)

**Files:**
- Create: `tools/sync_web_contact.mjs`
- Modify: `test/web/static_pages_test.dart`

**Interfaces:**
- Produces: `readContactEmail(dartSource) → string` (throws on a non-address), `contactBlock(page, email) → string`; CLI `node tools/sync_web_contact.mjs [--check]`.
- Consumes: `kOperatorContactEmail` (`lib/config/contact.dart`, unchanged, empty).

- [ ] **Step 1: Write the failing test**

In `test/web/static_pages_test.dart`, replace:

```dart
import 'package:flutter_test/flutter_test.dart';
```

with:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/config/contact.dart';
```

and insert before the final closing `}` of `main()`:

```dart
  test('C-3: the static pages show exactly the address in kOperatorContactEmail (or none)', () {
    for (final page in ['web/index.html', 'web/about/index.html']) {
      final m = RegExp(r'<!-- contact:begin -->([\s\S]*?)<!-- contact:end -->').firstMatch(read(page));
      expect(m, isNotNull, reason: '$page: contact markers missing');
      final block = m!.group(1)!;
      if (kOperatorContactEmail.isEmpty) {
        expect(block.contains('@'), isFalse, reason: '$page shows an address although the constant is empty');
      } else {
        expect(block, contains('mailto:$kOperatorContactEmail'), reason: '$page is out of date: node tools/sync_web_contact.mjs');
      }
    }
  });
```

- [ ] **Step 2: Run the test, then prove it catches drift**

Run: `flutter test test/web/static_pages_test.dart` → PASS (8 tests; the constant is empty and no page shows an address).
Mutation (do not commit): set `const String kOperatorContactEmail = 'ops@example.com';` in `lib/config/contact.dart` → the C-3 test FAILS for both pages ("is out of date"). Keep the mutation for Step 4.

- [ ] **Step 3: Create `tools/sync_web_contact.mjs`**

```js
#!/usr/bin/env node
// Copies the operator contact address from its ONE source of truth,
// lib/config/contact.dart (kOperatorContactEmail), into the static web pages
// (web/index.html start screen, web/about/index.html), between the markers
// <!-- contact:begin --> and <!-- contact:end --> (Plan 4, Ruling C-3).
// Empty constant -> the fallback text (no address is ever invented).
// `--check` changes nothing and exits 1 when a page is out of date;
// test/web/static_pages_test.dart runs the same check inside `flutter test`.
//   node tools/sync_web_contact.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = {
  'web/index.html': {
    withEmail: (e) => `解決しない場合は、こちらのメールからご連絡ください: <a href="mailto:${e}">${e}</a>`,
    fallback: '解決しない場合は、アプリが開けるときに「マイページ → お問い合わせ」からご連絡ください。',
  },
  'web/about/index.html': {
    withEmail: (e) => `お問い合わせ: <a href="mailto:${e}">${e}</a>`,
    fallback: 'お問い合わせは、アプリの「マイページ → お問い合わせ」からどうぞ。',
  },
};
const BLOCK = /<!-- contact:begin -->[\s\S]*?<!-- contact:end -->/;

export function readContactEmail(dartSource) {
  const m = /const String kOperatorContactEmail\s*=\s*'([^']*)';/.exec(dartSource);
  if (!m) throw new Error('kOperatorContactEmail not found in lib/config/contact.dart');
  const email = m[1].trim();
  if (email !== '' && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
    throw new Error(`kOperatorContactEmail is not a plain e-mail address: ${JSON.stringify(email)}`);
  }
  return email;
}

export function contactBlock(page, email) {
  const t = PAGES[page];
  return `<!-- contact:begin -->${email ? t.withEmail(email) : t.fallback}<!-- contact:end -->`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const check = process.argv.includes('--check');
  const email = readContactEmail(readFileSync(join(ROOT, 'lib/config/contact.dart'), 'utf8'));
  let stale = 0;
  for (const page of Object.keys(PAGES)) {
    const p = join(ROOT, page);
    const html = readFileSync(p, 'utf8');
    if (!BLOCK.test(html)) throw new Error(`${page}: contact markers missing`);
    const next = html.replace(BLOCK, contactBlock(page, email));
    if (next === html) { console.log(`${page}: up to date`); continue; }
    if (check) { console.log(`${page}: OUT OF DATE (run node tools/sync_web_contact.mjs)`); stale++; continue; }
    writeFileSync(p, next);
    console.log(`${page}: updated (${email ? email : 'no address: fallback text'})`);
  }
  process.exit(stale ? 1 : 0);
}
```

- [ ] **Step 4: Run to verify it passes**

Run (still with the mutated constant):
```bash
node tools/sync_web_contact.mjs --check      # exit 1: both pages OUT OF DATE
node tools/sync_web_contact.mjs              # both pages updated (ops@example.com)
flutter test test/web/static_pages_test.dart # PASS
git checkout lib/config/contact.dart web/index.html web/about/index.html
node tools/sync_web_contact.mjs --check      # exit 0: both pages up to date
```
Then: `flutter test` → **194**; `flutter analyze` → **21**. Also: `const String kOperatorContactEmail = 'x"><script>';` → `node tools/sync_web_contact.mjs` stops with the error `kOperatorContactEmail is not a plain e-mail address` (exit 1) and writes nothing (revert afterwards).

- [ ] **Step 5: Commit (now — before the next task)**

```bash
git add tools/sync_web_contact.mjs test/web/static_pages_test.dart
git commit -m "feat(tools): sync_web_contact.mjs — kOperatorContactEmail is the one source for the static pages; flutter test fails on drift (Plan 4)"
```

---

### Task 8: Documentation, full verification and the AFTER numbers

**Files:**
- Modify: `tools/README.md` (append a section)

- [ ] **Step 1: Append to `tools/README.md`**

Append at the end of the file:

```markdown
## web performance and cache checks (Plan 4)

Lab tooling under `tools/perf/` (its own `package.json`: Lighthouse 13.5.0,
playwright-core 1.56.1, chrome-launcher 1.2.2, and the `firebase` 12.19.0 npm
package used ONLY as the sandbox stand-in for the SDK on www.gstatic.com).
Nothing here deploys, reads credentials or talks to production. Install once:
`npm --prefix tools/perf install`. Every tool asks the **Firebase Hosting
emulator** (`firebase emulators:exec --only hosting --project demo-perf`, a
temporary `firebase.json` next to the build) how this repo's `firebase.json`
serves a build, so header and rewrite rules are interpreted by firebase-tools
itself.

- `node tools/perf/check_web_cache.mjs [--dir build/web]` — **run before every
  hosting deploy.** Exit 1 if any response is `immutable`, cacheable for more
  than a day (`*.png`) or not revalidated (everything else must be `no-cache`),
  if `/`, a deep link, `/about/`, `/robots.txt` or `/sitemap.xml` is answered
  by the wrong file, or if the built `flutter_bootstrap.js` lacks the per-build
  id / `main.dart.js?v=<id>`.
- `node tools/perf/check_web_cache.mjs --returning-user --v1 <build A> --v2 <build B>
  [--v1-firebase-json <old firebase.json>]` — a real returning visitor in
  Chromium: load A, "deploy" B on the same origin, open the app again; exit 1 if
  a file that changed between A and B was taken from the browser cache.
- `node tools/perf/check_start_screen.mjs [--dir build/web]` — the start screen
  and the failure paths in Chromium (Firebase SDK blocked, bootstrap missing,
  `main.dart.js` never arriving, JavaScript off).
- `node tools/perf/measure_web.mjs [--dir build/web] [--build "<flutter args>"]
  [--runs 3] [--profiles mobile,desktop] [--lighthouse] [--landing /about/
  --dwell 15000] [--out results.json]` — median (min–max) of N runs: time to the
  **first Flutter frame** (the engine's `flutter-first-frame` event; Lighthouse
  cannot see the canvas and times the HTML start screen as FCP/LCP), FCP,
  transfer, requests and fallback fonts, cold and warm, with applied throttling
  (mobile: 562.5 ms latency, 1.47 Mbps down, CPU ×4 — Lighthouse's "devtools"
  numbers; desktop: 40 ms, 10 Mbps, CPU ×1); optionally 3 Lighthouse runs per
  profile and a landing → dwell → app run. The server precompresses (brotli 11 /
  gzip 9) and answers `If-None-Match` with 304, which the emulator does not.
- `node tools/perf/make_og_image.mjs` — regenerates `web/og-image.png`
  (1200×630, < 100 KB) from the HTML in the script; needs network for the
  Google Fonts subset of Noto Sans JP and refuses to write without it.

**These are lab values.** 127.0.0.1 over HTTP/1.1 instead of Firebase's CDN
(HTTP/2/3, edge in Japan), emulated bandwidth/latency, CPU ×4 relative to the
host (not a calibrated phone), Chromium only (no Safari/iOS), signed-out cold
start only. Compare before/after on the same machine; do not read the absolute
numbers as what students experience.

**Sandbox (Claude Code cloud) only:** www.gstatic.com is denied there, so build
with `--no-web-resources-cdn` (CanvasKit served locally) and pass
`--sandbox-sdk` (the Firebase JS SDK is served same-origin from
`tools/perf/node_modules/firebase` and the URL in `main.dart.js` is rewritten);
Chromium must trust the egress proxy's CA: create an NSS db once and point
`CHROME_HOME` at it (`apt-get download libnss3-tools; dpkg -x libnss3-tools*.deb x;
mkdir -p $H/.pki/nssdb; x/usr/bin/certutil -N -d sql:$H/.pki/nssdb --empty-password;
x/usr/bin/certutil -A -n agent-proxy -t "C,," -i /root/.ccr/agent-proxy-ca.crt -d sql:$H/.pki/nssdb`,
then `CHROME_HOME=$H`). Chromium defaults to `/opt/pw-browsers/chromium-1194`
when it exists; elsewhere set `CHROME_PATH` to a Chrome/Chromium binary. On the
user's machine none of this is needed (and the production build keeps the CDN).

**Contact address on the static pages:** `node tools/sync_web_contact.mjs`
copies `kOperatorContactEmail` (lib/config/contact.dart, the one source) into
`web/index.html` and `web/about/index.html`; `--check` only reports.
`flutter test` (test/web/static_pages_test.dart) fails while they disagree.
```

- [ ] **Step 2: Full verification**

Run:
```bash
bash tools/test_functions.sh ; bash tools/test_rules.sh ; bash tools/test_storage_rules.sh
flutter analyze ; flutter test
flutter build web --release --no-web-resources-cdn
node tools/sync_web_contact.mjs --check
node tools/perf/check_web_cache.mjs
node tools/perf/check_start_screen.mjs --sandbox-sdk
node tools/perf/measure_web.mjs --runs 3 --lighthouse --sandbox-sdk --landing /about/ --dwell 15000 --label after --out /tmp/perf-after.json
node tools/perf/measure_web.mjs --path /about/ --static --runs 3 --lighthouse --sandbox-sdk --label landing
```
Expected: functions **220**, rules **138**, storage rules **9** (unchanged); analyzer **21**; `flutter test` **194**; contact check exit 0; cache check OK; start-screen checks all passed; the measurement meets every "target" row of the acceptance table in Dry-run results (lab). Finally `flutter build web --release` (the production build, CDN on) must also succeed — it cannot be loaded in the sandbox (gstatic denied), which is expected.

- [ ] **Step 3: Commit (now)**

```bash
git add tools/README.md
git commit -m "docs(tools): web performance and cache checks (Plan 4)"
```

---

## Deploy (Plan 4 — rides on the 2A + 2B + 3 runbook; do NOT improvise)

**This section extends, and does not replace, the Deploy section of `2026-10-05-phase3-textbook-market.md`** (the combined 2A + 2B + 3 runbook, itself superseding 2A's and 2B's). None of 2A, 2B, 3 or 4 is deployed. Plan 4 has **no** Functions, rules, indexes, Storage or data steps; it ships entirely in the combined runbook's **step 6** (`firebase deploy --only hosting` also deploys `firebase.json`'s `hosting.headers`). **Nothing here is run from the implementation environment.** The USER runs every step on their own machine (PowerShell 5.1: one line per command, `;` chains). Plan 4's checks need Node 22 and the firebase CLI the runbook already uses (the Hosting emulator needs no Java and no login).

**Implemented subset (read first).** Only **Tasks 1–5** are implemented. **Tasks 6–8 are deferred** (pending the Next.js spike decision): no Japanese-font override (F-1), **no `tools/sync_web_contact.mjs`** (C-3) and no contact-address mirroring, no docs/AFTER-numbers task. Consequences for this runbook: the static pages (`web/index.html` failure screen, `web/about/index.html`) show the fallback text 「マイページ → お問い合わせ」 **even after `kOperatorContactEmail` is set**; nothing in `flutter test` checks that they agree with the constant. Expected counts for the implemented subset: `flutter test` **192**, `flutter analyze` **21**, functions 220 / rules 138 / storage rules 9 unchanged. Steps marked "only when Task N is implemented" are skipped until then.

**Order (recommended, A): implement Plan 4 before the combined deploy, then run the combined runbook with these additions.** Never deploy a Plan 4 hosting build before the combined runbook's steps 1–5b: the build contains the 2A/2B/3 client.

```
PRE (additions, in this order — the rest of PRE unchanged):
     a) ONLY WHEN TASK 7 IS IMPLEMENTED (it is NOT in the implemented subset: tools/sync_web_contact.mjs does not exist yet — skip this item):
        after setting kOperatorContactEmail in lib/config/contact.dart, `node tools/sync_web_contact.mjs` copies the address into
        web/index.html and web/about/index.html. Until then those pages keep the fallback text 「マイページ → お問い合わせ」
        whatever kOperatorContactEmail says.
     b) The existing `flutter build web --release` (production build, CanvasKit from the CDN).
     c) HARD GATE — the stale-code check on the BUILT output (needs Node 22 + the firebase CLI; starts the Hosting emulator locally):
        npm --prefix tools/perf ci ; node tools/perf/check_web_cache.mjs
        # must print "OK: every response revalidates ..." and exit 0. DO NOT DEPLOY HOSTING if it fails, for any reason.
        # It fails (by design) when: build/web/flutter_bootstrap.js has no numeric build id — i.e. the {{flutter_service_worker_version}}
        # token was not substituted, came out null, or is still a literal {{...}} (a build with --pwa-strategy=none, or a future Flutter
        # that dropped the token; without the id the per-build URL and the one-time asset refresh silently do nothing and returning
        # visitors can run stale code); when main.dart.js is not loaded as ?v=<id>; when any response is `immutable`/cached > 1 day
        # (images) or lacks Cache-Control; and when /, deep paths, /about/, /robots.txt (text/plain) or /sitemap.xml (xml) are
        # answered by the wrong file or type.
     d) Expected suite counts for the implemented subset (Tasks 1–5): flutter test 192 (was 181), functions 220, rules 138,
        storage rules 9, flutter analyze 21 issues unchanged. (194 only after Tasks 6–8.)
     e) BEFORE the deploy, read-only: confirm production's service worker is Flutter's self-unregistering stub:
        curl.exe -s https://kyodai-info.web.app/flutter_service_worker.js | findstr unregister
        # expect at least one line. If NOTHING is printed, production still serves an old CACHING service worker: such a worker
        # serves main.dart.js from its own cache, so returning visitors would keep the old code and (because the localStorage flag
        # is then set by the refresh against a stale cache) skip a useful refresh. Do not rely on Plan 4 alone: stop, tell the owner,
        # and either (1) first deploy a hosting release whose flutter_service_worker.js is the stub (a current Flutter build of this repo is: its `build/web/flutter_service_worker.js` only unregisters itself)
        # and wait a day, or (2) after the deploy have testers clear the site data (Chrome: lock icon -> Site settings -> Delete data;
        # unregisters the worker). Plan 4 changes neither the worker file nor its scope.

6. (unchanged command)  firebase deploy --only hosting --project kyodai-sns
   # Plan 4 rides on this deploy: start screen, /about/, robots.txt, sitemap.xml, og-image.png, new Cache-Control headers.

6b. (4) USER (PowerShell), right after step 6 — check what production actually sends (read-only, one line each):
   curl.exe -sI https://kyodai-info.web.app/main.dart.js
   # expect "cache-control: no-cache" and an "etag" line (NOT "immutable").
   curl.exe -sI https://kyodai-info.web.app/
   # expect "cache-control: no-cache".
   curl.exe -s -o NUL -w "%{http_code} %{content_type}\n" https://kyodai-info.web.app/robots.txt
   # expect "200 text/plain; charset=utf-8" (before Plan 4 this was the app's HTML).
   curl.exe -s -o NUL -w "%{http_code} %{content_type}\n" https://kyodai-info.web.app/sitemap.xml
   # expect 200 and an XML content type.
   curl.exe -sI https://kyodai-info.web.app/og-image.png
   # expect 200, image/png, "cache-control: public, max-age=86400".
   curl.exe -s -o NUL -w "%{http_code} %{redirect_url}\n" https://kyodai-info.web.app/about
   # expect "301 https://kyodai-info.web.app/about/" (or 200).
   curl.exe -sI -H "Accept-Encoding: br" https://kyodai-info.web.app/main.dart.js
   # note content-encoding (br or gzip) — the lab assumed brotli; production compression was never verified.
   curl.exe -sI https://kyodai-info.web.app/flutter_bootstrap.js
   # expect "cache-control: no-cache" (and 200) — the file that carries the per-build id must never be cached.
   curl.exe -sI -H 'If-None-Match: \"<the etag value from the first command, WITHOUT its surrounding quotes>\"' https://kyodai-info.web.app/main.dart.js
   # PowerShell 5.1 drops unescaped double quotes when it starts a native program, so the header is single-quoted for
   # PowerShell and each literal quote is written \" for curl.exe's command-line parser. Example for etag "abc123":
   #   curl.exe -sI -H 'If-None-Match: \"abc123\"' https://kyodai-info.web.app/main.dart.js
   # expect "HTTP/1.1 304" or "HTTP/2 304" — this is what keeps repeat visits cheap under no-cache (not verifiable in the lab).
   # UNTESTED in PowerShell: curl.exe/PowerShell are not available in the implementation environment; the quoting is reasoned from
   # PowerShell 5.1's documented argument-passing behaviour. If you get 200 instead of 304, run the same request with a
   # header file instead: write `If-None-Match: "abc123"` into h.txt and use `curl.exe -sI -H @h.txt <url>`.

8. (unchanged) Tell testers to reload the app TWICE.
   # Plan 4 note (requires the service-worker stub confirmed in PRE e): with Plan 4 one normal reload is enough, and returning visitors whose browsers still hold the OLD
   # main.dart.js / icon font (cached as "immutable" by today's production headers) get the new ones on their first
   # visit (C-2). WITHOUT Plan 4, the dry run measured that two reloads still run the old code under today's headers:
   # testers would have to clear the site data (Chrome: lock icon -> Site settings -> Delete data).
```

**Order B (only if Plan 4 is implemented after the combined deploy is live):** PRE a)–d) as above, then `flutter build web --release`, then `firebase deploy --only hosting --project kyodai-sns`, then 6b. Plan 4 needs nothing else from the backend.

**Rollback.** Two different things are called "rollback" here; do not mix them up.

1. **Roll back Plan 4's hosting layer only** (headers, start screen, `/about/`, bootstrap): Use Git, not the console's Release history (under order A a console rollback also reverts the 2A/2B/3 client — see 2). In Git Bash: `git log --diff-filter=A --format=%h -- docs/superpowers/plans/2026-10-06-first-load-and-public-pages.md` prints the commit that added this plan (call it `<P4>`; its tree is the code without Plan 4 and with 2A/2B/3), then `git checkout <P4>`, `flutter build web --release`, `firebase deploy --only hosting --project kyodai-sns`, `git checkout master-wf96b2`. Consequences: the old `immutable` headers return (the stale-code risk is back, and files fetched under Plan 4's `no-cache` stay revalidated), `/about/`, robots, sitemap and the share image disappear (soft-200 HTML again). Browsers that ran Plan 4 hold `no-cache` copies and revalidate — nothing breaks.
2. **Roll back app code (2A / 2B / 3 client) while keeping Plan 4's hosting layer — the normal case under order A.** Under order A, Plan 4 and the 2A/2B/3 client went out in the same release, so rolling back to an earlier release in the console (Hosting → `kyodai-info` → Release history) is a rollback of the 2A/2B/3 *client* against the already-deployed *backend* (new rules, Functions and migrated data), and because a release carries its own `firebase.json` headers and files it also removes Plan 4's headers and bootstrap. **Every app-code rollback must therefore keep Plan 4's hosting files.** In Git Bash: `git checkout <P>` (the older tree, e.g. the combined runbook's `<P>` or `bc72fb0`), then `git checkout master-wf96b2 -- firebase.json web/flutter_bootstrap.js web/index.html web/about web/robots.txt web/sitemap.xml web/og-image.png web/manifest.json`, then `flutter build web --release`, `node tools/perf/check_web_cache.mjs` (HARD GATE as PRE c), `firebase deploy --only hosting --project kyodai-sns`, and finally `git checkout master-wf96b2`. `lib/main.dart` keeps the older version in this case (the startup guard lives in `lib/startup/`; an older `lib/main.dart` simply does not call it, so the failure screen's Dart-side signals are absent but the page watchdog still works). Backend rollbacks (rules, Functions, data) are separate and stay as written in the combined runbook.

## Manual E2E (production, after step 6b; user + phone + desktop browser)

1. **Start screen:** on a phone (mobile data, cache cleared), open `https://kyodai-info.web.app/` → within about a second the blue logo, 「京大InfoHub」 and the one-line description appear with 「アプリを読み込んでいます…」; if loading takes more than 8 s the 30-秒 hint appears; then the sign-up screen replaces it with no blank flash.
2. **Failure screen** (the contact text is the fallback 「マイページ → お問い合わせ」 — Task 7 is not implemented, so the address is not mirrored): desktop Chrome → DevTools → Network → right-click any `www.gstatic.com/firebasejs/…` request → Block request domain → reload → after ≈ 30 s 「アプリを起動できませんでした」 with a focused 再読み込み button and the contact text (the address if `kOperatorContactEmail` was set). Unblock (Network request blocking panel) → 再読み込み → the app starts.
3. **Console:** DevTools Console shows `[kyotohub] first frame N ms` (note N for phone and desktop: the first real-world numbers, R-1).
4. **Fonts — ONLY WHEN TASK 6 IS IMPLEMENTED (skip otherwise; it is not in the implemented subset):** DevTools Network, filter `fonts.gstatic` on a cold load → only `notosansjp` (and one `roboto`) files, no `notosanssc` / `notosanshk`.
5. **Returning visitor:** open the app on a device that used the app BEFORE this deploy (do not clear anything) → Network shows `main.dart.js?v=<number>` with status 200 and `MaterialIcons-Regular.otf` fetched; icons on マイページ / 教科書 render (no empty boxes). Reload → `main.dart.js?v=…` 304 (or "memory cache").
6. **Links still work:** sign up a test account and use the verification e-mail link (it opens `kyodai-sns.firebaseapp.com/__/auth/action…`, unchanged), then 検証ステータスを更新する → onboarding; a bookmarked `https://kyodai-info.web.app/` and `https://kyodai-info.web.app/anything` open the app; an installed PWA (if any) still opens the app.
7. **Landing:** `https://kyodai-info.web.app/about/` → readable page, no login; アプリを開く → the app (it opens faster after reading for ~15 s); DevTools Network on `/about/` shows prefetches of `main.dart.js?v=…` and `canvaskit.wasm` about a second after load (the Data Saver / 2G skip is covered by the static test; desktop DevTools cannot reliably emulate it).
8. **Link previews:** paste `https://kyodai-info.web.app/` and `/about/` into LINE / Slack / X (or the Facebook Sharing Debugger) → title 「京大InfoHub — 京大生専用の…」, the description and the blue 1200×630 image. Previews are cached by those services; use a fresh URL suffix like `/?p=1` if an old preview sticks.
9. **Search (optional, owner):** in Google Search Console (if the owner sets it up) submit `https://kyodai-info.web.app/sitemap.xml`.

## Dry-run results (lab values — read the conditions)

**How it was run.** The plan was developed in a scratch copy of `master-wf96b2` at `43f17f2` (`git archive` into the session scratchpad, never the real tree), and its code blocks were generated from that copy. Then a scripted replay applied every step of THIS text, in task order, to a second fresh copy, with a commit per task, running each task's failing and passing state: `flutter test` 186 → 188 → 191 → 192 → 193 → 194, analyzer 21 every time, `check_start_screen` 17 → 18 → 20 `ok`, the Task 5 "before" check 41 `FAIL` lines, the Task 6 "before" run failing exactly the two F-1 checks, the Task 7 mutations as described, the Task 5 returning-user proof `OK`; the replayed tree matched the development copy file for file (build outputs excluded) and `og-image.png` was byte-identical (sha256 `67ae0470…`). Mutations run: see Self-Review. Final suites on the final tree: final suites on the final tree: functions 220/220, rules 138/138, storage rules 9/9, `flutter test` 194/194, `flutter analyze` 21 issues, `check_web_cache` OK, `check_start_screen` 20/20, `sync_web_contact --check` exit 0. Builds: `flutter build web --release --no-web-resources-cdn` (www.gstatic.com is denied in the sandbox, so CanvasKit was served locally and the Firebase JS SDK 12.19.0 from the npm package via `--sandbox-sdk`).

**Conditions.** Sandbox Linux, 4 vCPU; Chromium 141.0.7390.37 headless (`/opt/pw-browsers/chromium-1194`); local server on 127.0.0.1 (HTTP/1.1, brotli 11, ETag/304, headers from the Hosting emulator of firebase-tools 15.32.1); applied throttling — mobile 562.5 ms latency / 1.47 Mbps down / CPU ×4 / 412×823 @1.75 / locale ja-JP, desktop 40 ms / 10 Mbps / CPU ×1; external requests (fonts.gstatic.com, Firestore) through the sandbox proxy; signed-out cold start; median (min–max) of 3 runs; Lighthouse 13.5.0 simulated. Not production, not a real phone, no Safari/iOS, no HTTP/2 CDN in Japan (the analysis report §2/§8 caveats apply unchanged).

| Profile | Load | Metric | Before (`43f17f2`) | After (Plan 4) |
|---|---|---|---|---|
| mobile | cold | first Flutter frame | 18,820 (18,805–18,841) ms | 18,929 (18,926–18,961) ms (+0.6%) |
| mobile | warm | first Flutter frame | 4,454 (4,400–4,650) ms | 5,209 (5,128–5,291) ms (+0.76 s: revalidation, C-1) |
| mobile | `/about/` + 15 s dwell → app | first Flutter frame after the click | — (report prototype 8,449) | **8,151 (8,141–8,213) ms** |
| mobile | cold | first visible content (FCP) | 668 ms — the plain loading text | 700 (688–708) ms — brand + description |
| mobile | cold | transfer / requests | 2,996 KiB / 31 | 2,858 KiB / 41 |
| mobile | cold | fallback fonts | 14 files / 434 KiB (SC ×9, HK ×3, JP ×1, Roboto) | 19 files / **293 KiB** (JP ×18, Roboto) |
| mobile | Lighthouse | score · FCP · LCP* · TBT · SI | 65 · 661 · 801* · 3,726 · 6,318 | 65 · 677 · 861* · 3,042 · 5,882 |
| desktop | cold | first Flutter frame | 2,786 (2,723–2,805) ms | 2,780 (2,775–2,786) ms |
| desktop | warm | first Flutter frame | 987 (962–994) ms | 864 (863–912) ms |
| desktop | `/about/` + 15 s → app | first Flutter frame after the click | — | 1,396 (1,395–1,440) ms |
| desktop | Lighthouse | score · FCP · LCP* · TBT · SI | 75 · 229 · 322* · 514 · 1,853 | 73 · 231 · 375* · 595 · 1,934 |
| `/about/` | Lighthouse mobile / desktop | score · FCP · LCP · TBT | — | 100 · 725 · 751 · 0 / 100 · 196 · 201 · 0 |

\* LCP/FCP of the app page time the HTML start screen, not the canvas (the analysis report §4.1); the first-frame rows are the app.

**Acceptance thresholds (lab, same machine, before/after).** Derived from the baselines above and the analysis report; they gate a regression, they do not predict real devices.

| Metric (lab) | Baseline | Target | Dry run | Met |
|---|---|---|---|---|
| Something branded visible (FCP), mobile cold | 668 ms (plain text) | ≤ 1,000 ms with brand + description | 700 ms | ✓ |
| SDK blocked → visible failure screen | never (blank page) | ≤ 35 s, retry works | firebase-timeout at ≈ 30 s, retry starts the app | ✓ |
| First frame, mobile cold | 18,820 ms | ≤ 19,800 ms (+5%) | 18,929 ms | ✓ |
| First frame, mobile warm | 4,454 ms | ≤ 6,000 ms (revalidation cost accepted) | 5,209 ms | ✓ |
| First frame after `/about/` + 15 s, mobile | — | ≤ 9,000 ms | 8,151 ms | ✓ |
| First frame, desktop cold / warm | 2,786 / 987 ms | ≤ 2,950 / ≤ 1,300 ms | 2,780 / 864 ms | ✓ |
| Fallback fonts, cold | 434 KiB incl. SC/HK | ≤ 320 KiB, JP only | 293 KiB, JP only | ✓ |
| `/about/` Lighthouse mobile | — | score ≥ 0.95, LCP ≤ 1,000 ms | 1.00, 751 ms | ✓ |
| Stale files after a deploy (returning visitor) | `main.dart.js` + icon font stale | 0 | 0 | ✓ |

**Caching — verified, not assumed.**
- Hosting emulator answers for today's `firebase.json`: `max-age=31536000, immutable` on `/main.dart.js`, `/flutter.js`, `/manifest.json`, `/version.json`, every `/assets/…`, every `/canvaskit/…`, every PNG — and on every path served by the `**` rewrite (`/about/`, `/robots.txt`, `/sitemap.xml`, `/no/such/deep/path`); `/` itself had **no** `Cache-Control`; only `/index.html`, `/flutter_bootstrap.js`, `/flutter_service_worker.js` were `no-store`. `check_web_cache` on that config: 79 problems.
- Returning visitor, today's headers and stock bootstrap, v1 → v2 (only `MaterialApp.title` changed): `/main.dart.js` NOT requested on the next visit; `document.title` stayed v1. Two `page.reload()`s: still v1, `main.dart.js` never requested. With Plan 4's headers: reload 1 → v2 (`main.dart.js` 200), reload 2 → 304.
- v1 with a different icon set (tree-shaken `MaterialIcons-Regular.otf` 17,116 B vs 16,980 B): new headers alone → `STALE … MaterialIcons-Regular.otf, /main.dart.js` (old `immutable` copies are never revalidated); new headers + C-2 bootstrap → all three changed files fetched (font `200` via the refresh, then `304` for the engine), `OK`. The pre-2A tree (`11df5aa`, ≈ today's production) builds a 15,800 B icon font: the risk applies to the real 2A/2B/3 deploy.
- `/about` → `301 /about/`; deep paths and `/?mode=signIn&oobCode=…` → `index.html` (the app); the Hosting emulator never answered `304` (hence the local server). Production ETag/304 and compression are checked in step 6b.

**Crawler / link-preview view (curl, no JS, via the Hosting emulator):** `/` → `<html lang="ja">`, viewport, title 「京大InfoHub — 京大生専用の授業レビュー・過去問共有・教科書マーケット」, description, canonical `https://kyodai-info.web.app/`, `og:*` with `og-image.png` 1200×630 + alt, `twitter:card summary_large_image`, `<h1>京大InfoHub</h1>`; `/about/` the same with its own canonical and the full page text; `/robots.txt` 200 `text/plain` 73 B; `/sitemap.xml` 200 `application/xml` 321 B with the two URLs; `/og-image.png` 200 `image/png` 59,118 B; `/some/deep/link` 200 = the app's HTML with canonical `/`.

**Start screen checks (`check_start_screen`, Chromium):** brand visible before scripts; removed after the first frame; `kyotohub-first-frame` mark; `navigator.language === 'ja'`; fallback fonts `roboto, notosansjp`; SDK blocked → `failed` / `firebase-timeout` (≈ 30 s), retry focused and visible, contact text visible, unblock + 再読み込み → app; bootstrap blocked → `failed` / `bootstrap` at once; `main.dart.js` never answered → `slow` at 8 s, `failed` / `timeout` at 60 s; JS off → brand + noscript, `/about/` complete; `/?mode=signIn&oobCode=TEST&apiKey=TEST&lang=ja` and `/course/123` start the app. Screenshots of the loading, failed and `/about/` states (412 px wide) were checked by eye: no overflow, contrast OK, no overlap.

**Experiments (not adopted):** wasm (`--wasm --no-web-resources-cdn`, SDK served by request interception, which is un-throttled and disables the HTTP cache, so warm loads were not measurable): cold mobile 16,697 → 15,521 ms (−7%), desktop 2,568 → 2,306 ms (−10%); the failure path reported `firebase-timeout` under dart2wasm too (W-1). Deferred loading: source-map attribution of `main.dart.js` (3,354,280 B): Flutter framework 46.5%, web engine 21.6%, Dart SDK 17.1%, Firebase plugins 4.8%, **`lib/views` 4.3%**, other `lib` 2.8%, other packages 2.0% (D-1).

**Plan errors found and fixed during the dry run:** the Hosting emulator 404s with an absolute `public` path (now relative, temp dir next to the build); Playwright's `proxy` option forces loopback through the proxy (now `--proxy-server` only); Chromium needs an NSS db trusting the egress proxy CA in the sandbox (`CHROME_HOME`); the first stale check treated the engine's `304` after the refresh as stale (a `304` is only sent for the CURRENT ETag, now accepted); headers alone were insufficient (C-2 added); the OG lead line wrapped into the badge (34 px, no wrap).

## Self-Review

**Scope coverage (the request's items 1–7):**
1. Branded, accessible first paint without JS + visible failure state with retry and contact text + no blank page / no `runApp` without Firebase → S-1/S-2/S-3, Tasks 2–3, C-3 Task 7. ✓
2. Static public landing with prefetch and CTA; architecture ruling with URL/auth-link analysis; proven by a scratch-copy browser test → L-1, P-1, Task 4, `check_start_screen` case 6, route checks. ✓
3. robots, sitemap (public URLs only), OGP/Twitter with a real 1200×630 image from a deterministic script, viewport, canonical, lang, theme-color; crawler view via curl → L-2, Tasks 3–4, Dry-run "Crawler view". ✓
4. Caching verified for real (v1/v2 returning user, reloads) and fixed; regression script that fails if a deploy would serve stale code → C-1/C-2, Task 5, `check_web_cache.mjs`. ✓
5. Fonts measured, then decided → F-1, Task 6. ✓
6. Wasm and deferred loading measured, not adopted, with reasons and rollback-free status → W-1, D-1. ✓
7. Repeatable measurement tool + README + acceptance table + honest lab limits; privacy-safe RUM decision → M-1, R-1, Tasks 1/8, Dry-run results. ✓

**Mutation checks run on the dry-run copy (each failed the named check):** `firebase.json` restored to the old headers on the final build → static test C-1 + `check_web_cache` (39 problems); C-2 removed (stock bootstrap) → bootstrap static test + returning-user `STALE`; `defineProperty` removed → F-1 test + `check_start_screen` fonts/language checks; `kOperatorContactEmail` set without syncing → C-3 test for both pages; `initFirebase` hang with the guard removed (direct `await`) → `startup_test` timeout tests; `onerror` removed from the bootstrap `<script>` → index test + case 3.

**Placeholder scan:** none — every step carries a full file, a full replacement or an exact replace/insert edit with both texts; every Run step names its command and expected result. The only generated artefacts are `web/og-image.png` and `tools/perf/package-lock.json` (commands given; binary/lockfile cannot be inlined).

**Name / value consistency:** `window.kyotoHubBootFailed` (index.html, bootstrap, `boot_signal_web.dart`); reasons `bootstrap`/`engine`/`loader`/`firebase-error`/`firebase-timeout`/`timeout` (index, bootstrap, `startup.dart`, `check_start_screen`); `data-state` `loading`/`slow`/`failed`; `kyotohub-first-frame` (index, `check_start_screen`); `kyotoHubBuild` (bootstrap, `/about/` regex, `bootstrapProblems`); `kyotohub.build` localStorage key; contact markers (index, about, `sync_web_contact.mjs`, C-3 test); `no-cache` / `public, max-age=86400` (firebase.json, C-1 test, `headerProblems`); 30 s (`kFirebaseInitTimeout`, test), 8 s / 60 s (`SLOW_MS`/`FAIL_MS`, case 4); test counts 181 → 186 → 188 → 191 → 192 → 193 → 194.

## Owner decisions to confirm

Each is implemented as the ruling says and can be reversed cheaply (the "Cost if wrong" column):

1. **L-1** the app stays at `/`; the landing is `/about/` (vs landing at `/` and the app at `/app/`).
2. **L-2** public pages carry static marketing text only — no course names, counts, reviews or listings; sitemap = `/` and `/about/`.
3. **S-1 / S-2** timeouts: Firebase init 30 s; "slow" hint at 8 s; failure screen at 60 s without a first frame.
4. **S-2 copy** of the failure screen (mentions gstatic.com filters and suggests another network).
5. **C-1** everything `no-cache` (revalidation on every load, lab cost +0.76 s warm on the slow mobile profile) and images one day.
6. **C-2** per-build `main.dart.js?v=` and the one-time asset refresh (relies on Flutter's deprecated service-worker token; the deploy check catches its removal).
7. **C-3** the contact address is copied into the static pages by `node tools/sync_web_contact.mjs` (one more PRE command when the address is set).
8. **F-1** report `ja` to Flutter's font picker for every visitor (vs bundling a font or doing nothing).
9. **P-1** landing prefetch of ≈ 2.3 MB on any connection except Data Saver / 2G (vs Wi-Fi only, or no prefetch).
10. **R-1** no analytics: the first-frame time stays in the visitor's console. Decide whether to send it (and with what) to learn real Kyoto-student load times — the analysis report's key unknown.
11. **W-1** wasm not adopted now (follow-up plan with signed-in smoke tests and Safari check).
12. **D-1** no deferred loading (< 0.2 s possible gain).
13. **X-1** manifest name/colours and the corrected meta description (no 教科書の貸借).
14. **Deploy order A** — implement Plan 4 before the combined 2A + 2B + 3 deploy so step 8's reload instruction actually works (vs order B, Plan 4 later with testers clearing site data after the combined deploy).
16. **No-cache everywhere (C-1) — cost and the cheaper alternative.** Every non-image file is revalidated on every load; measured in the lab: warm mobile first frame 4.45 → 5.21 s (+0.76 s on a 562 ms-RTT emulated link; production on a typical link is likely smaller, not measured). Cheaper alternative: because `main.dart.js` is now *always* requested as `?v=<build id>`, `/main.dart.js` alone could carry `max-age=31536000, immutable` (a new build is a new URL) and everything else stays `no-cache`; the saving is one 304 round trip per visit. Not adopted: it makes the check rule and the headers file more complex and the unversioned `/main.dart.js` (e.g. an old `/about/` prefetch or a hand-typed URL) would then be immutable-cached without the id.
17. **60 s watchdog on very slow links.** A phone that needs more than 60 s for the first frame (a lab cold mobile load is ≈ 19 s; 3× margin) sees the failure screen, though the app may still start behind it (the first frame removes the screen, even after a failure was shown). Raise `FAIL_MS` if real timings (R-1) show slower loads.
18. **iOS / Safari prefetch behaviour (P-1).** `<link rel=prefetch>` is honoured differently by iOS Safari (historically ignored or limited); on iOS the landing prefetch may simply not happen, which only costs the speed-up. Not tested on a device.
19. **gstatic dependency.** In the production (CDN) build CanvasKit comes from `www.gstatic.com` and the Firebase JS SDK from `gstatic.com/firebasejs`; networks that block gstatic show the failure screen (S-1/S-2) rather than a blank page. Self-hosting CanvasKit (`--no-web-resources-cdn`, about 7 MB more on your own hosting) is the alternative; not adopted.
20. **Tasks 6–8 deferred** pending the Next.js spike decision (Japanese font override, contact mirroring, final docs/AFTER numbers): until then the static pages show the fallback contact text only.
15. **Search Console** — whether to register the site and submit the sitemap (needs the owner's Google account; not part of this plan).
