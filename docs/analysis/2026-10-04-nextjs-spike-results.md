# Spike: should the Flutter Web client be rewritten in Next.js? — results

Date: 2026-10-04. Branch: `master-wf96b2`.
Companion: `docs/analysis/2026-10-04-flutter-web-vs-nextjs-measurements.md`.

**Part A** (this part) is read-only analysis of the repository and of installed package sources.
No timings, no builds of the app, no deploys. Every number below is either counted from the repo
(command or file cited) or explicitly labelled **estimate** with its basis.

Legend: **[verified-code]** = read in this repo or in installed package sources;
**[verified-test]** = observed in a local test run; **[unverified]** = reasoning only, needs a test.

### Part A summary

- **Scope**: 56 Dart files / 11,716 LOC (7,502 in 18 screen files) and 192 Dart tests would be rewritten; 10 simple,
  5 medium, 5 hard screens/widgets. Reused unchanged: functions (2,332 LOC, 220 tests), rules (461 LOC, 118 tests),
  tools, plans. Every Firebase call already runs on the JS SDK 12.19.0 underneath FlutterFire, so the backend
  contract maps 1:1 (10 callables in `asia-east1`, streams, 2 transactions, server timestamps, 2 upload paths).
- **Effort (estimate, wide error bars)**: ~25–90 focused-developer-days, from LOC and component-count bases with
  assumed rates (A.1.6).
- **Auth cutover**: sessions carry over in both directions on the same origin when the new client uses the
  default app name, the same web apiKey and local persistence — verified in source **and** in a browser test
  against the Auth emulator with the real Flutter build (A.2.2). Not tested: production, Safari/iOS.
- **Found in passing**: `logout()` never calls `signOut()`; the e-mail-link sign-in branch can never succeed.
- **Before vs after 2A/2B/3**: 2A/2B/3 is a breaking backend change for the current production client; a later
  framework switch is client-only and data-compatible both ways. "After" is the lower-risk order (A.3).
- **Next.js would not fix** login-gated (non-indexable) content, Firestore start-up, real-user network; it
  **would** give HTML first paint, per-route splitting, real URLs, native a11y/IME, and allow dropping the
  eager Google auth iframe on mobile (A.4).

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
  catalog per visitor; the `CourseRepository` comment (`course_repository.dart:134-137`) puts a full fetch at ~10k
  reads per session, i.e. the Spark plan's 50k reads/day after five visitors (on Blaze: billed reads instead).
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

Measured numbers cited here come from the companion measurements doc (§1, lab conditions, not real users).

### A.4.1 What a rewrite would NOT fix

| Issue | Why the framework does not change it | Basis |
|---|---|---|
| **Login-gated content → nothing indexable** | every Firestore read rule is `kuDomain()`, `owns()`, a uid check or `false` (`firestore.rules`: all 37 `allow read` lines checked); Storage reads are `false` (`storage.rules:28,55`). Server-rendering cannot render data the server is not allowed to read without an Admin-SDK design and a product decision on what is public | [verified-code] |
| **Firebase SDK weight** | today the app downloads the SDK at runtime (0.23 MB brotli, measurements §1.3); a Next client bundles Auth + Firestore (+ Functions, Storage on demand) — tree-shaken, but Firestore with persistent cache is still the largest piece of a Firebase web app. Part B must measure the real first-load JS for the login page and for a signed-in screen | measured in companion doc for Flutter; Next figure = Part B |
| **Firestore connection start-up** | the listen channel, auth token fetch, and the catalog load (`CourseRepository.warmUp` → `meta/catalog` + cached or ~10k-doc server read, `course_repository.dart:91-142`) are the same calls in any client | [verified-code] |
| **Real-user network** | latency from Kyoto to Firestore and to `asia-east1` callables, mobile radio wake-up, school Wi-Fi filters — unchanged | not measured anywhere yet (companion doc §8) |
| **Google-hosted dependencies at runtime** | partly: a bundled SDK removes the `www.gstatic.com/firebasejs/` fetch (whose failure today means "no app", `lib/startup/startup.dart` comment) and the CanvasKit fetch; but Auth/Firestore/Functions endpoints are still Google APIs, and with the default `browserPopupRedirectResolver` the JS SDK loads `https://apis.google.com/js/api.js` + the auth iframe **eagerly on mobile browsers, Safari and iOS** (`_shouldInitProactively`, `@firebase/auth` `index-4NFEPWkC.js:2716,10833-10836,11314`) | [verified-code] |
| **Logic bugs** (e.g. logout not signing out) | would be ported unless explicitly fixed | [verified-code] |

### A.4.2 What a rewrite WOULD enable

| Enables | Detail | Basis |
|---|---|---|
| Real HTML first paint | the login screen and every public page are DOM/HTML from the first byte, with no 1.64 MB CanvasKit engine and no 0.74 MB `main.dart.js` before the first frame (measurements §1.3); the empty Next.js export floor was 116 KiB / 7 requests (§1.7). How close a *real* screen gets to that floor is Part B's question | companion doc + Part B |
| Per-route code splitting | the market, chat, course and my-page code load only when visited; Flutter ships one `main.dart.js` | framework property; size effect = Part B |
| Server-rendered or statically generated public pages | e.g. course pages or aggregate stats **if** the product decides they are public (today nothing is); static generation from `tools/courses.json` (~10k courses) needs no server | requires product decision |
| SEO / link previews per URL | real URLs + per-page `<title>`/OG tags; today every path serves the same `index.html` (no routes) | [verified-code] |
| Native accessibility and text behaviour | DOM semantics, browser find-in-page, copy/paste, screen readers, native IME composition in `<input>`; Flutter web has 9 semantics hints in `lib/` | [verified-code] for the count; benefit is judgement |
| Dropping the eager Google iframe | a password-only client can call `initializeAuth(app, {persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence]})` **without** `popupRedirectResolver`; the session key does not depend on the resolver (A.2.1), so hand-over is unaffected. FlutterFire hard-codes the resolver (`auth.dart:36`) | [verified-code]; startup effect = Part B |
| Simpler start-up/caching story | hashed `/_next/static/*` filenames + `no-cache` HTML replace Plan 4's build-id bootstrap and asset refresh | framework property |

### A.4.3 What Part B must measure (so the decision rests on numbers, not on the floors)

1. First-load JS/CSS bytes (brotli) and request count for: login page, a signed-in heavy screen (course detail or
   market), with the real Firebase modules the screen needs (Auth + Firestore persistent cache; Functions/Storage lazily).
2. Time to interactive login form and time to a **signed-in** rendered screen for a returning user (session in
   IndexedDB), mobile and desktop throttling identical to the companion doc, vs the Flutter build of the same commit.
