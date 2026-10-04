# Flutter Web vs Next.js: measurements for the deferred stack decision

- Date: 2026-10-04 · Branch: `master-wf96b2` @ `b3d73db` · Type: measurement study (no app code changed)
- Feeds: spec `docs/specs/2026-09-07-kyodai-info-redesign-design.md` §2 non-goal (L44), §3 stack decision (L58), §5 "login gate + heavy Flutter web → zero SEO/share traffic" (L232), §8 risk "Flutter Web SEO / first load → re-evaluate after Phase 1" (L323)

## 1. Summary for the decision

**What the numbers show (local lab conditions, see §2):**

1. **Cold first load on a throttled phone takes about 19 s before the app's first frame (the login screen).** Conditions: emulated slow 4G (562.5 ms latency, 1.47 Mbps down) and 4x CPU slowdown, applied throttling, current release build (JS + CanvasKit). Median 18.9 s, range 18.8–19.0 s, n=3. On a desktop profile it is 2.8 s. For the whole wait the user sees only the HTML splash text.
2. **Lighthouse misreports this app.** It gives LCP 0.80 s and FCP 0.65 s (mobile). Those numbers time the splash `<div>` ("京大InfoHub を読み込み中"), because Flutter draws on a canvas, which is never an LCP candidate. The metrics that do track the real cost: TBT 3.4 s, Speed Index 6.5 s, TTI 13.8 s (simulated), score 0.65. Lighthouse also warned on every Flutter run that the page never went network-idle within its 45 s limit, because the Firestore listen channel stays open.
3. **About 3.0 MB moves over the wire on a cold load, in 30–34 requests.** The bytes break down as: rendering engine (CanvasKit wasm+js) 1.64 MB, app code `main.dart.js` 0.74 MB (3.35 MB raw), CJK fallback fonts from fonts.gstatic.com 0.38 MB in 13 requests, Firebase JS SDK 0.23 MB, Roboto 64 KB. All sizes are brotli where compressible. The Firebase SDK and fonts are fetched at runtime and are **not** part of `build/web`.
4. **A repeat visit (warm HTTP cache) brings first frame down to 4.5 s (mobile) / 1.2 s (desktop).** The `--wasm` build lowers it further, to 2.8 s / 0.5 s. Cold-load gains from wasm are small: 17.7 s vs 18.9 s mobile.
5. **Crawlers and link previews see no content.** The HTML without JS has a title, a description and OG tags, and its only body text is the splash. There is no `robots.txt` and no `sitemap.xml`: the `**` rewrite answers both with `index.html`, status 200, `text/html`. There are no URL routes, so every path renders the same signup screen. `og:image` is the 64×64 favicon, even though `twitter:card` is `summary_large_image`. There is no `<meta name="viewport">` in `web/index.html`.
6. **Nothing in the data is publicly readable.** Every Firestore and Storage read rule requires `kuDomain()`, `owns()` or `false`. The only screens before the login gate are `SignupScreen` and the `TakedownScreen` linked from it. So **switching framework alone would not make anything indexable.** Indexable pages first need a product/privacy decision on which content is public (for example course names or aggregate stats), and then a way to serve it (static generation or Admin-SDK server reads).
7. **The empty-page floors:** a minimal Next.js 16 static export is 116 KiB / 7 requests, with mobile LCP 1.35 s, TBT 89 ms and score 1.00. A plain static HTML landing page is 2 KiB / 2 requests, with LCP 0.75 s and score 1.00. **These are floors for an empty page, not predictions for a rewritten app.**
8. **A cheap mitigation that was tested:** a static landing page that prefetches the Flutter bundle while the visitor reads. After a 15 s dwell, the app's first frame on clicking through was 8.4 s instead of 18.9 s (mobile, applied throttling). A Lighthouse-simulated run of that same landing page scored it worse (LCP 13 s), because the simulator counts the prefetches as competing for bandwidth. That Lighthouse figure is an artefact, discussed in §6.

**What the numbers do NOT show.** No real devices were used, and there was no production Firebase Hosting or CDN, no latency from Japan, no authenticated load, no iOS/Safari and no real user data. Details are in §8. Bandwidth and latency were emulated, and CPU throttling was relative to this sandbox's CPU (Lighthouse benchmarkIndex 2152). An absolute "19 s" therefore does **not** mean "19 s for Kyoto students". The relative comparisons (JS vs wasm vs prototypes) are more robust than the absolute values.

**Recommendation in one line (reasoned in §9).** The data does **not** justify a full Next.js migration now. It does support (a) adding static public pages in front of the app, starting with a landing page plus a real OG image, robots.txt and sitemap, and (b) the small cache/config fixes in §7. Re-check after Phase 1 with production RUM and Search Console data. A migration case would have to rest on content that the product decides to make public, and that decision does not exist yet.

