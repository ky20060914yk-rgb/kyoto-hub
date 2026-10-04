# Spike: should the Flutter Web client be rewritten in Next.js? — results

Date: 2026-10-04. Branch: `master-wf96b2`.
Companion: `docs/analysis/2026-10-04-flutter-web-vs-nextjs-measurements.md`.

**Part A** (this part) is read-only analysis of the repository and of installed package sources.
No timings, no builds of the app, no deploys. Every number below is either counted from the repo
(command or file cited) or explicitly labelled **estimate** with its basis.

Legend: **[verified-code]** = read in this repo or in installed package sources;
**[verified-test]** = observed in a local test run; **[unverified]** = reasoning only, needs a test.

## Part A.1 — Rewrite scope

All counts are from `wc -l` / `grep -c` on the tree at `7abb8fb` (the commit before this report).
Test counts are `test(` + `testWidgets(` declarations (Dart) and `it(`/`test(` declarations (JS).

### A.1.1 Size of what would be rewritten [verified-code]

| Area (`lib/`) | Files | LOC | Dart tests (files / decls) |
|---|---:|---:|---|
| `views/` (screens) | 18 | 7,502 | `test/views` 4 / 20 |
| `widgets/` | 2 | 142 | `test/widgets` 1 / 6 |
| `services/` | 8 | 1,791 | `test/services` 8 / 73 |
| `repositories/` | 5 | 416 | `test/repositories` 2 / 27 |
| `models/` | 11 | 1,549 | `test/models` 11 / 54 |
| `startup/` (Plan 4) | 4 | 46 | `test/startup` 1 / 5 |
| `utils/` (web interop: download, picker, localStorage) | 6 | 94 | — |
| `config/`, `main.dart`, `firebase_options.dart` | 3 | 176 | `widget_test.dart` 1 |
| `test/web/static_pages_test.dart` (checks `web/` HTML) | — | — | 1 / 6 |
| **Total** | **56** | **11,716** | **30 files, 2,807 LOC, 192 decls** |

Host page / web shell: `web/index.html` 150 lines (Plan 4 start screen + failure screen),
`web/flutter_bootstrap.js` 59 lines (Plan 4 build-id cache busting), `web/about/index.html` 134 lines,
`web/manifest.json`, `robots.txt`, `sitemap.xml`, `og-image.png`.

### A.1.2 What is reused unchanged vs thrown away [verified-code]

Reused unchanged (the backend contract does not depend on the client framework):

| Item | Size |
|---|---|
| Cloud Functions `functions/src/*.ts` | 19 files, 2,332 LOC |
| Functions tests `functions/test/*.mjs` + `testlib/` | 17 + 2 files, 2,710 + 79 LOC, 220 decls |
| `firestore.rules` / `storage.rules` | 403 / 58 LOC |
| Rules tests `firestore-tests/rules.test.mjs` / `storage.test.mjs` | 1,161 / 108 LOC, 109 / 9 decls |
| `firestore.indexes.json` | unchanged (same queries must be re-issued, see A.1.4) |
| `tools/` (seed, migrate, moderate, backfill, courses.json build) | unchanged |
| `docs/` plans and spec | unchanged, but every client-side plan task would need a re-check against the new client |
| `web/about/`, `robots.txt`, `sitemap.xml`, `og-image.png`, icons | reusable as-is (plain static files) |

Thrown away (or rewritten from scratch):

| Item | Size |
|---|---|
| Dart client `lib/` | 56 files, 11,716 LOC |
| Dart tests `test/` | 30 files, 2,807 LOC, 192 decls (the *behaviour* they pin down must be re-tested in TS) |
| Plan 4 Flutter-specific work | `lib/startup/` (46 LOC + 5 tests), `web/index.html` start/failure screen (150), `web/flutter_bootstrap.js` (59), `tools/perf/check_start_screen.mjs` (125) and `tools/perf/check_web_cache.mjs` (156, checks `main.dart.js?v=`) — the *goals* (no blank page, no stale code after deploy) remain and need Next.js equivalents |
| `tools/perf/measure_web.mjs` first-Flutter-frame probe | needs a new "app ready" signal |
| Android / iOS folders | not used by the web build; a JS client would not serve them (out of scope: the spec targets web) |

### A.1.3 Screens, grouped by difficulty [verified-code for the signals; grouping is judgement]