3. Same with `getAuth()` vs `initializeAuth` without `popupRedirectResolver` on the mobile profile (A.4.2).
4. Static export vs `next start` (server) — whether SSR helps at all for login-gated screens (A.2.3 says it cannot see the session).
5. Growth: JS added per ported screen (to extrapolate to 20 screens), and the time it took to port one real screen
   (replaces the assumed rate in A.1.6).
6. Re-run the session hand-over (A.2.2) between the Part B prototype and the Flutter build.

## Part B — measured prototype

Status: **in progress** (written in checkpoints; sections marked *pending* are not measured yet).
Every number in Part B was measured in this session unless labelled **estimate** (with basis) or
**cited** (from the companion doc). Numbers from earlier, lost attempts were not reused.

### B.0 Summary — *pending*

### B.1 Prototype and conditions

**Prototype** (session scratchpad `partb/app`, never in the repo tree): Next.js **16.3.8** (App Router, Turbopack,
TypeScript, Tailwind 4.3.3), React **19.3.0**, Firebase JS SDK **12.19.0** modular (= `npm view` latest on 2026-10-05;
the SDK version FlutterFire 3.12.0 loads, A.1.4). It reuses, after reading, the leftover source of the lost attempt
(login, market, listing form/detail, takedown — ~700 lines) and adds this attempt's own code (auth variants, lab marks,
the course screen port in B.7). What a real app would import, and only there:

| Route | What it does | Firebase modules |
|---|---|---|
| `/` login | port of `SignupScreen`: e-mail+password login/signup, `@st.kyoto-u.ac.jp` check, referral field, verify-email state (`sendEmailVerification`, `reload` + `getIdToken(true)`), receive-side e-mail link; a returning signed-in user is sent to `/market/` | app + auth (static); Firestore only on submit (dynamic `import()`) |
| `/market/` heavy screen | port of the さがす tab of `market_screen.dart`: **real-time** `onSnapshot` on the same query as `streamListings` (`status == active`, `expiresAt > now`, `orderBy expiresAt desc`), **pagination** by widening the live window (20 → 40 → …, "もっと見る"), type chips + free-word filter (`filterListings` port), live credit balance stream, listing detail dialog with Storage `getDownloadURL` photos, clipboard share and the **`openListingChat` callable** | + Firestore with `persistentLocalCache` (single-tab, unlimited, like `main.dart:29-32`), Storage and Functions loaded on use |
| `/market/new/` | port of `ListingFormScreen`: validation, photo upload to `listings/<uid>/…`, `createListing` callable | Storage, Functions |
| `/course/?id=` | port of `course_detail_screen` + `course_review_tab` (B.7): 3 live streams, transaction | Firestore |
| `/takedown/` | `submitTakedown` callable form, reachable signed out | Functions |

**Backend: emulators only** (`firebase emulators:start --project demo-spike`, firebase-tools 15.32.1): the repo's
`firestore.rules`, `storage.rules`, `firestore.indexes.json` and the 10 **real callables** compiled from `functions/src`
(Firestore triggers are not loaded: their registration is blocked in this sandbox, as in the lost attempt). Seed:
1 verified KU user with profile + credit balance, a seller, **50 `textbook_listings`** (45 active, 10 with a photo in the
Storage emulator), 1 course with 12 reviews and its `course_stats`. All reads go through the real rules (`kuDomain()`).

**Flutter comparison build** (`partb/flutter-emu`): `git archive 7abb8fb`, `flutter build web --release --no-web-resources-cdn`
(Flutter 3.41.9), changed **only** in a scratch copy: demo-spike config + emulator wiring, `?autologin=1` (Dart sign-in),
`?tab=market` (start on the 教科書 tab), and two lab events (`signed-in-frame` after `NavigationRootScreen` builds,
`market-rendered` after the first frame that draws listings). Firebase SDK served same-origin (gstatic is blocked,
`tools/perf/lib/server.mjs --sandbox-sdk` mechanism). For the returning-user case a 12-line shim around the SDK's
`initializeAuth` connects the Auth emulator immediately (B.4 explains why); production builds do not need it.

**Conditions** (same as the companion doc and `tools/perf`): Chromium 141.0.7390.37 headless
(`/opt/pw-browsers/chromium-1194`), proxy CA trusted via a scratch NSS db (TLS verification on), sandbox host 4 vCPU.
Served by `tools/perf/lib/server.mjs` (brotli q11/gzip -9, ETag/304) with headers from the **Hosting emulator**
reading a `firebase.json` — the repo's for Flutter, and for Next the Part A plan's (`no-cache` everywhere,
`public, max-age=31536000, immutable` for `/_next/static/**`, `trailingSlash: true`). Applied throttling = `tools/perf`
`PROFILES` (mobile: 562.5 ms latency, 1474.56 kbps down, 675 up, CPU ×4, 412×823 @1.75; desktop: 40 ms, 10240 kbps, CPU ×1).
**One addition:** the mobile context also sends Lighthouse's mobile user agent (`moto g power (2022)`, Chrome/136),
because the Auth SDK decides from the UA whether to load the Google iframe eagerly (B.5); Playwright's `isMobile`
alone keeps a desktop UA. Every run: fresh browser context, cold load, then a warm load in a second page of the
same context; 3 runs; median (min–max). Runs were strictly sequential; the emulators were idle in the background
(< 2% CPU) and nothing else was running. Harness: `partb/tools/{common,login,signedin,sizes}.mjs` on top of
`tools/perf/lib` (unchanged).