## 2. Conditions and limits

| Item | Value |
|---|---|
| Flutter | 3.41.9 stable, Dart 3.11.5, engine `42d3d75a56` |
| Build host | sandbox Linux container, 4 vCPU, 15 GB RAM |
| Browser | Chromium 141.0.7390.37 (Playwright build at `/opt/pw-browsers/chromium-1194`), headless |
| Lighthouse | 13.5.0, `onlyCategories: performance` |
| Lighthouse mobile preset | default: simulated throttling (Lantern), RTT 150 ms, 1638.4 kbps, CPU ×4, Moto G Power emulation 412×823 @1.75 |
| Lighthouse desktop preset | `desktop-config`: simulated, RTT 40 ms, 10240 kbps, CPU ×1, 1350×940 |
| Applied-throttling runs (Playwright + CDP) | mobile: latency 562.5 ms, down 1474.56 kbps, up 675 kbps, CPU ×4 (the same numbers Lighthouse uses for "devtools" throttling). Desktop: 40 ms, 10240 kbps, CPU ×1 |
| Host CPU speed | Lighthouse benchmarkIndex 2152. CPU ×4 is relative to this host, not to a real phone |
| Server | local Node static server (below), HTTP/1.1, on localhost. Firebase Hosting serves HTTP/2 and HTTP/3 from a CDN, which was not reproducible here |
| Network to Google | through the sandbox egress proxy (see the "what failed" table). fonts.gstatic.com, firestore.googleapis.com and identitytoolkit.googleapis.com were reachable. **www.gstatic.com, kyodai-info.web.app and apis.google.com were denied (403) by the sandbox policy** |
| Auth | none. Unauthenticated cold load only, because no credentials were available and none were looked for |
| Runs | 3 per configuration. Each Lighthouse run used a fresh Chrome profile (cold), then a second run in the same Chrome with `disableStorageReset` (warm) |

### Local server ("Firebase-like")

`server.js` (scratchpad only) does the following:
- SPA fallback: any path that is not a file returns `/index.html` (like `firebase.json` `rewrites: ** → /index.html`).
- `Cache-Control`: copied from `firebase.json`. `index.html`, `flutter_bootstrap.js` and `flutter_service_worker.js` get `max-age=0, no-cache, no-store, must-revalidate`; everything else gets `max-age=31536000, immutable`.
- `Content-Encoding`: brotli (quality 11) when `br` is accepted, otherwise gzip -9, precomputed and pre-warmed before measuring. Applied to html, js, mjs, json, css, **wasm**, otf, ttf, frag and text. PNG is not compressed.
- Limit: Firebase Hosting compresses dynamically, and its brotli level and **whether it compresses `application/wasm` were not verifiable here** (production was unreachable). If production serves the 5.69 MB `chromium/canvaskit.wasm` uncompressed, the cold payload would be about 4 MB larger than measured. Check with the command in §10.

### Workarounds required by the sandbox (and how they bias results)

| Problem | Effect on the stock build | Workaround (scratchpad copies only) | Bias |
|---|---|---|---|
| `www.gstatic.com` denied → CanvasKit CDN unreachable | Default build (`--web-resources-cdn` on) cannot load its engine | Measured `--no-web-resources-cdn` builds (engine served from the same origin). Same files, same bytes | Production fetches CanvasKit cross-origin from gstatic (an extra DNS/TCP/TLS connection, but possibly faster CDN edges). Not measured |
| `www.gstatic.com/firebasejs/12.19.0/*` denied | **App never starts: blank page, permanently** (observed for 30 s+). `main()` awaits `Firebase.initializeApp` with no catch, so `runApp` never runs. The splash is removed when the engine creates `<flutter-view>`, leaving an empty page | Rewrote the SDK URL in the built `main.dart.js` (and same-length in `main.dart.wasm`) to a same-origin `/firebasejs/12.19.0/`, serving the identical files from the `firebase@12.19.0` npm package (these are the CDN builds; their imports point at gstatic, rewritten likewise) | Same-origin instead of cross-origin. Brotli sizes are from the local server and may differ from gstatic's |
| Chromium did not trust the proxy CA | fonts.gstatic.com and Firestore failed TLS | Created a scratchpad NSS db containing `/root/.ccr/agent-proxy-ca.crt` and ran Chrome with `HOME` pointing at it. Verification was **not** disabled | External requests (fonts, Firestore) pay the proxy's latency, which inflates both the applied runs and Lantern's per-origin estimates |
| `apis.google.com/js/api.js` denied | Firebase Auth's iframe helper failed (0 bytes). The app still rendered | none | Production downloads this script plus an auth iframe. **Not measured** |