Signals per file: LOC, number of dialogs/bottom sheets, input fields, stream/future builders, tabs, grid/layout code.
There is **no URL routing** in the Flutter app (all navigation is `Navigator.push(MaterialPageRoute)` and an
`IndexedStack`-style root, `lib/views/navigation_root_screen.dart`), so URL routes would be *new* work in Next.js.

| Group | Screen file (LOC) | Notes / non-trivial React gap |
|---|---|---|
| Simple (10) | `notifications_screen` (102), `course_detail_screen` (92, tab shell), `onboarding_screen` (223), `contact_screen` (213), `takedown_screen` (214, 4 fields, callable `submitTakedown`), `listing_detail_screen` (182, photo `getDownloadURL`, clipboard share), `navigation_root_screen` (179), `widgets/credit_rules_dialog` (62), `widgets/policy_notice_gate` (80), `listing_form_screen` (226, 4 fields + photo pick/upload) | forms map 1:1 to controlled inputs; dialogs need an accessible modal component (focus trap) |
| Medium (5) | `signup_screen` (512, signup/login/verification states), `market_screen` (265, tabs + 2 streams), `search_screen` (515, client-side search over the cached catalog), `review_form_sheet` (355, 3 dialogs, star inputs), `my_page_screen` (660, 6 dialogs, ledger, invitation code → clipboard) | bottom sheets → responsive sheet/modal; star rating input needs keyboard a11y |
| Hard (5) | `course_resource_tab` (1,133, 9 dialogs, 7 fields, file pick → Storage upload, signed-URL download), `course_review_tab` (743, 9 classes, 7 stream/future builders), `home_screen` (895, **timetable grid** 5 days × 5 periods with grid/list toggle, 7 layout/grid hits), `timetable_registration_screen` (599, grid + 4 fields + custom-course creation), `textbook/talk_room_screen` (394, chat: live window + history pages, send, read marker, block/report/rate dialogs) | timetable grid → CSS grid, must be responsive at phone width; chat → virtualised/reverse list with scroll-anchoring on "load older" and IME-safe Enter (below) |

### A.1.4 Firebase features used, and the JS-SDK equivalent [verified-code]

FlutterFire web is a wrapper over the Firebase JS SDK: `firebase_core_web 3.12.0` (pubspec.lock) pins
`supportedFirebaseJsSdkVersion = '12.19.0'` (`~/.pub-cache/hosted/pub.dev/firebase_core_web-3.12.0/lib/src/firebase_sdk_version.dart:9`)
and loads `https://www.gstatic.com/firebasejs/$version/firebase-<service>.js` at runtime (`firebase_core_web.dart:236`).
So **every Firebase call below already runs on the JS SDK 12.19.0** — a Next.js client calls the same API
directly (modular `firebase@12.x` from npm, bundled instead of fetched from gstatic).