**Production contact — disclosure.** Two early smoke runs and one layout probe loaded an *unmodified* `7abb8fb`
build, whose config points at the production project: its pre-auth Firestore listen attempts (unauthenticated,
denied by the rules, no writes — the same traffic the companion doc's measurements made) reached
`firestore.googleapis.com`. That build was then deleted; every number below comes from the demo-spike build.
While debugging B.4, the Flutter build also sent one `accounts:lookup` with the fake key `demo-key` to
`identitytoolkit.googleapis.com` (rejected with 400; no project or user data). No credentials were read; nothing
was deployed.

### B.2 JS bytes and requests (login, heavy signed-in screen)

JS = exactly the script files the measured cold load fetched (URLs recorded by the harness, sizes re-read from disk:
raw / gzip -9 / brotli q11). "Transfer" and "requests" are what the browser reported (`encodedDataLength`, all hosts).

| Page (cold, mobile) | JS files | JS raw | JS gzip | JS brotli | Transfer (all) | Requests | Not JS but code |
|---|---:|---:|---:|---:|---:|---:|---|
| Flutter, login screen (until first input accepted) | 8 | 4,538,073 | 1,267,533 | 995,805 | 2,631 KiB at input; 3,004 KiB after 5 s | 36 at input; 39 | `canvaskit.wasm` 5,686,880 raw / 1,612,881 br; fonts 14 requests |
| Next export `getAuth`, login screen (until first input accepted) | 9 | 585,419 | 175,018 | 150,783 | 157 KiB at input; 189 KiB after 5 s | 13 at input; 17 | CSS 1 file |
| Next export `initializeAuth` without resolver, login | 9 | 575,741 | 171,660 | 147,973 | 154 KiB; 186 KiB | 13; 16 | |
| Flutter, returning user → market list with data (HTTP cache cleared) | 8 (same files) | 4,538,073 | 1,267,533 | 995,805 | 3,630 KiB | 70 (37 font requests, 13 Firestore channel) | as above |
| Next export `getAuth`, returning user `/` → `/market/` with data (HTTP cache cleared) | 14 | 1,234,764 | 369,541 | 316,814 | 352 KiB | 28 (24 same-origin) | |
| Next export no resolver, same | 14 | 1,225,086 | 366,183 | 314,004 | 349 KiB | 27 | |

Ratios (brotli JS): login **6.6×** less JS for Next (151 KB vs 996 KB, plus Flutter's 1.6 MB wasm engine);
signed-in heavy screen **3.1×** less (317 KB vs 996 KB). Total transfer to the signed-in screen: 352 KiB vs 3,630 KiB (**10×**).
The Next login page's JS is mostly framework: react-dom 229,156 raw / 61,215 br, Next runtime ≈ 160 KB raw / 37 KB br,
Firebase app+auth ≈ 86 KB raw / 22 KB br. The signed-in screen adds the Firestore chunk (569,369 raw) and the route code.
Flutter ships all screens and the whole SDK on every page; the Next signed-in total includes the login page's JS
because returning users land on `/` and are redirected client-side (B.4).

### B.3 Cold/warm load: Lighthouse and applied throttling vs Flutter

**Applied throttling (`login.mjs`), login screen.** "Input accepted" is a **real** first-input time: from navigation
start the harness taps one control every 50 ms (CDP `Input.dispatchMouseEvent`) and records the page-clock time when
the app first reacted — Next: the React `onClick` of the login/signup toggle ran; Flutter: the tap on the e-mail
field reached the framework, which then created its DOM text-editing `<input>`. These are **not identical metrics**
(a handler run vs. a focus change), and neither is Flutter's first frame (engine drew the screen) or Next's FCP (HTML
painted, not yet hydrated). Note that before hydration the Next page's native `<input>` already accepts typing
(it is plain HTML from FCP); only the app logic (validation, submit) waits for hydration.

| Target | Profile | Load | FCP | First frame (Flutter) / hydration mark (Next) | **First input accepted** | Transfer at input |
|---|---|---|---:|---:|---:|---:|
| Flutter | mobile | cold | 756 (700–840) splash | 18,957 (18,871–19,186) | **19,909 (19,901–20,275)** | 2,632 KiB |
| Next `getAuth` | mobile | cold | 1,372 (1,372–1,452) | 2,303 (2,292–2,337) | **2,246 (2,236–2,281)** | 157 KiB |
| Next no resolver | mobile | cold | 1,380 (1,376–1,416) | 2,300 (2,271–2,353) | **2,241 (2,194–2,278)** | 154 KiB |
| Flutter | mobile | warm | 720 (712–764) | 5,214 (5,048–5,268) | **6,253 (6,126–6,266)** | 2 KiB |
| Next `getAuth` | mobile | warm | 776 (768–840) | 1,376 (1,253–1,384) | **1,314 (1,196–1,317)** | 0 KiB |
| Next no resolver | mobile | warm | 812 (792–868) | 1,339 (1,277–1,349) | **1,265 (1,206–1,277)** | 0 KiB |
| Flutter | desktop | cold | 96 (88–144) | 2,862 (2,837–2,944) | **3,345 (3,314–3,473)** | 2,632 KiB |
| Next `getAuth` | desktop | cold | 156 (152–160) | 324 (301–333) | **312 (304–328)** | 157 KiB |
| Next no resolver | desktop | cold | 152 (144–156) | 310 (306–310) | **297 (288–299)** | 154 KiB |
| Flutter | desktop | warm | 136 (108–136) | 881 (880–937) | **1,324 (1,293–1,420)** | 2 KiB |
| Next `getAuth` | desktop | warm | 124 (120–124) | 200 (187–201) | **224 (208–228)** | 0 KiB |
| Next no resolver | desktop | warm | 132 (128–136) | 194 (191–206) | **214 (214–236)** | 0 KiB |

Flutter rows: second series with the Auth-emulator banner hidden (see Lighthouse note below); the first series (banner
visible, `login-flutter.json`) agreed within 2% (cold input accepted 20,248 mobile / 3,262 desktop). Flutter cold first
frame (19.0 s mobile, 2.86 s desktop) reproduces the companion doc's 18.9 s / 2.83 s within 1%, and the unchanged repo
tool `tools/perf/measure_web.mjs` on the same build gave 18,910 (18,811–18,916) / 2,760 (2,736–2,770) ms without the tap
probe and without the mobile UA, so the probe does not perturb the load noticeably. Flutter accepts input about 1 s
(mobile) / 0.5 s (desktop) after its first frame. The Next hydration mark fires after a
rAF+timeout and so lands ~50 ms *after* the first accepted tap. LCP from these runs is not reported: the browser stops
LCP at the first input, and the probe taps from t=0 (Lighthouse LCP below).

**Lighthouse 13.5 (simulated throttling; mobile = default preset incl. its mobile UA, desktop = `desktop-config`)**, login
page `/`, 3 runs, each a fresh Chrome: cold, then warm with `disableStorageReset` (`partb/tools/lh.mjs`):

| Target | Preset | Load | Score | FCP | LCP | TBT | Speed Index | TTI | Transfer | Requests |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Flutter | mobile | cold | 66 (66–66) | 673 (671–867) | 814* (801–1,409) | 2,819 (2,616–2,961) | 5,691 (5,667–5,717) | 14,803 (14,490–15,234) | 3,007 KiB | 41 |
| Flutter | mobile | warm | 71 (71–71) | 664 (658–668) | 806* (806–861) | 2,730 (2,664–2,837) | 2,455 (2,388–2,467) | 4,434 (4,269–4,437) | 4 KiB | 33 |
| Next `getAuth` | mobile | cold | 99 (99–99) | 751 (751–753) | 2,002 (1,651–2,120) | 67 (53–67) | 751 (751–753) | 2,270 (2,002–2,368) | 189 KiB | 17 |
| Next `getAuth` | mobile | warm | 100 | 689 (670–705) | 689 (670–738) | 0 (0–9) | 689 (670–705) | 738 (670–750) | 1 KiB | 16 |
| Next no resolver | mobile | cold | 99 (99–99) | 751 (751–752) | 2,106 (1,951–2,108) | 60 (39–64) | 751 (751–752) | 2,106 (1,951–2,258) | 186 KiB | 16 |
| Next no resolver | mobile | warm | 100 | 695 (688–715) | 715 (695–737) | 3 (1–6) | 695 (688–715) | 743 (726–770) | 1 KiB | 15 |
| Flutter | desktop | cold | 77 (77–78) | 185 (182–231) | 295* (257–380) | 456 (435–461) | 1,804 (1,784–1,813) | 2,685 (2,681–2,720) | 3,007 KiB | 40 |
| Flutter | desktop | warm | 79 (77–79) | 209 (209–217) | 284* (256–309) | 478 (478–535) | 990 (959–1,060) | 1,177 (1,168–1,255) | 4 KiB | 32 |
| Next `getAuth` | desktop | cold | 100 | 205 (202–209) | 477 (471–479) | 0 | 205 (202–209) | 477 (471–479) | 189 KiB | 16 |
| Next `getAuth` | desktop | warm | 100 | 194 (193–197) | 207 (206–209) | 0 | 194 (193–197) | 207 (206–209) | 1 KiB | 15 |
| Next no resolver | desktop | cold | 100 | 203 (201–204) | 485 (484–497) | 0 | 203 (201–204) | 485 (484–497) | 186 KiB | 16 |
| Next no resolver | desktop | warm | 100 | 197 (195–204) | 211 (209–226) | 0 | 197 (195–204) | 211 (209–226) | 1 KiB | 15 |

\* Flutter's FCP/LCP time the Plan 4 HTML start screen, not the app (as in the companion doc); its TBT, Speed Index and
TTI are the meaningful columns. Every Flutter run carried "page loaded too slowly to finish within the time limit"
(open Firestore channel). A first Flutter series (`lh-flutter.json`) was **discarded**: the Auth emulator's
"Running in emulator mode" banner (added to the DOM by `connectAuthEmulator` without `disableWarnings`) became the
mobile LCP element at ~15.7 s; the rerun hides that banner with CSS in the scratch build (production has no banner;
the Next prototype passes `disableWarnings`). Lighthouse's warm "JS bootup" values for Next were implausible (~4 s
with ~1 KiB transferred) and are not used. The Flutter numbers are in the same range as the companion doc's (score 0.65, TBT 3.4 s,
SI 6.5 s, TTI 13.8 s on the pre-Plan-4 build `b3d73db`) but outside its min–max for TBT/SI/TTI; the builds differ
(Plan 4 start screen, `main.dart.js?v=`, emulator wiring), so exact agreement is not expected.

