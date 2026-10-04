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

(in progress)

## Part A.3 — Risks: migrate before vs after 2A/2B/3, cutover plan outline

(in progress)

## Part A.4 — What Next.js would and would not fix

(in progress)

## Part B — measured prototype (to be added)

Reserved for the Part B agent (built-and-measured Next.js prototype). Do not edit above this line
except to correct Part A.