| Feature | Where (Dart) | Exact usage | JS SDK equivalent / gap |
|---|---|---|---|
| App init | `main.dart:21` | `Firebase.initializeApp(options: currentPlatform)`, default app name `[DEFAULT]` (no `name:` passed; `firebase_core_web.dart:333`), wrapped in a 30 s timeout (`startup/startup.dart`) | `initializeApp(config)`; same name `[DEFAULT]` by default |
| Firestore persistence | `main.dart:29-32` | `persistenceEnabled: true`, `CACHE_SIZE_UNLIMITED` → `persistentLocalCache({cacheSizeBytes})`, no tab manager = SDK default single-tab (`cloud_firestore_web-5.7.1/lib/cloud_firestore_web.dart:156-180`) | `initializeFirestore(app, {localCache: persistentLocalCache(...)})`. **Must be kept**: `CourseRepository` relies on the on-device cache to avoid a full ~10k-doc `Source.server` read per visit (`course_repository.dart:91-142`, `meta/catalog` count check) |
| Auth: password signup | `app_store.dart:342-370` | `createUserWithEmailAndPassword` → `sendEmailVerification()` **without ActionCodeSettings** → profile write; domain check `@st.kyoto-u.ac.jp` is client-side + rules | same calls; the verification link goes to Firebase's hosted handler on `authDomain` (`kyodai-sns.firebaseapp.com`, `firebase_options.dart:54`), **not back into the app**; the user returns manually |
| Auth: verification check | `app_store.dart:428-455` | `user.reload()` + `getIdToken(true)` (rules read `email_verified`), then `claimWelcomeCredits` | same; no URL handling needed |
| Auth: password login | `app_store.dart:380-410` | `signInWithEmailAndPassword` + profile read | same |
| Auth: email-link sign-in | `app_store.dart:205-236` | **receive side only**: `isSignInWithEmailLink(location.href)` + `signInWithEmailLink(email from localStorage['emailForSignIn'])`. No `sendSignInLinkToEmail` exists in `lib/`, and `saveEmailForSignIn` is only ever called with `''` (`app_store.dart:230`), so this branch is effectively dead code | port or drop; Next.js would need a route that keeps the query string (`apiKey`, `oobCode`, `mode`) |
| Auth: state | `app_store.dart:240` | `authStateChanges()` → profile + streams | `onAuthStateChanged` |
| Auth: logout | `app_store.dart:410-427` | **`logout()` never calls `FirebaseAuth.signOut()`** (no `signOut` anywhere in `lib/`): it only clears in-memory state, so a reload restores the session | a port should fix this (a behaviour change to call out and test) |
| Firestore streams | 17 `.snapshots()` in `lib/` | posts, requests, credit balance/code/ledger, notifications, talk rooms (two equality queries merged, `talk_room_queries.dart`), reviews, course stats, listings | `onSnapshot`; same queries ⇒ same composite indexes |
| Firestore one-shot reads | 10 `.get()` | profile, timetable, catalog meta, history pages | `getDoc/getDocs` |
| Transactions | `review_service.dart:94,116` | `runTransaction` (review + helpful votes, `FieldValue.arrayUnion`) | `runTransaction`, `arrayUnion` |
| Server timestamps | `chat_service.dart`, `post_repository.dart`, `user_repository.dart` | `FieldValue.serverTimestamp()` (messages, read markers, posts, policy-notice flag) | `serverTimestamp()`; UI must handle the pending-null `createdAt` of a local write |
| Chat | `chat_service.dart` | page size 30; `streamLatest` (newest 30 live), `loadOlder(before)` (`createdAt <` cursor, desc, limit), then switch to `streamSince(oldestLoaded)` live and unbounded; `send` (≤ `kChatMaxMessage` runes), `markRead` | same queries; UI gap: reverse list with scroll anchoring when history is prepended |
| Callables, region `asia-east1` | `credit_service.dart:57`, `market_service.dart:186`, `moderation_service.dart:102` | 10 callables: `claimWelcomeCredits`, `downloadResource`, `reportPost`, `submitTakedown`, `createListing`, `updateListing` (actions `edit`/`renew`/`close`), `openListingChat`, `blockRoom`, `reportMarket`, `rateDeal`. All exported in `functions/src/index.ts:43-119` with `region: REGION` | `httpsCallable(getFunctions(app,'asia-east1'), name)`; error codes map from `FunctionsError.code` (`functions/<code>` prefix differs from Dart's bare code — mapping tables in `CreditException.fromCode` etc. must be re-checked) |
| Storage upload | `app_store.dart:622-627` (resources), `:654-658` (listing photos) | `ref(path).putData(bytes, SettableMetadata(contentType))`; paths `resources/<uid>/<millis>_<safe>` and `listings/<uid>/<millis>_<safe>` (the only shapes `storage.rules` accept) | `uploadBytes(ref, file, {contentType})`; can pass the `File` directly (no ArrayBuffer copy) |
| Storage read | `listing_detail_screen.dart:173` | `getDownloadURL()` for listing photos | `getDownloadURL` + `<img>` |
| Signed-URL download | `app_store.dart:589`, `utils/download_helper_web.dart` | callable `downloadResource` returns a signed URL with `Content-Disposition: attachment`; client navigates a hidden `<a target=_self>` (popup blockers kill `window.open` after an await) | identical DOM code |
| File picker | `utils/file_picker_helper_web.dart` | hidden `<input type=file accept=".pdf,.png,.jpg,.jpeg,.webp">`; note: a cancelled dialog never completes the future (no cancel handling) | native `<input type=file>`; can use the `cancel` event |
| Share | `listing_detail_screen.dart:93`, `my_page_screen.dart:435` | **clipboard only** (`Clipboard.setData`), no Web Share API | `navigator.clipboard.writeText` (+ optional `navigator.share`) |
| Notifications | `moderation_service.dart` (`notifications` where uid, orderBy createdAt desc), `notifications_screen.dart` | in-app list from Firestore + mark read; **no FCM/push** in pubspec | same query |
| One-time policy notice | `widgets/policy_notice_gate.dart` | dialog shown once when `users/{uid}.policyNoticeV2SeenAt` is absent; dismiss writes server timestamp | a context provider + modal |
| Start screen / bootstrap (Plan 4) | `web/index.html`, `web/flutter_bootstrap.js`, `lib/startup/` | HTML start screen visible without JS, 8 s hint, failure screen with retry, Firebase init timeout, build-id cache busting | mostly unnecessary: a Next.js page *is* HTML, and hashed chunk names solve stale code; the "Firebase SDK failed to load" failure mode largely disappears when the SDK is bundled (no gstatic fetch) — but a Firestore/Auth network failure still needs a visible error state |

### A.1.5 UI gaps that are not 1:1 [judgement, from the code above]

- **Timetable grid** (`home_screen.dart`, `timetable_registration_screen.dart`): 5×5 grid + list toggle; CSS grid is simpler than Flutter's layout, but phone-width behaviour must be designed and tested.
- **Responsive layout**: the Flutter screens use a handful of `MediaQuery`/`LayoutBuilder` checks; a DOM layout needs explicit breakpoints at 360–420 px.
- **Japanese IME in chat input** (`talk_room_screen.dart:357-366`, `onSubmitted` sends): in React an `onKeyDown` Enter handler must ignore `event.nativeEvent.isComposing` (Enter that confirms a kana→kanji conversion must not send). A native `<input>` handles composition itself; whether Flutter web currently mishandles it was **not tested** [unverified].
- **Accessibility**: Flutter web draws to a canvas; `lib/` has 9 `Semantics`/`semanticLabel`/`tooltip:` occurrences in total. DOM gives native semantics for free, but modals, tabs, star-rating and the grid need correct ARIA. This is a gain, not a cost, if done properly.
- **Rich lists**: reviews, resources, market and chat lists; the catalog is ~10k courses (`tools/courses.json`), searched client-side (`search_screen.dart`), so long result lists need virtualisation or paging.
- **Routing/deep links**: new work (none exist today); also required for the auth guard and the email-link route.

### A.1.6 Effort range — ESTIMATE, wide error bars

There is no productivity data for this team in the repo; both bases below rest on **assumed** rates.
Treat the result as an order of magnitude, not a plan.

*Basis 1 — LOC ratio.* 11,716 Dart LOC + 2,807 test LOC to port. Assumed port-and-test rate for a
focused developer who knows React/Firebase: 300–800 LOC/day for app code, 400–800 LOC/day for tests →
15–39 days + 4–7 days. Add new work that Flutter does not have: URL routing + auth guard + Next.js/hosting
config + CI (3–6 days), cutover and re-verification of plans 2A/2B/3 flows (3–6 days). **≈ 25–58 days.**

*Basis 2 — component count.* 20 screen/widget files: 10 simple × 0.5–1.5 d, 5 medium × 1.5–3 d,
5 hard × 3–6 d = 27.5–60 days of UI; services/models/repositories (3,756 LOC) 5–10 days; tests 5–10 days;
infra 3–6; cutover 3–6. **≈ 44–92 days.**

**Combined: roughly 25–90 focused-developer-days (≈ 5–18 weeks)**, the spread coming mostly from the
assumed rates and from the five hard screens. Not included: design changes, the product decision about
public content, iOS/Safari device testing, and any bug-for-bug behaviour reconciliation found during cutover.
Part B's prototype (if it ports one real screen) is the cheapest way to replace the assumed rate with a measured one.

## Part A.2 — Auth cutover

Question: if `kyodai-info.web.app` switched from the Flutter build to a Next.js client using the Firebase
JS SDK (same Firebase project, same origin), would signed-in users stay signed in?

**Answer: yes, provided the new client uses the default app name, the same web `apiKey`, local
(IndexedDB/localStorage) persistence and a JS SDK that reads the same record. Verified both in source and
in a browser test against the Auth emulator, including with the real Flutter build, in both directions.**

### A.2.1 Where Flutter web stores the session [verified-code]

1. FlutterFire web does not have its own auth implementation. `firebase_auth_web 6.2.5` (pubspec.lock)
   creates the Auth instance with the JS SDK's `initializeAuth`, passing persistence
   `[indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence]` plus
   `browserPopupRedirectResolver` and `debugErrorMap`
   (`~/.pub-cache/hosted/pub.dev/firebase_auth_web-6.2.5/lib/src/interop/auth.dart:22-38`).
2. The JS SDK it loads is 12.19.0 (`firebase_core_web 3.12.0`, `firebase_sdk_version.dart:9`), fetched from
   `www.gstatic.com/firebasejs/12.19.0/` and exposed as `window.firebase_core`, `window.firebase_auth`, …
   (`firebase_core_web.dart:220-240`).
3. The app is the default app: `Firebase.initializeApp(options: …)` without `name` (`lib/main.dart:21`) →
   `[DEFAULT]` (`firebase_core_web.dart:333`).
4. The app never calls `setPersistence` (`grep -rn setPersistence lib/` → none).
5. In the JS SDK (`firebase 12.19.0` → `@firebase/auth 1.13.6`, installed at `tools/perf/node_modules`):
   - record key = `firebase:authUser:<apiKey>:<appName>` (`_persistenceKeyName`, `dist/esm/index-4NFEPWkC.js:2080`);
   - IndexedDB database `firebaseLocalStorageDb`, object store `firebaseLocalStorage`, key path `fbase_key` (`:8215-8218`);
   - `getAuth()` — what a Next.js client normally calls — uses **exactly the same hierarchy**
     `[indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence]` with
     `browserPopupRedirectResolver` (`:11262-11274`);
   - on start, `PersistenceUserManager.create` looks for the key in *every* persistence of the hierarchy and
     migrates a found user to the preferred one (`:2139-2199`), so even a different order would still find it.

So the stored session is `IndexedDB firebaseLocalStorageDb / firebaseLocalStorage / "firebase:authUser:<web apiKey>:[DEFAULT]"`,
on the origin `https://kyodai-info.web.app` (storage is per *app origin*; `authDomain`
`kyodai-sns.firebaseapp.com` plays no part in where the session is kept).

### A.2.2 Browser test [verified-test]

Script: scratchpad `cut/cutover.mjs` (not committed; ~120 lines). Auth + Firestore emulators
(`firebase emulators:start --only auth,firestore --project demo-spike`, open rules, scratch config),
one local origin serving (a) the Flutter release build of a **scratch copy** of `7abb8fb` whose only changes are
emulator wiring, demo config (`apiKey 'demo-key'`), an optional `?autologin=1` that calls Dart
`FirebaseAuth.instance.signInWithEmailAndPassword`, and a `signed-in-frame` event fired after
`NavigationRootScreen` builds; (b) JS-SDK test pages; (c) the CDN builds of the SDK from the npm package
(the sandbox blocks `www.gstatic.com`, so `main.dart.js`'s SDK URL is rewritten to the same files served
locally). Chromium 141 headless (`/opt/pw-browsers/chromium-1194`), fresh browser context per case.

| # | Page 1 (signs in) | Page 2 (fresh load, same origin, same context) | Session carried? |
|---|---|---|---|
| 1 | JS 12.19.0, `initializeAuth` with FlutterFire's exact options | JS 12.19.0 `getAuth()` (Next-style) | **yes** |
| 2 | JS 12.19.0 `getAuth()` | JS 12.19.0 FlutterFire-style `initializeAuth` (rollback direction) | **yes** |
| 3 | JS 12.19.0 FlutterFire-style | JS **11.10.0** `getAuth()` (older major, from `firestore-tests/node_modules`) | **yes** |
| 4 | JS 12.19.0 FlutterFire-style | JS 12.19.0 `getAuth()` on an app named `web` instead of `[DEFAULT]` | **no** (expected) |
| 5 | JS 12.19.0 with `setPersistence(browserSessionPersistence)` | new tab, `getAuth()` | **no** (expected; nothing written to IndexedDB) |
| 6 | JS 12.19.0 `getAuth()` | **real Flutter build**: `window.firebase_auth.getAuth(getApp()).currentUser` | **yes** |
| 7 | JS 12.19.0 `getAuth()` (user has a `users/{uid}` profile) | **real Flutter build**: Dart `AppStore` reaches `NavigationRootScreen` without any login typed | **yes** |
| 8 | **real Flutter build**, Dart sign-in (`?autologin=1`) | JS 12.19.0 `getAuth()` | **yes** |

IndexedDB keys after every local-persistence sign-in, Flutter included: exactly
`["firebase:authUser:demo-key:[DEFAULT]"]`. The only localStorage key the Flutter build left was
`kyotohub.build` (Plan 4 cache busting) — the session is not in localStorage.

Limits of this test: emulator, not production Auth; Chromium only (no Safari/iOS, where ITP storage
eviction applies to both clients equally and was not tested); one SDK pair per direction. Case 7 needs the
user's `users/{uid}` document — the Flutter `AppStore` only treats a user as signed in when the profile
exists (`app_store.dart:240-252`). An earlier, lost attempt of this spike recorded a failure for the
Next→Flutter direction; it was not reproduced here, and its cause is unknown (missing profile is one
possibility) — **[unverified]**.

### A.2.3 What could break the hand-over

| Cause | Effect | Status |
|---|---|---|
| Different app name (`initializeApp(cfg, 'web')`) | different key → signed out | verified (case 4) |
| Different web `apiKey` (e.g. a new Web App registered in the console) | different key → signed out | verified by key format in source; use the **same** web app config |
| `setPersistence(browserSessionPersistence / inMemoryPersistence)` or `initializeAuth` with session-only persistence | nothing in IndexedDB → signed out on next visit | verified (case 5) |
| Different origin (e.g. Next on `kyodai-info-next.web.app` or a custom domain) | storage is per origin → signed out; also needs Auth authorized domain | follows from browser storage rules; not tested |
| SDK major-version change | record is the serialised `UserImpl`; 11↔12 worked (case 3); 9/10 or a future 13 not tested | partly verified |
| `authDomain` change | does not affect stored session; affects only popup/redirect and action links | source reasoning |
| Server-side rendering expecting the user | the session is in IndexedDB, **invisible to the server**; SSR of signed-in pages needs a cookie (JS SDK has an experimental `authTokenSyncURL` hook in `getAuth`, `:11275-11286`, or Admin-SDK session cookies) | verified that no cookie exists today |
| Firestore offline cache | Flutter uses `persistentLocalCache` single-tab (A.1.4). The JS SDK error text says shared access needs multi-tab enabled "in all tabs" (`@firebase/firestore 4.17.2`). During cutover a still-open Flutter tab and a new Next tab may contend for the cache lease; what each app then shows was **not tested**. Cached data is a cache — losing it costs one catalog re-read, not data | [unverified] |

### A.2.4 E-mail verification and e-mail-link URLs [verified-code]

- Verification mail: `sendEmailVerification()` **without ActionCodeSettings** (`app_store.dart:349,460`) → the link
  points at Firebase's default action handler on `kyodai-sns.firebaseapp.com`, not at a hosting path. The app
  learns about it only through `checkEmailVerification()` (`reload()` + `getIdToken(true)`). **Unaffected by
  the framework switch**, including mails sent before the cutover. (Whether a custom action URL is set in the
  Firebase console template cannot be seen from the repo — check once in the console.)
- E-mail-link sign-in: only the receiving branch exists and it can never succeed (no sender; stored e-mail is
  only ever set to `''`). A Next.js port can drop it; if kept, every route must leave `?mode=…&oobCode=…`
  intact (Plan 4 kept `/?mode=signIn&oobCode=…` serving the app).
- Password reset: not implemented in `lib/` (no `sendPasswordResetEmail`).

### A.2.5 PWA manifest and service worker [verified-code]

- `web/manifest.json`: `start_url: "."`, `display: standalone`, scope implicit `/`. A Next.js export can ship the
  same file (same URL `/manifest.json`), so installed home-screen icons keep working.
- Flutter's `flutter_service_worker.js` (in `build/web`) is a **self-unregistering stub** (install → skipWaiting;
  activate → `registration.unregister()` + navigate clients). Browsers that ever registered it will re-fetch it on
  update checks. **Keep serving this exact stub at `/flutter_service_worker.js` after the cutover** (cheap); if the
  file 404s, the old registration simply stays registered without fetch handlers. Whether an older, *caching*
  Flutter service worker was ever deployed to real users is not knowable from the repo [unverified].