### B.4 Returning signed-in user: time to the signed-in screen with data

`signedin.mjs`: per run a fresh context signs in **unthrottled** (Next: the login form; Flutter: `?autologin=1`), the page is
closed, the harness waits 6 s (past Firestore's 5 s primary-lease window of the closed tab), then measures a throttled load of
the start URL until the market list **with listings** is on screen: **W** = everything warm (HTTP cache, IndexedDB session,
Firestore cache); **C** = `Network.clearBrowserCache` first (session and Firestore cache kept). Next starts at `/` (the PWA
`start_url`), whose client code sees the restored user and `router.replace('/market/')`; Flutter starts at `/?tab=market`.

| Target | Profile | Case | Auth ready (Next) / signed-in shell frame (Flutter) | **List with data on screen** | Transfer | Requests |
|---|---|---|---:|---:|---:|---:|
| Flutter | mobile | W warm | 10,666 (10,625–11,033) | **27,410 (25,711–27,894)** | 10 KiB | 68 |
| Next `getAuth` | mobile | W warm | 1,862 (1,860–1,878) | **3,170 (3,112–3,193)** | 2 KiB | 27 |
| Next no resolver | mobile | W warm | 1,814 (1,728–1,815) | **3,086 (2,998–3,103)** | 2 KiB | 26 |
| Flutter | mobile | C cache cleared | 22,969 (22,816–23,389) | **39,298 (39,150–40,367)** | 3,630 KiB | 70 |
| Next `getAuth` | mobile | C cache cleared | 2,956 (2,903–2,972) | **6,207 (6,181–6,276)** | 352 KiB | 28 |
| Next no resolver | mobile | C cache cleared | 2,869 (2,855–2,887) | **6,123 (6,091–6,143)** | 349 KiB | 27 |
| Flutter | desktop | W warm | 2,004 (1,982–2,019) | **5,866 (5,836–5,995)** | 10 KiB | 66 |
| Next `getAuth` | desktop | W warm | 263 (234–282) | **479 (428–529)** | 3 KiB | 28 |
| Next no resolver | desktop | W warm | 240 (231–260) | **456 (445–492)** | 3 KiB | 28 |
| Flutter | desktop | C cache cleared | 3,621 (3,596–3,707) | **7,742 (7,711–7,920)** | 3,544 KiB | 67 |
| Next `getAuth` | desktop | C cache cleared | 358 (352–359) | **764 (758–772)** | 354 KiB | 29 |
| Next no resolver | desktop | C cache cleared | 349 (347–363) | **780 (773–795)** | 351 KiB | 29 |

**Comparability — read before using these numbers.** The two "data" columns do **not** measure the same amount of
app work. In the Flutter build, most of the time between the signed-in shell (10.7 s) and the market list (27.4 s) is the
Dart `AppStore` start-up: a request timeline (`timeline.mjs`) shows ~13 Firestore listen-channel POSTs issued one after
another, ~1.2–1.5 s apart at 562 ms latency (the WebChannel sends one forward POST at a time), before the market
target is answered. The Next prototype opens 2 listeners (listings, credit balance). A port that keeps `AppStore`'s
subscriptions (profile, credits, ledger, notifications, talk rooms, posts, catalog warm-up …) in the same order would
pay a similar serial cost; it would be the same Firestore work in any framework (A.4.1). The framework-comparable
points are therefore **auth ready / shell frame** (Next 1.9 s vs Flutter 10.7 s mobile warm) and the login figures in B.3;
"data on screen" is an upper bound for Flutter's disadvantage. Emulator on localhost (throttled like everything else),
not production Firestore latency. Flutter rows: series with the emulator banner hidden (`signedin-flutter2.json`; the
first series agreed within 4%).

Why Flutter needed the emulator shim: FlutterFire's `firebase_auth_web` 6.2.5 awaits `authDelegate.onWaitInitState()` **inside
`Firebase.initializeApp`** (`lib/firebase_auth_web.dart:57-84`), so the SDK reloads the persisted user before Dart can call
`useAuthEmulator`; without the shim that reload went to production `identitytoolkit` and the emulator session was cleared
(observed). It also means that, in production, **Flutter's first frame waits for Auth initialisation** — see B.5.

### B.5 Google auth iframe: `getAuth()` vs `initializeAuth` without resolver

Code facts [verified-code, `@firebase/auth` 1.13.6 `dist/esm/index-4NFEPWkC.js`]: with `browserPopupRedirectResolver`
(what `getAuth()` and FlutterFire use) on a **mobile UA, Safari or iOS** (`_shouldInitProactively`, `:10833-10836`),
`_initializeWithPersistence` **awaits** the resolver's `_initialize` (load `https://apis.google.com/js/api.js` →
`gapi.load('gapi.iframes')` → open the `authDomain/__/auth/iframe` and ping it, 5 s ping timeout) **before**
`initializeCurrentUser` (`:2716-2728`). So the first `onAuthStateChanged` callback waits for that chain; on desktop
Chrome it does not run at start. In the sandbox `apis.google.com` is denied by the proxy, so the chain fails at once.