## 3. Build and payload

### 3.1 Builds

| Command (in a scratchpad copy of the committed tree) | Result | Wall time |
|---|---|---|
| `flutter build web --release` (= the deploy command in the plans) | OK. Renderer CanvasKit via dart2js. Engine loaded from gstatic CDN. "Wasm dry run succeeded" | 49 s |
| `flutter build web --release --no-web-resources-cdn` | OK. Same output, engine served locally (main.dart.js differs by 73 bytes) | 43 s |
| `flutter build web --release --wasm --no-web-resources-cdn` | OK, no warnings beyond the standard "WebAssembly compilation is new" banner. `flutter_bootstrap.js` lists dart2wasm+skwasm first with dart2js+canvaskit as fallback | 69 s |
| `--web-renderer html/canvaskit` | Not available in 3.41.9 (flag removed; `flutter build web -h` lists none). The HTML renderer no longer exists | n/a |
| `--base-href /app/` (for the landing prototype) | OK | ~45 s |

Icon fonts are tree-shaken by default: MaterialIcons 1,645,184 → 16,980 B and CupertinoIcons 257,628 → 1,472 B.

### 3.2 `build/web` on disk vs what a browser actually downloads

`build/web` contains every renderer variant, but the browser downloads only one of them. The disk total is therefore **not** the payload.

| Build | Files | Raw total | gzip -9 | brotli 11 |
|---|---|---|---|---|
| JS (`--no-web-resources-cdn`) | 36 | 37,670,689 | 12,565,008 | 9,572,828 |
| wasm | 38 | 40,455,790 | 13,605,379 | 10,371,055 |
| Next.js hello (static export `out/`) | 20 | 607,258 | 186,338 | 160,213 |

Largest files (bytes):

| File | Raw | gzip -9 | brotli 11 | Downloaded on cold load? |
|---|---|---|---|---|
| `canvaskit/canvaskit.wasm` | 7,155,824 | 2,897,324 | 2,227,094 | no (non-Chromium fallback variant) |
| `canvaskit/chromium/canvaskit.wasm` | 5,686,880 | 2,175,381 | 1,612,881 | **yes** (JS build on Chromium) |
| `canvaskit/skwasm_heavy.wasm` | 5,140,187 | 2,280,039 | 1,831,156 | no |
| `canvaskit/skwasm.wasm` | 3,549,782 | 1,531,455 | 1,191,600 | **yes** (wasm build) |
| `canvaskit/wimp.wasm` | 3,461,893 | 1,420,784 | 1,099,852 | no |
| `main.dart.js` | 3,353,023 | 960,382 | 738,365 | **yes** (JS build) |
| `main.dart.wasm` | 2,739,865 | 1,030,315 | 789,794 | **yes** (wasm build) |
| `*.js.symbols` (5 files) | 1.26–1.76 M each | | | no (debug symbols) |
| `assets/NOTICES` | 1,364,918 | 106,933 | 45,384 | no (only on the licence page) |
| `canvaskit/chromium/canvaskit.js` | 86,496 | 27,579 | 24,292 | yes (JS) |
| `canvaskit/skwasm.js` | 63,437 | 17,148 | 14,886 | yes (wasm) |
| `main.dart.mjs` | 45,118 | 10,032 | 8,410 | yes (wasm) |
| `assets/fonts/MaterialIcons-Regular.otf` | 16,980 | 9,409 | 8,388 | yes |
| `flutter_bootstrap.js` | ~10,000 | 3,822 | 3,359 | yes |
| `index.html` | 4,363 | 1,863 | 1,347 | yes |
| `favicon.png` | 388 (64×64) | | | yes |
| `icons/Icon-512.png` / `-192` / maskable | 3,716 / 1,156 / 3,762 / 1,188 | | | 192 px only (manifest) |

**Favicon:** it is no longer oversized. The original file was 1,003,122 B (`git show 68ba94c:web/favicon.png`); commit `6330b8f` replaced it with a 388 B file, and the commit message records `build/web` dropping 42.4 MB → 37.4 MB. Nothing is left to trim there. Its remaining problem is that it is used as `og:image` (§5).

### 3.3 Measured cold-load transfer by category (Lighthouse mobile cold run 1, `network-requests`)