- Today `firebase.json` sends `Cache-Control: no-cache` for everything and one day for PNGs; Plan 4 notes that
  older deploys cached files as `immutable` for a year. Next.js hashed `/_next/static/*` names are new URLs, so
  old cached Flutter files cannot be served for them; `index.html` revalidates.

### A.2.6 Hosting options for Next.js [source reasoning; product facts not re-checked online]

| Option | How | Implications |
|---|---|---|
| **Static export** (`output: 'export'`) on the existing Hosting site | `public: out/`; `trailingSlash: true`; client-side auth guard; dynamic routes such as `/course/[id]` either pre-generated (`generateStaticParams`, e.g. from `tools/courses.json`, ~10k pages) or one shell page + a Hosting rewrite (`/course/** → /course/_/index.html`) | no server, no new cost, same deploy as today (`firebase deploy --only hosting`); no SSR, no per-request data; the closest match to today's architecture |
| **Server-rendered** Next.js | Firebase Hosting framework integration (deploys SSR into a Cloud Function) or Firebase App Hosting / Cloud Run behind Hosting | every dynamic request runs server code: Blaze billing per request/instance-time, cold starts, a region choice (functions here are `asia-east1`), Node runtime upgrades, a second deploy pipeline; useful only for content the server can render **without** the user's session (see A.2.3) |