Measured (mobile profile with mobile UA):

| Scenario | `getAuth()` (resolver) | `initializeAuth`, no resolver | Difference |
|---|---:|---:|---:|
| Next login: first input accepted, cold (B.3) | 2,246 (2,236–2,281) | 2,241 (2,194–2,278) | none: hydration does not wait for auth |
| Next returning user, auth ready, warm — api.js fails at once (sandbox) | 1,862 (1,860–1,878) | 1,814 (1,728–1,815) | ≈ 50 ms |
| Next returning user, list on screen, warm — same | 3,170 (3,112–3,193) | 3,086 (2,998–3,103) | ≈ 85 ms |
| Next returning user, auth ready, **api.js answered after 3,000 ms** (stand-in, cache cleared) | 5,962 (5,904–5,981) | 2,870 (2,829–2,887) | **+3.09 s** |
| Next returning user, list on screen, same | 9,281 (9,248–9,322) | 6,239 (6,163–6,259) | **+3.04 s** |
| **Flutter login: first frame**, api.js answered after 3,000 ms vs answered at once (both with request routing on) | 22,206 (21,987–22,240) vs 19,006 (18,938–19,034) | n/a (FlutterFire hard-codes the resolver) | **+3.20 s** |
| Bundle | 150,783 B br login JS | 147,973 | −2.8 KB br |

The "3,000 ms" is a **stand-in, not a measurement of Google's script**: Playwright answers the `apis.google.com` request
with a 404 after 3 s, to test whether startup waits for it. It does, in both apps, one-for-one. What production costs on a
real phone is **unmeasured** here (the chain is two cross-origin hosts and ≥ 3 sequential requests; at the lab's 562 ms
RTT a new HTTPS connection alone is ~3–4 RTT ≈ 1.7–2.3 s — **estimate** from the throttling parameters). Request routing
disables Playwright's HTTP cache, so only cache-cleared cases are compared in those rows.

Finding: for a password-only app the resolver brings nothing at start and, on phones, delays (a) **Flutter's first
frame** — because FlutterFire's plugin init awaits Auth init inside `Firebase.initializeApp` (B.4) — and (b) any
Next.js screen that waits for `onAuthStateChanged` (the returning-user redirect), not the login form. A Next.js
client can drop it (`initializeAuth` with `[indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence]`);
the hand-over consequence of a *narrower* persistence list is tested in B.8. Flutter cannot drop it without patching
FlutterFire (`auth.dart:36`).

### B.6 Static export vs server-rendered build