| Category | JS build: bytes / requests | wasm build: bytes / requests | Source |
|---|---|---|---|
| Engine (CanvasKit / skwasm wasm + js) | 1,637,668 / 2 | 1,206,981 / 2 | build/web (prod: gstatic CDN) |
| App code (`main.dart.js` / `.wasm` + `.mjs`) | 738,450 / 1 | 798,797 / 2 | build/web |
| CJK fallback fonts (Noto Sans **SC** ×9, **HK** ×3, JP ×1 subsets) | 380,548 / 13 | 380,547 / 13 | fonts.gstatic.com at runtime |
| Firebase JS SDK 12.19.0 (app, auth, firestore-pipelines, storage, functions) | 228,643 / 5 | 228,711 / 5 | gstatic at runtime (served locally here) |
| Roboto | 64,243 / 1 | 64,243 / 1 | fonts.gstatic.com at runtime |
| HTML, bootstrap, icon fonts, manifest, icons | 17,966 / 8 | 17,989 / 8 | build/web |
| Firestore listen + blocked apis.google.com | 1,791 / 4 | 1,762 / 4 | Google APIs |
| **Total (Lighthouse `total-byte-weight`)** | **2,997 KiB / 34** | **2,636 KiB / 35** | |

Raw sizes of the Firebase SDK files: app 106,558, auth 157,113, firestore-pipelines 753,030, storage 46,975 B (functions: same package). Together about 1.1 MB of JS for the browser to parse.

What these numbers mean:
- About 22% of the cold-load bytes (fonts plus Firebase SDK, ~0.67 MB of ~3.07 MB) are fetched at runtime and appear in no build-size number.
- The theme sets `fontFamily: 'Inter'`, which is not bundled, so the engine falls back to Roboto plus Noto fallbacks. For the login screen's Japanese text it downloaded mostly **Noto Sans SC/HK (Chinese) subsets** and a single JP subset, even with `locale: ja-JP`. That costs bytes, and it is a likely glyph-shape issue (Chinese glyph forms for kanji). The glyph forms were seen in the request log only and were not checked visually.
- Pre-login Firestore traffic: `AppStore` starts `courses.warmUp()` and `streamPosts()` before auth. With rules requiring `kuDomain()`, these cannot return content to a signed-out visitor. They keep a listen channel open, which is why Lighthouse never sees network idle.

## 4. Lighthouse and applied-throttling results

### 4.1 Lighthouse 13.5 (simulated throttling), median (min–max), n=3

ms unless noted. "warm" = second load in the same browser (HTTP cache kept; the Flutter service worker is a self-unregistering stub, so warm = HTTP cache only).

| Target | Preset | Load | Score | FCP | LCP* | TBT | CLS | Speed Index | TTI | Transfer | Requests |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Flutter JS (current) | mobile | cold | 0.65 (0.65–0.65) | 649 (649–653) | 802* (793–837) | 3394 (3025–3407) | 0.029 | 6465 (6165–6514) | 13801 (13798–14110) | 2997 KiB | 34 |
| Flutter JS | mobile | warm | 0.70 (0.70–0.71) | 640 | 797* | 3183 (2989–3383) | 0.027 | 3002 (2788–3200) | 4581 (4345–4834) | 7 KiB | 33 |
| Flutter wasm | mobile | cold | 0.67 (0.66–0.68) | 650 | 800* | 2268 (1966–2282) | 0.030 | 5739 (5623–5863) | 15114 (15049–15123) | 2636 KiB | 35 |
| Flutter wasm | mobile | warm | 0.72 (0.71–0.72) | 631 | 793* | 2248 (2100–2298) | 0.022 | 2252 (2181–2365) | 3643 (3392–3721) | 7 KiB | 34 |
| Flutter JS + preload hints (prototype) | mobile | cold | 0.38 (0.38–0.38) | 2252 (2251–2313) | 10202* | 3139 (3033–3215) | 0.027 | 5999 | 14208 | 2997 KiB | 35 |
| Flutter JS + preload hints | mobile | warm | 0.71 | 757 | 775* | 2873 | 0.029 | 2776 | 4356 | 7 KiB | 34 |
| Static landing, no prefetch (prototype) | mobile | cold | 1.00 | 663 (658–680) | 752 (752–752) | 0 | 0 | 663 | 752 | 2 KiB | 2 |
| Static landing + prefetch of Flutter bundle | mobile | cold | 0.75 | 677 | 13051 (Lantern artefact, §6) | 0 | 0 | 677 | 13051 | 2325 KiB | 6 |
| Next.js 16.3.8 hello (lower bound) | mobile | cold | 1.00 (0.99–1.00) | 643 (634–648) | 1352 (1351–1825) | 89 (88–124) | 0 | 643 | 1791 (1789–1825) | 116 KiB | 7 |
| Next.js hello | mobile | warm | 1.00 | 635 | 705 | 56 | 0 | 635 | 784 | 3 KiB | 7 |
| Flutter JS (current) | desktop | cold | 0.75 (0.75–0.76) | 228 (172–235) | 335* (212–336) | 525 (482–534) | 0 | 1831 (1804–1832) | 2685 (2655–2731) | 2997 KiB | 33 |
| Flutter JS | desktop | warm | 0.77 (0.76–0.79) | 191 | 214* | 537 | 0 | 1030 | 1181 | 7 KiB | 32 |
| Flutter wasm | desktop | cold | 0.86 (0.79–0.87) | 229 | 334* (201–1297) | 298 (276–352) | 0 | 1598 | 1846 (1840–1949) | 2636 KiB | 34 |
| Flutter wasm | desktop | warm | 0.90 (0.89–0.90) | 191 | 224* | 263 | 0 | 745 | 837 | 7 KiB | 33 |
| Flutter JS + preload hints | desktop | cold | 0.69 (0.64–0.70) | 481 | 1762* | 492 | 0 | 1826 | 3063 | 2997 KiB | 34 |
| Static landing, no prefetch | desktop | cold | 1.00 | 178 | 201 | 0 | 0 | 178 | 201 | 2 KiB | 2 |
| Static landing + prefetch | desktop | cold | 0.89 | 184 | 2203 | 0 | 0 | 184 | 2203 | 2325 KiB | 6 |
| Next.js hello | desktop | cold | 1.00 | 175 (173–175) | 417 (396–424) | 0 | 0 | 175 | 417 | 116 KiB | 7 |
| Next.js hello | desktop | warm | 1.00 | 169 | 216 | 0 | 0 | 169 | 216 | 3 KiB | 7 |