The project already deploys Cloud Functions (v2 `onCall` / Firestore triggers in `functions/src/index.ts`), which
Firebase only allows on the Blaze plan, so Blaze is presumably active [inferred, not checked in the console].

### A.2.7 Must be re-verified after a cutover

1. Returning signed-in user lands signed in (desktop Chrome, Android Chrome, **iOS Safari**, installed PWA).
2. Sign-up → verification mail → "verified" check → `claimWelcomeCredits` grants 3 credits; rules see `email_verified`.
3. Logout actually signs out (today it does not — decide and test).
4. Every callable in `asia-east1` with its error mapping (`functions/<code>` prefix in JS, verified in
   `@firebase/functions 0.14.0`: `super(\`${FUNCTIONS_TYPE}/${code}\`)`).
5. Uploads to `resources/` and `listings/` paths accepted by `storage.rules`; signed-URL download starts without a popup block.
6. Chat: live window, older pages, read markers, Japanese IME Enter behaviour.
7. Catalog cache: second visit does not re-read ~10k `courses` from the server (`meta/catalog` check).
8. Policy notice shows once; onboarding for new users.
9. `/about/`, `robots.txt`, `sitemap.xml`, OG image, deep paths and query strings; `/flutter_service_worker.js` stub still served.
10. Rollback: re-deploying the Flutter build keeps sessions (case 2/7 above) — rehearse it.