Same source, `getAuth()`. **Server build** = default `next build` + `next start` (Node 22, localhost:3000): Next marks
**every route `○` static** — none of them reads request data, so the server serves prerendered HTML
(`x-nextjs-cache: HIT`, `Cache-Control: s-maxage=31536000`), compressed with **gzip** (Next's built-in; no brotli).
**SSR per request** = the same with `export const dynamic = "force-dynamic"` in the root layout (all routes `ƒ`;
`Cache-Control: private, no-cache, no-store`). The export is served as in B.3 (Hosting headers, brotli).

| Build | Login: first input accepted, mobile cold / warm | desktop cold / warm | Login transfer | Lighthouse mobile cold: score / FCP / LCP / TBT | Returning user, list on screen, mobile W / C | desktop W / C |
|---|---|---|---:|---|---|---|
| Static export (Hosting-like) | 2,246 (2,236–2,281) / 1,314 (1,196–1,317) | 312 / 224 | 189 KiB | 99 / 751 / 2,002 / 67 | 3,170 / 6,207 | 479 / 764 |
| Server build, prerendered (`next start`) | 2,483 (2,442–2,507) / 1,206 (1,155–1,264) | 307 (305–324) / 202 (195–226) | 217 KiB | 98 / 763 / 2,376 / 77 | 3,154 (3,057–3,190) / 6,642 (6,525–6,756) | 468 (461–520) / 807 (798–826) |
| Server build, SSR every request | 2,548 (2,526–2,561) / 1,247 (1,228–1,291) | 315 (313–321) / 212 (207–213) | 212 KiB | — | — | — |

Server TTFB for `/` on localhost, unthrottled (curl ×5): prerendered 2–3 ms, SSR per request 7–14 ms.

Reading: for these login-gated screens the server build gives **no earlier first paint** — FCP is the same HTML either
way (1.37–1.40 s mobile cold), and the cold login is ~0.24 s *slower* only because Next's server sends gzip instead of
brotli (184 vs 157 KiB at first input). SSR on every request cannot render the signed-in data, because the session lives
in the browser's IndexedDB and the server never sees it (A.2.3); the returning-user path is the same client-side
redirect in all three. In production the differences would be **larger than here and in the export's favour**: the
server build would run on Cloud Run / Cloud Functions behind Hosting (A.2.6) — cold starts, a region hop, per-request
billing — none of which a localhost `next start` shows (**not measured**). A server would only pay off for content it
may render without the user's session (public pages), which today does not exist (A.4.1).

### B.7 Bundle growth per screen-equivalent (extrapolation) and porting one real screen

**Growth curve — label: EXTRAPOLATION input, synthetic screens.** `partb/tools/gen.mjs N` adds N extra routes
`/g/<i>/`, each a **copy of one of the three real ported screens** (cycled: market list + detail dialog, listing form,
course detail + review tab), each with its own copy of its model module, its own collection names and its own Japanese
strings, so every copy is a separate module graph. Static export, `getAuth()`. "First load" = the route HTML's
`<script src>` set without the `nomodule` polyfill (for `/` this equals the network-measured login JS of B.2 byte for
byte); dynamic `import()` chunks are not included. "All JS" = every `.js` file in the export (includes the 112,594 B
legacy polyfill that modern browsers skip).

| Extra screen-equivalents N | All JS raw / gzip / **brotli** | Login `/` first load (brotli) | `/market/` first load (brotli) | A generated route (brotli) |
|---:|---|---:|---:|---|
| 0 (base app) | 1,402,169 / 429,206 / **369,517** (23 files) | 150,783 | 306,252 | — |
| 1 | 1,429,597 / 439,993 / **378,861** | 150,783 | 306,290 | `/g/1/` (market type) 306,095 |
| 5 | 1,500,084 / 468,292 / **403,200** | 150,783 | 306,290 | `/g/5/` (form type) 160,198 |
| 10 | 1,597,101 / 506,732 / **436,408** | 150,783 | 306,290 | `/g/10/` (market type) 306,077 |
| 15 | 1,681,587 / 540,483 / **465,492** (38 files) | 150,783 | 306,290 | `/g/15/` (course type) 291,709 |
| 15, all imported into the root layout (no route splitting) | 1,509,399 / 434,466 / 370,364 | **318,083** | 319,162 | 315,599 |

Measured slope: **≈ 6.4 KB brotli (18.6 KB raw, 7.4 KB gzip) of JS per screen-equivalent**, near-linear
(steps of 9.3 / 6.1 / 6.6 / 5.8 KB br per screen). With route splitting the login page stays at **150,783 B** for every N,
and a route's own first load does not depend on N. Applied throttling confirms it: login first input accepted, mobile
cold, N=15 split **2,222 (2,219–2,240) ms** (= base 2,246); N=15 all-in-root **3,297 (3,292–3,364) ms** (desktop
296 vs 438 ms), because the shared bundle then carries the screens **and** the Firestore SDK (+167 KB br).

Extrapolation to the full app (**estimate**): the prototype covers 7 of the 20 screen/widget files of A.1.3
(signup, market search tab, listing form, listing detail, course detail shell, review tab, takedown). 13 more at the
measured 6.4 KB br → **+83 KB br**; if the remaining *hard* screens port to ~2× a template copy (basis: the TS/Dart line
ratio below applied to `course_resource_tab` 1,133 / `home_screen` 895 Dart LOC), → +~170 KB br. Whole-app JS ≈
**450–540 KB br**, of which a visitor downloads only the login page's ~151 KB and, signed in, the visited route's
(~160–310 KB first load incl. Firestore). Flutter's single bundle today: 996 KB br JS + 1.6 MB br wasm on every page.

**Porting one real screen — a single data point, and what it does and does not replace.** Ported in this session:
`course_detail_screen.dart` (92 LOC, tab shell) + `course_review_tab.dart` (743 LOC, a "hard" screen in A.1.3: 3 live
streams, summary distributions, mine-pinned list, helpful-vote transaction, error states) + the read side of
`review.dart`, `course_stats.dart`, `subject.dart`, `review_service.dart` (excluded: `review_form_sheet.dart`, the
過去問・資料 tab, `submitReview`/`deleteReview`, `applyReview`, `toMap`/`copyWith`).

| Measure | Value |
|---|---|
| Wall-clock, read Dart → TS written → typecheck → seeded emulator → rendered + helpful vote accepted by the real rules | **173 s** (02:35:56 → 02:38:49 UTC; `/proc/uptime` delta 173 s) |
| Who | **an AI coding agent (this session)**, not a human developer |
| Lines written | **359 TS/TSX** (`lib/review.ts` 114, `CourseReviewTab.tsx` 184, `CourseDetail.tsx` 56, route 5) + 2 lab scripts (seed, check) |
| Dart → TS size ratio | screen code 835 Dart LOC → 245 TSX lines (**0.29×**); all touched Dart files 1,671 LOC → 359 TS (0.21×, part excluded) |
| Verification done | type check; one functional run against the emulators (12 reviews, slugged `course_stats` id with '/', distributions, rakutan score 49 = hand-computed, vote 1 → 2); screenshot |
| Not done | unit tests (the Dart side has 20 view + 54 model tests for this area), the form sheet, accessibility review, visual parity check, edge cases (stream errors were coded but not exercised) |

What it replaces in A.1.6: **not** the human rate — 173 s of agent time says nothing about a person's days. It does
replace the size assumption: TS output is ~0.2–0.3× the Dart line count, so Basis 1's "300–800 Dart LOC/day" means only
~60–240 TS lines/day of output — the human cost is dominated by understanding behaviour and testing, not typing. If an
agent writes the code, the coding share of the 25–90 days shrinks sharply, and what remains is review, test porting
(192 Dart tests), device/a11y checks and the cutover work of A.3.4 — none of which this data point measured.

### B.8 Session hand-over prototype ↔ Flutter build

`partb/tools/handover.mjs` (successor of Part A's `cut/cutover.mjs`, which tested JS pages against the Flutter build):
**one origin**, and the served build is **swapped in place** between steps, the way a Hosting deploy replaces the site
(`tools/perf/lib/server.mjs` `swap`). Sign-in happens inside the real app (Flutter: Dart `signInWithEmailAndPassword` via
`?autologin=1`; Next: typing into the login form). "Carried" = after the deploy swap the **app itself** shows the
signed-in market list with data, no login typed (Flutter: `AppStore` reached `NavigationRootScreen` and the list
rendered). Auth + Firestore + Functions emulators, real rules, Chromium desktop profile, unthrottled, fresh context per case.

| # | Signed in with | Then deployed and opened | Session record after sign-in | Result |
|---|---|---|---|---|
| 1 | Flutter | Next `getAuth()` | IndexedDB `firebase:authUser:demo-key:[DEFAULT]` | **carried** |
| 2 | Flutter | Next `initializeAuth([indexedDB, local, session])`, no resolver | same | **carried** |
| 3 | Flutter | Next `initializeAuth(browserLocalPersistence)` only | same | **not carried** (signed out) |
| 4 | Next `getAuth()` | Flutter (rollback) | IndexedDB, same key | **carried** |
| 5 | Next no resolver | Flutter (rollback) | IndexedDB, same key | **carried** |
| 6 | Next local-only | Flutter (rollback) | **localStorage** `firebase:authUser:demo-key:[DEFAULT]` (no IndexedDB db) | **carried**; Flutter's SDK found it and moved it to IndexedDB |
| 7 | Flutter | Next `getAuth()`, then Flutter again | IndexedDB | **carried** at both steps (cutover + rollback) |

So the Part A result holds against the prototype in both directions, with one new constraint from case 3: a persistence
list **without `indexedDBLocalPersistence`** does not look in IndexedDB, where every Flutter user's session is, and
signs every existing user out at the cutover. `PersistenceUserManager.create` only searches the persistences it was
given (A.2.1 item 5). The safe choice for dropping the iframe is therefore case 2's full list without the resolver,
not "only `browserLocalPersistence`". Limits as in A.2.2 (emulator, Chromium only, no Safari/iOS ITP eviction).

### B.9 Side-by-side table with comparability caveats

Lab values, this sandbox, median of 3 (ranges in B.2–B.8). Flutter = `7abb8fb` release build (emulator copy);
Next = the B.1 prototype, static export, `getAuth()` unless noted. Mobile = slow-4G-like applied throttling + CPU ×4 + mobile UA.

| # | Metric | Flutter | Next.js prototype | Ratio | Comparability caveats |
|---|---|---:|---:|---:|---|
| 1 | Login JS, brotli (raw) | 996 KB (4.54 MB) + wasm engine 1.61 MB (5.69 MB) | 151 KB (585 KB) | 6.6× JS; ~17× incl. wasm | Flutter's bundle holds every screen + the whole Firebase SDK; Next's holds the login route only (signed-in routes are separate) |
| 2 | Login transfer / requests, cold | 3,004 KiB / 39 | 189 KiB / 17 | 16× | Flutter fetches 434 KiB of CJK fallback fonts (14 req); Next uses system fonts (none downloaded) — real phones' Japanese system fonts not checked |
| 3 | Mobile cold: **first input accepted** | 19,909 ms | 2,246 ms | 8.9× | different events (Flutter: tap focuses field; Next: click handler ran); Flutter first frame 18,957 ms; Next HTML (FCP) 1,372 ms and its native inputs accept typing before hydration |
| 4 | Mobile warm: first input accepted | 6,253 ms | 1,314 ms | 4.8× | same as 3; warm = HTTP cache only (no service worker in either) |
| 5 | Desktop cold / warm: first input accepted | 3,345 / 1,324 ms | 312 / 224 ms | 10.7× / 5.9× | same as 3 |
| 6 | Lighthouse mobile cold: score / TBT / Speed Index / TTI | 66 / 2,819 / 5,691 / 14,803 | 99 / 67 / 751 / 2,270 | — | Flutter FCP/LCP (673/814) time its HTML start screen, not the app; Lantern simulation; Flutter runs never reached network idle |
| 7 | Signed-in heavy screen: JS brotli / total transfer (cache cleared) | 996 KB / 3,630 KiB | 317 KB / 352 KiB | 3.1× / 10× | Next figure includes the login route (returning users land on `/`) and the Firestore SDK |
| 8 | Returning user, mobile warm: auth ready (Next) / signed-in shell frame (Flutter) | 10,666 ms | 1,862 ms | 5.7× | closest framework-to-framework comparison of the signed-in start |
| 9 | Returning user, mobile warm / cache-cleared: **list with data on screen** | 27,410 / 39,298 ms | 3,170 / 6,207 ms | 8.6× / 6.3× | **not like for like**: Flutter's `AppStore` opens ~13 listeners serially before the market query; the prototype opens 2. A full port with the same subscriptions would pay much of that (Firestore work, A.4.1). Emulator on localhost |
| 10 | Returning user, desktop warm: list on screen | 5,866 ms | 479 ms | 12× | as 9 |
| 11 | Google auth iframe on mobile (api.js answered after a 3 s stand-in delay) | first frame +3.2 s (cannot be removed without patching FlutterFire) | login +0; auth ready +3.1 s with `getAuth()`, **+0 with `initializeAuth` without resolver** | — | stand-in delay, not Google's real script cost (unmeasured: apis.google.com blocked) |
| 12 | Session hand-over on one origin (deploy swap) | — | carried Flutter→Next and Next→Flutter (and back) | — | **fails** if Next's persistence list lacks `indexedDBLocalPersistence`; emulator, Chromium only |
| 13 | Growth with more screens | one bundle, every page | +6.4 KB br JS per screen-equivalent; login page flat at 151 KB | — | synthetic copies of real ported screens; extrapolation |
| 14 | Server-rendered build vs static | n/a | no earlier paint; +0.24 s cold (gzip vs brotli) | — | localhost Node; Cloud Run cold starts not measured |

### B.10 Decision framework, thresholds, recommendation

**What the measurements settle.**
1. *Technical feasibility and safety*: a Next.js client on the same origin keeps every signed-in user signed in, both
   ways, including a rollback (B.8), as long as it keeps the default app name, the web `apiKey` and IndexedDB in its
   persistence list. The prototype talks to the real rules and callables unchanged (B.1).
2. *Size of the gain, in the lab*: on the throttled mobile profile the login form accepts input **~9× sooner cold
   (19.9 → 2.2 s) and ~5× sooner warm (6.3 → 1.3 s)**; ~16× fewer bytes; a returning user's signed-in start is ~6×
   sooner (10.7 → 1.9 s to shell/auth). Ratios are more trustworthy than the absolute seconds (companion §2).
3. *The gain does not decay as screens are added* if routes are split (B.7): +6.4 KB br per screen, login flat.
4. *A server is not needed* and does not help for login-gated screens (B.6): static export on the existing Hosting site.
5. *Not framework-bound*: a large part of the signed-in "data on screen" time is the app's own Firestore start-up
   (B.4); a port would inherit it unless `AppStore`'s subscriptions are reorganised (possible in either framework).

**What the measurements cannot settle**: what real Kyoto students on real phones and networks experience (the lab's
CPU ×4 is relative to a fast host; no iOS/Safari; no production Firebase latency), how often their loads are cold, and
how many leave during the wait. Those decide whether ~25–90 developer-days (A.1.6) are worth spending.

**Thresholds** (judgement anchored on the measured numbers; the RUM fields are listed below):

| Production RUM, mobile, ≥ 2 weeks after 2A/2B/3 + Plan 4 are live | Decision |
|---|---|
| p75 **cold** first frame ≥ 8 s **and** cold loads ≥ 25% of mobile loads; **or** ≥ 10% of cold loads end before the first frame; **or** p75 **warm** first frame ≥ 4 s | **Migrate** (static export, after 2A/2B/3, A.3.4 plan). Basis: Flutter-side options measured so far reach only 17.7 s cold / 2.8 s warm in the lab (wasm, companion §6), the prototype 2.2 s / 1.3 s; at ≥ 8 s real cold, the lab ratio (~9×) predicts ~1 s for the Next client |
| p75 cold first frame ≤ 5 s **and** p75 warm ≤ 2.5 s, or cold loads < 10% | **Do not migrate**; apply the cheap Flutter options (wasm build, a bundled JP font, the HTML/JS login front below) |
| in between | do the cheap options first, re-measure the same RUM for 2 weeks, then apply this table again |

Effort qualifier: at the low end of A.1.6 (~25–40 days, plausible if an agent writes most code and the cost is
review + tests, B.7) one "migrate" row suffices; at the high end (60–90 days) require two of them, or a product decision
to publish content (A.4), which only a DOM/Next client can serve to crawlers.

**Real-user timing that is needed** (none of it exists yet; Plan 4 already emits `flutter-first-frame` and
`performance.mark('kyotohub-first-frame')`, but only logs locally, R-1):
1. `first_frame_ms` per load, with: cold vs warm (`transferSize` of `main.dart.js` > 0 → cold), `navigator.userAgent`
   class (iOS Safari / Android Chrome / desktop), `navigator.connection.effectiveType`, `deviceMemory`, installed PWA or not;
2. a beacon on `pagehide` before the first frame (start-screen abandonment rate);
3. `signed_in_shell_ms` (the `signed-in-frame` mark used here) and time to first data on the landing tab;
4. the auth start-up share on phones: time from `Firebase.initializeApp` start to its completion (the gapi/iframe wait, B.5);
p50/p75/p95 per segment; Firebase Performance Monitoring or a small `web-vitals`-style beacon to a Function would do.

**Recommendation that follows from the data.** Do **not** start the rewrite now and do **not** migrate *before*
2A/2B/3 (Part A.3 still holds: the backend change ships first, with the tested Flutter client). The lab data makes a
later migration look **technically safe and clearly faster**, but its value depends on real-user numbers that do not
exist; collect items 1–4 for two weeks after 2A/2B/3, then apply the thresholds. Meanwhile one option is now better
supported than before: an **HTML/JS login front in front of the Flutter app** — B.8 shows a JS-SDK sign-in and the
Flutter app share the session on one origin, and B.3 shows such a page accepts input at ~2.2 s cold on mobile while
Flutter could be prefetched behind it (companion §6: 8.4 s instead of 18.9 s after a 15 s dwell). That combination was
**not measured end to end** and would be the next experiment if the RUM lands in the middle band.

### B.11 Limits

- **Lab only**: one sandbox host (4 vCPU), Chromium 141 headless, emulated network and CPU ×4 relative to this host;
  localhost HTTP/1.1 server instead of Hosting's CDN/HTTP2-3; no real phone, **no iOS/Safari/WebKit**.
- **Emulators, not production**: Auth/Firestore/Functions/Storage emulators on localhost (throttled like everything
  else); production Firestore/Auth latency from Japan unmeasured. Firestore triggers not emulated.
- **Google auth iframe** unmeasured in its real form (`apis.google.com` denied); B.5 uses a 3 s stand-in delay to test
  gating only. Sandbox gstatic block → same-origin SDK stand-in for Flutter (as the companion doc).
- **Prototype scope**: 7 of 20 screen files, partial (market: さがす tab only; course: review tab only; no review form);
  the signed-in "data on screen" comparison is not like for like (B.4). No tests ported.
- **Flutter scratch build** differs from production by emulator wiring, two lab events, `?tab=market`, an Auth-emulator
  shim (B.4) and a CSS rule hiding the emulator banner; the unchanged repo tool gave the same first frame within 1%.
- **Metric mismatch**: "first input accepted" is a handler run in Next and a focus change in Flutter (B.3); LCP was
  taken from Lighthouse only (taps cut LCP in applied runs). Lighthouse's warm JS-bootup values for Next were discarded.
- **Runs**: 3 per configuration; ranges are min–max of 3, not confidence intervals. Measurements ran one at a time;
  the emulators idled in the background (< 2% CPU); load averages printed before runs reflect the preceding run.
  The emulators were restarted once (2 h background limit) and reseeded; B.6–B.8 ran on the reseeded data.
- **Porting time** is one AI-agent data point; it does not measure a human developer (B.7).
- **Production contact**: see B.1 disclosure (unauthenticated pre-auth Firestore listens from 2 smoke runs + 1 probe,
  and 1 rejected `accounts:lookup` with a fake key). No credentials, no writes, no deploys.

### B.12 Reproduction

Everything lives in the session scratchpad `partb/` (not committed). Versions: Node 22.22.0, firebase-tools 15.32.1,
Flutter 3.41.9, Next 16.3.8, React 19.3.0, firebase 12.19.0, Lighthouse 13.5.0 / playwright-core 1.56.1 (from `tools/perf`).

```bash
S=<scratchpad>/partb
# Flutter comparison build (scratch copy of 7abb8fb + emulator wiring + lab events, B.1)
git archive 7abb8fb | tar -x -C $S/flutter-emu      # then apply the B.1 edits to lib/main.dart, navigation_root_screen.dart, market_screen.dart
(cd $S/flutter-emu && flutter build web --release --no-web-resources-cdn)
sed -i 's#</head>#<style>.firebase-emulator-warning{display:none!important}</style></head>#' $S/flutter-emu/build/web/index.html
# emulators: repo rules/indexes + functions/src compiled (callables only), demo project
(cd $S/emu && firebase emulators:start --project demo-spike) &
node $S/tools/seed.mjs && node $S/tools/seed_course.mjs
# Next prototype: export per auth variant, server builds
(cd $S/app && npm install)
$S/tools/build.sh getauth export-getauth; $S/tools/build.sh noresolver export-noresolver; $S/tools/build.sh localonly export-localonly
$S/tools/build.sh getauth server-getauth server      # + a copy with `export const dynamic = "force-dynamic"` in app/layout.tsx -> server-dynamic
export CHROME_HOME=$S/chromehome                     # NSS db trusting /root/.ccr/agent-proxy-ca.crt (certutil -A ... -t C,,)
cd $S/tools
node login.mjs --target flutter --dir $S/flutter-emu/build/web --fbjson /home/user/kyoto-hub/firebase.json --sdk --out ../results/login-flutter2.json
node login.mjs --target next --dir $S/builds/export-getauth --fbjson $S/hosting-next.json --out ../results/login-next-getauth.json
node signedin.mjs --target flutter --dir $S/flutter-emu/build/web --fbjson /home/user/kyoto-hub/firebase.json --sdkdir $S/sdk-emu --out ../results/signedin-flutter2.json
node signedin.mjs --target next --dir $S/builds/export-getauth --fbjson $S/hosting-next.json --out ../results/signedin-next-getauth.json
node signedin.mjs --target next --dir $S/builds/export-getauth --fbjson $S/hosting-next.json --profiles mobile --gapi delay:3000   # B.5
node login.mjs --target flutter ... --profiles mobile --gapi delay:3000      # and --gapi block as the control
node lh.mjs --dir <build> --firebase-json <firebase.json> [--sandbox-sdk]     # Lighthouse cold+warm, mobile+desktop
(cd $S/app && SPIKE_DIST=.next-server-getauth npx next start -p 3000) & node login.mjs --target next --url http://127.0.0.1:3000
node handover.mjs                                                             # B.8
for n in 0 1 5 10 15; do node gen.mjs $n; ./build.sh getauth growth-$n; node route_sizes.mjs $S/builds/growth-$n / /market/; done
node gen.mjs 15 --root && ./build.sh getauth growth-15root; node gen.mjs 0  # B.7
node sizes.mjs ../results/login-next-getauth.json $S/builds/export-getauth jsUrlsAtAccept   # B.2 raw/gzip/brotli
# unchanged repo tool, cross-check of the Flutter first frame:
node /home/user/kyoto-hub/tools/perf/measure_web.mjs --dir $S/flutter-emu/build/web --sandbox-sdk
```