\* **For every Flutter row, LCP is the splash `<div id="loading-indicator">`, not app content.** Confirmed in the applied runs with a `PerformanceObserver`: 18 of 18 LCP entries were `DIV:京大InfoHub を読み込み中`. The same is true of FCP. Every Flutter run (36 of 36) carried the Lighthouse warning "The page loaded too slowly to finish within the time limit", caused by the never-idle Firestore listen channel. Treat those rows as indicative.

### 4.2 Applied throttling: time until the app's first frame (`flutter-first-frame` event)

These runs measure what Lighthouse cannot see inside the canvas: the moment the login screen is first drawn. median (min–max), n=3, ms from navigation start. "Last font" = wall-clock time of the last font response, i.e. when the Japanese text is fully drawn.

| Target | Preset | Load | FCP (splash) | **App first frame** | Last font response | Transfer | Requests |
|---|---|---|---|---|---|---|---|
| Flutter JS (current) | mobile | cold | 680 | **18,949 (18,833–19,035)** | 22,422 | 2995 KiB | 30 |
| Flutter JS | mobile | warm | 660 | **4,509 (4,427–4,549)** | 5,367 | 6 KiB | 30 |
| Flutter wasm | mobile | cold | 664 | **17,655 (17,532–17,709)** | 20,942 | 2633 KiB | 31 |
| Flutter wasm | mobile | warm | 672 | **2,778 (2,724–2,988)** | 3,681 | 6 KiB | 31 |
| Flutter JS + preload hints | mobile | cold | 668 | **17,664 (17,597–17,684)** | 21,000 | 2995 KiB | 31 |
| Flutter JS + preload hints | mobile | warm | 692 | 4,301 (4,275–4,405) | 5,185 | 6 KiB | 31 |
| Landing (+prefetch) → 15 s dwell → click to `/app/` | mobile | after landing | 640 (landing) | **8,449 (8,448–8,714)** after click | 27,600 (from landing start) | 674 KiB after click | 30 |
| Flutter JS (current) | desktop | cold | 92 | **2,827 (2,825–2,884)** | 3,896 | 2995 KiB | 30 |
| Flutter JS | desktop | warm | 84 | 1,189 (969–1,241) | 1,640 | 6 KiB | 30 |
| Flutter wasm | desktop | cold | 92 | 2,518 (2,507–2,593) | 3,550 | 2633 KiB | 31 |
| Flutter wasm | desktop | warm | 84 | 530 (503–636) | 932 | 6 KiB | 31 |
| Flutter JS + preload hints | desktop | cold | 96 | 2,674 (2,671–2,781) | 3,686 | 2995 KiB | 31 |
| Landing (+prefetch) → 15 s dwell → `/app/` | desktop | after landing | 76 | 1,597 (1,538–1,717) | | 674 KiB | 30 |

For comparison, a static or Next.js page shows real content at its LCP (0.75 s and 1.35 s mobile in §4.1). For the Flutter app, the comparable moment is the first-frame column.

## 5. What a crawler or link preview sees

`curl` of `/` without JS (same bytes as `web/index.html` after build):