## Part A.3 — Risks: migrate before vs after 2A/2B/3, cutover plan outline

### A.3.1 The fact that shapes this [verified-code]

The combined runbook (`docs/superpowers/plans/2026-10-05-phase3-textbook-market.md:7771` ff.) states that
none of 2A, 2B, 3 is deployed and that they ship as one sequence. That sequence is a **breaking backend change for
the client now in production**: the 2A migration removes `fileUrls`, the chat migration removes message arrays,
and the new rules refuse the old client's writes; hence "deploy hosting IMMEDIATELY after step 5b" (`:7852-7856`)
and "redeploying the previous hosting build alone is not enough" for rollback (2A plan `:2848`, 2B plan `:4228`).
By contrast, a later Flutter→Next switch on top of an already-deployed 2A/2B/3 backend changes **only the client**:
same rules, same data, same functions, and (A.2) the same session.

### A.3.2 Before vs after

| | Migrate **before** deploying 2A/2B/3 (Next client ships with the backend change) | Migrate **after** (deploy 2A/2B/3 + Plan 4 with Flutter now, switch client later) |
|---|---|---|
| Time to users getting 2A/2B/3 | delayed by the whole rewrite (A.1.6: ~25–90 dev-days, estimate) | now; runbook and 192 Dart + 220 functions + 118 rules/storage tests already exist |
| Blast radius of the deploy | backend migration + new rules + new client framework in **one** window; a bug cannot be attributed quickly to rules, migration or client | two smaller windows; the second one is client-only |
| Rollback | client rollback is possible (the Flutter build at the same commit is a valid client for the new backend, and sessions carry over — A.2.2 cases 2/7), but the backend rollback stays as hard as the runbook says | client rollback = redeploy the Flutter hosting build; data compatible both ways; sessions carry |
| Test baseline | the Next client must reach parity *before* the first production run of 2A/2B/3; the Dart tests that pin the 2A/2B/3 behaviour would be discarded before they ever guarded production | production behaviour of 2A/2B/3 is known first; the Next port can be tested against a known-good contract (and against the Flutter client side by side) |
| Wasted work | Flutter 2A/2B/3 UI and Plan 4 never get production use (the work is already spent either way) | Flutter UI is used for a while, then dropped; Plan 4's Flutter-specific hosting layer (bootstrap, start screen) is dropped at the switch |
| Moving target | none — the feature set is frozen at 2A/2B/3 | any feature added to Flutter during the rewrite must be ported too → needs a feature freeze or double implementation |
| Users see | one client change | two client changes (looks and behaves differently twice) |
| Security/abuse fixes in 2A/2B (server-side credits, moderation, takedown) | delayed with the rewrite | live now |