| Item | Value |
|---|---|
| `<title>` | `京大InfoHub` (MaterialApp `title` is set only after JS runs) |
| `meta description` | present: "京大生専用の過去問、テスト対策情報共有、教科書の貸借マッチングサービス…". It mentions textbook **lending**, which v1 drops per spec §3 |
| OG / Twitter | `og:type/url/title/description` present. `og:image` = `https://kyodai-info.web.app/favicon.png`, a **64×64** PNG, while `twitter:card=summary_large_image` asks for a large image |
| `<meta name="viewport">` | **absent** in the served HTML |
| Server-rendered body text | only `京大InfoHub を読み込み中 / 初回ロードには数秒かかる場合があります...` |
| `/robots.txt`, `/sitemap.xml` | **do not exist**. Both return `index.html` with 200 `text/html` via the `**` rewrite (soft 200) |
| Deep paths (`/course/123`, `/anything`) | 200 + identical `index.html`. The app has no path routing (`home:` only, `MaterialPageRoute` pushes, no `routes`/`onGenerateRoute`, no path URL strategy), so no screen has its own URL |
| Accessibility tree after JS | only `<flt-semantics-placeholder aria-label="Enable accessibility">` and 0 `flt-semantics` nodes until a user activates it. After activating it, the signup screen's text appears (e.g. 京大生専用プラットフォーム / 京都大学のアカウントでサインイン / 新規アカウント登録 / 担当教員・権利者の方へ（掲載資料の削除依頼）) |
| Reachable without login | `SignupScreen` (signup/login, email-link sign-in) and `TakedownScreen` (opened from the signup screen). `OnboardingScreen` and `NavigationRootScreen` (tabs さがす/時間割/教科書/マイページ) and everything under them require `currentUser != null` (`lib/main.dart`) |
| Publicly readable data | none. In `firestore.rules`, every `allow read` is `kuDomain()` (signed in with `@st.kyoto-u.ac.jp`), `owns(uid)`, a signed-in owner check, or `false`. `storage.rules`: `get` requires `kuDomain()` |
| Indexable content today | the HTML head and the splash line only. Even a JS-rendering crawler (Googlebot renders JS) would reach the signup form, not course content. Whether Googlebot renders the CanvasKit app at all was not tested |

## 6. Prototyped mitigations (scratchpad copies only; the repo is unchanged)

| Mitigation | How it was prototyped | Measured effect | Verdict from the data |
|---|---|---|---|
| **Static public landing page** in front of the app (app moved to `/app/`) | Hand-written 2.3 KB HTML with real Japanese text, OG tags and system fonts, no JS. Flutter rebuilt with `--base-href /app/` | Landing alone: Lighthouse mobile LCP 752 ms, score 1.00, 2 KiB, 2 requests (desktop 201 ms). The content text is in the HTML, so a crawler or link preview sees it | Gives crawlers and link previews real content. The cost is one extra click to the app |
| Landing + `<link rel=prefetch>` of `main.dart.js` and the CanvasKit wasm/js | as above, plus 4 prefetch hints | Applied throttling, 15 s dwell then click: app first frame **8.4 s vs 18.9 s** cold (mobile), 1.6 s vs 2.8 s (desktop). Lighthouse-simulated LCP of the landing page itself rose to 13.0 s and the score fell to 0.75: Lantern models the 2.3 MB of prefetches as competing for bandwidth with the page. In the applied run the landing's own FCP/LCP was 640 ms | Worth considering, with two caveats: the gain depends on how long visitors stay on the landing page, and the hints cost visitors who never click through about 2.3 MB of mobile data |
| `<link rel=preload/modulepreload/preconnect>` in `index.html` (main.dart.js, canvaskit wasm/js, Firebase SDK modules, fonts.gstatic, firestore) | edited the built `index.html` only | Applied: app first frame 17.7 s vs 18.9 s (−6.8%) mobile, 2.67 s vs 2.83 s desktop. Lighthouse simulated: FCP got worse (2.25 s vs 0.65 s) and LCP 10.2 s, because the splash paint now competes with the preloads | Small real gain, and it makes Lighthouse scores worse. Low value |
| `--wasm` build | built and measured | Cold first frame −1.3 s (mobile) / −0.3 s (desktop). Warm first frame 2.8 s vs 4.5 s (mobile), 0.53 s vs 1.19 s (desktop). TBT −33% (mobile). Bytes −12% | Measured on Chromium only. Browsers without WasmGC fall back to the JS build automatically; Safari/iOS behaviour was **not measured** |
| Favicon / icon trimming | checked | already done (388 B). Nothing to gain | done |
| Icon-font tree-shaking | already the default | 1.9 MB → 18 KB already | done |
| Bundle a Japanese font / set a JP font family | not prototyped (requires `lib/` change and font licensing/subsetting choice) | — | **untested**. Observed 381 KB / 13 requests of SC/HK/JP fallback subsets, plus a possible Chinese glyph-form issue |
| Defer Firebase init / show UI before `initializeApp` | not prototyped (requires `lib/main.dart` change) | — | **untested**. Would also fix the blank page when gstatic is unreachable |
| Deferred loading (`deferred as`) of rarely used screens | not prototyped (requires `lib/` change) | — | **untested**. The upper bound on savings is part of the 738 KB br `main.dart.js` |
| Caching headers | read `firebase.json` (not changed) | — | see §7 |

## 7. Config observations (read only; not measured in production)

- `firebase.json` gives `max-age=31536000, immutable` to everything except `index.html`, `flutter_bootstrap.js` and `flutter_service_worker.js`. That includes `main.dart.js`, `main.dart.wasm`, `assets/**` and the locally served `canvaskit/**`. **These filenames are not content-hashed, and the bootstrap loads `main.dart.js` without a version query** (checked in the built `flutter_bootstrap.js`). After a deploy, a returning browser may keep running an old `main.dart.js` with a new `flutter_bootstrap.js`. Fix options: `no-cache` (revalidate with ETag) for those paths, or versioned paths. This is a correctness risk, separate from the stack decision.
- The service worker is the deprecated self-unregistering stub, so repeat-visit speed relies entirely on the HTTP cache headers above.
- No `robots.txt` / `sitemap.xml` files, and the catch-all rewrite turns them into soft-200 HTML.
- If `www.gstatic.com` (Firebase JS SDK) is unreachable for a user (school or corporate filters, outages), the app shows a blank page indefinitely (§2).

## 8. Not measured: needs real-device or production data

- Real users' devices and networks (Kyoto students' iPhone/Android mix, campus Wi-Fi, mobile carriers). CPU ×4 here is relative to a fast sandbox host and is not a calibrated phone.
- **iOS Safari / WebKit**: no WebKit browser was used. It matters for wasm fallback behaviour and CanvasKit performance.
- Production Firebase Hosting: HTTP/2 and HTTP/3, CDN edge in Japan, actual compression of `.wasm`, real cache behaviour.
- CanvasKit from the gstatic CDN (default build). It could not be loaded here.
- Firebase latency from Japan (Auth, Firestore listen, Storage). Here these went through the sandbox proxy from an unknown region.
- **Authenticated first load** (login → onboarding → さがす tab with course catalog/ranking queries). No credentials were available, and data volume and query latency were not measured.
- `apis.google.com` / auth iframe cost (blocked here).
- Search Console (impressions, indexing status, whether Googlebot renders the canvas), analytics/RUM (real LCP/INP, bounce on the splash), share-click-through data.
- INP and interaction latency after load (lab-only TBT was measured).
- A Next.js version of the real app. The hello-world numbers are a floor for an empty page and must not be read as a forecast.

## 9. Rewrite size (factual counts) and options

### 9.1 What a front-end migration would replace vs keep

| Area | Count | Changes in a Next.js migration? |
|---|---|---|
| Dart under `lib/` | 53 files, 11,662 lines (10,104 non-blank, non-`//` lines) | rewritten |
| `lib/views` | 18 files, 7,502 lines. 15 `*Screen` classes, 27 widget classes. 39 `MaterialPageRoute`/sheet/dialog call sites | rewritten (UI) |
| `lib/services` | 8 files, 1,791 lines (app_store, review, ranking, credit, moderation, market, chat, talk-room queries) | ported to TS |
| `lib/models` | 11 files, 1,549 lines | ported to TS |
| `lib/repositories` | 5 files, 416 lines | ported to TS |
| `lib/widgets`, `utils`, `config` | 2 + 6 + 1 files, 244 lines | rewritten |
| Flutter tests | 27 files, 2,670 lines. **181 tests, all passing** (`flutter test`, this run) | rewritten |
| Cloud Functions (TypeScript) | 18 `src/*.ts` files, 2,332 lines. 17 test files, ~220 `it/test` call sites (grep) | **unchanged** |
| Security rules | `firestore.rules` 403 lines, `storage.rules` 58 lines, indexes 55 lines. Emulator tests 1,269 lines, ~118 cases (grep) | **unchanged** (unless public read access is added) |
| Logic duplicated client/server | `test/models/course_stats_parity_test.dart` checks Dart stats match `functions/test/courseStats.test.mjs` | a TS front end could share the Functions code instead |

No person-day estimate is given: there is no measured velocity for this codebase to base one on. Basis for reasoning: about 11.7k Dart lines and 181 tests would be rewritten, while about 2.3k TS lines of Functions and 0.5k lines of rules with their tests stay as they are.

### 9.2 Options