Judgement: the "after" path carries less risk per deploy and gets the server-side fixes live sooner; "before"
avoids one user-visible change and a period of keeping Flutter alive. The data for "before" being worth it would
have to come from Part B (how much the first load actually improves) and from a product decision on public
content (A.4) — neither exists yet.

### A.3.3 Other risks (either path)

- **Effort estimate risk**: the range is assumption-based (A.1.6); the five hard screens dominate it.
- **Behaviour drift**: the Dart code holds many small rules (domain check, rune-length limits, error-code → message
  maps, catalog cache freshness rule, policy-notice logic). Missing one is a silent regression; port the 192 Dart
  test cases as a checklist, not only the code.
- **Error-code mapping**: JS `FunctionsError.code` is `functions/<code>` (A.2.7 item 4) vs Dart's bare code.
- **Firestore cost**: losing the persistent cache (or using a different cache name/app) re-reads the ~10k-doc
  catalog per visitor; `CourseRepository` comments say this would exhaust the free read quota after a handful of visitors.
- **Logout bug carried or fixed**: today logout does not sign out (A.1.4); fixing it changes user-visible behaviour.
- **iOS Safari**: storage eviction and IME behaviour were not tested for either client.
- **Preview channels** (`kyodai-info--<channel>.web.app`) are a different origin: no shared session (expected), and
  whether they need adding to Auth authorized domains for this project was not checked [unverified].