**A. Keep Flutter Web as is**
- For: it works, it is tested (181 + ~220 + ~118 tests), the Phase 1–2 plans are built on it, and warm repeat visits are 1.2 s desktop / 4.5 s mobile in the lab.
- Against: a cold mobile first frame of about 19 s in the lab, about 3 MB of transfer, zero indexable or shareable content, a weak OG preview, and a blank page if gstatic fails.

**B. Keep Flutter for the app, add static public pages (landing / about / course-index pages generated at build time) plus head/OG/robots/sitemap fixes**
- For (measured): the landing page is 2 KiB with LCP 0.75 s mobile and real text in the HTML. With prefetch, the app's first frame after a 15 s dwell drops from 18.9 s to 8.4 s. Nothing in `lib/`, Functions or rules has to change for the landing page itself. Course-index pages could come from the existing `courses.json` build pipeline (see the Phase 1 plan).
- Against: the app itself stays 3 MB / ~19 s cold for anyone who deep-links into it. There are two stacks to maintain (small). Static pages that show reviews or stats need a deliberate decision to publish that data, either at build time via the Admin SDK or by adding public rules.

**C. Migrate the front end to Next.js**
- For: the empty-page floor is 116 KiB / LCP 1.35 s / TBT 89 ms mobile, about 26× fewer bytes than the current app's cold load. It gives real URLs, SSR/SSG and text-based accessibility, and the TS front end could share code with Functions.
- Against: it rewrites about 11.7k Dart lines and 181 tests while Functions and rules stay. The floor says nothing about the real app's size once Firebase SDK (~229 KB br measured here), UI and data loading are added; that was not measured. **And it would not by itself create indexable content, because every read is gated to `@st.kyoto-u.ac.jp` accounts.**

**Recommendation that follows from the data:** **B now**, as a measured, low-cost step, plus the config fixes in §7 and wasm/font/Firebase-init items as candidates to test next. **Do not migrate (C) on this evidence.** The two things that would justify C are not measured yet: real-user load times from production RUM, and a product decision to make course or review content public, which would give SEO something to index. Re-evaluate after Phase 1 with those data, as the spec already plans. The lab data does not say whether the ~19 s cold mobile first frame is what real Kyoto users experience. That is the key unknown, and production RUM (for example Firebase Performance or web-vitals with a custom "first-frame" mark) is what answers it.

## 10. How to reproduce

All work was in the session scratchpad. Copy the tree first so the repo's `build/` is untouched: `git archive HEAD | tar -x -C <scratch>/app`.

```bash
export PATH=/opt/tools/flutter/bin:$PATH CI=true
cd <scratch>/app && flutter pub get
flutter build web --release                                   # deploy build (CDN engine)
flutter build web --release --no-web-resources-cdn            # measured JS build
flutter build web --release --wasm --no-web-resources-cdn     # measured wasm build
flutter build web --release --no-web-resources-cdn --base-href /app/   # landing prototype

# sizes: walk build dir, zlib gzip level 9 and brotli quality 11 per file (Node zlib)
# server: node server.js <dir> <port>  (SPA fallback, firebase.json Cache-Control, br/gzip incl. wasm)

npm i lighthouse@13.5.0 playwright-core chrome-launcher
# Lighthouse: programmatic API, 3 runs, each: fresh Chrome -> cold run, then same Chrome with
#   disableStorageReset:true -> warm run. Mobile = default config; desktop = lighthouse/core/config/desktop-config.js
#   chromeFlags: --headless=new --no-sandbox --proxy-server=$HTTPS_PROXY
#   CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome, HOME=<scratch>/chromehome (NSS db with proxy CA)
# Applied throttling (Playwright + CDP): Network.emulateNetworkConditions {latency:562.5,
#   downloadThroughput:1474.56*1024/8, uploadThroughput:675*1024/8}, Emulation.setCPUThrottlingRate {rate:4};
#   viewport 412x823 @1.75, isMobile, locale ja-JP; init script records 'flutter-first-frame',
#   paint FCP and LCP entries (with element) via PerformanceObserver.
npx next@16.3.8 build   # app/layout.js + app/page.js (one <h1>, one <p>), next.config.mjs {output:'export'}
```

Checks to run against production (not possible from this sandbox):

```bash
curl -sI -H 'Accept-Encoding: br' https://kyodai-info.web.app/main.dart.js | grep -i -E 'content-encoding|cache-control|content-length'
curl -sI -H 'Accept-Encoding: br' https://www.gstatic.com/flutter-canvaskit/42d3d75a56efe1a2e9902f52dc8006099c45d937/chromium/canvaskit.wasm | grep -i -E 'content-encoding|content-length'
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://kyodai-info.web.app/robots.txt
npx lighthouse https://kyodai-info.web.app/ --preset=desktop   # and the mobile default, from a machine in Japan
```