- **Two clients open at once** during the switch (old Flutter tab, new Next tab): Firestore single-tab cache
  contention (A.2.3) [unverified].

### A.3.4 Cutover plan outline (if the owner chooses to migrate)

1. **Gate**: Part B numbers + an explicit decision on whether any content becomes public (A.4).
2. Deploy 2A/2B/3 + Plan 4 with Flutter per the existing runbook (recommended "after" path).
3. Build the Next.js client on a branch as a **static export**: same web app config (`apiKey`, default app name),
   `getAuth()` defaults, `persistentLocalCache`, `getFunctions(app,'asia-east1')`; port Dart tests to TS unit tests;
   add Playwright e2e against the emulators (the repo already has emulator-based suites and `tools/perf`).
4. Feature freeze on the Flutter client from parity-start to cutover (or a port-list for each change).
5. Test on a preview channel (separate origin; sign in again there).
6. Cutover: `firebase.json` `public` → the export dir, rewrites for dynamic routes, `Cache-Control: immutable` for
   `/_next/static/**` and `no-cache` for HTML; keep `/manifest.json`, icons, `/about/`, `robots.txt`, `sitemap.xml`,
   `og-image.png` and the `/flutter_service_worker.js` unregister stub. Deploy hosting only.
7. Run the A.2.7 list on production; watch callable error rates and Firestore read counts for a day.
8. Rollback = redeploy the last Flutter hosting build (keep it built and tagged); sessions survive (verified in emulator).
9. Delete the Flutter client only after a stable period.

## Part A.4 — What Next.js would and would not fix

(in progress)

## Part B — measured prototype (to be added)

Reserved for the Part B agent (built-and-measured Next.js prototype). Do not edit above this line
except to correct Part A.
