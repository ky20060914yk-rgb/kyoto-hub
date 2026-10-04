# Phase 2B — Moderation Queue, Takedown Flow, Notifications & Server-side Course Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client-driven `posts.reports` array (and the "any verified user may delete a post at 3 reports" rule) with a Function-owned report → hide → moderation-queue pipeline; add the rights-holder takedown form with a priority queue; tell authors when their post is hidden, restored or removed; make `course_stats` a Function-maintained aggregate that no client can forge; and tighten `users` / `talk_rooms` reads to what the app actually needs.

**Architecture:** Same `functions/` codebase as Plan 2A (Firebase Functions v2, Node 22, `asia-east1`; pure handlers `(db, …)` tested against the Firestore emulator, thin wrappers in `index.ts`). **Hiding a post is a MOVE** from `posts/{id}` to the Admin-only `hidden_posts/{id}` inside one transaction (M-1), so every client query, `downloadResource`, the ranking counters and マイページ stop seeing it with no client query change. Reports are one Admin-only doc per (post, reporter) under `moderation_queue/{postId}/reports/{uid}`, written only by the `reportPost` callable; takedowns go through the `submitTakedown` callable. There is no admin UI and no admin callable: the operator runs `tools/moderate.mjs` with the project's credentials, and that CLI calls the same compiled moderation code (`functions/lib/moderation.js`) the Functions use. Authors get rows in a Function-only `notifications` collection, shown behind a new bell on マイページ. `course_stats/{slug}` is recounted from `reviews` + `posts` + `courses` by `onReviewWritten` / `onPostWritten` triggers (full recount in a transaction, never an increment); `tools/backfill_course_stats.mjs` runs the same recount once over every course.

**Tech Stack:** TypeScript 5 / Node 22 / `firebase-functions` ^7 (v2 API) / `firebase-admin` ^14 / `node:test` on the Firestore emulator; Flutter 3.41.9 / Dart ^3.11.5 / `cloud_functions` ^6.5 (already added by 2A) / `fake_cloud_firestore`; `@firebase/rules-unit-testing` for rules.

**Spec:** `docs/specs/2026-09-07-kyodai-info-redesign-design.md` §4.2 秩序・不正対策 (通報 → 閾値で非表示＋運営キュー), §4.3 削除対応フロー (報告ボタン＋権利者フォーム、優先キュー・即時削除、投稿者に通知、獲得済みクレジットは没収しない), §4.5.3 (rules), §4.5.5 (集計ドキュメントを onWrite Function で事前計算), §6 Phase 2 (削除対応フロー), §8 (著作権リスク), §10 (通報の閾値 / 管理画面をどこまで作るか). This is **Plan 2B of 2**.

**Builds on Plan 2A — which is implemented on `master-wf96b2` but NOT deployed.** Everything below assumes the 2A code as it is on this branch now (`functions/src/*`, credit rules, private storage, `CreditService`). 2A and 2B are deployed **together, once**, in the order given in the Deploy section of this plan, which **supersedes** the Deploy section of `2026-10-03-phase2a-credits-private-resources.md` (it contains every 2A step, re-ordered around the 2B steps).

## Global Constraints

- Flutter `3.41.9`, Dart `^3.11.5`. **No new Dart dependency** (the bell badge is Material's `Badge`; the talk-room merge is a hand-written `StreamController`, no rxdart). Functions: Node `22`, TypeScript, `firebase-functions/v2/*` only, region **`asia-east1`** and `maxInstances: 10` on every function (the existing `opts` object in `index.ts`).
- **Credits are never clawed back** (spec §4.3). No 2B code path writes `credit_balances` or `credits_ledger`; `writeCredit` stays the only writer. Hide, restore and remove each have a test asserting the author's balance and ledger are unchanged.
- Every document written by a Function carries `university_id: 'kyoto_u'`: `moderation_queue`, its `reports`, `moderation_actors`, `moderation_meta`, `takedown_requests`, `moderation_log`, `notifications`, `course_stats`. `hidden_posts/{id}` is the post's own data copied unchanged, and that data already carries `university_id: 'kyoto_u'` (the 2A posts create rule pins it).
- Authenticated callables call `requireKuVerified` (`reportPost`). **The single deliberate exception is `submitTakedown`**, which must accept a signed-out rights-holder; it classifies the caller with the new `universityVerifiedUid` (never throws) and is capped (M-6, M-7).
- Admin-only collections get an explicit `allow read, write: if false` block **and** a rules test. The catch-all `match /{document=**} { allow read, write: if false; }` stays LAST. `firestore.rules` stays start-anchored on the KU email pattern.
- **Tests must fail when an invariant is broken.** Every ruling below has at least one assertion a mutation would break (boundaries are tested on both sides: e.g. 2 restored takedowns ⇒ no immediate hide, 1 ⇒ still hides). The Self-Review lists them.
- Test commands. Functions: `bash tools/test_functions.sh` (it runs `node --test test/*.test.mjs` — Node 22 rejects a bare `test/` directory, keep the glob). Rules: `bash tools/test_rules.sh`. New: `bash tools/test_backfill_course_stats.sh`, `bash tools/test_moderate.sh`. The emulator scripts export the Windows `JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"`; on the Linux implementation box that path is a symlink to a JDK 21 — **never edit the scripts for it**; new scripts copy the same two `export` lines verbatim.
- Flutter is at `/opt/tools/flutter/bin` (`export PATH=/opt/tools/flutter/bin:$PATH` in the implementation shell). `flutter analyze` baseline is **24 issues** and must stay 24: no new lints. In new UI code do not use `RadioListTile.groupValue` or `DropdownButtonFormField.value` (deprecated in 3.41 → new info lints); use `ChoiceChip`s, like `course_resource_tab.dart` already does.
- Commit scope: `functions/` (never `functions/node_modules/` or `functions/lib/`), `lib/`, `test/` (including the new `test/fixtures/`), `tools/`, `firestore*`, `firestore-tests/`, `docs/`. **Never** `.superpowers/`, never a service-account key.
- PowerShell 5.1 is the user's shell: every command in Deploy / Manual E2E is a single line, no `&&`, no bash `\` continuations (`;` chains).
- **Production side effects: none from the implementation environment.** No `firebase deploy`, no tool run with `--project kyodai-sns`, no `gcloud` against the project. (This supersedes 2A's "Claude may run firebase deploy".) The Deploy section is the user's runbook, run on the user's machine.

## Rulings (the plan decides; each can be reversed cheaply — every one is also listed under "Owner decisions to confirm")

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| M-1 | **Hide = move** `posts/{id}` → Admin-only `hidden_posts/{id}` (data unchanged) in one transaction; restore is the reverse move. `onPostDeleted` and a new `onHiddenPostDeleted` share `handlePostGone`, which removes Storage files **only when the post exists in neither collection**. The posts create rule refuses an id that exists in `hidden_posts` (so nobody can squat a hidden post's id and block its restore). | Every client query, `downloadResource` (`not-found`), the course post counters and マイページ stop seeing a hidden post with **zero** client/query/index changes. A `hidden` flag would need a backfill of every post, a filter on every query and a read rule the query must prove, and an old cached client would leak hidden posts. | Switch to a `hidden` field + backfill. Known edge: restore re-runs `onPostCreated` validation, so a restored post whose files are gone (or a never-migrated legacy post) is deleted — correct, it was undownloadable. Ledger ids make the re-run pay nothing twice. |
| M-2 | **Report threshold = 3 DISTINCT counted reporters** hides a post (hidden, not deleted; restorable). | Spec §10 left it open; 3 matches the old client rule and the existing copy. Distinctness is structural: one report doc per (post, reporter uid). | `MODERATION.reportHideThreshold` |
| M-3 | **Reports are Function-owned docs** `moderation_queue/{postId}/reports/{reporterUid}` written only by the `reportPost` callable. `posts.reports` is retired: no client may write it (rules), `Post` no longer has the field, and the legacy arrays are stripped once (`moderate.mjs strip-legacy-reports`) because they publish **who reported whom** to every KU reader. Legacy reports are discarded, not imported (≤ 2 per post, ~22 test users). | Clients can no longer forge counts, self-hide others' posts by array tricks, or see reporters; the reporter list is Admin-only. | Import instead of strip (a 20-line loop in the CLI) |
| M-4 | **No credit is ever clawed back** on hide, restore or remove; an upload credit not yet granted when a post is hidden is granted (once) if it is restored, through the normal `onPostCreated` path. | Spec §4.3 「獲得済みクレジットは没収しない」. | n/a (spec) |
| M-5 | **No admin UI and no admin callable in 2B.** The operator = whoever holds the project's credentials and runs `tools/moderate.mjs` (`list` / `hide` / `restore` / `delete` / `close` / `strip-legacy-reports`; dry-run default, `--project` required, `--apply` requires `--operator <name>`, emulator-tested). Every action writes a `moderation_log` row. | Spec §10 allows console-level moderation at first. With no admin callable there is no admin identity a client could forge — admin = IAM, never client-writable data. | Add an admin callable gated by an Admin-only `config/moderators` doc later |
| M-6 | **Takedown form:** a caller whose token is a verified `@st.kyoto-u.ac.jp` **or** `@kyoto-u.ac.jp` address (`universityVerifiedUid`) and who is not discredited (M-9) causes an **immediate hide** of each named post + a priority queue entry + an author notification. A signed-out, unverified or non-KU caller only creates a priority entry **without hiding**. Never hides the requester's own post, nor a post an operator already cleared (M-8). | Spec: 権利者・大学からの要請 = 優先キュー、即時削除. An anonymous form that hides posts would be a free censorship button for anyone on the internet; a verified university address is accountable and rate-limited. Note: staff cannot sign in to the app (signup is `@st` only), so in 2B the immediate path is used by students; an outside rights-holder's request lands in the priority queue and the operator acts. | Restrict immediate hide to `@kyoto-u.ac.jp` staff only (one regex), or add staff email-link verification |
| M-7 | **Rate limits (per JST day):** reports **10** per reporter; takedowns **3** per signed-in requester; at most **3 POSTS hidden at once** per requester per day (`MODERATION.maxImmediateHidesPerDay`; a request naming more only queues the rest, still priority); unverified + anonymous takedowns **20 in total** (one global counter). All per-requester counters are keyed by mailbox (M-20). No per-IP limit. | Bounds queue flooding and notification churn. The callable's client IP is not reliable behind Google's front end, so a per-IP cap could silently become a global 3/day; the global cap is the honest hard bound. | Constants in `MODERATION`; App Check later |
| M-8 | **An operator decision is final for automation:** `restore` sets `autoHide: false` on the queue entry. Later reports or takedowns on that post are still recorded but only flag it `needsReview`; they never hide it again. | Stops hide/restore ping-pong by a group of reporters and bounds notification spam to operator actions. | Reset `autoHide` on the next restore |
| M-9 | **Discredit:** when an operator restores a post, every reporter whose report was counted for a report-hide gets `restoredReports + 1`, and the requester of a takedown-hide gets `restoredTakedowns + 1` (Admin-only `moderation_actors/{uid}`). From **3** restored report-hides a user's reports are recorded but not counted; from **2** restored takedown-hides their takedowns no longer hide at once. Both are silent (the call still succeeds). | Report-bombing and takedown abuse cost the abuser their influence without letting them probe whether they are flagged. | `MODERATION.discreditRestored*` |
| M-10 | **Notifications:** Function-only `notifications/{mod_<postId>_<transition>}` with `type` ∈ `post_hidden` / `post_restored` / `post_removed`, shown in a new お知らせ screen behind a bell (with an unread badge) in the マイページ app bar — there is no bell UI today. The client may only flip its own `read` from false to true. No push, no email, no reason, never the reporter's identity. | Spec: 投稿者に通知. The transition counter makes each notice idempotent (a replayed hide writes the same id) and bounded (one per state change). | Add FCM later |
| M-11 | **`course_stats` is Function-maintained.** `onReviewWritten` / `onPostWritten` recount the affected course(s) from scratch in a transaction that reads the stats doc first (its lock serialises concurrent recounts) and write it with a plain `set` (a forged field cannot survive). Writes irrelevant to stats (a 役に立った vote, a `downloadCount` bump, a title edit) recount nothing. Client writes are denied. | Spec §4.5.5. Recount instead of increment ⇒ idempotent under trigger retries, self-healing, and every Phase-1/2A forgery is erased. | N reads per review write (N = reviews of that course); switch to increments if a course grows past ~1000 reviews |
| M-12 | Post counters count posts **in `posts` only** (hidden ones excluded) across **every course doc sharing the courseKey**; every category other than `past_exam` counts as a resource (exactly `tools/backfill_post_counts.mjs`'s rule, which this plan retires). | Matches what readers can download; same-lecture-different-slot docs accumulate (existing behaviour). | One filter |
| M-13 | `lastReviewAt` = the `updatedAt` string of the newest current review (max), written as that raw ISO string. | Phase 1 kept the last *applied* value, even of a deleted review; `CourseStats.fromMap` parses an ISO string, so the format is preserved. | One line |
| M-14 | **Parity:** Dart `CourseStats.applyReview` stays as the reference implementation. A shared fixture `test/fixtures/course_stats_parity.json` (reviews in, expected `CourseStats.toMap()` out — including garbage enum values, an out-of-range rating and a missing field) is asserted by BOTH the Dart and the TypeScript suites. | The ranking and the course summary read Function-written docs through the unchanged Dart model; a drifted formula would silently re-rank courses. | n/a |
| M-15 | **`users` read → own doc only; `talk_rooms` read → its two participants only.** The client never reads another user's profile (names are denormalised onto posts/reviews/requests/rooms), so nothing needs to be split out. The talk-room stream becomes two equality queries (`lenderId == me`, `borrowerId == me`) merged client-side; the 「トークルームを開く」 button shows only to the two parties. | Today any KU account can read every user's email and every chat. | Re-open a field via a separate public doc |
| M-16 | **`ku_verified` custom claim: SKIP again** (2A P2-7 re-evaluated). | It adds no protection: rules and Functions already read the Firebase-asserted `email` / `email_verified` token fields. Setting a claim needs a Function on verification plus a forced token refresh (or a blocking function, which requires the Identity Platform upgrade). The one capability it would add — revoking a single user — is already available as `admin.auth().updateUser(uid, { disabled: true })` + `revokeRefreshTokens(uid)`. | Add the claim when a protection needs it (e.g. a ban that must keep the account) |
| M-17 | Tools reuse the compiled Functions code: `backfill_course_stats.mjs` and `moderate.mjs` load `functions/lib/*.js` **and** `firebase-admin` from `functions/node_modules` via `createRequire`, so the CLI and the backfill cannot drift from the triggers and only one firebase-admin copy is in play. | One implementation of every invariant; the emulator tests of the tools exercise the shipped code. | `npm --prefix functions run build` before running a tool (in the Deploy steps) |
| M-18 | The takedown screen is reachable **signed out** (a link on the login screen), from the report dialog (post id prefilled) and from お問い合わせ. | A professor who hears that their exam is posted has no app account. | Move it to a static hosting page |
| M-19 | A hidden post's author sees it disappear and gets the notice; they cannot edit or delete it while hidden (it is not in `posts`); appeals go through お問い合わせ. | Keeps the hidden data intact for the operator. | n/a |

| M-20 | **Moderation identity is the MAILBOX, not the uid** (consistent with welcome-once-per-email, P2-15). Report docs (`moderation_queue/{postId}/reports/{emailKey}`), daily report/takedown caps, the immediate-hide budget and the discredit counters (`moderation_actors/{emailKey}`) are all keyed by `emailKey(email)` = sha256 of the lowercased, trimmed verified token email (`common.ts`, shared with `welcomeKey`). The reporter's uid is stored on the doc for operator tooling only; it is never shown to authors or put in notifications. `+` aliases are NOT forbidden (KU mail is not a plus-alias concern). A queue entry remembers `hiddenByKey` so a restore discredits the requester's mailbox. | Delete-account + re-signup with the same address gives a new uid; keyed by uid it would be a fresh reporter, reset caps and erase discredit. | Key by uid again (`emailKey` -> `uid` in report.ts / takedown.ts) |
| M-21 | **Hide + re-upload cannot re-earn the upload credit.** `onPostCreated`'s duplicate-past-exam check also looks in `hidden_posts` (same course + year + category, any timestamps). A restored original is judged against live posts only (its own ledger id keeps a paid upload from paying twice; an unpaid one may now count as a duplicate of a later upload). | Otherwise: upload, get hidden, re-upload, +3 again. | Drop the `hidden_posts` query |
| M-22 | **Moderation state follows the post id.** The posts create rule refuses an id that has a `moderation_queue` doc (as it does for `hidden_posts`); `readQueue` takes author/title from the LIVE post; restore/remove/`handlePostGone` on a post that is in neither collection retire its queue entry (`status: 'removed'`, `needsReview: false`) so the list stops showing it; `handlePostGone` never deletes a Storage file another live post still lists. | A reused id must not inherit another post's moderation state. | n/a |

Resolved 2A rulings: **P2-6** (no manual upload queue — the safety net is now M-2/M-6), **P2-7** (claim — M-16), **P2-11** (client-driven 3-report delete — replaced by M-1..M-3).

## Adversarial surfaces → mitigations → tests

| Surface | Attack | Mitigation | Test (task) |
|---|---|---|---|
| Report-bombing to censor a post | 1 account reports 3× / writes `reports: [a,b,c]` | One doc per (post, uid) behind a callable; rules deny `reports` writes and non-author deletes | `report.test` "one account cannot reach the threshold alone"; rules "no client may write reports" (T4, T7) |
| Sybil reporters | 3 accounts collude | Needs 3 verified KU mailboxes; 10/day each; operator restore → `autoHide:false` (M-8) and discredit (M-9) | `report.test` discredit boundary (2 counts, 3 does not), restored-post never re-hidden (T4) |
| Race to double-hide | 3 reports at once | One transaction per report; reads before writes | `report.test` "three reporters at once hide exactly once" (T4) |
| Takedown abuse | Anyone hides posts via the public form | Anonymous/unverified never hide; verified 3/day; discredit after 2 restored | `takedown.test` signed-out / unverified / discredited / boundary (T5) |
| Form/queue flooding | Script floods `submitTakedown` | Global 20/day for unverified; field size limits; ≤ 5 post ids; unknown ids create no queue doc | `takedown.test` anon cap, parse refusals, unknown ids (T5) |
| Field smuggling | `{verified:true, injected:…}` in the payload | `parseTakedown` copies only whitelisted fields; `verified` comes from the token | `takedown.test` "a client cannot claim to be verified" (T5) |
| Terminal injection | Escape codes in a takedown name/description | CLI prints through `safeText` | `test_moderate_fixture` `listcheck` (T12) |
| Notification spam / forgery | Client writes notifications, or un-reads/rewords them | Function-only create; client may only set `read: true` on own | rules notifications tests (T7) |
| Forged stats | Client writes `course_stats.score: 100` | Client write denied; recount overwrites with plain `set` | rules course_stats; `courseStats.test` forged doc (T2, T7); backfill fixture (T11) |
| Hidden-id squatting | Create `posts/{hiddenId}` to block restore | Create rule `!exists(hidden_posts/{id})`; restore never overwrites | rules + `moderation.test` (T3, T7) |
| Hide deletes files | Move fires `onPostDeleted` | `handlePostGone` skips while either doc exists | `postDeleted.test` (T3) |
| Hidden download | Call `downloadResource` on a hidden id | Post is not in `posts` → `not-found`, nothing charged | `moderation.test` (T3) |
| Privacy | Read other users' emails / chats / reporters | `users` own-only, `talk_rooms` participants-only, reports Admin-only, legacy arrays stripped | rules tests (T7), `test_moderate_fixture` strip (T12) |

**Amendments made in the final review (implemented; the code blocks below predate them):** M-20 (email-keyed identity: `processReport(db, {uid, email}, …)`, `reportRef`/`actorRef` take an `emailKey`), M-21 (hidden posts in the duplicate check), M-22 (state follows the id), the 3-hides-per-day takedown budget with `{requestId, hidden, queued}`, `talk_rooms` update pins `lenderId`/`borrowerId`/`university_id`, `strip-legacy-reports` writes an audit row and survives per-document failures, `course_stats` parity hardening (string-only enums, ISO-only `lastReviewAt`, unusable course keys skipped). Final counts: functions 146, rules 127, storage rules 6, flutter 107, `flutter analyze` 22 issues.

## File Structure

**Created**
- `functions/src/courseStats.ts` — `aggregateCourseStats`, `rakutanScore`, `statsRef`, `computeCourseStats`, `recomputeCourseStats`, `reviewStatsKeys`, `postStatsSubjects`, `handleReviewWritten`, `handlePostWritten`
- `functions/src/moderation.ts` — queue model + `hideInTx`, `hidePost`, `restorePost`, `removePost`, `closeTakedown`, `listQueue`
- `functions/src/report.ts` — `processReport`
- `functions/src/takedown.ts` — `parseTakedown`, `processTakedown`
- `functions/test/courseStats.test.mjs`, `functions/test/moderation.test.mjs`, `functions/test/report.test.mjs`, `functions/test/takedown.test.mjs`
- `test/fixtures/course_stats_parity.json` — shared by the Dart and TS suites (M-14)
- `lib/models/app_notification.dart`, `lib/services/moderation_service.dart`, `lib/services/talk_room_queries.dart`
- `lib/views/moderation/takedown_screen.dart`, `lib/views/notifications/notifications_screen.dart`
- `test/models/app_notification_test.dart`, `test/models/course_stats_parity_test.dart`, `test/services/moderation_service_test.dart`, `test/services/talk_room_queries_test.dart`, `test/views/takedown_screen_test.dart`
- `tools/backfill_course_stats.mjs`, `tools/test_backfill_course_stats.sh`, `tools/test_backfill_course_stats_fixture.mjs`
- `tools/moderate.mjs`, `tools/test_moderate.sh`, `tools/test_moderate_fixture.mjs`

**Modified**
- `functions/src/common.ts` (`MODERATION`, `universityVerifiedUid`, `isDocId`), `functions/src/postDeleted.ts` (`handlePostGone`), `functions/src/index.ts`, `functions/test/common.test.mjs`, `functions/test/postDeleted.test.mjs`
- `firestore.rules`, `firestore.indexes.json`, `firestore-tests/rules.test.mjs`
- `lib/models/post.dart`, `lib/services/review_service.dart`, `lib/services/firestore_service.dart`, `lib/services/app_store.dart`, `lib/main.dart`
- `lib/views/course/course_resource_tab.dart`, `lib/views/mypage/my_page_screen.dart`, `lib/views/auth/signup_screen.dart`, `lib/views/contact/contact_screen.dart`, `lib/views/textbook/textbook_lending_screen.dart`, `lib/widgets/credit_rules_dialog.dart`
- `test/services/review_service_test.dart`, `test/models/post_test.dart`, `tools/README.md`

**Deleted**
- `tools/backfill_post_counts.mjs`, `tools/test_backfill.sh`, `tools/test_backfill_fixture.mjs` (superseded by `backfill_course_stats.mjs`, which recounts every field with the trigger's own code; two writers of `course_stats` would fight)

---

### Task 1: Moderation constants, the university-address check, and a safe document-id guard

**Files:**
- Modify: `functions/src/common.ts`, `functions/test/common.test.mjs`

**Interfaces:**
- Consumes: `AuthLike` (common.ts, 2A).
- Produces (`common.ts`):
  - `MODERATION` (`reportHideThreshold: 3, reportDailyCap: 10, takedownDailyCapUser: 3, takedownDailyCapAnon: 20, discreditRestoredReports: 3, discreditRestoredTakedowns: 2, maxTakedownPosts: 5, maxDetail: 500, minDescription: 10, maxDescription: 2000, maxName: 100, maxEmail: 200, maxPostIdLength: 200`)
  - `universityVerifiedUid(auth: AuthLike | undefined | null): string | null` — uid for a verified `@st.kyoto-u.ac.jp` or `@kyoto-u.ac.jp` address (start-anchored, case-insensitive), else `null`; never throws.
  - `isDocId(v: unknown): v is string` — non-empty string, ≤ `MODERATION.maxPostIdLength`, no `/`, not `.`/`..`, not `__…__`.

- [ ] **Step 1: Write the failing tests** — in `functions/test/common.test.mjs` replace the import line (`import { requireKuVerified, jstDay, CREDITS, attachmentDisposition } from '../lib/common.js';`) with

```js
import { requireKuVerified, jstDay, CREDITS, attachmentDisposition, MODERATION, universityVerifiedUid, isDocId } from '../lib/common.js';
```

and append:

```js
test('universityVerifiedUid accepts verified student AND staff addresses, case-insensitively', () => {
  for (const email of ['a@st.kyoto-u.ac.jp', 'prof@kyoto-u.ac.jp', 'PROF@KYOTO-U.AC.JP', 'B@ST.KYOTO-U.AC.JP']) {
    assert.equal(universityVerifiedUid({ uid: 'u1', token: { email, email_verified: true } }), 'u1', email);
  }
});

test('universityVerifiedUid returns null (never throws) for anyone else', () => {
  const bad = [
    undefined,
    null,
    { uid: 'u', token: {} },
    { uid: 'u', token: { email: 'prof@kyoto-u.ac.jp', email_verified: false } },
    { uid: 'u', token: { email: 'a@gmail.com', email_verified: true } },
    { uid: 'u', token: { email: 'a@evil.kyoto-u.ac.jp', email_verified: true } },
    { uid: 'u', token: { email: 'a@notkyoto-u.ac.jp', email_verified: true } },
    { uid: 'u', token: { email: 'a@kyoto-u.ac.jp.attacker.com', email_verified: true } },
    { uid: 'u', token: { email: 'evil@x.com@kyoto-u.ac.jp', email_verified: true } },
  ];
  for (const a of bad) assert.equal(universityVerifiedUid(a), null, JSON.stringify(a));
});

test('isDocId accepts a plain id and rejects paths, empties, non-strings, reserved and oversized ids', () => {
  assert.equal(isDocId('post_1760000000000'), true);
  assert.equal(isDocId('x'.repeat(200)), true);
  for (const v of ['', 'a/b', '.', '..', '__x__', 'x'.repeat(201), 42, null, undefined, ['p']]) {
    assert.equal(isDocId(v), false, String(v));
  }
});

test('moderation limits match Plan 2B rulings M-2 / M-7 / M-9', () => {
  assert.deepEqual({ ...MODERATION }, {
    reportHideThreshold: 3, reportDailyCap: 10, takedownDailyCapUser: 3, takedownDailyCapAnon: 20,
    discreditRestoredReports: 3, discreditRestoredTakedowns: 2, maxTakedownPosts: 5, maxDetail: 500,
    minDescription: 10, maxDescription: 2000, maxName: 100, maxEmail: 200, maxPostIdLength: 200,
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `tsc` passes but `common.test.mjs` fails (`MODERATION`, `universityVerifiedUid`, `isDocId` are not exported).

- [ ] **Step 3: Append to `functions/src/common.ts`**

```ts
/** Moderation limits (Plan 2B rulings M-2, M-7, M-9). */
export const MODERATION = {
  reportHideThreshold: 3, // distinct COUNTED reporters that hide a post (M-2)
  reportDailyCap: 10, // reports per reporter per JST day (M-7)
  takedownDailyCapUser: 3, // takedown requests per signed-in requester per JST day (M-7)
  takedownDailyCapAnon: 20, // unverified + anonymous takedown requests per JST day, all together (M-7)
  discreditRestoredReports: 3, // from this many restored report-hides a reporter stops counting (M-9)
  discreditRestoredTakedowns: 2, // from this many restored takedown-hides: no more immediate hide (M-9)
  maxTakedownPosts: 5,
  maxDetail: 500,
  minDescription: 10,
  maxDescription: 2000,
  maxName: 100,
  maxEmail: 200,
  maxPostIdLength: 200,
} as const;

// Any Kyoto University mailbox: students (st.) and staff. Start-anchored, single
// '@', like KU_EMAIL — a subdomain other than `st.` does not pass (M-6).
const KU_ANY_EMAIL = /^[^@]+@(st\.)?kyoto-u\.ac\.jp$/;

/** The caller's uid when the token is a verified KU address (student or staff), else null. Never throws. */
export function universityVerifiedUid(auth: AuthLike | undefined | null): string | null {
  if (!auth) return null;
  const email = (auth.token.email ?? '').toLowerCase();
  return KU_ANY_EMAIL.test(email) && auth.token.email_verified === true ? auth.uid : null;
}

/** A document id a client may name: a non-empty bounded string that is not a path or reserved id. */
export function isDocId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MODERATION.maxPostIdLength &&
    !v.includes('/') && v !== '.' && v !== '..' && !/^__.*__$/.test(v);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — 83 existing + 4 new (`common.test.mjs` now 10).

- [ ] **Step 5: Commit**

```bash
git add functions/src/common.ts functions/test/common.test.mjs
git commit -m "feat(functions): moderation limits, university-address check, doc-id guard (Plan 2B)"
```

---

### Task 2: `course_stats` as a Function aggregate (recount, triggers, parity fixture)

**Files:**
- Create: `functions/src/courseStats.ts`, `functions/test/courseStats.test.mjs`, `test/fixtures/course_stats_parity.json`

**Interfaces:**
- Consumes: `UNIVERSITY_ID`, `isDocId` (common); `reviewSlug` (reviewCreated.ts, 2A).
- Produces (`courseStats.ts`):
  - `interface CourseStatsDoc { courseKey; university_id; reviewCount; ratingSum; rakutanCounts; attendanceCounts; gradingCounts; pastExamCounts; bringInCounts; pastExamPostCount; resourcePostCount; lastReviewAt?: string; score }` — exactly the fields `CourseStats.fromMap` reads.
  - `interface PostCounts { pastExam: number; resource: number }`
  - `rakutanScore(s): number` (unrounded, clamped 0..100), `aggregateCourseStats(courseKey, reviews: DocumentData[], posts: PostCounts): CourseStatsDoc` (pure)
  - `statsRef(db, courseKey)` → `course_stats/{reviewSlug(courseKey)}`
  - `computeCourseStats(db, courseKey): Promise<CourseStatsDoc>` (read-only), `recomputeCourseStats(db, courseKey): Promise<CourseStatsDoc>` (transactional full overwrite + `aggregatedAt`)
  - `reviewStatsKeys(before?, after?): string[]`, `postStatsSubjects(before?, after?): string[]`
  - `handleReviewWritten(db, before?, after?): Promise<string[]>`, `handlePostWritten(db, before?, after?): Promise<string[]>` (return the recounted courseKeys)

- [ ] **Step 1: Create the shared parity fixture `test/fixtures/course_stats_parity.json`**

The fourth review is deliberately malformed: `rating` 9 (clamps to 5), `rakutan` `'zzz'` (→ `futsu`), no `attendance` (→ `light`), `grading` 42 (→ `exam_report`), `pastExam` null (→ `trend_only`), `bringIn` `'NO'` (case-sensitive → `na`). Expected values are hand-computed: raku 2 / muzu 1 of 4 ⇒ 35·0.25 = 8.75; avg (5+2+4+5)/4 = 4 ⇒ +5; lightFrac 1/4 + 0.5·2/4 = 0.5 ⇒ 0; score = round(63.75) = 64. `lastReviewAt` is the newest `updatedAt` (M-13).

```json
{
  "courseKey": "parity|山田太郎",
  "reviews": [
    { "courseKey": "parity|山田太郎", "authorId": "a", "rating": 5, "rakutan": "raku", "attendance": "none", "grading": "exam_only", "pastExam": "as_is", "bringIn": "no", "createdAt": "2026-09-01T10:00:00.000", "updatedAt": "2026-09-01T10:00:00.000" },
    { "courseKey": "parity|山田太郎", "authorId": "b", "rating": 2, "rakutan": "muzu", "attendance": "heavy", "grading": "report_mainly", "pastExam": "not_useful", "bringIn": "yes", "createdAt": "2026-09-03T09:00:00.000", "updatedAt": "2026-09-03T09:00:00.000" },
    { "courseKey": "parity|山田太郎", "authorId": "c", "rating": 4, "rakutan": "raku", "attendance": "light", "grading": "exam_report", "pastExam": "similar", "bringIn": "na", "createdAt": "2026-09-02T08:00:00.000", "updatedAt": "2026-09-02T08:00:00.000" },
    { "courseKey": "parity|山田太郎", "authorId": "d", "rating": 9, "rakutan": "zzz", "grading": 42, "pastExam": null, "bringIn": "NO", "createdAt": "2026-08-30T00:00:00.000", "updatedAt": "2026-08-30T00:00:00.000" }
  ],
  "expected": {
    "courseKey": "parity|山田太郎",
    "university_id": "kyoto_u",
    "reviewCount": 4,
    "ratingSum": 16,
    "rakutanCounts": { "raku": 2, "futsu": 1, "muzu": 1 },
    "attendanceCounts": { "none": 1, "light": 2, "heavy": 1 },
    "gradingCounts": { "exam_only": 1, "exam_report": 2, "report_mainly": 1, "attendance_heavy": 0 },
    "pastExamCounts": { "as_is": 1, "similar": 1, "trend_only": 1, "not_useful": 1 },
    "bringInCounts": { "no": 1, "yes": 1, "na": 2 },
    "lastReviewAt": "2026-09-03T09:00:00.000",
    "score": 64
  }
}
```

(The Dart half of the parity check is Task 9 Step 1.)

- [ ] **Step 2: Write the failing tests `functions/test/courseStats.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { db, uid } from '../testlib/helpers.mjs';
import {
  aggregateCourseStats, rakutanScore, recomputeCourseStats, computeCourseStats,
  handleReviewWritten, handlePostWritten, reviewStatsKeys, postStatsSubjects,
} from '../lib/courseStats.js';

const fixture = JSON.parse(readFileSync(new URL('../../test/fixtures/course_stats_parity.json', import.meta.url), 'utf8'));
const REVIEW_FIELDS = Object.keys(fixture.expected); // exactly what CourseStats.toMap() emits
const NO_POSTS = { pastExam: 0, resource: 0 };
const slug = (s) => s.replace(/%/g, '%25').replace(/\//g, '%2F');
const statsDoc = async (ck) => (await db.collection('course_stats').doc(slug(ck)).get()).data();
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

const review = (ck, author, over = {}) => db.collection('reviews').doc(`${slug(ck)}_${author}`).set({
  courseKey: ck, courseSlug: slug(ck), authorId: author, university_id: 'kyoto_u', rating: 4,
  rakutan: 'raku', attendance: 'none', grading: 'exam_only', pastExam: 'as_is', bringIn: 'no',
  helpfulBy: [], createdAt: '2026-09-01T00:00:00.000', updatedAt: '2026-09-01T00:00:00.000', ...over,
});
const course = (id, ck) => db.collection('courses').doc(id).set({ id, courseKey: ck, name: 'n', university_id: 'kyoto_u' });
const post = (id, subjectId, category) => db.collection('posts').doc(id).set({
  authorId: 'a', subjectId, category, title: 't', university_id: 'kyoto_u',
});

test('PARITY: the aggregate equals CourseStats.applyReview on the shared fixture (M-14)', () => {
  const out = aggregateCourseStats(fixture.courseKey, fixture.reviews, NO_POSTS);
  assert.deepEqual(pick(out, REVIEW_FIELDS), fixture.expected);
  assert.deepEqual(Object.keys(out).sort(), [...REVIEW_FIELDS, 'pastExamPostCount', 'resourcePostCount'].sort());
});

test('rakutanScore: neutral 50 with no reviews, clamps at 0 and at 100', () => {
  assert.equal(aggregateCourseStats('k', [], NO_POSTS).score, 50);
  assert.equal(aggregateCourseStats('k', [{ rating: 1, rakutan: 'muzu', attendance: 'heavy' }], NO_POSTS).score, 0);
  assert.equal(aggregateCourseStats('k', [{ rating: 5, rakutan: 'raku', attendance: 'none' }], NO_POSTS).score, 100);
  assert.equal(rakutanScore(fixture.expected), 63.75);
});

test('an empty course: zero counters, every bucket key present, no lastReviewAt', () => {
  const out = aggregateCourseStats('k', [], NO_POSTS);
  assert.equal(out.reviewCount, 0);
  assert.equal(out.ratingSum, 0);
  assert.deepEqual(out.rakutanCounts, { raku: 0, futsu: 0, muzu: 0 });
  assert.deepEqual(out.gradingCounts, { exam_only: 0, exam_report: 0, report_mainly: 0, attendance_heavy: 0 });
  assert.equal('lastReviewAt' in out, false);
  assert.equal(out.university_id, 'kyoto_u');
});

test('recompute overwrites a forged aggregate with the true counts, under the slugged id', async () => {
  const ck = `${uid('ck')}/x|教員`; // C1: a courseKey with '/'
  await db.collection('course_stats').doc(slug(ck)).set({
    courseKey: ck, reviewCount: 999, score: 100, pinned: true, university_id: 'kyoto_u',
  });
  await review(ck, uid('a'), { rating: 5 });
  await review(ck, uid('a'), { rating: 3, rakutan: 'muzu', attendance: 'heavy' });
  const out = await recomputeCourseStats(db, ck);
  const s = await statsDoc(ck);
  assert.equal(s.reviewCount, 2);
  assert.equal(s.ratingSum, 8);
  assert.equal(s.score, 55); // raku-muzu 0, avg 4 -> +5, light 0.5 -> 0
  assert.equal(s.pinned, undefined); // a plain set, not a merge: forged fields do not survive
  assert.equal(s.courseKey, ck);
  assert.equal(s.university_id, 'kyoto_u');
  assert.ok(s.aggregatedAt);
  assert.equal(out.reviewCount, 2);
});

test('recompute: post counters span every course doc of the courseKey; hidden and foreign posts do not count', async () => {
  const ck = uid('ck'); const c1 = uid('c'); const c2 = uid('c'); const other = uid('c');
  await course(c1, ck);
  await course(c2, ck);
  await course(other, uid('ck'));
  await post(uid('p'), c1, 'past_exam');
  await post(uid('p'), c1, 'other');
  await post(uid('p'), c2, 'test_prep');
  await post(uid('p'), other, 'past_exam');
  await db.collection('hidden_posts').doc(uid('h')).set({
    authorId: 'a', subjectId: c1, category: 'past_exam', university_id: 'kyoto_u',
  });
  await recomputeCourseStats(db, ck);
  const s = await statsDoc(ck);
  assert.equal(s.pastExamPostCount, 1);
  assert.equal(s.resourcePostCount, 2);
  assert.equal(s.reviewCount, 0);
});

test('recompute is idempotent, and computeCourseStats predicts it without writing', async () => {
  const ck = uid('ck');
  await review(ck, uid('a'));
  const predicted = await computeCourseStats(db, ck);
  assert.equal(await statsDoc(ck), undefined); // compute never writes
  const a = await recomputeCourseStats(db, ck);
  const b = await recomputeCourseStats(db, ck);
  assert.deepEqual(a, b);
  assert.deepEqual(a, predicted);
});

test('reviewStatsKeys: a helpful vote or a comment-only change recounts nothing; stats fields, create and delete do', () => {
  const base = {
    courseKey: 'k', rating: 3, rakutan: 'raku', attendance: 'none', grading: 'exam_only',
    pastExam: 'as_is', bringIn: 'no', updatedAt: 'x', helpfulBy: [],
  };
  assert.deepEqual(reviewStatsKeys(base, { ...base, helpfulBy: ['u2'] }), []);
  assert.deepEqual(reviewStatsKeys(base, { ...base, comment: 'edited' }), []);
  assert.deepEqual(reviewStatsKeys(base, { ...base, rating: 4 }), ['k']);
  assert.deepEqual(reviewStatsKeys(base, { ...base, updatedAt: 'y' }), ['k']);
  assert.deepEqual(reviewStatsKeys(undefined, base), ['k']);
  assert.deepEqual(reviewStatsKeys(base, undefined), ['k']);
  assert.deepEqual(reviewStatsKeys(base, { ...base, courseKey: 'k2' }).sort(), ['k', 'k2']);
  assert.deepEqual(reviewStatsKeys({ ...base, courseKey: '' }, undefined), []);
});

test('postStatsSubjects: a downloadCount bump or title edit recounts nothing; create/delete/re-file does', () => {
  const p = { subjectId: 'c1', category: 'past_exam', downloadCount: 0 };
  assert.deepEqual(postStatsSubjects(p, { ...p, downloadCount: 1 }), []);
  assert.deepEqual(postStatsSubjects(p, { ...p, title: 'edited' }), []);
  assert.deepEqual(postStatsSubjects(undefined, p), ['c1']);
  assert.deepEqual(postStatsSubjects(p, undefined), ['c1']);
  assert.deepEqual(postStatsSubjects(p, { ...p, category: 'other' }), ['c1']);
  assert.deepEqual(postStatsSubjects(p, { ...p, subjectId: 'c2' }).sort(), ['c1', 'c2']);
  assert.deepEqual(postStatsSubjects({ subjectId: 'a/b', category: 'other' }, undefined), []); // never a path
});

test('handleReviewWritten recounts on create and delete, and skips vote-only writes', async () => {
  const ck = uid('ck'); const a = uid('a');
  const r = {
    courseKey: ck, rating: 4, rakutan: 'raku', attendance: 'none', grading: 'exam_only', pastExam: 'as_is',
    bringIn: 'no', updatedAt: '2026-09-01T00:00:00.000', helpfulBy: [],
  };
  assert.deepEqual(await handleReviewWritten(db, r, { ...r, helpfulBy: ['x'] }), []);
  assert.equal(await statsDoc(ck), undefined);
  await review(ck, a);
  assert.deepEqual(await handleReviewWritten(db, undefined, r), [ck]);
  assert.equal((await statsDoc(ck)).reviewCount, 1);
  await db.collection('reviews').doc(`${slug(ck)}_${a}`).delete();
  await handleReviewWritten(db, r, undefined);
  assert.equal((await statsDoc(ck)).reviewCount, 0);
});

test('handlePostWritten resolves subjectId -> courseKey; an unknown course is skipped without throwing', async () => {
  const ck = uid('ck'); const c = uid('c');
  await course(c, ck);
  await post(uid('p'), c, 'past_exam');
  const p = { subjectId: c, category: 'past_exam', downloadCount: 0 };
  assert.deepEqual(await handlePostWritten(db, undefined, p), [ck]);
  assert.equal((await statsDoc(ck)).pastExamPostCount, 1);
  assert.deepEqual(await handlePostWritten(db, p, { ...p, downloadCount: 5 }), []);
  assert.deepEqual(await handlePostWritten(db, undefined, { subjectId: uid('nocourse'), category: 'past_exam' }), []);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `courseStats.test.mjs` cannot import `../lib/courseStats.js`.

- [ ] **Step 4: Create `functions/src/courseStats.ts`**

```ts
import { FieldValue, type DocumentData, type Firestore, type Query, type QuerySnapshot } from 'firebase-admin/firestore';
import { UNIVERSITY_ID, isDocId } from './common.js';
import { reviewSlug } from './reviewCreated.js';

/**
 * Server-side `course_stats` (Plan 2B, M-11..M-14). Mirrors
 * lib/models/course_stats.dart + lib/models/review.dart exactly: the same enum
 * values and `fromString` fallbacks, the same rating clamp, the same
 * rakutanScore formula in the same operation order. Parity is enforced by
 * test/fixtures/course_stats_parity.json, asserted by BOTH test suites.
 */
// Review field -> its enum values (lib/models/review.dart `.value`s) and the
// value `fromString` falls back to. The doc fields are `<field>Counts`.
const BUCKETS: Record<'rakutan' | 'attendance' | 'grading' | 'pastExam' | 'bringIn', { keys: readonly string[]; fallback: string }> = {
  rakutan: { keys: ['raku', 'futsu', 'muzu'], fallback: 'futsu' },
  attendance: { keys: ['none', 'light', 'heavy'], fallback: 'light' },
  grading: { keys: ['exam_only', 'exam_report', 'report_mainly', 'attendance_heavy'], fallback: 'exam_report' },
  pastExam: { keys: ['as_is', 'similar', 'trend_only', 'not_useful'], fallback: 'trend_only' },
  bringIn: { keys: ['no', 'yes', 'na'], fallback: 'na' },
};
type Bucket = keyof typeof BUCKETS;
const BUCKET_NAMES = Object.keys(BUCKETS) as Bucket[];

export interface CourseStatsDoc {
  courseKey: string;
  university_id: string;
  reviewCount: number;
  ratingSum: number;
  rakutanCounts: Record<string, number>;
  attendanceCounts: Record<string, number>;
  gradingCounts: Record<string, number>;
  pastExamCounts: Record<string, number>;
  bringInCounts: Record<string, number>;
  pastExamPostCount: number;
  resourcePostCount: number;
  lastReviewAt?: string;
  score: number;
}

export interface PostCounts { pastExam: number; resource: number }

/** Review._rating: a whole number clamped to 0..5; anything else is 0. */
const rating = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
  return n < 0 ? 0 : n > 5 ? 5 : n;
};

/** `XxxX.fromString(map[k]?.toString() ?? '')`: an unknown value takes the enum's default. */
const bucketValue = (b: Bucket, v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return BUCKETS[b].keys.includes(s) ? s : BUCKETS[b].fallback;
};

/** CourseStats.rakutanScore (unrounded). Same operations, same order => bit-identical doubles. */
export function rakutanScore(
  s: Pick<CourseStatsDoc, 'reviewCount' | 'ratingSum' | 'rakutanCounts' | 'attendanceCounts'>,
): number {
  const n = s.reviewCount;
  if (n === 0) return 50;
  const avgRating = s.ratingSum / n;
  const rakuFrac = (s.rakutanCounts.raku ?? 0) / n;
  const muzuFrac = (s.rakutanCounts.muzu ?? 0) / n;
  const lightFrac = (s.attendanceCounts.none ?? 0) / n + 0.5 * ((s.attendanceCounts.light ?? 0) / n);
  const base = 50 + 35 * (rakuFrac - muzuFrac) + 10 * (avgRating - 3) / 2 + 10 * (lightFrac - 0.5);
  return Math.min(100, Math.max(0, base));
}

/** Pure: the aggregate of `reviews` (raw docs, possibly malformed) and the post counts. */
export function aggregateCourseStats(courseKey: string, reviews: DocumentData[], posts: PostCounts): CourseStatsDoc {
  const counts = Object.fromEntries(
    BUCKET_NAMES.map((b) => [b, Object.fromEntries(BUCKETS[b].keys.map((k) => [k, 0]))]),
  ) as Record<Bucket, Record<string, number>>;
  let ratingSum = 0;
  let last: { ms: number; raw: string } | null = null;
  for (const r of reviews) {
    ratingSum += rating(r.rating);
    for (const b of BUCKET_NAMES) counts[b][bucketValue(b, r[b])] += 1;
    const raw = typeof r.updatedAt === 'string' ? r.updatedAt : '';
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms) && (last === null || ms > last.ms)) last = { ms, raw }; // M-13
  }
  const doc: CourseStatsDoc = {
    courseKey,
    university_id: UNIVERSITY_ID,
    reviewCount: reviews.length,
    ratingSum,
    rakutanCounts: counts.rakutan,
    attendanceCounts: counts.attendance,
    gradingCounts: counts.grading,
    pastExamCounts: counts.pastExam,
    bringInCounts: counts.bringIn,
    pastExamPostCount: posts.pastExam,
    resourcePostCount: posts.resource,
    score: 50,
    ...(last ? { lastReviewAt: last.raw } : {}),
  };
  doc.score = Math.round(rakutanScore(doc)); // Dart .round(): identical for the non-negative range
  return doc;
}

export const statsRef = (db: Firestore, courseKey: string) =>
  db.collection('course_stats').doc(reviewSlug(courseKey));

type QueryGet = (q: Query) => Promise<QuerySnapshot>;

/** Every input of one course's aggregate (M-12: posts across every course doc of the courseKey). */
async function gather(db: Firestore, get: QueryGet, courseKey: string): Promise<{ reviews: DocumentData[]; posts: PostCounts }> {
  const reviews = (await get(db.collection('reviews').where('courseKey', '==', courseKey))).docs.map((d) => d.data());
  const courseIds = (await get(db.collection('courses').where('courseKey', '==', courseKey))).docs.map((d) => d.id);
  const posts: PostCounts = { pastExam: 0, resource: 0 };
  for (let i = 0; i < courseIds.length; i += 30) { // an 'in' filter takes at most 30 values
    const snap = await get(db.collection('posts').where('subjectId', 'in', courseIds.slice(i, i + 30)));
    for (const d of snap.docs) {
      if (d.get('category') === 'past_exam') posts.pastExam += 1;
      else posts.resource += 1; // PostCategoryX.fromString: anything else is 'other'
    }
  }
  return { reviews, posts };
}

/** Read-only: what a recount would write (the backfill dry run uses this). */
export async function computeCourseStats(db: Firestore, courseKey: string): Promise<CourseStatsDoc> {
  const { reviews, posts } = await gather(db, (q) => q.get(), courseKey);
  return aggregateCourseStats(courseKey, reviews, posts);
}

/**
 * Full recount of one course, written with a plain `set` (not merge) so a forged
 * or stale field cannot survive (M-11). The stats doc is read FIRST: its
 * pessimistic lock serialises concurrent recounts of the same course, so the
 * last writer always counted after the last committed source write.
 */
export async function recomputeCourseStats(db: Firestore, courseKey: string): Promise<CourseStatsDoc> {
  if (!courseKey) throw new Error('recomputeCourseStats: empty courseKey');
  const ref = statsRef(db, courseKey);
  return db.runTransaction(async (tx) => {
    await tx.get(ref);
    const { reviews, posts } = await gather(db, (q) => tx.get(q), courseKey);
    const doc = aggregateCourseStats(courseKey, reviews, posts);
    tx.set(ref, { ...doc, aggregatedAt: FieldValue.serverTimestamp() });
    return doc;
  });
}

// Review fields the aggregate reads; a write touching none of them recounts nothing.
const REVIEW_STATS_FIELDS = ['courseKey', 'rating', 'rakutan', 'attendance', 'grading', 'pastExam', 'bringIn', 'updatedAt'];
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function reviewStatsKeys(before?: DocumentData, after?: DocumentData): string[] {
  if (before && after && REVIEW_STATS_FIELDS.every((f) => same(before[f], after[f]))) return [];
  const keys = new Set<string>();
  for (const d of [before, after]) {
    if (typeof d?.courseKey === 'string' && d.courseKey !== '') keys.add(d.courseKey);
  }
  return [...keys];
}

export function postStatsSubjects(before?: DocumentData, after?: DocumentData): string[] {
  if (before && after && same(before.subjectId, after.subjectId) && same(before.category, after.category)) return [];
  const ids = new Set<string>();
  for (const d of [before, after]) {
    const s: unknown = d?.subjectId;
    if (isDocId(s)) ids.add(s);
  }
  return [...ids];
}

export async function handleReviewWritten(db: Firestore, before?: DocumentData, after?: DocumentData): Promise<string[]> {
  const keys = reviewStatsKeys(before, after);
  for (const k of keys) await recomputeCourseStats(db, k);
  return keys;
}

export async function handlePostWritten(db: Firestore, before?: DocumentData, after?: DocumentData): Promise<string[]> {
  const keys = new Set<string>();
  for (const id of postStatsSubjects(before, after)) {
    const ck = (await db.collection('courses').doc(id).get()).get('courseKey');
    if (typeof ck === 'string' && ck !== '') keys.add(ck);
  }
  for (const k of keys) await recomputeCourseStats(db, k);
  return [...keys];
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — prior 87 + 10 new in `courseStats.test.mjs`; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add functions/src/courseStats.ts functions/test/courseStats.test.mjs test/fixtures/course_stats_parity.json
git commit -m "feat(functions): course_stats as a Function-maintained full recount with a shared parity fixture"
```

---

### Task 3: Moderation core — hide/restore/remove as moves, notifications, audit log, file guard

**Files:**
- Create: `functions/src/moderation.ts`, `functions/test/moderation.test.mjs`
- Modify: `functions/src/postDeleted.ts`, `functions/test/postDeleted.test.mjs`

**Interfaces:**
- Consumes: `UNIVERSITY_ID`, `isDocId` (common); `handlePostDeleted`, `DeleteDeps` (postDeleted, 2A); test helpers `db`, `uid`, `seedPost`, `fakeDeps`; `processDownload`, `handlePostCreated`, `claimWelcome(db, uid, email)` (2A).
- Produces (`moderation.ts`):
  - types `HiddenBy = 'reports' | 'takedown' | 'operator'`, `QueueStatus = 'open' | 'hidden' | 'restored' | 'removed'`, `NotificationType = 'post_hidden' | 'post_restored' | 'post_removed'`, `interface QueueDoc { postId; authorId; postTitle; subjectId; status; priority: 'normal' | 'takedown'; reportCount; countedReports; takedownRequestIds: string[]; hiddenBy: HiddenBy | null; hiddenByUid: string | null; autoHide: boolean; transitions: number; needsReview: boolean }`, `interface OperatorAction { operator: string; note?: string }`
  - refs `postRef`, `hiddenRef`, `queueRef`, `reportRef(db, postId, uid)`, `actorRef`; `notificationId(postId, transitions)` = `mod_<postId>_<transitions>`; `num(v)`
  - `readQueue(snap, postId, post?) → QueueDoc`, `writeQueue(tx, db, q, isNew)`, `hideInTx(tx, db, q, post, by, byUid, actor, note?)` (used by Tasks 4 and 5)
  - `hidePost(db, postId, act) → {changed}`, `restorePost(db, postId, act) → {changed, discredited: string[]}`, `removePost(db, postId, act) → {removedFrom: 'posts' | 'hidden_posts'}`, `closeTakedown(db, requestId, act) → {changed}`, `listQueue(db, limit?) → {queue: (QueueDoc & {updatedAtMs})[], requests: {id, …}[]}`
- Produces (`postDeleted.ts`): `handlePostGone(db, deps, postId, post) → Promise<string[]>` — files removed only when the post exists in neither `posts` nor `hidden_posts`.

**Security invariants (tested):** a hide never deletes Storage files; a restore never overwrites a live doc; no moderation action changes a credit; every action is logged with its actor.

- [ ] **Step 1: Write the failing tests `functions/test/moderation.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, seedPost, fakeDeps } from '../testlib/helpers.mjs';
import { hidePost, restorePost, removePost, closeTakedown, listQueue } from '../lib/moderation.js';
import { processDownload } from '../lib/download.js';
import { handlePostCreated } from '../lib/postCreated.js';
import { claimWelcome } from '../lib/welcome.js';

const OP = { operator: 'tester' };
const get = (path) => db.doc(path).get();
const balance = async (u) => (await get(`credit_balances/${u}`)).get('balance') ?? 0;
const mkPost = async () => {
  const a = uid('a'); const id = uid('p'); const path = `resources/${a}/1_a.pdf`;
  await seedPost(id, { authorId: a, filePaths: [path], subjectId: uid('c'), title: '2024 期末' });
  return { a, id, path };
};

test('operator hide moves the post unchanged into hidden_posts, notifies the author, and is idempotent', async () => {
  const { a, id } = await mkPost();
  const original = (await get(`posts/${id}`)).data();
  assert.deepEqual(await hidePost(db, id, OP), { changed: true });
  assert.equal((await get(`posts/${id}`)).exists, false);
  assert.deepEqual((await get(`hidden_posts/${id}`)).data(), original);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ status: q.status, hiddenBy: q.hiddenBy, transitions: q.transitions, university_id: q.university_id },
    { status: 'hidden', hiddenBy: 'operator', transitions: 1, university_id: 'kyoto_u' });
  const n = (await get(`notifications/mod_${id}_1`)).data();
  assert.deepEqual({ uid: n.uid, type: n.type, postId: n.postId, postTitle: n.postTitle, read: n.read, university_id: n.university_id },
    { uid: a, type: 'post_hidden', postId: id, postTitle: '2024 期末', read: false, university_id: 'kyoto_u' });
  assert.deepEqual(await hidePost(db, id, OP), { changed: false });
  assert.equal((await get(`moderation_queue/${id}`)).get('transitions'), 1);
});

test('a hidden post cannot be downloaded and nothing is charged', async () => {
  const { id } = await mkPost();
  const u = uid('d');
  await claimWelcome(db, u, `${u}@st.kyoto-u.ac.jp`); // balance 3
  await hidePost(db, id, OP);
  const deps = fakeDeps();
  await assert.rejects(processDownload(db, deps, u, { postId: id }), (e) => e.code === 'not-found');
  assert.equal(deps.signed.length, 0);
  assert.equal(await balance(u), 3);
});

test('restore moves it back byte-for-byte, notifies, turns auto-hide off, and the re-fired onPostCreated pays nothing twice', async () => {
  const { a, id, path } = await mkPost();
  await handlePostCreated(db, fakeDeps([path]), id); // +3 upload
  assert.equal(await balance(a), 3);
  const original = (await get(`posts/${id}`)).data();
  await hidePost(db, id, OP);
  assert.equal((await restorePost(db, id, OP)).changed, true);
  assert.deepEqual((await get(`posts/${id}`)).data(), original);
  assert.equal((await get(`hidden_posts/${id}`)).exists, false);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ status: q.status, autoHide: q.autoHide, needsReview: q.needsReview, transitions: q.transitions },
    { status: 'restored', autoHide: false, needsReview: false, transitions: 2 });
  assert.equal((await get(`notifications/mod_${id}_2`)).get('type'), 'post_restored');
  await handlePostCreated(db, fakeDeps([path]), id); // the restore re-creates posts/{id}
  assert.equal(await balance(a), 3);
});

test('restore discredits the reporters behind a report-hide, the requester behind a takedown-hide, nobody behind an operator hide', async () => {
  const seedHidden = async (hiddenBy, hiddenByUid, reporters) => {
    const { id } = await mkPost();
    await hidePost(db, id, OP);
    await db.doc(`moderation_queue/${id}`).set({ hiddenBy, hiddenByUid }, { merge: true });
    for (const [r, counted] of reporters) {
      await db.doc(`moderation_queue/${id}/reports/${r}`).set({ counted, university_id: 'kyoto_u' });
    }
    return id;
  };
  const r1 = uid('r'); const r2 = uid('r'); const r3 = uid('r'); const quiet = uid('r'); const req = uid('t');
  const byReports = await seedHidden('reports', null, [[r1, true], [r2, true], [r3, true], [quiet, false]]);
  assert.deepEqual((await restorePost(db, byReports, OP)).discredited.sort(), [r1, r2, r3].sort());
  for (const r of [r1, r2, r3]) assert.equal((await get(`moderation_actors/${r}`)).get('restoredReports'), 1);
  assert.equal((await get(`moderation_actors/${quiet}`)).exists, false);
  const byTakedown = await seedHidden('takedown', req, []);
  assert.deepEqual((await restorePost(db, byTakedown, OP)).discredited, [req]);
  assert.equal((await get(`moderation_actors/${req}`)).get('restoredTakedowns'), 1);
  assert.equal((await get(`moderation_actors/${req}`)).get('restoredReports'), undefined);
  const lone = uid('r');
  const byOperator = await seedHidden('operator', null, [[lone, true]]);
  assert.deepEqual((await restorePost(db, byOperator, OP)).discredited, []);
  assert.equal((await get(`moderation_actors/${lone}`)).exists, false);
});

test('restore on a visible queued post acknowledges it: stays visible, no notification, auto-hide off', async () => {
  const { id } = await mkPost();
  await db.doc(`moderation_queue/${id}`).set({ postId: id, status: 'open', needsReview: true, priority: 'takedown', transitions: 0 });
  assert.equal((await restorePost(db, id, OP)).changed, false);
  assert.equal((await get(`posts/${id}`)).exists, true);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ status: q.status, autoHide: q.autoHide, needsReview: q.needsReview },
    { status: 'restored', autoHide: false, needsReview: false });
  assert.equal((await db.collection('notifications').where('postId', '==', id).get()).size, 0);
});

test('remove deletes a hidden or a visible post, notifies, and never claws back credits (M-4)', async () => {
  const { a, id, path } = await mkPost();
  await handlePostCreated(db, fakeDeps([path]), id); // +3
  await hidePost(db, id, OP);
  assert.deepEqual(await removePost(db, id, OP), { removedFrom: 'hidden_posts' });
  assert.equal((await get(`hidden_posts/${id}`)).exists, false);
  assert.equal((await get(`posts/${id}`)).exists, false);
  assert.equal((await get(`moderation_queue/${id}`)).get('status'), 'removed');
  assert.equal((await get(`notifications/mod_${id}_2`)).get('type'), 'post_removed');
  assert.equal(await balance(a), 3);
  assert.equal((await get(`credits_ledger/upload_${id}`)).get('delta'), 3);
  const v = await mkPost();
  assert.deepEqual(await removePost(db, v.id, OP), { removedFrom: 'posts' });
  assert.equal((await get(`posts/${v.id}`)).exists, false);
  assert.equal((await get(`notifications/mod_${v.id}_1`)).get('type'), 'post_removed');
});

test('operator actions need an operator name and a valid id; unknown ids are not-found; nothing changes', async () => {
  const { id } = await mkPost();
  for (const fn of [hidePost, restorePost, removePost]) {
    await assert.rejects(fn(db, id, { operator: '' }), (e) => e.code === 'invalid-argument');
    await assert.rejects(fn(db, id, { operator: 'x'.repeat(51) }), (e) => e.code === 'invalid-argument');
    await assert.rejects(fn(db, 'a/b', OP), (e) => e.code === 'invalid-argument');
    await assert.rejects(fn(db, uid('nope'), OP), (e) => e.code === 'not-found');
  }
  assert.equal((await get(`posts/${id}`)).exists, true);
  assert.equal((await get(`moderation_queue/${id}`)).exists, false);
});

test('restore refuses when a live post already holds the id (never overwrites)', async () => {
  const { id } = await mkPost();
  await hidePost(db, id, OP);
  await db.doc(`posts/${id}`).set({ authorId: 'someone', university_id: 'kyoto_u' });
  await assert.rejects(restorePost(db, id, OP), (e) => e.code === 'failed-precondition');
  assert.equal((await get(`hidden_posts/${id}`)).exists, true);
  assert.equal((await get(`posts/${id}`)).get('authorId'), 'someone');
});

test('every action leaves an audit row naming its actor', async () => {
  const { id } = await mkPost();
  await hidePost(db, id, { operator: 'alice', note: 'checked the PDF' });
  await restorePost(db, id, { operator: 'bob' });
  const rows = (await db.collection('moderation_log').where('target', '==', id).get()).docs.map((d) => d.data());
  assert.deepEqual(rows.map((r) => r.by).sort(), ['operator:alice', 'operator:bob']);
  assert.ok(rows.some((r) => r.note === 'checked the PDF'));
  assert.ok(rows.every((r) => r.university_id === 'kyoto_u'));
});

test('closeTakedown closes an open request once; unknown ids are not-found', async () => {
  const rid = uid('t');
  await db.doc(`takedown_requests/${rid}`).set({ status: 'open', university_id: 'kyoto_u' });
  assert.deepEqual(await closeTakedown(db, rid, OP), { changed: true });
  assert.equal((await get(`takedown_requests/${rid}`)).get('status'), 'closed');
  assert.deepEqual(await closeTakedown(db, rid, OP), { changed: false });
  await assert.rejects(closeTakedown(db, uid('t'), OP), (e) => e.code === 'not-found');
});

test('listQueue: takedown-priority entries first, plus entries that need review, plus open requests', async () => {
  const a = uid('q'); const b = uid('q'); const c = uid('q'); const done = uid('q'); const rid = uid('t');
  await db.doc(`moderation_queue/${a}`).set({ postId: a, status: 'open', priority: 'normal' });
  await db.doc(`moderation_queue/${b}`).set({ postId: b, status: 'hidden', priority: 'takedown' });
  await db.doc(`moderation_queue/${c}`).set({ postId: c, status: 'restored', priority: 'normal', needsReview: true });
  await db.doc(`moderation_queue/${done}`).set({ postId: done, status: 'removed', priority: 'takedown' });
  await db.doc(`takedown_requests/${rid}`).set({ status: 'open', description: 'x' });
  const { queue, requests } = await listQueue(db, 500);
  const mine = queue.map((x) => x.postId).filter((id) => [a, b, c, done].includes(id));
  assert.equal(mine[0], b);
  assert.deepEqual(mine.slice(1).sort(), [a, c].sort()); // `done` (removed, no review) is not listed
  assert.ok(requests.some((r) => r.id === rid));
});
```

- [ ] **Step 2: Extend `functions/test/postDeleted.test.mjs`**

Replace its helpers import with `import { db, uid, fakeDeps } from '../testlib/helpers.mjs';`, add `handlePostGone` to the `../lib/postDeleted.js` import, and append:

```js
const owned = (a) => ({ authorId: a, filePaths: [`resources/${a}/1_a.pdf`] });

test('handlePostGone: a post that exists in NEITHER collection has its files removed', async () => {
  const a = uid('a'); const deps = fakeDeps();
  assert.deepEqual(await handlePostGone(db, deps, uid('p'), owned(a)), [`resources/${a}/1_a.pdf`]);
  assert.deepEqual(deps.removed, [`resources/${a}/1_a.pdf`]);
});

test('handlePostGone: a hide (the doc moved to hidden_posts) keeps the files', async () => {
  const a = uid('a'); const id = uid('p'); const deps = fakeDeps();
  await db.doc(`hidden_posts/${id}`).set({ ...owned(a), university_id: 'kyoto_u' });
  assert.deepEqual(await handlePostGone(db, deps, id, owned(a)), []);
  assert.deepEqual(deps.removed, []);
});

test('handlePostGone: a restore (the doc is back in posts) keeps the files', async () => {
  const a = uid('a'); const id = uid('p'); const deps = fakeDeps();
  await db.doc(`posts/${id}`).set({ ...owned(a), university_id: 'kyoto_u' });
  assert.deepEqual(await handlePostGone(db, deps, id, owned(a)), []);
  assert.deepEqual(deps.removed, []);
});

test('handlePostGone keeps the author-prefix guard', async () => {
  const deps = fakeDeps();
  const out = await handlePostGone(db, deps, uid('p'), {
    authorId: 'attacker', filePaths: ['resources/victim/x.pdf', 'resources/attacker/y.pdf'],
  });
  assert.deepEqual(out, ['resources/attacker/y.pdf']);
  assert.deepEqual(deps.removed, ['resources/attacker/y.pdf']);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `../lib/moderation.js` missing; `handlePostGone` is not exported.

- [ ] **Step 4: Create `functions/src/moderation.ts`**

```ts
import {
  FieldValue, type DocumentData, type DocumentSnapshot, type Firestore, type Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { UNIVERSITY_ID, isDocId } from './common.js';

export type HiddenBy = 'reports' | 'takedown' | 'operator';
export type QueueStatus = 'open' | 'hidden' | 'restored' | 'removed';
export type NotificationType = 'post_hidden' | 'post_restored' | 'post_removed';

/** `moderation_queue/{postId}` (Admin-only). One entry per post that was ever reported or named in a takedown. */
export interface QueueDoc {
  postId: string;
  authorId: string;
  postTitle: string;
  subjectId: string;
  status: QueueStatus;
  priority: 'normal' | 'takedown';
  reportCount: number;
  countedReports: number;
  takedownRequestIds: string[];
  hiddenBy: HiddenBy | null;
  hiddenByUid: string | null;
  autoHide: boolean; // false once an operator has reviewed the post (M-8)
  transitions: number; // hide/restore/remove count; keys the notification ids (M-10)
  needsReview: boolean;
}

export interface OperatorAction { operator: string; note?: string }

export const postRef = (db: Firestore, id: string) => db.collection('posts').doc(id);
export const hiddenRef = (db: Firestore, id: string) => db.collection('hidden_posts').doc(id);
export const queueRef = (db: Firestore, id: string) => db.collection('moderation_queue').doc(id);
export const reportRef = (db: Firestore, postId: string, uid: string) => queueRef(db, postId).collection('reports').doc(uid);
export const actorRef = (db: Firestore, uid: string) => db.collection('moderation_actors').doc(uid);
export const notificationId = (postId: string, transitions: number) => `mod_${postId}_${transitions}`;

export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const STATUSES: QueueStatus[] = ['open', 'hidden', 'restored', 'removed'];
const HIDERS: HiddenBy[] = ['reports', 'takedown', 'operator'];

export function readQueue(snap: DocumentSnapshot, postId: string, post?: DocumentData): QueueDoc {
  const d: DocumentData = (snap.exists ? snap.data() : undefined) ?? {};
  return {
    postId,
    authorId: String(d.authorId ?? post?.authorId ?? ''),
    postTitle: String(d.postTitle ?? post?.title ?? '').slice(0, 200),
    subjectId: String(d.subjectId ?? post?.subjectId ?? ''),
    status: STATUSES.includes(d.status) ? d.status : 'open',
    priority: d.priority === 'takedown' ? 'takedown' : 'normal',
    reportCount: num(d.reportCount),
    countedReports: num(d.countedReports),
    takedownRequestIds: Array.isArray(d.takedownRequestIds)
      ? d.takedownRequestIds.filter((x: unknown): x is string => typeof x === 'string') : [],
    hiddenBy: HIDERS.includes(d.hiddenBy) ? d.hiddenBy : null,
    hiddenByUid: typeof d.hiddenByUid === 'string' ? d.hiddenByUid : null,
    autoHide: d.autoHide !== false,
    transitions: num(d.transitions),
    needsReview: d.needsReview === true,
  };
}

export function writeQueue(tx: Transaction, db: Firestore, q: QueueDoc, isNew: boolean): void {
  tx.set(queueRef(db, q.postId), {
    ...q,
    university_id: UNIVERSITY_ID,
    updatedAt: FieldValue.serverTimestamp(),
    ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}),
  }, { merge: true });
}

/** One notice per state transition; the id makes a replay rewrite the same doc (M-10). */
function notify(tx: Transaction, db: Firestore, q: QueueDoc, type: NotificationType): void {
  if (!q.authorId) return;
  tx.set(db.collection('notifications').doc(notificationId(q.postId, q.transitions)), {
    uid: q.authorId,
    type,
    postId: q.postId,
    postTitle: q.postTitle,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    university_id: UNIVERSITY_ID,
  });
}

function log(tx: Transaction, db: Firestore, action: string, target: string, by: string, note = ''): void {
  tx.set(db.collection('moderation_log').doc(), {
    action, target, by, note: String(note ?? '').slice(0, 500),
    at: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
  });
}

/**
 * Hide = MOVE (M-1): the post's data goes to Admin-only `hidden_posts/{id}`
 * unchanged and `posts/{id}` is deleted in the same transaction, so every client
 * query, the course counters and `downloadResource` stop seeing it. Storage
 * files stay (handlePostGone skips while either doc exists). Never touches a
 * credit (M-4). The caller has done every read; it writes the queue doc after.
 */
export function hideInTx(
  tx: Transaction, db: Firestore, q: QueueDoc, post: DocumentData,
  by: HiddenBy, byUid: string | null, actor: string, note = '',
): void {
  tx.set(hiddenRef(db, q.postId), post);
  tx.delete(postRef(db, q.postId));
  q.status = 'hidden';
  q.hiddenBy = by;
  q.hiddenByUid = byUid;
  q.transitions += 1;
  q.needsReview = true;
  notify(tx, db, q, 'post_hidden');
  log(tx, db, `hide:${by}`, q.postId, actor, note);
}

function operatorName(act: OperatorAction | undefined): string {
  const op = String(act?.operator ?? '').trim();
  if (!op || op.length > 50) throw new HttpsError('invalid-argument', 'operator required');
  return op;
}

function requireId(id: unknown): string {
  if (!isDocId(id)) throw new HttpsError('invalid-argument', 'bad id');
  return id;
}

/** Operator hide (e.g. after checking an unverified takedown). Idempotent. */
export async function hidePost(db: Firestore, postIdIn: unknown, act: OperatorAction): Promise<{ changed: boolean }> {
  const op = operatorName(act);
  const postId = requireId(postIdIn);
  return db.runTransaction(async (tx) => {
    const p = await tx.get(postRef(db, postId));
    const h = await tx.get(hiddenRef(db, postId));
    const qs = await tx.get(queueRef(db, postId));
    if (!p.exists) {
      if (h.exists) return { changed: false };
      throw new HttpsError('not-found', 'post not found');
    }
    const q = readQueue(qs, postId, p.data());
    hideInTx(tx, db, q, p.data()!, 'operator', null, `operator:${op}`, act.note);
    writeQueue(tx, db, q, !qs.exists);
    return { changed: true };
  });
}

/**
 * Operator: the post is fine. A hidden post moves back (identical data) and its
 * author is told; a visible queued post is acknowledged. Either way automatic
 * hiding is switched off for it (M-8), and whoever caused the hide is
 * discredited by one (M-9). Never overwrites a live doc; never touches credits.
 */
export async function restorePost(
  db: Firestore, postIdIn: unknown, act: OperatorAction,
): Promise<{ changed: boolean; discredited: string[] }> {
  const op = operatorName(act);
  const postId = requireId(postIdIn);
  return db.runTransaction(async (tx) => {
    const h = await tx.get(hiddenRef(db, postId));
    const p = await tx.get(postRef(db, postId));
    const qs = await tx.get(queueRef(db, postId));
    const counted = await tx.get(queueRef(db, postId).collection('reports').where('counted', '==', true));
    if (!h.exists && !p.exists) throw new HttpsError('not-found', 'post not found');
    if (h.exists && p.exists) throw new HttpsError('failed-precondition', 'a live post holds this id');

    const q = readQueue(qs, postId, (h.exists ? h : p).data());
    const discredited: string[] = [];
    if (h.exists) {
      tx.create(postRef(db, postId), h.data()!);
      tx.delete(hiddenRef(db, postId));
      if (q.hiddenBy === 'reports') for (const r of counted.docs) discredited.push(r.id);
      if (q.hiddenBy === 'takedown' && q.hiddenByUid) discredited.push(q.hiddenByUid);
      const field = q.hiddenBy === 'takedown' ? 'restoredTakedowns' : 'restoredReports';
      for (const u of discredited) {
        tx.set(actorRef(db, u), { [field]: FieldValue.increment(1), university_id: UNIVERSITY_ID }, { merge: true });
      }
      q.transitions += 1;
      notify(tx, db, q, 'post_restored');
    }
    q.status = 'restored';
    q.autoHide = false;
    q.needsReview = false;
    log(tx, db, h.exists ? 'restore' : 'acknowledge', postId, `operator:${op}`, act.note);
    writeQueue(tx, db, q, !qs.exists);
    return { changed: h.exists, discredited };
  });
}

/** Operator: permanent removal (visible or hidden). Files go via handlePostGone; credits stay (M-4). */
export async function removePost(
  db: Firestore, postIdIn: unknown, act: OperatorAction,
): Promise<{ removedFrom: 'posts' | 'hidden_posts' }> {
  const op = operatorName(act);
  const postId = requireId(postIdIn);
  return db.runTransaction(async (tx) => {
    const p = await tx.get(postRef(db, postId));
    const h = await tx.get(hiddenRef(db, postId));
    const qs = await tx.get(queueRef(db, postId));
    if (!p.exists && !h.exists) throw new HttpsError('not-found', 'post not found');
    const q = readQueue(qs, postId, (p.exists ? p : h).data());
    if (p.exists) tx.delete(postRef(db, postId));
    if (h.exists) tx.delete(hiddenRef(db, postId));
    q.status = 'removed';
    q.autoHide = false;
    q.needsReview = false;
    q.transitions += 1;
    notify(tx, db, q, 'post_removed');
    log(tx, db, 'remove', postId, `operator:${op}`, act.note);
    writeQueue(tx, db, q, !qs.exists);
    return { removedFrom: p.exists ? 'posts' as const : 'hidden_posts' as const };
  });
}

/** Operator: a takedown request has been dealt with (or needs no action). */
export async function closeTakedown(db: Firestore, requestIdIn: unknown, act: OperatorAction): Promise<{ changed: boolean }> {
  const op = operatorName(act);
  const id = requireId(requestIdIn);
  const ref = db.collection('takedown_requests').doc(id);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', 'request not found');
    if (s.get('status') === 'closed') return { changed: false };
    tx.update(ref, { status: 'closed', closedBy: op, closedAt: FieldValue.serverTimestamp() });
    log(tx, db, 'close_takedown', id, `operator:${op}`, act.note);
    return { changed: true };
  });
}

const millis = (v: unknown): number =>
  v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : 0;

/** What needs an operator: open/hidden entries and flagged ones (takedown priority first), plus open requests. */
export async function listQueue(db: Firestore, limit = 50): Promise<{
  queue: Array<QueueDoc & { updatedAtMs: number }>;
  requests: Array<DocumentData & { id: string }>;
}> {
  const [active, flagged, open] = await Promise.all([
    db.collection('moderation_queue').where('status', 'in', ['open', 'hidden']).limit(limit).get(),
    db.collection('moderation_queue').where('needsReview', '==', true).limit(limit).get(),
    db.collection('takedown_requests').where('status', '==', 'open').limit(limit).get(),
  ]);
  const byId = new Map<string, QueueDoc & { updatedAtMs: number }>();
  for (const d of [...active.docs, ...flagged.docs]) {
    byId.set(d.id, { ...readQueue(d, d.id), updatedAtMs: millis(d.get('updatedAt')) });
  }
  const rank = (x: QueueDoc) => (x.priority === 'takedown' ? 0 : 1);
  const queue = [...byId.values()].sort((a, b) => rank(a) - rank(b) || b.updatedAtMs - a.updatedAtMs);
  return { queue, requests: open.docs.map((d) => ({ id: d.id, ...d.data() })) };
}
```

- [ ] **Step 5: Add `handlePostGone` to `functions/src/postDeleted.ts`**

Add at the top `import type { Firestore } from 'firebase-admin/firestore';` and append:

```ts
/**
 * Plan 2B: shared by `onPostDeleted` and `onHiddenPostDeleted`. Hide and restore
 * MOVE a post between `posts` and `hidden_posts` (M-1), which looks like a delete
 * to one of the two triggers. Files are removed only when the post now exists in
 * NEITHER collection — i.e. it is really gone (author delete, invalid post,
 * operator removal) — and then still only under the author's own prefix.
 */
export async function handlePostGone(
  db: Firestore,
  deps: DeleteDeps,
  postId: string,
  post: Record<string, unknown>,
): Promise<string[]> {
  const [live, hidden] = await Promise.all([
    db.collection('posts').doc(postId).get(),
    db.collection('hidden_posts').doc(postId).get(),
  ]);
  if (live.exists || hidden.exists) return [];
  return handlePostDeleted(deps, post);
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — prior 97 + 11 (`moderation.test.mjs`) + 4 (`postDeleted.test.mjs`, now 9); `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add functions/src/moderation.ts functions/src/postDeleted.ts functions/test/moderation.test.mjs functions/test/postDeleted.test.mjs
git commit -m "feat(functions): moderation core — hide/restore/remove as moves, notices, audit log, file guard"
```

---

### Task 4: `reportPost` — one report per (post, reporter), threshold hide, discredit, daily cap

**Files:**
- Create: `functions/src/report.ts`, `functions/test/report.test.mjs`

**Interfaces:**
- Consumes: `MODERATION`, `UNIVERSITY_ID`, `isDocId`, `jstDay` (common); `actorRef`, `hiddenRef`, `hideInTx`, `num`, `postRef`, `queueRef`, `readQueue`, `reportRef`, `writeQueue` (moderation).
- Produces: `REPORT_CATEGORIES = ['copyright', 'unrelated', 'inappropriate', 'other']`, `type ReportStatus = 'reported' | 'hidden' | 'duplicate' | 'already_hidden'`, `processReport(db, uid, input: { postId, category, detail? }, now?) → Promise<{ status: ReportStatus }>`.

Behaviour (in order, one transaction, all reads first): bad `postId` / `category` / `detail` > 500 → `invalid-argument` (nothing written); post missing → `already_hidden` if it is in `hidden_posts`, else `not-found`; caller is the author → `failed-precondition` `own-post`; caller already reported it → `duplicate` (no write); caller used 10 reports today (JST) → `resource-exhausted` `report-limit`; otherwise the report doc is created (`counted` = caller has < 3 restored report-hides), the caller's daily counter bumped, the queue entry updated, and — if `autoHide` and `countedReports >= 3` — the post is hidden (`hideInTx`, `by: 'reports'`). On an operator-cleared post (`autoHide: false`) the report only sets `needsReview`.

- [ ] **Step 1: Write the failing tests `functions/test/report.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, seedPost } from '../testlib/helpers.mjs';
import { processReport } from '../lib/report.js';

const get = (path) => db.doc(path).get();
const R = (postId, over = {}) => ({ postId, category: 'copyright', detail: '無断転載です', ...over });
const mk = async () => {
  const a = uid('a'); const id = uid('p');
  await seedPost(id, { authorId: a, filePaths: [`resources/${a}/1.pdf`], title: '期末' });
  return { a, id };
};

test('a report is recorded once per reporter, Admin-side, and alone does not hide the post', async () => {
  const { id } = await mk(); const r = uid('r');
  assert.deepEqual(await processReport(db, r, R(id)), { status: 'reported' });
  const rep = (await get(`moderation_queue/${id}/reports/${r}`)).data();
  assert.deepEqual({ reporterUid: rep.reporterUid, category: rep.category, detail: rep.detail, counted: rep.counted, university_id: rep.university_id },
    { reporterUid: r, category: 'copyright', detail: '無断転載です', counted: true, university_id: 'kyoto_u' });
  assert.equal((await get(`posts/${id}`)).exists, true);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ status: q.status, reportCount: q.reportCount, countedReports: q.countedReports, university_id: q.university_id },
    { status: 'open', reportCount: 1, countedReports: 1, university_id: 'kyoto_u' });
  assert.equal((await get(`moderation_actors/${r}`)).get('university_id'), 'kyoto_u');
  assert.deepEqual(await processReport(db, r, R(id)), { status: 'duplicate' });
  assert.equal((await get(`moderation_queue/${id}`)).get('reportCount'), 1);
});

test('the 3rd DISTINCT reporter hides the post (moved, not deleted), notifies the author once, credits untouched', async () => {
  const { a, id } = await mk();
  await db.doc(`credit_balances/${a}`).set({ balance: 7, university_id: 'kyoto_u' });
  const original = (await get(`posts/${id}`)).data();
  assert.equal((await processReport(db, uid('r'), R(id))).status, 'reported');
  assert.equal((await processReport(db, uid('r'), R(id))).status, 'reported');
  assert.equal((await processReport(db, uid('r'), R(id))).status, 'hidden');
  assert.equal((await get(`posts/${id}`)).exists, false);
  assert.deepEqual((await get(`hidden_posts/${id}`)).data(), original);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ status: q.status, hiddenBy: q.hiddenBy, transitions: q.transitions, needsReview: q.needsReview },
    { status: 'hidden', hiddenBy: 'reports', transitions: 1, needsReview: true });
  const notes = await db.collection('notifications').where('postId', '==', id).get();
  assert.equal(notes.size, 1);
  assert.deepEqual({ uid: notes.docs[0].get('uid'), type: notes.docs[0].get('type') }, { uid: a, type: 'post_hidden' });
  assert.equal((await get(`credit_balances/${a}`)).get('balance'), 7);
  assert.deepEqual(await processReport(db, uid('r'), R(id)), { status: 'already_hidden' });
});

test('one account cannot reach the threshold alone: re-reporting is a no-op', async () => {
  const { id } = await mk(); const r = uid('r');
  for (let i = 0; i < 4; i++) await processReport(db, r, R(id));
  assert.equal((await get(`posts/${id}`)).exists, true);
  assert.equal((await get(`moderation_queue/${id}`)).get('countedReports'), 1);
});

test('three reporters at once hide the post exactly once', async () => {
  const { id } = await mk();
  const rs = await Promise.all([1, 2, 3].map(() => processReport(db, uid('r'), R(id))));
  assert.equal(rs.filter((x) => x.status === 'hidden').length, 1);
  assert.equal((await get(`moderation_queue/${id}`)).get('transitions'), 1);
  assert.equal((await db.collection('notifications').where('postId', '==', id).get()).size, 1);
});

test('the author cannot report their own post', async () => {
  const { a, id } = await mk();
  await assert.rejects(processReport(db, a, R(id)), (e) => e.code === 'failed-precondition' && /own-post/.test(e.message));
  assert.equal((await get(`moderation_queue/${id}`)).exists, false);
});

test('M-9: a reporter with 3 restored report-hides is recorded but not counted; with 2 they still count', async () => {
  const { id } = await mk(); const bad = uid('r');
  await db.doc(`moderation_actors/${bad}`).set({ restoredReports: 3 });
  await processReport(db, uid('r'), R(id));
  await processReport(db, uid('r'), R(id));
  assert.deepEqual(await processReport(db, bad, R(id)), { status: 'reported' }); // silent
  assert.equal((await get(`posts/${id}`)).exists, true);
  assert.equal((await get(`moderation_queue/${id}/reports/${bad}`)).get('counted'), false);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ reportCount: q.reportCount, countedReports: q.countedReports }, { reportCount: 3, countedReports: 2 });
  const ok = uid('r');
  await db.doc(`moderation_actors/${ok}`).set({ restoredReports: 2 });
  assert.equal((await processReport(db, ok, R(id))).status, 'hidden');
});

test('M-8: a post an operator cleared is never re-hidden by reports — it is flagged for review', async () => {
  const { id } = await mk();
  await db.doc(`moderation_queue/${id}`).set({ postId: id, status: 'restored', autoHide: false, needsReview: false });
  for (let i = 0; i < 4; i++) assert.equal((await processReport(db, uid('r'), R(id))).status, 'reported');
  assert.equal((await get(`posts/${id}`)).exists, true);
  assert.equal((await get(`moderation_queue/${id}`)).get('needsReview'), true);
});

test('M-7: the 11th report of a JST day is refused and leaves no trace; the next day is fine', async () => {
  const r = uid('r'); const day = new Date('2027-01-20T03:00:00Z');
  for (let i = 0; i < 10; i++) { const { id } = await mk(); await processReport(db, r, R(id), day); }
  const { id } = await mk();
  await assert.rejects(processReport(db, r, R(id), day), (e) => e.code === 'resource-exhausted');
  assert.equal((await get(`moderation_queue/${id}/reports/${r}`)).exists, false);
  assert.equal((await processReport(db, r, R(id), new Date('2027-01-20T16:00:00Z'))).status, 'reported');
});

test('bad input is refused before anything is written', async () => {
  const { id } = await mk(); const r = uid('r');
  const bads = [R('a/b'), R(''), R(42), R(id, { category: 'spam' }), R(id, { category: undefined }), R(id, { detail: 'x'.repeat(501) })];
  for (const bad of bads) {
    await assert.rejects(processReport(db, r, bad), (e) => e.code === 'invalid-argument', JSON.stringify(bad));
  }
  await assert.rejects(processReport(db, r, R(uid('nope'))), (e) => e.code === 'not-found');
  assert.equal((await get(`moderation_actors/${r}`)).exists, false);
  assert.equal((await get(`moderation_queue/${id}`)).exists, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `../lib/report.js` missing.

- [ ] **Step 3: Create `functions/src/report.ts`**

```ts
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { MODERATION, UNIVERSITY_ID, isDocId, jstDay } from './common.js';
import {
  actorRef, hiddenRef, hideInTx, num, postRef, queueRef, readQueue, reportRef, writeQueue,
} from './moderation.js';

export const REPORT_CATEGORIES = ['copyright', 'unrelated', 'inappropriate', 'other'] as const;
export type ReportStatus = 'reported' | 'hidden' | 'duplicate' | 'already_hidden';

/**
 * `reportPost` (M-2, M-3, M-7, M-8, M-9). One report per (post, reporter), at
 * moderation_queue/{postId}/reports/{uid} — Admin-only, so a client can neither
 * forge a count nor learn who reported. The post is hidden once
 * MODERATION.reportHideThreshold DISTINCT counted reporters have reported it,
 * unless an operator already cleared it. Never touches a credit.
 */
export async function processReport(
  db: Firestore,
  uid: string,
  input: Record<string, unknown>,
  now: Date = new Date(),
): Promise<{ status: ReportStatus }> {
  const postId = input?.postId;
  if (!isDocId(postId)) throw new HttpsError('invalid-argument', 'bad post id');
  const category = input.category;
  if (typeof category !== 'string' || !(REPORT_CATEGORIES as readonly string[]).includes(category)) {
    throw new HttpsError('invalid-argument', 'bad category');
  }
  const detail = typeof input.detail === 'string' ? input.detail.trim() : '';
  if (detail.length > MODERATION.maxDetail) throw new HttpsError('invalid-argument', 'detail too long');
  const day = jstDay(now);

  return db.runTransaction(async (tx) => {
    const postSnap = await tx.get(postRef(db, postId));
    const hiddenSnap = await tx.get(hiddenRef(db, postId));
    const mine = await tx.get(reportRef(db, postId, uid));
    const actorSnap = await tx.get(actorRef(db, uid));
    const queueSnap = await tx.get(queueRef(db, postId));

    if (!postSnap.exists) {
      if (hiddenSnap.exists) return { status: 'already_hidden' as const };
      throw new HttpsError('not-found', 'post not found');
    }
    const post = postSnap.data()!;
    if (post.authorId === uid) throw new HttpsError('failed-precondition', 'own-post');
    if (mine.exists) return { status: 'duplicate' as const };

    const actor = actorSnap.data() ?? {};
    const usedToday = actor.reportDay === day ? num(actor.reportsToday) : 0;
    if (usedToday >= MODERATION.reportDailyCap) throw new HttpsError('resource-exhausted', 'report-limit');
    // M-9: a discredited reporter is recorded but silently not counted.
    const counted = num(actor.restoredReports) < MODERATION.discreditRestoredReports;

    const q = readQueue(queueSnap, postId, post);
    q.reportCount += 1;
    if (counted) q.countedReports += 1;
    tx.create(reportRef(db, postId, uid), {
      postId, reporterUid: uid, category, detail, counted,
      createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
    });
    tx.set(actorRef(db, uid), { reportDay: day, reportsToday: usedToday + 1, university_id: UNIVERSITY_ID }, { merge: true });

    let status: ReportStatus = 'reported';
    if (q.autoHide && q.countedReports >= MODERATION.reportHideThreshold) {
      hideInTx(tx, db, q, post, 'reports', null, 'system');
      status = 'hidden';
    } else if (!q.autoHide) {
      q.needsReview = true; // M-8: an operator-cleared post only goes back to review
    }
    writeQueue(tx, db, q, !queueSnap.exists);
    return { status };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — prior 112 + 9 new in `report.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add functions/src/report.ts functions/test/report.test.mjs
git commit -m "feat(functions): reportPost — Function-owned reports, 3 distinct reporters hide, discredit, daily cap"
```

---

### Task 5: `submitTakedown` — priority queue, immediate hide only for a verified KU requester

**Files:**
- Create: `functions/src/takedown.ts`, `functions/test/takedown.test.mjs`

**Interfaces:**
- Consumes: `MODERATION`, `UNIVERSITY_ID`, `isDocId`, `jstDay` (common); `actorRef`, `hiddenRef`, `hideInTx`, `num`, `postRef`, `queueRef`, `readQueue`, `writeQueue` (moderation).
- Produces: `TAKEDOWN_ROLES = ['instructor', 'university', 'publisher', 'other']`, `interface TakedownCaller { uid: string; verified: boolean; email: string }`, `interface TakedownForm { postIds: string[]; requesterName: string; role: TakedownRole; contactEmail: string; description: string }`, `interface TakedownResult { requestId: string; hidden: string[]; queued: string[] }` (`queued` = existing named posts that were only queued, e.g. beyond the 3-hides-per-day budget; unknown ids appear in neither), `parseTakedown(input) → TakedownForm` (throws `invalid-argument`), `processTakedown(db, caller: TakedownCaller | null, input, now?) → Promise<TakedownResult>`.

Behaviour: the form is whitelisted and bounded (≤ 5 unique valid ids, name 1–100, role in the list, email ≤ 200 and well-formed, description 10–2000, all trimmed). Every call writes `takedown_requests/{auto}` (`status: 'open'`, `verified` from the caller — never from the payload). Signed-in callers: ≤ 3/JST day. Unverified + anonymous: ≤ 20/JST day in total (`moderation_meta/takedown_anon_<day>`). For each named post that exists (visible or hidden): queue entry `priority: 'takedown'`, `needsReview: true`, request id appended; and if the caller is verified, not discredited (`restoredTakedowns < 2`), the post is visible, `autoHide` is on and the caller is not its author → hidden (`by: 'takedown'`, `byUid: caller.uid`). Unknown ids stay on the request only. **Implemented amendments (final review):** at most `maxImmediateHidesPerDay` (3) posts are hidden per requester per JST day across all requests, the rest are queued and reported in `queued`; the requester's counters are keyed by `emailKey` (M-20); the audit row is `by: takedown:<uid>` with the request id as note.

- [ ] **Step 1: Write the failing tests `functions/test/takedown.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, seedPost } from '../testlib/helpers.mjs';
import { jstDay } from '../lib/common.js';
import { processTakedown, parseTakedown } from '../lib/takedown.js';

const get = (path) => db.doc(path).get();
const FORM = (postIds, over = {}) => ({
  postIds, requesterName: '山田 太郎（理学研究科）', role: 'instructor', contactEmail: 'yamada@kyoto-u.ac.jp',
  description: '2024年度 線形代数A 期末試験の問題が無断で掲載されています。', ...over,
});
const verified = (u = uid('v')) => ({ uid: u, verified: true, email: `${u}@kyoto-u.ac.jp` });
const mk = async () => {
  const a = uid('a'); const id = uid('p');
  await seedPost(id, { authorId: a, filePaths: [`resources/${a}/1.pdf`] });
  return { a, id };
};
// The anonymous cap is ONE counter per JST day. Every test that files unverified
// requests uses its own far-future day, so the tests cannot exhaust each other's pool.
let n = 0;
const day = () => new Date(Date.UTC(2040, 0, ++n, 3));

test('a verified KU requester hides the named post at once, files a priority request, and notifies the author', async () => {
  const { a, id } = await mk(); const v = verified();
  const original = (await get(`posts/${id}`)).data();
  const r = await processTakedown(db, v, FORM([id]));
  assert.deepEqual(r.hidden, [id]);
  assert.equal((await get(`posts/${id}`)).exists, false);
  assert.deepEqual((await get(`hidden_posts/${id}`)).data(), original);
  const req = (await get(`takedown_requests/${r.requestId}`)).data();
  assert.deepEqual(
    { verified: req.verified, requesterUid: req.requesterUid, postIds: req.postIds, status: req.status, role: req.role, university_id: req.university_id },
    { verified: true, requesterUid: v.uid, postIds: [id], status: 'open', role: 'instructor', university_id: 'kyoto_u' });
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ priority: q.priority, hiddenBy: q.hiddenBy, hiddenByUid: q.hiddenByUid, takedownRequestIds: q.takedownRequestIds },
    { priority: 'takedown', hiddenBy: 'takedown', hiddenByUid: v.uid, takedownRequestIds: [r.requestId] });
  assert.equal((await get(`notifications/mod_${id}_1`)).get('uid'), a);
});

test('M-6: a signed-out requester only queues — the post stays visible and nobody is notified', async () => {
  const { id } = await mk();
  const r = await processTakedown(db, null, FORM([id]), day());
  assert.deepEqual(r.hidden, []);
  assert.equal((await get(`posts/${id}`)).exists, true);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.deepEqual({ priority: q.priority, needsReview: q.needsReview, status: q.status },
    { priority: 'takedown', needsReview: true, status: 'open' });
  const req = (await get(`takedown_requests/${r.requestId}`)).data();
  assert.deepEqual({ verified: req.verified, requesterUid: req.requesterUid }, { verified: false, requesterUid: null });
  assert.equal((await db.collection('notifications').where('postId', '==', id).get()).size, 0);
});

test('M-6: a signed-in but unverified (or non-KU) requester also only queues', async () => {
  const { id } = await mk(); const u = uid('u');
  const r = await processTakedown(db, { uid: u, verified: false, email: `${u}@gmail.com` }, FORM([id]), day());
  assert.deepEqual(r.hidden, []);
  assert.equal((await get(`posts/${id}`)).exists, true);
});

test('no immediate hide for the post’s own author, an operator-cleared post, or a discredited requester (boundary: 1 restored still hides)', async () => {
  const own = await mk();
  assert.deepEqual((await processTakedown(db, verified(own.a), FORM([own.id]))).hidden, []);
  const cleared = await mk();
  await db.doc(`moderation_queue/${cleared.id}`).set({ postId: cleared.id, status: 'restored', autoHide: false });
  assert.deepEqual((await processTakedown(db, verified(), FORM([cleared.id]))).hidden, []);
  assert.equal((await get(`moderation_queue/${cleared.id}`)).get('needsReview'), true);
  const bad = uid('v');
  await db.doc(`moderation_actors/${bad}`).set({ restoredTakedowns: 2 });
  const p = await mk();
  assert.deepEqual((await processTakedown(db, verified(bad), FORM([p.id]))).hidden, []);
  for (const x of [own, cleared, p]) assert.equal((await get(`posts/${x.id}`)).exists, true);
  const once = uid('v');
  await db.doc(`moderation_actors/${once}`).set({ restoredTakedowns: 1 });
  const p2 = await mk();
  assert.deepEqual((await processTakedown(db, verified(once), FORM([p2.id]))).hidden, [p2.id]);
});

test('M-7: 3 takedowns per signed-in requester per JST day, then resource-exhausted; the next day is fine', async () => {
  const v = verified(); const d = new Date('2027-01-21T03:00:00Z');
  for (let i = 0; i < 3; i++) await processTakedown(db, v, FORM([]), d);
  await assert.rejects(processTakedown(db, v, FORM([]), d), (e) => e.code === 'resource-exhausted');
  await processTakedown(db, v, FORM([]), new Date('2027-01-21T16:00:00Z'));
});

test('M-7: the unverified + anonymous pool is 20 per JST day for everyone together; verified requesters are not in it', async () => {
  const d = day();
  for (let i = 0; i < 20; i++) await processTakedown(db, null, FORM([]), d);
  await assert.rejects(processTakedown(db, null, FORM([]), d), (e) => e.code === 'resource-exhausted');
  await assert.rejects(processTakedown(db, { uid: uid('u'), verified: false, email: 'x@gmail.com' }, FORM([]), d),
    (e) => e.code === 'resource-exhausted');
  await processTakedown(db, verified(), FORM([]), d);
  assert.equal((await get(`moderation_meta/takedown_anon_${jstDay(d)}`)).get('count'), 20);
});

test('unknown post ids stay on the request only; an already-hidden post gets the request but no second hide or notice', async () => {
  const { id } = await mk(); const ghost = uid('nope');
  await processTakedown(db, verified(), FORM([id]));
  const r = await processTakedown(db, verified(), FORM([id, ghost]));
  assert.deepEqual(r.hidden, []);
  assert.equal((await get(`moderation_queue/${ghost}`)).exists, false);
  const q = (await get(`moderation_queue/${id}`)).data();
  assert.equal(q.transitions, 1);
  assert.equal(q.takedownRequestIds.length, 2);
  assert.equal((await db.collection('notifications').where('postId', '==', id).get()).size, 1);
});

test('parseTakedown refuses malformed forms, and nothing is written for them', async () => {
  const bads = [
    FORM(['a/b']), FORM(Array.from({ length: 6 }, (_, i) => `p${i}`)), FORM('p1'),
    FORM([], { requesterName: '' }), FORM([], { requesterName: 'x'.repeat(101) }),
    FORM([], { role: 'police' }), FORM([], { contactEmail: 'not-an-email' }),
    FORM([], { contactEmail: `${'a'.repeat(196)}@x.jp` }),
    FORM([], { description: '短い' }), FORM([], { description: 'x'.repeat(2001) }),
  ];
  for (const f of bads) {
    assert.throws(() => parseTakedown(f), (e) => e.code === 'invalid-argument', JSON.stringify(f).slice(0, 80));
  }
  const d = day();
  for (const f of bads) await assert.rejects(processTakedown(db, null, f, d), (e) => e.code === 'invalid-argument');
  assert.equal((await get(`moderation_meta/takedown_anon_${jstDay(d)}`)).exists, false);
  assert.deepEqual(parseTakedown(FORM(['p1', 'p1'])).postIds, ['p1']);
});

test('the stored request is trimmed and whitelisted: a client cannot claim to be verified or smuggle fields', async () => {
  const r = await processTakedown(db, null,
    { ...FORM(['x1', 'x1']), requesterName: '  名前  ', injected: 'ignored', verified: true, status: 'closed' }, day());
  const req = (await get(`takedown_requests/${r.requestId}`)).data();
  assert.equal(req.requesterName, '名前');
  assert.deepEqual(req.postIds, ['x1']);
  assert.equal(req.injected, undefined);
  assert.equal(req.verified, false);
  assert.equal(req.status, 'open');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `../lib/takedown.js` missing.

- [ ] **Step 3: Create `functions/src/takedown.ts`**

```ts
import { FieldValue, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { MODERATION, UNIVERSITY_ID, isDocId, jstDay } from './common.js';
import { actorRef, hiddenRef, hideInTx, num, postRef, queueRef, readQueue, writeQueue } from './moderation.js';

export const TAKEDOWN_ROLES = ['instructor', 'university', 'publisher', 'other'] as const;
export type TakedownRole = (typeof TAKEDOWN_ROLES)[number];

/** Who called; null = signed out. `verified` = universityVerifiedUid() accepted the token (M-6). */
export interface TakedownCaller { uid: string; verified: boolean; email: string }
export interface TakedownForm {
  postIds: string[]; requesterName: string; role: TakedownRole; contactEmail: string; description: string;
}
export interface TakedownResult { requestId: string; hidden: string[] }

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const bad = (what: string) => new HttpsError('invalid-argument', `bad ${what}`);

/** Whitelist + bounds. Only these five fields ever reach Firestore. */
export function parseTakedown(input: Record<string, unknown>): TakedownForm {
  const raw = input?.postIds ?? [];
  if (!Array.isArray(raw) || raw.length > MODERATION.maxTakedownPosts || !raw.every((x) => isDocId(x))) throw bad('post ids');
  const requesterName = typeof input.requesterName === 'string' ? input.requesterName.trim() : '';
  if (requesterName.length < 1 || requesterName.length > MODERATION.maxName) throw bad('name');
  const role = input.role;
  if (typeof role !== 'string' || !(TAKEDOWN_ROLES as readonly string[]).includes(role)) throw bad('role');
  const contactEmail = typeof input.contactEmail === 'string' ? input.contactEmail.trim() : '';
  if (contactEmail.length > MODERATION.maxEmail || !EMAIL.test(contactEmail)) throw bad('email');
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length < MODERATION.minDescription || description.length > MODERATION.maxDescription) throw bad('description');
  return { postIds: [...new Set(raw as string[])], requesterName, role: role as TakedownRole, contactEmail, description };
}

/**
 * 「担当教員・権利者の方はこちら」 (spec §4.3; M-6, M-7, M-8, M-9). Always files a
 * priority request. A verified Kyoto University requester (student or staff) who
 * is not discredited also hides each named post AT ONCE — unless an operator
 * already cleared it or they wrote it. Anyone else only queues: an anonymous
 * form must never be a censorship button. Caps: per signed-in requester per JST
 * day, and one global per-day pool for every unverified request.
 */
export async function processTakedown(
  db: Firestore,
  caller: TakedownCaller | null,
  input: Record<string, unknown>,
  now: Date = new Date(),
): Promise<TakedownResult> {
  const form = parseTakedown(input);
  const day = jstDay(now);
  const verified = caller?.verified === true;
  const reqRef = db.collection('takedown_requests').doc();
  const anonRef = db.collection('moderation_meta').doc(`takedown_anon_${day}`);

  return db.runTransaction(async (tx) => {
    // ---- reads
    const actorSnap = caller ? await tx.get(actorRef(db, caller.uid)) : null;
    const anonSnap = verified ? null : await tx.get(anonRef);
    const targets: { id: string; post: DocumentSnapshot; hidden: DocumentSnapshot; queue: DocumentSnapshot }[] = [];
    for (const id of form.postIds) {
      targets.push({
        id,
        post: await tx.get(postRef(db, id)),
        hidden: await tx.get(hiddenRef(db, id)),
        queue: await tx.get(queueRef(db, id)),
      });
    }

    // ---- limits
    const actor = actorSnap?.data() ?? {};
    const usedByCaller = actor.takedownDay === day ? num(actor.takedownsToday) : 0;
    if (caller && usedByCaller >= MODERATION.takedownDailyCapUser) throw new HttpsError('resource-exhausted', 'takedown-limit');
    const anonUsed = num(anonSnap?.get('count'));
    if (!verified && anonUsed >= MODERATION.takedownDailyCapAnon) throw new HttpsError('resource-exhausted', 'takedown-limit');
    const mayHide = verified && num(actor.restoredTakedowns) < MODERATION.discreditRestoredTakedowns;

    // ---- writes
    tx.create(reqRef, {
      ...form,
      verified,
      requesterUid: caller?.uid ?? null,
      requesterEmail: caller?.email || null,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
      university_id: UNIVERSITY_ID,
    });
    if (caller) {
      tx.set(actorRef(db, caller.uid), { takedownDay: day, takedownsToday: usedByCaller + 1, university_id: UNIVERSITY_ID }, { merge: true });
    }
    if (!verified) tx.set(anonRef, { day, count: anonUsed + 1, university_id: UNIVERSITY_ID }, { merge: true });

    const hidden: string[] = [];
    for (const t of targets) {
      const snap = t.post.exists ? t.post : t.hidden;
      if (!snap.exists) continue; // unknown id: kept on the request only, no queue entry
      const post = snap.data()!;
      const q = readQueue(t.queue, t.id, post);
      q.priority = 'takedown';
      q.needsReview = true;
      if (!q.takedownRequestIds.includes(reqRef.id)) q.takedownRequestIds.push(reqRef.id);
      if (t.post.exists && mayHide && q.autoHide && post.authorId !== caller!.uid) {
        hideInTx(tx, db, q, post, 'takedown', caller!.uid, 'system');
        hidden.push(t.id);
      }
      writeQueue(tx, db, q, !t.queue.exists);
    }
    return { requestId: reqRef.id, hidden };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — prior 121 + 9 new in `takedown.test.mjs` (130 in total).

- [ ] **Step 5: Commit**

```bash
git add functions/src/takedown.ts functions/test/takedown.test.mjs
git commit -m "feat(functions): submitTakedown — priority queue, immediate hide only for verified KU requesters, caps"
```

---

### Task 6: Wire the new callables and triggers in `index.ts`

**Files:**
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `universityVerifiedUid`, `requireKuVerified`, `REGION` (common); `processReport`; `processTakedown`, `TakedownCaller`; `handlePostGone`; `handleReviewWritten`, `handlePostWritten`.
- Produces (exported Firebase functions): callables **`reportPost`**, **`submitTakedown`**; triggers **`onHiddenPostDeleted`** (`hidden_posts/{postId}` deleted), **`onReviewWritten`** (`reviews/{reviewId}` written), **`onPostWritten`** (`posts/{postId}` written); **`onPostDeleted` changed** to `handlePostGone`. The 2A exports (`claimWelcomeCredits`, `downloadResource`, `onPostCreated`, `onReviewCreated`) are unchanged.

- [ ] **Step 1: Edit `functions/src/index.ts`**

Change the imports to:

```ts
import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { REGION, requireKuVerified, attachmentDisposition, universityVerifiedUid } from './common.js';
import { handlePostGone } from './postDeleted.js';
import { processReport } from './report.js';
import { processTakedown, type TakedownCaller } from './takedown.js';
import { handlePostWritten, handleReviewWritten } from './courseStats.js';
```

(keep the other existing imports; `handlePostDeleted` is no longer imported here). Replace the `onPostDeleted` export with the block below and append the rest:

```ts
// Hide/restore MOVE posts between `posts` and `hidden_posts` (Plan 2B, M-1):
// files are removed only when the post exists in neither collection.
export const onPostDeleted = onDocumentDeleted({ ...opts, document: 'posts/{postId}' }, async (event) => {
  const data = event.data?.data();
  if (data) await handlePostGone(db, storageDeps, event.params.postId, data);
});

export const onHiddenPostDeleted = onDocumentDeleted({ ...opts, document: 'hidden_posts/{postId}' }, async (event) => {
  const data = event.data?.data();
  if (data) await handlePostGone(db, storageDeps, event.params.postId, data);
});

export const reportPost = onCall(opts, async (req) =>
  processReport(db, requireKuVerified(req.auth), (req.data ?? {}) as Record<string, unknown>));

// The ONE callable that accepts a signed-out caller (a rights-holder has no app
// account). Classified, never trusted: only a verified KU token may hide (M-6).
export const submitTakedown = onCall(opts, async (req) => {
  const auth = req.auth ?? null;
  const caller: TakedownCaller | null = auth
    ? { uid: auth.uid, verified: universityVerifiedUid(auth) !== null, email: String(auth.token.email ?? '') }
    : null;
  return processTakedown(db, caller, (req.data ?? {}) as Record<string, unknown>);
});

// course_stats is Function-maintained (M-11): every relevant write recounts its course.
export const onReviewWritten = onDocumentWritten({ ...opts, document: 'reviews/{reviewId}' }, async (event) => {
  await handleReviewWritten(db, event.data?.before?.data(), event.data?.after?.data());
});

export const onPostWritten = onDocumentWritten({ ...opts, document: 'posts/{postId}' }, async (event) => {
  await handlePostWritten(db, event.data?.before?.data(), event.data?.after?.data());
});
```

If the installed `firebase-functions` types `req.auth.token` differently from `AuthLike`, the existing `requireKuVerified(req.auth)` already compiles, so `universityVerifiedUid(auth)` does too.

- [ ] **Step 2: Verify**

Run: `bash tools/test_functions.sh`
Expected: PASS — 130 tests, `tsc` clean (it type-checks `index.ts`).

Run: `grep -cE "^exports\.(reportPost|submitTakedown|onHiddenPostDeleted|onReviewWritten|onPostWritten|onPostDeleted) = \(0," functions/lib/index.js`
Expected: `6`.

- [ ] **Step 3: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat(functions): wire reportPost, submitTakedown, onHiddenPostDeleted, onReviewWritten, onPostWritten"
```

---

### Task 7: Firestore rules, index and rules tests

**Files:**
- Modify: `firestore.rules`, `firestore.indexes.json`, `firestore-tests/rules.test.mjs`

**Interfaces:**
- Produces (rules): `posts` — no client write of `reports`, author-only update/delete (the ≥ 3-reports delete is gone), create refused when `hidden_posts/{id}` exists; `course_stats` — read `kuDomain()`, **write false**; `users` — read own only; `talk_rooms` — read only by `lenderId` / `borrowerId`; `notifications/{id}` — read own, update only `read: true` on own, no create/delete; explicit Admin-only blocks for `hidden_posts`, `moderation_queue` (+ `reports/{uid}`), `moderation_actors`, `moderation_meta`, `takedown_requests`, `moderation_log`.
- Produces (index): `notifications` composite `uid ASC, createdAt DESC`.

- [ ] **Step 1: Update the tests first — `firestore-tests/rules.test.mjs`**

1a. In `beforeEach`'s `withSecurityRulesDisabled` block add the fixtures:

```js
    await setDoc(doc(db, 'notifications/n_u1'), {
      uid: 'u1', type: 'post_hidden', postId: 'p', postTitle: 't', read: false, university_id: 'kyoto_u',
    });
    // A post hidden by moderation: its author (u2) cannot read it either.
    await setDoc(doc(db, 'hidden_posts/hid_1'), { authorId: 'u2', university_id: 'kyoto_u', title: 'hidden' });
```

1b. In `KU_READABLE` change `['users', 'users/u1']` to `['users', 'users/u2']` (the unverified reader is `u2`; after 2B a user reads only their own profile).

1c. **Replace** `'signed-in user can read another profile but anonymous cannot'` with:

```js
test('a user can read only their own profile (2B)', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'users/u1')));
  await assertFails(getDoc(doc(asKu(), 'users/u2')));
  await assertFails(getDoc(doc(asAnon(), 'users/u1')));
  await assertFails(getDocs(query(collection(asKu(), 'users'), where('university_id', '==', 'kyoto_u'))));
});
```

1d. **Replace** `'non-author may only touch the reports field of a post'`, the whole I7 block (`'a non-author may append exactly one report — their own uid (I7)'` through `'only a verified KU user may flag a post (I4)'`, keeping `'an author cannot rewrite a post out of its stream or reassign it (M5)'`) and the two I2 tests (`'a post with 3+ reports can be auto-deleted…'`, `'a non-author cannot delete a post below the report threshold (I2)'`) with:

```js
// --- posts: moderation is Function-owned (Plan 2B) ---------------------------

test('no client may write reports any more — not a reporter, not the author (2B)', async () => {
  await assertFails(updateDoc(doc(asKu2(), 'posts/seed_u1'), { reports: ['u2'] }));
  await assertFails(updateDoc(doc(asKu2(), 'posts/flagged_u1'), { reports: ['ra', 'u2'] }));
  await assertFails(updateDoc(doc(asKu(), 'posts/flagged_u1'), { reports: [] }));
  await assertFails(updateDoc(doc(asKu(), 'posts/reported_u1'), { reports: [] }));
  await assertSucceeds(updateDoc(doc(asKu(), 'posts/flagged_u1'), { description: 'x' }));
});

test('a non-author can never edit or delete a post, whatever its stored reports say (2B)', async () => {
  await assertFails(updateDoc(doc(asKu2(), 'posts/seed_u1'), { title: 'vandalised' }));
  await assertFails(deleteDoc(doc(asKu2(), 'posts/seed_u1')));
  await assertFails(deleteDoc(doc(asKu2(), 'posts/reported_u1'))); // 3 legacy reports: no longer a licence
  const outsider = env.authenticatedContext('u3', OUTSIDER).firestore();
  await assertFails(deleteDoc(doc(outsider, 'posts/reported_u1')));
});

test('a post cannot be created under the id of a hidden post (2B, M-1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'posts/hid_1'), validPost({ id: 'hid_1' })));
  await assertSucceeds(setDoc(doc(asKu(), 'posts/fresh_1'), validPost({ id: 'fresh_1' })));
});
```

1e. In the `for (const name of ['posts', 'requests', 'textbook_requests', 'talk_rooms', 'courses'])` "university-scoped stream query is allowed" loop, **remove `'talk_rooms'`**. **Replace** `'users: the invitation-code lookup query is allowed'` with:

```js
test('users: no list query over other users’ profiles, e.g. the old invitation-code lookup (2B)', async () => {
  await assertFails(getDocs(query(collection(asKu(), 'users'), where('invitationCode', '==', 'KUXXXX'))));
});
```

1f. **Replace** the five `course_stats` tests (`'course_stats: KU-domain reads, KU-verified writes, outsider denied both'` through `'course_stats: a counter-only CREATE with invalid reviewCount fails'`) with:

```js
// --- course_stats: Function-maintained aggregate (Plan 2B, M-11) ------------

test('course_stats: KU-domain reads; no client write of any kind (2B)', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'course_stats/ck')));
  await assertSucceeds(getDoc(doc(asKuUnverified(), 'course_stats/ck')));
  await assertFails(getDoc(doc(asOutsider(), 'course_stats/ck')));
  const ku = asKu();
  await assertFails(setDoc(doc(ku, 'course_stats/ck'), {
    courseKey: 'ck', university_id: 'kyoto_u', reviewCount: 2, ratingSum: 7,
  }, { merge: true }));
  await assertFails(setDoc(doc(ku, 'course_stats/fresh'), {
    courseKey: 'fresh', university_id: 'kyoto_u', pastExamPostCount: 1,
  }, { merge: true }));
  await assertFails(updateDoc(doc(ku, 'course_stats/ck'), { score: 100 }));
  await assertFails(deleteDoc(doc(ku, 'course_stats/ck')));
});

test('course_stats: the ranking pool query still runs (2B)', async () => {
  await assertSucceeds(getDocs(query(collection(asKu(), 'course_stats'), where('reviewCount', '>=', 1))));
});
```

1g. Add after the existing talk-room tests:

```js
// --- talk_rooms: participants only (Plan 2B, M-15) --------------------------

test('talk_rooms: only the two participants can read a room (2B)', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'talk_rooms/room_1')));
  await assertSucceeds(getDoc(doc(asKu2(), 'talk_rooms/room_1')));
  const stranger = env.authenticatedContext('u7', { email: 'g@st.kyoto-u.ac.jp', email_verified: true }).firestore();
  await assertFails(getDoc(doc(stranger, 'talk_rooms/room_1')));
});

test('talk_rooms: the participant queries are allowed; the university-wide stream is not (2B)', async () => {
  await assertSucceeds(getDocs(query(collection(asKu(), 'talk_rooms'), where('lenderId', '==', 'u1'))));
  await assertSucceeds(getDocs(query(collection(asKu2(), 'talk_rooms'), where('borrowerId', '==', 'u2'))));
  await assertFails(getDocs(query(collection(asKu(), 'talk_rooms'), where('lenderId', '==', 'u2'))));
  await assertFails(getDocs(query(collection(asKu(), 'talk_rooms'), where('university_id', '==', 'kyoto_u'))));
});
```

1h. Add before the catch-all section:

```js
// --- notifications (Plan 2B, M-10) -------------------------------------------

test('notifications: own read and own query only; marking read is the only client write (2B)', async () => {
  const me = asKu();
  await assertSucceeds(getDoc(doc(me, 'notifications/n_u1')));
  await assertFails(getDoc(doc(asKu2(), 'notifications/n_u1')));
  await assertSucceeds(getDocs(query(collection(me, 'notifications'), where('uid', '==', 'u1'))));
  await assertFails(getDocs(query(collection(me, 'notifications'), where('uid', '==', 'u2'))));
  await assertSucceeds(updateDoc(doc(me, 'notifications/n_u1'), { read: true }));
  await assertFails(updateDoc(doc(me, 'notifications/n_u1'), { read: false })); // no un-reading
});

test('notifications: no forging, rewording, foreign mark-read or deleting (2B)', async () => {
  const me = asKu();
  await assertFails(setDoc(doc(me, 'notifications/forged'), { uid: 'u1', type: 'post_restored', read: false }));
  await assertFails(setDoc(doc(asKu2(), 'notifications/spam'), { uid: 'u1', type: 'post_hidden', read: false }));
  await assertFails(updateDoc(doc(me, 'notifications/n_u1'), { postTitle: 'changed' }));
  await assertFails(updateDoc(doc(me, 'notifications/n_u1'), { read: true, type: 'post_restored' }));
  await assertFails(updateDoc(doc(asKu2(), 'notifications/n_u1'), { read: true }));
  await assertFails(deleteDoc(doc(me, 'notifications/n_u1')));
});

// --- moderation collections: Admin-only (Plan 2B) ----------------------------

const ADMIN_ONLY = [
  'hidden_posts/hid_1', 'moderation_queue/p1', 'moderation_queue/p1/reports/u1',
  'moderation_actors/u1', 'moderation_meta/takedown_anon_2027-01-20', 'takedown_requests/t1', 'moderation_log/l1',
];
for (const path of ADMIN_ONLY) {
  test(`${path}: Admin-only — no client may get, create, update or delete (2B)`, async () => {
    for (const db of [asKu(), asKu2()]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { uid: 'u1', university_id: 'kyoto_u' }));
      await assertFails(deleteDoc(doc(db, path)));
    }
  });
}

test('moderation collections cannot be listed by any client (2B)', async () => {
  for (const name of ['hidden_posts', 'moderation_queue', 'moderation_actors', 'moderation_meta', 'takedown_requests', 'moderation_log']) {
    await assertFails(getDocs(collection(asKu(), name)));
  }
  await assertFails(getDocs(collection(asKu(), 'moderation_queue/p1/reports')));
});
```

(`asKu2()` is `u2`, the author of `hidden_posts/hid_1`: the author cannot read their hidden post either.)

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_rules.sh`
Expected: FAIL — exactly 9 tests (own-profile read, the three new posts tests, both talk-room tests, the course_stats write test, the users list query, the notifications read/mark test): the old rules allow `reports` appends, the 3-report delete, client stats writes, everyone's profiles and rooms, and have no `notifications` block. (The Admin-only tests already pass under the catch-all; they pin the explicit blocks.)

- [ ] **Step 3: Edit `firestore.rules`**

3a. **`users`** — the read line becomes own-only (update the comment):

```
    // Per-user documents (Plan 2B, M-15): readable by their owner only. The app
    // never reads another user's profile — display names are denormalised onto
    // posts, reviews, requests and talk rooms — and this doc holds the email.
    match /users/{uid} {
      allow read: if owns(uid);
```

(keep the existing `create, update` and `delete` lines.)

3b. **`posts`** — replace the long carve-out comment and the whole `match /posts/{id}` block with:

```
    // User-generated content: readable by any KU address, created by verified KU
    // users as themselves, edited/removed by the author only.
    //
    // Plan 2B: moderation is Function-owned. Reports are Admin-only docs written
    // by the `reportPost` callable (moderation_queue/{postId}/reports/{uid}), so
    // no client may write `reports` and there is no ">= 3 reports" delete any
    // more. A hidden post is MOVED to the Admin-only `hidden_posts/{id}`; create
    // refuses that id so nobody can squat it and block its restore. The author
    // branch pins `authorId` and `university_id` (M5) and keeps `reports`,
    // `downloadCount` (Function-only, 2A) and `filePaths` out of reach.
    match /posts/{id} {
      allow read: if kuDomain();
      // Plan 2A: files live in the private bucket under resources/<uid>/. The
      // first path is checked here (rules cannot loop); the onPostCreated
      // trigger validates every path and deletes the post if any is bad.
      allow create: if kuVerified()
        && !exists(/databases/$(database)/documents/hidden_posts/$(id))
        && request.resource.data.authorId == request.auth.uid
        && request.resource.data.university_id == 'kyoto_u'
        && request.resource.data.get('downloadCount', 0) == 0
        && request.resource.data.get('reports', []) == []
        && request.resource.data.filePaths is list
        && request.resource.data.filePaths.size() >= 1
        && request.resource.data.filePaths.size() <= 5
        && request.resource.data.filePaths[0] is string
        && request.resource.data.filePaths[0].matches('resources/' + request.auth.uid + '/.+');
      allow update: if signedIn()
        && resource.data.authorId == request.auth.uid
        && request.resource.data.authorId == resource.data.authorId
        && request.resource.data.university_id == resource.data.university_id
        && !request.resource.data.diff(resource.data).affectedKeys()
             .hasAny(['reports', 'downloadCount', 'filePaths']);
      allow delete: if signedIn() && resource.data.authorId == request.auth.uid;
    }
```

3c. **`talk_rooms`** — the read line becomes:

```
      // Plan 2B (M-15): only the two parties may read a room; the client
      // listens with `where('lenderId'|'borrowerId', '==', <own uid>)`.
      allow read: if kuDomain()
        && (resource.data.lenderId == request.auth.uid
            || resource.data.borrowerId == request.auth.uid);
```

3d. **`course_stats`** — replace the comment and block with:

```
    // Per-course roll-up (Plan 2B, M-11). Maintained ONLY by the onReviewWritten
    // / onPostWritten Cloud Functions, which recount the course from `reviews`,
    // `posts` and `courses` (Admin SDK bypasses rules). The Phase-1 client-side
    // aggregate let any verified account forge any course's counters and score;
    // now no client writes at all. The doc id is `Review.slug(courseKey)` (C1).
    match /course_stats/{statsId} {
      allow read: if kuDomain();
      allow write: if false;
    }
```

3e. Add before the catch-all:

```
    // Moderation notices for a post's author (Plan 2B, M-10). Written only by
    // Cloud Functions. The owner may read their own rows (the query must carry
    // `where('uid', '==', <own uid>)`) and may only mark one read.
    match /notifications/{id} {
      allow read: if signedIn() && resource.data.uid == request.auth.uid;
      allow update: if signedIn()
        && resource.data.uid == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['read'])
        && request.resource.data.read == true;
      allow create, delete: if false;
    }

    // Moderation state (Plan 2B): Admin-only. Explicit denies (also the
    // catch-all's answer) so none of these can be read, listed or written by a
    // client — reporters, requesters and hidden posts stay private.
    match /hidden_posts/{id} {
      allow read, write: if false;
    }
    match /moderation_queue/{postId} {
      allow read, write: if false;
      match /reports/{reporterUid} {
        allow read, write: if false;
      }
    }
    match /moderation_actors/{uid} {
      allow read, write: if false;
    }
    match /moderation_meta/{id} {
      allow read, write: if false;
    }
    match /takedown_requests/{id} {
      allow read, write: if false;
    }
    match /moderation_log/{id} {
      allow read, write: if false;
    }
```

- [ ] **Step 4: Add the composite index to `firestore.indexes.json`** (append to `"indexes"`):

```json
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "uid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
```

- [ ] **Step 5: Run to verify it passes**

Run: `bash tools/test_rules.sh` then `bash tools/test_storage_rules.sh`
Expected: PASS — 125 tests in `rules.test.mjs` (all unrelated tests unchanged and green); storage rules untouched and green.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules firestore.indexes.json firestore-tests/rules.test.mjs
git commit -m "feat(rules): Function-owned moderation and course_stats; own-only users, participant-only talk rooms, notifications"
```

---

### Task 8: Flutter — `AppNotification`, `ModerationService`, participant talk-room query

**Files:**
- Create: `lib/models/app_notification.dart`, `lib/services/moderation_service.dart`, `lib/services/talk_room_queries.dart`
- Create: `test/models/app_notification_test.dart`, `test/services/moderation_service_test.dart`, `test/services/talk_room_queries_test.dart`

**Interfaces:**
- Consumes: `CallableInvoker` (`lib/services/credit_service.dart`, 2A); `TalkRoom` (`lib/models/talk_room.dart`).
- Produces:
  - `class AppNotification { final String id; final String type; final String postId; final String postTitle; final bool read; final DateTime createdAt; String get message; factory AppNotification.fromMap(String id, Map<String, dynamic> map) }` — total.
  - `enum ReportCategory { copyright, unrelated, inappropriate, other }` + `ReportCategoryX.value` / `.label`; `enum ReportOutcome { reported, hidden, duplicate, alreadyHidden }`; `enum TakedownRole { instructor, university, publisher, other }` + `TakedownRoleX.value` / `.label`
  - `class ModerationException implements Exception { final String code; final String message; bool get isLimit; bool get isOwnPost; bool get isNotFound }`
  - `class TakedownResult { final String requestId; final List<String> hidden; final List<String> queued }` (`queued` defaults to empty)
  - constants `kReportMaxDetail = 500`, `kTakedownMinDescription = 10`, `kTakedownMaxDescription = 2000`, `kTakedownMaxName = 100`, `kTakedownMaxEmail = 200`; `String? validateTakedown({required String name, required String email, required String description})`
  - `class ModerationService { ModerationService(FirebaseFirestore db, CallableInvoker call); factory ModerationService.live(FirebaseFirestore db); Future<ReportOutcome> reportPost(String postId, ReportCategory category, String detail); Future<TakedownResult> submitTakedown({required List<String> postIds, required String requesterName, required TakedownRole role, required String contactEmail, required String description}); Stream<List<AppNotification>> streamNotifications(String uid, {int limit = 30}); Future<void> markNotificationRead(String id) }`
  - `Stream<List<TalkRoom>> participantTalkRooms(FirebaseFirestore db, String uid)` (`talk_room_queries.dart`)

- [ ] **Step 1: Write the failing tests**

`test/models/app_notification_test.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/app_notification.dart';

void main() {
  test('parses a Function-written notification', () {
    final n = AppNotification.fromMap('mod_p1_1', {
      'uid': 'u1', 'type': 'post_hidden', 'postId': 'p1', 'postTitle': '2024 期末', 'read': false,
      'createdAt': Timestamp.fromDate(DateTime.utc(2027, 1, 20, 3)),
    });
    expect(n.id, 'mod_p1_1');
    expect(n.type, 'post_hidden');
    expect(n.postId, 'p1');
    expect(n.read, isFalse);
    expect(n.createdAt.toUtc(), DateTime.utc(2027, 1, 20, 3));
    expect(n.message, contains('「2024 期末」'));
    expect(n.message, contains('非表示'));
    expect(n.message, contains('クレジットはそのまま'));
  });

  test('each type has its own copy; an unknown type falls back', () {
    String m(String t) => AppNotification.fromMap('x', {'type': t, 'postTitle': 'T'}).message;
    expect(m('post_restored'), contains('再び表示'));
    expect(m('post_removed'), contains('削除'));
    expect(m('post_removed'), contains('クレジットはそのまま'));
    expect(m('mystery'), contains('お知らせ'));
  });

  test('is total: garbage degrades instead of throwing; read is true only for true', () {
    final n = AppNotification.fromMap('x', {
      'type': 7, 'postId': ['p'], 'postTitle': null, 'read': 'yes', 'createdAt': {'a': 1},
    });
    expect(n.type, '');
    expect(n.postId, '');
    expect(n.postTitle, '');
    expect(n.read, isFalse);
    expect(n.createdAt, DateTime.fromMillisecondsSinceEpoch(0));
    expect(n.message, contains('あなたの投稿'));
  });
}
```

`test/services/moderation_service_test.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/services/moderation_service.dart';

void main() {
  test('reportPost sends postId / category / trimmed detail and maps every server status', () async {
    final sent = <Map<String, dynamic>>[];
    var reply = 'reported';
    final svc = ModerationService(FakeFirebaseFirestore(), (name, data) async {
      expect(name, 'reportPost');
      sent.add(data);
      return {'status': reply};
    });
    expect(await svc.reportPost('p1', ReportCategory.copyright, '  無断転載  '), ReportOutcome.reported);
    expect(sent.single, {'postId': 'p1', 'category': 'copyright', 'detail': '無断転載'});
    reply = 'hidden';
    expect(await svc.reportPost('p1', ReportCategory.other, ''), ReportOutcome.hidden);
    reply = 'duplicate';
    expect(await svc.reportPost('p1', ReportCategory.other, ''), ReportOutcome.duplicate);
    reply = 'already_hidden';
    expect(await svc.reportPost('p1', ReportCategory.other, ''), ReportOutcome.alreadyHidden);
  });

  test('enum wire values match functions/src/report.ts and takedown.ts', () {
    expect(ReportCategory.values.map((c) => c.value), ['copyright', 'unrelated', 'inappropriate', 'other']);
    expect(TakedownRole.values.map((r) => r.value), ['instructor', 'university', 'publisher', 'other']);
  });

  test('submitTakedown sends the trimmed form and parses requestId + hidden ids', () async {
    late Map<String, dynamic> sent;
    final svc = ModerationService(FakeFirebaseFirestore(), (name, data) async {
      expect(name, 'submitTakedown');
      sent = data;
      return {'requestId': 'td1', 'hidden': ['p1', 7]};
    });
    final r = await svc.submitTakedown(
      postIds: ['p1'], requesterName: ' 山田 ', role: TakedownRole.instructor,
      contactEmail: ' y@kyoto-u.ac.jp ', description: ' 2024年度の期末試験です ',
    );
    expect(sent, {
      'postIds': ['p1'], 'requesterName': '山田', 'role': 'instructor',
      'contactEmail': 'y@kyoto-u.ac.jp', 'description': '2024年度の期末試験です',
    });
    expect(r.requestId, 'td1');
    expect(r.hidden, ['p1']);
  });

  test('streamNotifications returns only the caller’s rows, newest first; markNotificationRead flips read', () async {
    final db = FakeFirebaseFirestore();
    Future<void> row(String id, String uid, int day) => db.collection('notifications').doc(id).set({
          'uid': uid, 'type': 'post_hidden', 'postId': id, 'postTitle': 't', 'read': false,
          'createdAt': Timestamp.fromDate(DateTime.utc(2027, 1, day)),
        });
    await row('a', 'u1', 1);
    await row('b', 'u1', 2);
    await row('c', 'u2', 3);
    final svc = ModerationService(db, (_, _) async => {});
    expect((await svc.streamNotifications('u1').first).map((n) => n.id), ['b', 'a']);
    await svc.markNotificationRead('a');
    expect((await db.collection('notifications').doc('a').get()).data()!['read'], isTrue);
  });

  test('ModerationException classifies the server codes the UI cares about', () {
    expect(ModerationException('resource-exhausted', 'report-limit').isLimit, isTrue);
    expect(ModerationException('failed-precondition', 'own-post').isOwnPost, isTrue);
    expect(ModerationException('failed-precondition', 'other').isOwnPost, isFalse);
    expect(ModerationException('not-found', 'x').isNotFound, isTrue);
    expect(ModerationException('internal', 'x').isLimit, isFalse);
  });

  test('validateTakedown mirrors the server limits', () {
    const ok = '2024年度 線形代数A 期末試験が無断掲載されています';
    expect(validateTakedown(name: '山田', email: 'y@kyoto-u.ac.jp', description: ok), isNull);
    expect(validateTakedown(name: '', email: 'y@kyoto-u.ac.jp', description: ok), isNotNull);
    expect(validateTakedown(name: 'x' * 101, email: 'y@kyoto-u.ac.jp', description: ok), isNotNull);
    expect(validateTakedown(name: '山田', email: 'not-an-email', description: ok), isNotNull);
    expect(validateTakedown(name: '山田', email: '${'a' * 196}@x.jp', description: ok), isNotNull);
    expect(validateTakedown(name: '山田', email: 'y@kyoto-u.ac.jp', description: '短い'), isNotNull);
    expect(validateTakedown(name: '山田', email: 'y@kyoto-u.ac.jp', description: 'x' * 2001), isNotNull);
  });
}
```

`test/services/talk_room_queries_test.dart`:

```dart
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/talk_room.dart';
import 'package:kyoto_exam_hub/services/talk_room_queries.dart';

TalkRoom room(String id, String lender, String borrower, int day) => TalkRoom(
      id: id, requestId: 'r', bookTitle: 'b', subjectName: 's',
      borrowerId: borrower, borrowerName: 'B', lenderId: lender, lenderName: 'L',
      messages: const [], createdAt: DateTime(2027, 1, day),
    );

void main() {
  test('merges the rooms I lend in and borrow in, newest first, and never shows anyone else’s', () async {
    final db = FakeFirebaseFirestore();
    for (final r in [room('lent', 'u1', 'u2', 1), room('borrowed', 'u3', 'u1', 2), room('foreign', 'u2', 'u3', 3)]) {
      await db.collection('talk_rooms').doc(r.id).set(r.toMap());
    }
    await expectLater(
      participantTalkRooms(db, 'u1'),
      emitsThrough(predicate<List<TalkRoom>>(
          (l) => l.map((r) => r.id).join(',') == 'borrowed,lent', 'both of u1’s rooms, newest first')),
    );
  });

  test('a room created later is picked up by the live stream', () async {
    final db = FakeFirebaseFirestore();
    final done = expectLater(
      participantTalkRooms(db, 'u1'),
      emitsThrough(predicate<List<TalkRoom>>((l) => l.any((r) => r.id == 'new'), 'the new room')),
    );
    await db.collection('talk_rooms').doc('new').set(room('new', 'u2', 'u1', 5).toMap());
    await done;
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `flutter test test/models/app_notification_test.dart test/services/moderation_service_test.dart test/services/talk_room_queries_test.dart`
Expected: FAIL — the files under test do not exist.

- [ ] **Step 3: Create `lib/models/app_notification.dart`**

```dart
import 'package:cloud_firestore/cloud_firestore.dart';

/// One row of `notifications`, written only by Cloud Functions (Plan 2B, M-10).
/// The reader is total: a malformed row degrades instead of breaking the list.
/// It never says who reported, nor why — only what happened to the post.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.type,
    required this.postId,
    required this.postTitle,
    required this.read,
    required this.createdAt,
  });

  final String id;
  final String type; // post_hidden | post_restored | post_removed
  final String postId;
  final String postTitle;
  final bool read;
  final DateTime createdAt;

  String get message {
    final t = postTitle.isEmpty ? 'あなたの投稿' : '「$postTitle」';
    return switch (type) {
      'post_hidden' => '$tは、通報または権利者からの申し立てにより非表示になりました。運営が内容を確認します。獲得済みのクレジットはそのままです。',
      'post_restored' => '$tは、運営の確認の結果、再び表示されるようになりました。',
      'post_removed' => '$tは、運営の確認の結果、削除されました。獲得済みのクレジットはそのままです。',
      _ => '$tについてのお知らせがあります。',
    };
  }

  static String _str(dynamic v) => v is String ? v : '';

  static DateTime _time(dynamic v) {
    if (v is Timestamp) return v.toDate();
    if (v is String) return DateTime.tryParse(v) ?? DateTime.fromMillisecondsSinceEpoch(0);
    return DateTime.fromMillisecondsSinceEpoch(0);
  }

  factory AppNotification.fromMap(String id, Map<String, dynamic> map) => AppNotification(
        id: id,
        type: _str(map['type']),
        postId: _str(map['postId']),
        postTitle: _str(map['postTitle']),
        read: map['read'] == true,
        createdAt: _time(map['createdAt']),
      );
}
```

- [ ] **Step 4: Create `lib/services/moderation_service.dart`**

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/app_notification.dart';
import 'credit_service.dart' show CallableInvoker;

/// Wire values must equal `REPORT_CATEGORIES` in functions/src/report.ts.
enum ReportCategory { copyright, unrelated, inappropriate, other }

extension ReportCategoryX on ReportCategory {
  String get value => switch (this) {
        ReportCategory.copyright => 'copyright',
        ReportCategory.unrelated => 'unrelated',
        ReportCategory.inappropriate => 'inappropriate',
        ReportCategory.other => 'other',
      };

  String get label => switch (this) {
        ReportCategory.copyright => '著作権侵害・無断転載',
        ReportCategory.unrelated => '科目と関係のないファイル',
        ReportCategory.inappropriate => '不適切な内容',
        ReportCategory.other => 'その他',
      };
}

enum ReportOutcome { reported, hidden, duplicate, alreadyHidden }

/// Wire values must equal `TAKEDOWN_ROLES` in functions/src/takedown.ts.
enum TakedownRole { instructor, university, publisher, other }

extension TakedownRoleX on TakedownRole {
  String get value => switch (this) {
        TakedownRole.instructor => 'instructor',
        TakedownRole.university => 'university',
        TakedownRole.publisher => 'publisher',
        TakedownRole.other => 'other',
      };

  String get label => switch (this) {
        TakedownRole.instructor => '担当教員',
        TakedownRole.university => '大学・部局',
        TakedownRole.publisher => '出版社・著作権者',
        TakedownRole.other => 'その他の権利者',
      };
}

class ModerationException implements Exception {
  ModerationException(this.code, this.message);
  final String code;
  final String message;

  bool get isLimit => code == 'resource-exhausted';
  bool get isOwnPost => code == 'failed-precondition' && message.contains('own-post');
  bool get isNotFound => code == 'not-found';

  @override
  String toString() => 'ModerationException($code, $message)';
}

class TakedownResult {
  const TakedownResult({required this.requestId, required this.hidden, this.queued = const []});
  final String requestId;
  final List<String> hidden; // post ids the server hid at once (verified requester only)
}

// Limits mirrored from functions/src/common.ts `MODERATION`; the server re-checks.
const int kReportMaxDetail = 500;
const int kTakedownMinDescription = 10;
const int kTakedownMaxDescription = 2000;
const int kTakedownMaxName = 100;
const int kTakedownMaxEmail = 200;

final RegExp _email = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

/// Null when the takedown form is acceptable, otherwise the message to show.
String? validateTakedown({required String name, required String email, required String description}) {
  final n = name.trim();
  final e = email.trim();
  final d = description.trim();
  if (n.isEmpty || n.length > kTakedownMaxName) return 'お名前（ご所属）を入力してください（100文字まで）';
  if (e.length > kTakedownMaxEmail || !_email.hasMatch(e)) return 'ご連絡先のメールアドレスを正しく入力してください';
  if (d.length < kTakedownMinDescription || d.length > kTakedownMaxDescription) {
    return '対象の資料と理由を10〜2000文字で入力してください';
  }
  return null;
}

/// Plan 2B moderation client: the `reportPost` / `submitTakedown` callables and
/// the caller's own `notifications`. The client never writes moderation state;
/// the only write is marking its own notice read (see firestore.rules).
class ModerationService {
  ModerationService(this._db, this._call);

  factory ModerationService.live(FirebaseFirestore db) => ModerationService(db, _liveInvoker);

  final FirebaseFirestore _db;
  final CallableInvoker _call;

  static Future<Map<String, dynamic>> _liveInvoker(String name, Map<String, dynamic> data) async {
    try {
      final res = await FirebaseFunctions.instanceFor(region: 'asia-east1')
          .httpsCallable(name)
          .call<Map<Object?, Object?>>(data);
      return Map<String, dynamic>.from(res.data);
    } on FirebaseFunctionsException catch (e) {
      throw ModerationException(e.code, e.message ?? e.code);
    }
  }

  Future<ReportOutcome> reportPost(String postId, ReportCategory category, String detail) async {
    final r = await _call('reportPost', {'postId': postId, 'category': category.value, 'detail': detail.trim()});
    return switch (r['status']) {
      'hidden' => ReportOutcome.hidden,
      'duplicate' => ReportOutcome.duplicate,
      'already_hidden' => ReportOutcome.alreadyHidden,
      _ => ReportOutcome.reported,
    };
  }

  Future<TakedownResult> submitTakedown({
    required List<String> postIds,
    required String requesterName,
    required TakedownRole role,
    required String contactEmail,
    required String description,
  }) async {
    final r = await _call('submitTakedown', {
      'postIds': postIds,
      'requesterName': requesterName.trim(),
      'role': role.value,
      'contactEmail': contactEmail.trim(),
      'description': description.trim(),
    });
    final hidden = r['hidden'];
    return TakedownResult(
      requestId: r['requestId'] is String ? r['requestId'] as String : '',
      hidden: hidden is List ? hidden.whereType<String>().toList() : const [],
    );
  }

  /// Needs the `notifications (uid ASC, createdAt DESC)` composite index.
  Stream<List<AppNotification>> streamNotifications(String uid, {int limit = 30}) => _db
      .collection('notifications')
      .where('uid', isEqualTo: uid)
      .orderBy('createdAt', descending: true)
      .limit(limit)
      .snapshots()
      .map((q) => q.docs.map((d) => AppNotification.fromMap(d.id, d.data())).toList());

  Future<void> markNotificationRead(String id) =>
      _db.collection('notifications').doc(id).update({'read': true});
}
```

- [ ] **Step 5: Create `lib/services/talk_room_queries.dart`**

```dart
import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/talk_room.dart';

/// Plan 2B (M-15): `talk_rooms` are readable only by their two participants, so
/// the client listens to the rooms it lends in and the rooms it borrows in — two
/// single-field equality queries the rules can prove — and merges them, newest
/// first. (A university-wide stream is now refused by the rules.)
Stream<List<TalkRoom>> participantTalkRooms(FirebaseFirestore db, String uid) {
  final rooms = db.collection('talk_rooms');
  var lent = const <TalkRoom>[];
  var borrowed = const <TalkRoom>[];
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? a;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? b;
  late final StreamController<List<TalkRoom>> out;

  List<TalkRoom> parse(QuerySnapshot<Map<String, dynamic>> s) =>
      s.docs.map((d) => TalkRoom.fromMap(d.data())).toList();

  void emit() {
    final byId = <String, TalkRoom>{for (final r in [...lent, ...borrowed]) r.id: r};
    out.add(byId.values.toList()..sort((x, y) => y.createdAt.compareTo(x.createdAt)));
  }

  out = StreamController<List<TalkRoom>>(
    onListen: () {
      a = rooms.where('lenderId', isEqualTo: uid).snapshots().listen((s) {
        lent = parse(s);
        emit();
      }, onError: out.addError);
      b = rooms.where('borrowerId', isEqualTo: uid).snapshots().listen((s) {
        borrowed = parse(s);
        emit();
      }, onError: out.addError);
    },
    onCancel: () async {
      await a?.cancel();
      await b?.cancel();
    },
  );
  return out.stream;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `flutter test test/models/app_notification_test.dart test/services/moderation_service_test.dart test/services/talk_room_queries_test.dart` then `flutter analyze`
Expected: PASS — 3 + 6 + 2 new tests; `flutter analyze` still reports 24 issues (no new ones).

- [ ] **Step 7: Commit**

```bash
git add lib/models/app_notification.dart lib/services/moderation_service.dart lib/services/talk_room_queries.dart test/models/app_notification_test.dart test/services/moderation_service_test.dart test/services/talk_room_queries_test.dart
git commit -m "feat: ModerationService (report/takedown callables, notices), AppNotification, participant talk-room query"
```

---

### Task 9: Flutter — stop writing `course_stats` and `reports`; wire moderation, notices and participant rooms into `AppStore`

**Files:**
- Create: `test/models/course_stats_parity_test.dart`
- Modify: `lib/services/review_service.dart`, `lib/models/post.dart`, `lib/services/firestore_service.dart`, `lib/services/app_store.dart`, `lib/main.dart`, `lib/views/course/course_resource_tab.dart` (one call site; Task 10 replaces the dialog), `test/services/review_service_test.dart` (full replacement below), `test/models/post_test.dart`

**Interfaces:**
- Consumes: `ModerationService`, `ReportCategory`, `ReportOutcome`, `ModerationException`, `AppNotification`, `participantTalkRooms` (Task 8); `test/fixtures/course_stats_parity.json` (Task 2).
- Produces:
  - `ReviewService.submitReview(Review)` writes ONLY the review (still preserving the stored `helpfulBy` / `createdAt` on an edit); `ReviewService.deleteReview(Review)` deletes ONLY the review; **`ReviewService.bumpPostCount` is removed**. `getStats` / `streamStats` unchanged.
  - `Post` **loses `reports`** (field, constructor parameter, `toMap`, `fromMap`, `copyWith` parameter); `fromMap` still reads a legacy doc that has it.
  - `FirestoreService.streamTalkRoomsFor(String uid)` replaces `streamTalkRooms()`; **`updatePostReports` is removed**.
  - `AppStore(CourseRepository, ReviewService, RankingService, CreditService, ModerationService)`; fields `final ModerationService moderation`, `List<AppNotification> notifications`, `int get unreadNotificationCount`; `Future<void> reportPost(String postId, {required ReportCategory category, String detail = ''})`; `Future<void> markNotificationsRead()`; `_bumpPostCountFor` removed.

- [ ] **Step 1: Write the failing tests**

`test/models/course_stats_parity_test.dart` (the Dart half of M-14; the TS half is Task 2):

```dart
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/course_stats.dart';
import 'package:kyoto_exam_hub/models/review.dart';

void main() {
  test('CourseStats.applyReview and functions/src/courseStats.ts agree on the shared fixture (M-14)', () {
    final fx = jsonDecode(File('test/fixtures/course_stats_parity.json').readAsStringSync()) as Map<String, dynamic>;
    final reviews = (fx['reviews'] as List)
        .map((m) => Review.fromMap(Map<String, dynamic>.from(m as Map)))
        .toList()
      // The server's lastReviewAt is the newest updatedAt (M-13): fold oldest -> newest.
      ..sort((a, b) => a.updatedAt.compareTo(b.updatedAt));
    var s = CourseStats.empty(fx['courseKey'] as String);
    for (final r in reviews) {
      s = s.applyReview(r, delta: 1);
    }
    expect(s.toMap(), equals(fx['expected']));
  });
}
```

`test/services/review_service_test.dart` — **replace the whole file** with:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/review.dart';
import 'package:kyoto_exam_hub/services/review_service.dart';

Review _review(String courseKey, String uid, {int rating = 4, Rakutan rakutan = Rakutan.raku}) {
  final now = DateTime(2024, 4, 1);
  return Review(
    id: Review.docId(courseKey, uid),
    courseKey: courseKey,
    courseName: '科目$courseKey',
    authorId: uid,
    authorName: '京大生_$uid',
    rating: rating,
    rakutan: rakutan,
    attendance: Attendance.light,
    grading: GradingStyle.examOnly,
    pastExam: PastExamUsefulness.asIs,
    bringIn: BringIn.na,
    comment: 'c',
    helpfulBy: const [],
    createdAt: now,
    updatedAt: now,
  );
}

// Plan 2B (M-11): course_stats is written only by the onReviewWritten Function.
Future<int> _statsDocs(FakeFirebaseFirestore db) async => (await db.collection('course_stats').get()).docs.length;

void main() {
  test('submitReview writes the review and NEVER writes course_stats', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1', rating: 5));
    expect((await db.doc('reviews/ck_u1').get()).exists, isTrue);
    expect(await _statsDocs(db), 0);
  });

  test('editing a review overwrites the one document in place', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1', rating: 2, rakutan: Rakutan.muzu));
    await svc.submitReview(_review('ck', 'u1', rating: 5, rakutan: Rakutan.raku));
    final stored = Review.fromMap((await db.doc('reviews/ck_u1').get()).data()!);
    expect(stored.rating, 5);
    expect(stored.rakutan, Rakutan.raku);
    expect((await db.collection('reviews').where('courseKey', isEqualTo: 'ck').get()).docs.length, 1);
    expect(await _statsDocs(db), 0);
  });

  test('deleteReview removes only the caller’s review and writes no aggregate', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1'));
    await svc.submitReview(_review('ck', 'u2'));
    await svc.deleteReview(_review('ck', 'u2'));
    expect((await db.doc('reviews/ck_u2').get()).exists, isFalse);
    expect((await db.doc('reviews/ck_u1').get()).exists, isTrue);
    expect(await _statsDocs(db), 0);
  });

  test('markHelpful appends uid once', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1'));
    await svc.markHelpful(reviewId: 'ck_u1', uid: 'u2');
    await svc.markHelpful(reviewId: 'ck_u1', uid: 'u2'); // idempotent
    final r = await svc.getMyReview('ck', 'u1');
    expect(r!.helpfulBy, ['u2']);
  });

  // The redundant `tx.update` would trip the reviews-update rule's helpfulBy
  // clause in production; the early return in markHelpful prevents it.
  test('markHelpful second call performs no write (early-return guard)', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1'));
    await svc.markHelpful(reviewId: 'ck_u1', uid: 'u2');
    final before = await db.doc('reviews/ck_u1').get();
    await svc.markHelpful(reviewId: 'ck_u1', uid: 'u2');
    final after = await db.doc('reviews/ck_u1').get();
    expect(after.data(), equals(before.data()));
    expect((await svc.getMyReview('ck', 'u1'))!.helpfulBy, ['u2']);
  });

  // On an edit the stored helpfulBy / createdAt must win over the caller's copy:
  // the rules deny any author update whose diff touches helpfulBy.
  test('submitReview edit preserves server-owned helpfulBy and createdAt', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    final original = _review('ck', 'u1', rating: 4);
    await svc.submitReview(original);
    await svc.markHelpful(reviewId: 'ck_u1', uid: 'helper');
    final edit = original.copyWith(
      rating: 2,
      helpfulBy: const ['someone', 'else'],
      createdAt: DateTime(2020, 1, 1),
      updatedAt: DateTime(2024, 6, 1),
    );
    await svc.submitReview(edit);
    final stored = Review.fromMap((await db.doc('reviews/ck_u1').get()).data()!);
    expect(stored.rating, 2);
    expect(stored.helpfulBy, ['helper']);
    expect(stored.createdAt, original.createdAt);
  });

  test('streamReviewsForCourse returns only that course', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1'));
    await svc.submitReview(_review('other', 'u1'));
    final list = await svc.streamReviewsForCourse('ck').first;
    expect(list.map((r) => r.courseKey).toSet(), {'ck'});
  });

  test('streamMyReviews returns exactly the caller\'s reviews', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck1', 'u1'));
    await svc.submitReview(_review('ck2', 'u1'));
    await svc.submitReview(_review('ck3', 'u2'));
    final list = await svc.streamMyReviews('u1').first;
    expect(list.length, 2);
    expect(list.map((r) => r.courseKey).toSet(), {'ck1', 'ck2'});
    expect(list.every((r) => r.authorId == 'u1'), isTrue);
  });

  test('getStats / streamStats read the Function-written aggregate; extra server fields are ignored', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    expect((await svc.getStats('ck')).reviewCount, 0); // missing doc -> empty
    await db.collection('course_stats').doc('ck').set({
      'courseKey': 'ck', 'university_id': 'kyoto_u', 'reviewCount': 2, 'ratingSum': 8,
      'pastExamPostCount': 1, 'score': 55, 'aggregatedAt': Timestamp.fromDate(DateTime.utc(2027)),
    });
    final s = await svc.getStats('ck');
    expect(s.reviewCount, 2);
    expect(s.ratingSum, 8);
    expect(s.pastExamPostCount, 1);
    expect(s.score, 55);
    expect((await svc.streamStats('ck').first).reviewCount, 2);
  });

  // C1 — a courseKey with '/' (17 catalog courses carry one) must never produce
  // a '/' in a document id.
  group('C1 — courseKey containing /', () {
    const slashKey = 'a/b|c/d';

    test('submitReview writes a well-formed (slash-free) review id and no aggregate', () async {
      final db = FakeFirebaseFirestore();
      final svc = ReviewService(db);
      await svc.submitReview(_review(slashKey, 'u1', rating: 5));
      expect((await db.doc('reviews/a%2Fb|c%2Fd_u1').get()).exists, isTrue);
      final stored = Review.fromMap((await db.doc('reviews/a%2Fb|c%2Fd_u1').get()).data()!);
      expect(stored.courseKey, slashKey);
      expect(stored.courseSlug, 'a%2Fb|c%2Fd');
      expect(stored.id, '${stored.courseSlug}_u1');
      expect(await _statsDocs(db), 0);
    });

    test('getStats reads the aggregate for a slash courseKey from its slugged id', () async {
      final db = FakeFirebaseFirestore();
      final svc = ReviewService(db);
      await db.collection('course_stats').doc('a%2Fb|c%2Fd').set({'courseKey': slashKey, 'reviewCount': 1, 'ratingSum': 5});
      final stats = await svc.getStats(slashKey);
      expect(stats.reviewCount, 1);
      expect(stats.ratingSum, 5);
    });

    test('the whole review lifecycle survives a slash courseKey', () async {
      final db = FakeFirebaseFirestore();
      final svc = ReviewService(db);
      await svc.submitReview(_review(slashKey, 'u1', rating: 5));
      expect((await svc.streamReviewsForCourse(slashKey).first).length, 1);
      expect((await svc.getMyReview(slashKey, 'u1'))!.rating, 5);
      await svc.markHelpful(reviewId: Review.docId(slashKey, 'u1'), uid: 'u2');
      expect((await svc.getMyReview(slashKey, 'u1'))!.helpfulBy, ['u2']);
      await svc.deleteReview(_review(slashKey, 'u1'));
      expect(await svc.getMyReview(slashKey, 'u1'), isNull);
    });
  });

  test('streamMyReview emits null when there is none, then the review', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    expect(await svc.streamMyReview('ck', 'u1').first, isNull);
    final done = expectLater(
      svc.streamMyReview('ck', 'u1'),
      emitsThrough(predicate<Review?>((r) => r != null && r.rating == 3 && r.courseKey == 'ck', 'the submitted review')),
    );
    await svc.submitReview(_review('ck', 'u1', rating: 3));
    await done;
  });
}
```

`test/models/post_test.dart` — append:

```dart
  test('Post no longer carries reports (Plan 2B: reports are Function-owned docs)', () {
    final m = Post(
      id: 'p1', subjectId: 'c_1', subjectName: 'n', authorId: 'u1', authorName: 'me',
      category: PostCategory.other, title: 't', description: '',
      filePaths: ['resources/u1/1_a.pdf'], fileNames: ['a.pdf'], createdAt: DateTime.utc(2026, 10, 3),
    ).toMap();
    expect(m.containsKey('reports'), isFalse);
    final legacy = Post.fromMap({'id': 'old', 'title': 't', 'reports': ['ra', 'rb'], 'createdAt': '2026-09-01T00:00:00.000'});
    expect(legacy.id, 'old');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `flutter test test/models/course_stats_parity_test.dart test/services/review_service_test.dart test/models/post_test.dart`
Expected: the parity test PASSES already (it pins the Dart reference — if it fails, the fixture or the hand computation in Task 2 is wrong: stop and fix the fixture, never the model). The review-service tests FAIL (`submitReview` still writes `course_stats`); the post test FAILS (`toMap` still emits `reports`).

- [ ] **Step 3: `lib/services/review_service.dart`**

Replace the class doc comment's first paragraph with:

```dart
/// Firestore data layer for the review layer.
///
/// Plan 2B (M-11): `course_stats/{slug(courseKey)}` is maintained by the
/// `onReviewWritten` / `onPostWritten` Cloud Functions (a full recount per
/// course) and the rules deny every client write to it. This service writes
/// ONLY reviews; it still reads the aggregate through [getStats] / [streamStats].
```

(keep the C1 paragraph). Replace `submitReview` and `deleteReview` with:

```dart
  /// Create or edit the caller's review. On an edit, `helpfulBy` and
  /// `createdAt` are server-owned: the rules hard-deny any author update whose
  /// diff touches `helpfulBy`, so the write carries the stored values.
  Future<void> submitReview(Review review) async {
    await _fs.runTransaction((tx) async {
      final reviewRef = _reviews.doc(review.id);
      final prevSnap = await tx.get(reviewRef);
      final prevData = prevSnap.data();
      final previous = prevSnap.exists && prevData != null ? Review.fromMap(prevData) : null;
      final toWrite = previous != null
          ? review.copyWith(helpfulBy: previous.helpfulBy, createdAt: previous.createdAt)
          : review;
      tx.set(reviewRef, toWrite.toMap());
    });
  }

  /// Remove the caller's review. The aggregate follows via `onReviewWritten`.
  Future<void> deleteReview(Review review) => _reviews.doc(review.id).delete();
```

Delete `bumpPostCount` (and its doc comment).

- [ ] **Step 4: `lib/models/post.dart`**

Delete `final List<String> reports;`, `this.reports = const [],`, `'reports': reports,` (from `toMap`), `reports: List<String>.from(map['reports'] ?? []),` (from `fromMap`), and from `copyWith` the `List<String>? reports,` parameter and `reports: reports ?? this.reports,`. (`copyWith` keeps `downloadCount`. The posts create rule accepts a missing `reports`.)

- [ ] **Step 5: `lib/services/firestore_service.dart`**

Add `import 'talk_room_queries.dart';`. Replace `streamTalkRooms()` with:

```dart
  /// Plan 2B (M-15): only the rooms the caller takes part in (rules: participants only).
  Stream<List<TalkRoom>> streamTalkRoomsFor(String uid) => participantTalkRooms(_db, uid);
```

Delete the whole `// --- 7. POST REPORTS ---` section (`updatePostReports`).

- [ ] **Step 6: `lib/services/app_store.dart`**

1. **Imports / ctor / fields.** Add `import 'moderation_service.dart';` and `import '../models/app_notification.dart';`. The constructor becomes `AppStore(this.courses, this.reviews, this.ranking, this.credits, this.moderation) {`. Add next to the credit fields:

```dart
  /// Report / takedown callables and the caller's own moderation notices (Plan 2B).
  final ModerationService moderation;
  List<AppNotification> notifications = [];
  int get unreadNotificationCount => notifications.where((n) => !n.read).length;
  StreamSubscription<List<AppNotification>>? _notifSub;
  StreamSubscription<List<TalkRoom>>? _roomsSub;

  /// Per-user streams the Plan 2B rules only allow once the uid is known: the
  /// caller's own notices and the talk rooms they take part in.
  void _watchUserStreams(String uid) {
    _notifSub?.cancel();
    _roomsSub?.cancel();
    _notifSub = moderation.streamNotifications(uid).listen((n) {
      notifications = n;
      notifyListeners();
    }, onError: (_) {});
    _roomsSub = _firestore.streamTalkRoomsFor(uid).listen((rooms) {
      talkRooms = rooms;
      notifyListeners();
    }, onError: (_) {});
  }

  /// Marks every unread notice read (the only client write the rules allow on
  /// `notifications`). Best-effort.
  Future<void> markNotificationsRead() async {
    for (final n in notifications.where((n) => !n.read).toList()) {
      try {
        await moderation.markNotificationRead(n.id);
      } catch (_) {/* retried next time the screen opens */}
    }
  }
```

2. **`_initFirebaseSync`.** In the `authStateChanges` listener, after `_watchCredits(fbUser.uid);` add `_watchUserStreams(fbUser.uid);`. **Delete** the `_firestore.streamTalkRooms().listen(...)` block (the university-wide stream is refused by the new rules).
3. **`signUpWithPassword`.** After `_watchCredits(uid);` add `_watchUserStreams(uid);`.
4. **`logout()`.** Add `_notifSub?.cancel(); _roomsSub?.cancel(); notifications = []; talkRooms = [];`.
5. **Delete `_bumpPostCountFor`** (method and doc comment) and its call sites in `addPost` and `deletePost` (the `onPostWritten` Function now keeps the post counters; the client's increments would be denied). In `deletePost` also delete the now-unused `final post = posts[idx];` line (otherwise `flutter analyze` gains an `unused_local_variable` warning).
6. **Replace `reportPost`** with:

```dart
  /// Plan 2B: reports go through the `reportPost` callable (one per account per
  /// post, Function-owned); the server hides the post at 3 distinct reporters.
  Future<void> reportPost(String postId, {required ReportCategory category, String detail = ''}) async {
    if (currentUser == null) return;
    try {
      final outcome = await moderation.reportPost(postId, category, detail);
      switch (outcome) {
        case ReportOutcome.hidden:
          posts.removeWhere((p) => p.id == postId);
          lastNoticeMessage = '通報が一定数に達したため、この投稿は非表示になりました。運営が内容を確認します。';
        case ReportOutcome.alreadyHidden:
          posts.removeWhere((p) => p.id == postId);
          lastNoticeMessage = 'この投稿はすでに非表示になっています。';
        case ReportOutcome.duplicate:
          lastNoticeMessage = '既にこの投稿を通報済みです。';
        case ReportOutcome.reported:
          lastNoticeMessage = '通報を受け付けました。ご協力ありがとうございます。';
      }
    } on ModerationException catch (e) {
      lastNoticeMessage = e.isLimit
          ? '本日の通報の上限に達しました。明日以降にもう一度お試しください。'
          : e.isOwnPost
              ? '自分の投稿は通報できません。削除はマイページから行えます。'
              : e.isNotFound
                  ? 'この投稿は削除されたか、見つかりませんでした。'
                  : '通報の送信に失敗しました。メール認証の状態と通信環境を確認してください。';
    } catch (_) {
      lastNoticeMessage = '通報の送信に失敗しました。メール認証の状態と通信環境を確認してください。';
    }
    notifyListeners();
  }
```

7. **`submitInquiry`.** The `'report'` category is no longer sent (reports are callables now): replace the ternary with `lastNoticeMessage = 'お問い合わせを送信しました。運営からの連絡をお待ちください。';`.

- [ ] **Step 7: `lib/main.dart`**

Add `import 'services/moderation_service.dart';` and pass `ModerationService.live(FirebaseFirestore.instance),` as the 5th `AppStore` argument.

`lib/views/course/course_resource_tab.dart` (interim, so the app compiles; Task 10 Step 3 replaces the whole dialog): add `import '../../services/moderation_service.dart';`; in `_showReportDialog`'s send button delete the `widget.store.submitInquiry(category: 'report', …)` call and change `await widget.store.reportPost(postId);` to `await widget.store.reportPost(postId, category: ReportCategory.copyright, detail: reasonController.text.trim());`.

- [ ] **Step 8: Verify**

Run: `flutter analyze` (still 24 issues — no new one; Task 10 then removes two), `flutter test` (all green: the replaced review-service file, +1 parity, +1 post), `flutter build web --debug` (clean).
Run: `grep -rnE "bumpPostCount|_bumpPostCountFor|updatePostReports|streamTalkRooms\(\)|\.reports\b" lib/` — must print nothing.

- [ ] **Step 9: Commit**

```bash
git add lib test
git commit -m "refactor: client stops writing course_stats and reports; AppStore wires moderation, notices, participant rooms"
```

---

### Task 10: Flutter — report dialog, takedown form, お知らせ, participant-only chat button, copy

**Files:**
- Create: `lib/views/moderation/takedown_screen.dart`, `lib/views/notifications/notifications_screen.dart`, `test/views/takedown_screen_test.dart`
- Modify: `lib/views/course/course_resource_tab.dart`, `lib/views/mypage/my_page_screen.dart`, `lib/views/auth/signup_screen.dart`, `lib/views/contact/contact_screen.dart`, `lib/views/textbook/textbook_lending_screen.dart`, `lib/widgets/credit_rules_dialog.dart`

**Interfaces:**
- Consumes: `AppStore.reportPost`, `.moderation`, `.notifications`, `.unreadNotificationCount`, `.markNotificationsRead` (Task 9); `ModerationService`, `validateTakedown`, `TakedownRole`, `ReportCategory`, `kReportMaxDetail`, `kTakedown*` (Task 8).
- Produces: `TakedownScreen({required ModerationService moderation, String? initialPostId, String? signedInEmail})`, `NotificationsScreen({required AppStore store})`.

- [ ] **Step 1: Write the failing widget test `test/views/takedown_screen_test.dart`**

```dart
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/services/moderation_service.dart';
import 'package:kyoto_exam_hub/views/moderation/takedown_screen.dart';

void main() {
  testWidgets('submits the prefilled post id and shows the receipt', (tester) async {
    Map<String, dynamic>? sent;
    final svc = ModerationService(FakeFirebaseFirestore(), (name, data) async {
      expect(name, 'submitTakedown');
      sent = data;
      return {'requestId': 'td42', 'hidden': <Object?>[]};
    });
    await tester.pumpWidget(MaterialApp(
      home: TakedownScreen(moderation: svc, initialPostId: 'post_1', signedInEmail: 'a@st.kyoto-u.ac.jp'),
    ));
    await tester.enterText(find.widgetWithText(TextField, 'お名前・ご所属'), '山田 太郎');
    await tester.enterText(find.widgetWithText(TextField, '対象の資料と削除を求める理由'), '2024年度 線形代数A 期末試験の問題です');
    await tester.ensureVisible(find.text('送信する'));
    await tester.tap(find.text('送信する'));
    await tester.pumpAndSettle();
    expect(sent!['postIds'], ['post_1']);
    expect(sent!['contactEmail'], 'a@st.kyoto-u.ac.jp');
    expect(sent!['role'], 'instructor');
    expect(find.text('削除依頼を受け付けました。'), findsOneWidget);
    expect(find.textContaining('td42'), findsOneWidget);
  });

  testWidgets('an invalid form is not sent and says why', (tester) async {
    var calls = 0;
    final svc = ModerationService(FakeFirebaseFirestore(), (_, _) async {
      calls++;
      return <String, dynamic>{};
    });
    await tester.pumpWidget(MaterialApp(home: TakedownScreen(moderation: svc)));
    await tester.ensureVisible(find.text('送信する'));
    await tester.tap(find.text('送信する'));
    await tester.pump();
    expect(calls, 0);
    expect(find.text('お名前（ご所属）を入力してください（100文字まで）'), findsOneWidget);
  });
}
```

Run: `flutter test test/views/takedown_screen_test.dart`
Expected: FAIL — `takedown_screen.dart` does not exist.

- [ ] **Step 2: Create `lib/views/moderation/takedown_screen.dart`**

```dart
import 'package:flutter/material.dart';

import '../../services/moderation_service.dart';

const _brand = Color(0xFF0F4C81);

/// 「担当教員・権利者の方はこちら」 — the takedown form (spec §4.3; Plan 2B M-6, M-18).
///
/// Reachable signed out (login screen), from a post's report dialog (post id
/// prefilled) and from お問い合わせ. The server decides what happens: a verified
/// Kyoto University sender hides the named post at once; anyone else files a
/// priority request that the operators review.
class TakedownScreen extends StatefulWidget {
  const TakedownScreen({super.key, required this.moderation, this.initialPostId, this.signedInEmail});

  final ModerationService moderation;
  final String? initialPostId;
  final String? signedInEmail;

  @override
  State<TakedownScreen> createState() => _TakedownScreenState();
}

class _TakedownScreenState extends State<TakedownScreen> {
  late final TextEditingController _postId = TextEditingController(text: widget.initialPostId ?? '');
  final TextEditingController _name = TextEditingController();
  late final TextEditingController _email = TextEditingController(text: widget.signedInEmail ?? '');
  final TextEditingController _description = TextEditingController();
  TakedownRole _role = TakedownRole.instructor;
  bool _sending = false;
  String? _error;
  TakedownResult? _done;

  @override
  void dispose() {
    _postId.dispose();
    _name.dispose();
    _email.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final invalid = validateTakedown(name: _name.text, email: _email.text, description: _description.text);
    if (invalid != null) {
      setState(() => _error = invalid);
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final id = _postId.text.trim();
      final r = await widget.moderation.submitTakedown(
        postIds: id.isEmpty ? const [] : [id],
        requesterName: _name.text,
        role: _role,
        contactEmail: _email.text,
        description: _description.text,
      );
      if (!mounted) return;
      setState(() => _done = r);
    } on ModerationException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.isLimit
          ? '本日の受付件数の上限に達しました。お手数ですが、明日以降にもう一度お送りください。'
          : '送信できませんでした。入力内容をご確認のうえ、もう一度お試しください。');
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = '送信できませんでした。通信環境をご確認のうえ、もう一度お試しください。');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  InputDecoration _deco(String label, {String? hint}) => InputDecoration(
        labelText: label,
        hintText: hint,
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
      );

  Widget _doneView(TakedownResult r) {
    final hidden = r.hidden.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(hidden ? Icons.visibility_off_rounded : Icons.mark_email_read_rounded, color: _brand, size: 40),
        const SizedBox(height: 12),
        Text(
          hidden ? '対象の資料を非表示にしました。' : '削除依頼を受け付けました。',
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
        ),
        const SizedBox(height: 8),
        const Text(
          '運営が優先して確認し、ご入力いただいた連絡先へご連絡します。',
          style: TextStyle(fontSize: 13, color: Color(0xFF475569)),
        ),
        const SizedBox(height: 12),
        SelectableText('受付番号: ${r.requestId}', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
        const SizedBox(height: 20),
        OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('閉じる')),
      ],
    );
  }

  Widget _formView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('担当教員・権利者の方へ',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
        const SizedBox(height: 6),
        const Text(
          '京大InfoHubに掲載された試験問題・資料について、権利者・大学関係者の方からの削除依頼を優先して受け付けます。'
          '京都大学の認証済みアカウントからの依頼では、確認の前でも対象の資料をただちに非表示にします。',
          style: TextStyle(fontSize: 13, color: Color(0xFF64748B)),
        ),
        const SizedBox(height: 20),
        const Text('ご立場', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF334155))),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            for (final r in TakedownRole.values)
              ChoiceChip(
                label: Text(r.label, style: const TextStyle(fontSize: 12)),
                selected: r == _role,
                onSelected: (_) => setState(() => _role = r),
              ),
          ],
        ),
        const SizedBox(height: 16),
        TextField(controller: _name, maxLength: kTakedownMaxName, decoration: _deco('お名前・ご所属', hint: '例: 山田 太郎（理学研究科）')),
        const SizedBox(height: 8),
        TextField(
          controller: _email,
          maxLength: kTakedownMaxEmail,
          keyboardType: TextInputType.emailAddress,
          decoration: _deco('ご連絡先メールアドレス'),
        ),
        const SizedBox(height: 8),
        TextField(controller: _postId, decoration: _deco('対象の投稿ID（分かる場合）', hint: '通報画面から開いた場合は入力済みです')),
        const SizedBox(height: 16),
        TextField(
          controller: _description,
          maxLines: 6,
          maxLength: kTakedownMaxDescription,
          decoration: _deco('対象の資料と削除を求める理由', hint: '科目名・年度・試験の種類など、資料を特定できる情報をご記入ください'),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(_error!, style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13)),
        ],
        const SizedBox(height: 16),
        SizedBox(
          height: 48,
          child: ElevatedButton(
            onPressed: _sending ? null : _submit,
            style: ElevatedButton.styleFrom(backgroundColor: _brand, foregroundColor: Colors.white),
            child: _sending
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : const Text('送信する', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final done = _done;
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(title: const Text('削除依頼フォーム')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 600),
            child: done != null ? _doneView(done) : _formView(),
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 3: Replace `_showReportDialog` in `lib/views/course/course_resource_tab.dart`**

Add `import '../moderation/takedown_screen.dart';` (the `moderation_service.dart` import came in Task 9). Replace the whole `_showReportDialog(String postId)` method (including Task 9's interim call) with:

```dart
  void _showReportDialog(String postId) {
    final detailController = TextEditingController();
    var category = ReportCategory.copyright;
    var sending = false;

    showDialog(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setLocal) => AlertDialog(
          title: const Row(
            children: [
              Icon(Icons.report_problem_outlined, color: Colors.redAccent),
              SizedBox(width: 8),
              Text('投稿の通報'),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '3人以上から通報された投稿は自動的に非表示になり、運営が確認します。通報したことが投稿者に知らされることはありません。',
                  style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: [
                    for (final c in ReportCategory.values)
                      ChoiceChip(
                        label: Text(c.label, style: const TextStyle(fontSize: 12)),
                        selected: c == category,
                        onSelected: (_) => setLocal(() => category = c),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: detailController,
                  maxLines: 3,
                  maxLength: kReportMaxDetail,
                  decoration: const InputDecoration(hintText: '具体的な理由（任意）', border: OutlineInputBorder()),
                ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () {
                      Navigator.pop(dialogContext);
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => TakedownScreen(
                            moderation: widget.store.moderation,
                            initialPostId: postId,
                            signedInEmail: widget.store.currentUser?.email,
                          ),
                        ),
                      );
                    },
                    icon: const Icon(Icons.gavel_rounded, size: 16),
                    label: const Text('担当教員・権利者の方はこちら', style: TextStyle(fontSize: 12)),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: sending ? null : () => Navigator.pop(dialogContext),
              child: const Text('キャンセル'),
            ),
            ElevatedButton(
              onPressed: sending
                  ? null
                  : () async {
                      setLocal(() => sending = true);
                      await widget.store.reportPost(postId, category: category, detail: detailController.text);
                      if (!mounted) return;
                      if (dialogContext.mounted) Navigator.pop(dialogContext);
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(widget.store.lastNoticeMessage ?? '通報を送信しました。')),
                      );
                      setState(() {});
                    },
              style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent, foregroundColor: Colors.white),
              child: const Text('通報を送信'),
            ),
          ],
        ),
      ),
    );
  }
```

(The old dialog also filed an `inquiries` row with category `'report'`; that is gone — the reason now lives in the Admin-only report doc.)

- [ ] **Step 4: Create `lib/views/notifications/notifications_screen.dart`**

```dart
import 'package:flutter/material.dart';

import '../../models/app_notification.dart';
import '../../services/app_store.dart';

/// お知らせ (Plan 2B, M-10): the moderation notices the Functions write for the
/// signed-in user. Opening the screen marks them read.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.store});

  final AppStore store;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    widget.store.addListener(_onStore);
    WidgetsBinding.instance.addPostFrameCallback((_) => widget.store.markNotificationsRead());
  }

  @override
  void dispose() {
    widget.store.removeListener(_onStore);
    super.dispose();
  }

  void _onStore() {
    if (mounted) setState(() {});
  }

  static String _two(int v) => v.toString().padLeft(2, '0');
  static String _when(DateTime d) => '${d.year}/${_two(d.month)}/${_two(d.day)} ${_two(d.hour)}:${_two(d.minute)}';

  IconData _icon(AppNotification n) => switch (n.type) {
        'post_hidden' => Icons.visibility_off_outlined,
        'post_restored' => Icons.visibility_outlined,
        'post_removed' => Icons.delete_outline_rounded,
        _ => Icons.notifications_none_rounded,
      };

  @override
  Widget build(BuildContext context) {
    final items = widget.store.notifications;
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(title: const Text('お知らせ')),
      body: items.isEmpty
          ? const Center(child: Text('お知らせはまだありません', style: TextStyle(color: Color(0xFF94A3B8))))
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                final n = items[i];
                return Card(
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: const BorderSide(color: Color(0xFFE2E8F0)),
                  ),
                  child: ListTile(
                    leading: Icon(_icon(n), color: const Color(0xFF0F4C81)),
                    title: Text(
                      n.message,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: n.read ? FontWeight.normal : FontWeight.bold,
                        color: const Color(0xFF1E293B),
                      ),
                    ),
                    subtitle: Text(_when(n.createdAt.toLocal()),
                        style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
                  ),
                );
              },
            ),
    );
  }
}
```

- [ ] **Step 5: Entry points and small edits**

`lib/views/mypage/my_page_screen.dart`: add `import '../notifications/notifications_screen.dart';`; in the `AppBar` `actions`, **before** the logout `IconButton`, add:

```dart
          IconButton(
            tooltip: 'お知らせ',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => NotificationsScreen(store: widget.store)),
            ),
            icon: Badge(
              isLabelVisible: widget.store.unreadNotificationCount > 0,
              label: Text('${widget.store.unreadNotificationCount}'),
              child: const Icon(Icons.notifications_none_rounded, color: Colors.grey),
            ),
          ),
```

`lib/views/auth/signup_screen.dart`: add `import '../moderation/takedown_screen.dart';`; at the end of `_buildAuthFormView()`'s `children` (after the login/signup toggle `TextButton`) add:

```dart
        const SizedBox(height: 4),
        TextButton(
          onPressed: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => TakedownScreen(moderation: widget.store.moderation)),
          ),
          child: const Text(
            '担当教員・権利者の方へ（掲載資料の削除依頼）',
            style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
          ),
        ),
```

`lib/views/contact/contact_screen.dart`: add `import '../moderation/takedown_screen.dart';`; directly after the `'お問い合わせ内容は運営チームへ保存・通知され、手動対応を行います。'` `Text` and its following `SizedBox(height: 24)`, insert:

```dart
              Card(
                elevation: 0,
                color: const Color(0xFFFEF2F2),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                  side: const BorderSide(color: Color(0xFFFECACA)),
                ),
                child: ListTile(
                  leading: const Icon(Icons.gavel_rounded, color: Color(0xFFB91C1C)),
                  title: const Text('著作権者・担当教員の方の削除依頼', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                  subtitle: const Text('掲載資料の削除はこちらのフォームから優先して受け付けます', style: TextStyle(fontSize: 11.5)),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => TakedownScreen(
                        moderation: widget.store.moderation,
                        signedInEmail: widget.store.currentUser?.email,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 20),
```

`lib/views/textbook/textbook_lending_screen.dart`: in the matched branch change `if (req.talkRoomId != null)` to

```dart
                            if (req.talkRoomId != null &&
                                (isMyRequest || req.responderId == widget.store.currentUser?.uid))
```

(M-15: only the two parties can open the room; everyone else would get the empty placeholder room.)

`lib/widgets/credit_rules_dialog.dart`: replace the last `kCreditRules` entry with

```dart
  '⚠️ 転載・無関係なファイルは通報できます。3人から通報された投稿は非表示になり、運営が確認します。権利者の方からの削除依頼は優先して対応します（獲得済みのクレジットは没収されません）。',
```

- [ ] **Step 6: Verify**

Run: `flutter test test/views/takedown_screen_test.dart` (2 pass), `flutter analyze` (**22 issues**: the baseline 24 minus the two `use_build_context_synchronously` infos of the old report dialog in `course_resource_tab.dart`; no new issue anywhere), `flutter test` (all green — 106 tests), `flutter build web --debug` (clean).
Run: `grep -rn "自動削除" lib/` — must print nothing.
Manual (`flutter run -d chrome --web-port 5000` against the emulators or a test project — never production): the login screen shows the 削除依頼 link and the form opens signed out; the flag icon on a post opens the new dialog with category chips and the 権利者 link; マイページ shows the bell.

- [ ] **Step 7: Commit**

```bash
git add lib test
git commit -m "feat: report dialog via callable, takedown form, お知らせ bell, participant-only chat button, copy"
```

---

### Task 11: `tools/backfill_course_stats.mjs` — one authoritative recount of every course (user-run)

Every existing `course_stats` doc was written by clients (forgeable, and the 2A post counters drift). After the 2B deploy the triggers keep each course right from its next write on; this tool recounts **all** of them once, with the triggers' own code (M-17). It replaces `tools/backfill_post_counts.mjs`.

**Files:**
- Create: `tools/backfill_course_stats.mjs`, `tools/test_backfill_course_stats_fixture.mjs`, `tools/test_backfill_course_stats.sh`
- Delete: `tools/backfill_post_counts.mjs`, `tools/test_backfill.sh`, `tools/test_backfill_fixture.mjs`
- Modify: `tools/README.md`

**Interfaces:** CLI `node backfill_course_stats.mjs --project <id> [--apply] [--prune-orphans]`, run by the USER (Application Default Credentials). Exports the pure `parseArgs(argv) → {opts} | {error}` and `diffStats(stored, next) → string[]` (sorted field names that differ; key order inside maps and `aggregatedAt` are ignored). Loads `functions/lib/courseStats.js` (`statsRef`, `computeCourseStats`, `recomputeCourseStats`) and `firebase-admin` from `functions/` via `createRequire` — so `npm --prefix functions run build` must have run.

Behaviour: courseKeys = every `reviews.courseKey` ∪ every `course_stats` doc whose id is the slug of its own `courseKey` ∪ the `courseKey` of every course a `posts.subjectId` points at. For each (sorted): compute; print `WOULD RECOUNT` / `RECOUNT course_stats/<id>: <changed fields>` when it differs; with `--apply` run `recomputeCourseStats`. `course_stats` docs whose id is not the slug of their `courseKey` are **orphans** (no Function can ever write them — forged under the old rules): listed, and deleted only with `--apply --prune-orphans`. Final line `totals: courses=… changed=… unchanged=… orphans=… pruned=…`. Idempotent: a second `--apply` reports `changed=0`.

- [ ] **Step 1: Write the failing fixture test `tools/test_backfill_course_stats_fixture.mjs`**

```js
// Pure asserts + emulator fixture for backfill_course_stats.mjs (Plan 2B, Task 11).
//
//   node test_backfill_course_stats_fixture.mjs                       # pure asserts
//   node test_backfill_course_stats_fixture.mjs seed|unchanged|check|pruned
//   node test_backfill_course_stats_fixture.mjs run <stdout-substring> [tool args]
//
// The emulator modes refuse to run unless FIRESTORE_EMULATOR_HOST is set.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseArgs, diffStats } from './backfill_course_stats.mjs';

const mode = process.argv[2];

if (!mode) {
  assert.deepEqual(parseArgs(['--project', 'p']), { opts: { apply: false, pruneOrphans: false, project: 'p' } });
  assert.equal(parseArgs(['--project', 'p', '--apply']).opts.apply, true);
  for (const bad of [[], ['--apply'], ['--project', 'p', '--prune-orphans'], ['--project', 'p', '--apply', '--dry-run'],
    ['--project', 'p', '--frobnicate'], ['--project', '--apply']]) {
    assert.ok(parseArgs(bad).error, JSON.stringify(bad));
  }
  assert.deepEqual(diffStats({ m: { y: 1, x: 2 }, aggregatedAt: { seconds: 1 } }, { m: { x: 2, y: 1 } }), []);
  assert.deepEqual(diffStats({ reviewCount: 99, pinned: true }, { reviewCount: 2 }), ['pinned', 'reviewCount']);
  assert.deepEqual(diffStats(undefined, { reviewCount: 0 }), ['reviewCount']);
  console.log('backfill_course_stats pure: OK');
  process.exit(0);
}

if (mode === 'run') {
  const [want, ...args] = process.argv.slice(3);
  const r = spawnSync(process.execPath, ['backfill_course_stats.mjs', ...args], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (r.status !== 0) { console.error(`FAILED: tool exited ${r.status}`); process.exit(1); }
  if (!r.stdout.includes(want)) { console.error(`FAILED: output lacks "${want}"`); process.exit(1); }
  process.exit(0);
}

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('refusing to run outside the emulator'); process.exit(1); }
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ projectId: 'demo-cstats' });
const db = getFirestore();

const K1 = '線形代数a|山田太郎';
const KS = 'river/coastal|後藤'; // C1: a '/' in the courseKey
const KS_SLUG = 'river%2Fcoastal|後藤';
const KGONE = 'gone|nobody'; // has an aggregate but no reviews or posts any more
const R = (ck, over) => ({
  courseKey: ck, authorId: 'x', university_id: 'kyoto_u', rakutan: 'raku', attendance: 'none',
  grading: 'exam_only', pastExam: 'as_is', bringIn: 'no', helpfulBy: [], ...over,
});

if (mode === 'seed') {
  for (const [id, ck] of [['c_x', K1], ['c_y', K1], ['c_s', KS]]) {
    await db.doc(`courses/${id}`).set({ id, courseKey: ck, name: 'n', university_id: 'kyoto_u' });
  }
  await db.doc(`reviews/${K1}_u1`).set(R(K1, { rating: 5, updatedAt: '2026-09-01T00:00:00.000' }));
  await db.doc(`reviews/${K1}_u2`).set(R(K1, { rating: 3, rakutan: 'muzu', attendance: 'heavy', updatedAt: '2026-09-02T00:00:00.000' }));
  await db.doc(`reviews/${KS_SLUG}_u3`).set(R(KS, { rating: 4, updatedAt: '2026-09-03T00:00:00.000' }));
  await db.doc('posts/p1').set({ authorId: 'u1', subjectId: 'c_x', category: 'past_exam', university_id: 'kyoto_u' });
  await db.doc('posts/p2').set({ authorId: 'u1', subjectId: 'c_x', category: 'other', university_id: 'kyoto_u' });
  await db.doc('posts/p3').set({ authorId: 'u2', subjectId: 'c_y', category: 'test_prep', university_id: 'kyoto_u' });
  await db.doc('posts/p4').set({ authorId: 'u2', subjectId: 'c_missing', category: 'past_exam', university_id: 'kyoto_u' });
  await db.doc('hidden_posts/h1').set({ authorId: 'u3', subjectId: 'c_x', category: 'past_exam', university_id: 'kyoto_u' });
  // A client-forged aggregate (old rules) and a stale one.
  await db.doc(`course_stats/${K1}`).set({ courseKey: K1, university_id: 'kyoto_u', reviewCount: 99, score: 100, pinned: true });
  await db.doc(`course_stats/${KGONE}`).set({ courseKey: KGONE, university_id: 'kyoto_u', reviewCount: 5, ratingSum: 20 });
  // An orphan: its id is not the slug of its courseKey, so no Function ever writes it.
  await db.doc('course_stats/forged_id').set({ courseKey: 'something else', reviewCount: 3 });
  console.log('fixture seeded');
  process.exit(0);
}

const failures = [];
const eq = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  else console.log(`  ok  ${label}`);
};
const stats = async (id) => (await db.doc(`course_stats/${id}`).get()).data();

if (mode === 'unchanged') {
  eq('dry run left the forged K1 doc alone', (await stats(K1))?.reviewCount, 99);
  eq('dry run wrote no slash doc', await stats(KS_SLUG), undefined);
} else if (mode === 'check') {
  const k1 = await stats(K1);
  eq('K1 reviewCount', k1.reviewCount, 2);
  eq('K1 ratingSum', k1.ratingSum, 8);
  eq('K1 score', k1.score, 55);
  eq('K1 pastExamPostCount (hidden h1 excluded)', k1.pastExamPostCount, 1);
  eq('K1 resourcePostCount (across c_x and c_y)', k1.resourcePostCount, 2);
  eq('K1 lastReviewAt', k1.lastReviewAt, '2026-09-02T00:00:00.000');
  eq('K1 forged field gone', k1.pinned, undefined);
  eq('K1 university_id', k1.university_id, 'kyoto_u');
  const ks = await stats(KS_SLUG);
  eq('slash doc under the slugged id', ks?.reviewCount, 1);
  eq('slash doc keeps the raw courseKey', ks?.courseKey, KS);
  const gone = await stats(KGONE);
  eq('stale aggregate zeroed', [gone.reviewCount, gone.ratingSum, gone.score], [0, 0, 50]);
  eq('orphan kept without --prune-orphans', (await stats('forged_id'))?.reviewCount, 3);
  eq('no aggregate for the orphan\'s key', await stats('something else'), undefined);
  for (const d of (await db.collection('course_stats').get()).docs) eq(`id "${d.id}" has no /`, d.id.includes('/'), false);
} else if (mode === 'pruned') {
  eq('orphan pruned', await stats('forged_id'), undefined);
  eq('K1 untouched by pruning', (await stats(K1)).reviewCount, 2);
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
if (failures.length) { console.error(`FAILED:\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log(`${mode}: assertions passed`);
process.exit(0);
```

`tools/test_backfill_course_stats.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Pure + emulator tests for backfill_course_stats.mjs (Plan 2B). Firestore
# emulator only (project demo-*): never touches production.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")"
npm --prefix ../functions run build   # the tool runs the compiled trigger code (M-17)
node test_backfill_course_stats_fixture.mjs
# No --project, or --prune-orphans without --apply, must refuse (exit non-zero, nothing touched).
if node backfill_course_stats.mjs >/dev/null 2>&1; then echo "expected usage failure"; exit 1; fi
if node backfill_course_stats.mjs --project demo-cstats --prune-orphans >/dev/null 2>&1; then echo "expected usage failure"; exit 1; fi
# changed=3: K1 (forged), the slash course (new), KGONE (stale -> zero). The 2nd --apply proves idempotence.
firebase emulators:exec --only firestore --project demo-cstats "\
  node test_backfill_course_stats_fixture.mjs seed \
  && node test_backfill_course_stats_fixture.mjs run 'changed=3' --project demo-cstats \
  && node test_backfill_course_stats_fixture.mjs unchanged \
  && node test_backfill_course_stats_fixture.mjs run 'changed=3' --project demo-cstats --apply \
  && node test_backfill_course_stats_fixture.mjs check \
  && node test_backfill_course_stats_fixture.mjs run 'changed=0' --project demo-cstats --apply \
  && node test_backfill_course_stats_fixture.mjs check \
  && node test_backfill_course_stats_fixture.mjs run 'pruned=1' --project demo-cstats --apply --prune-orphans \
  && node test_backfill_course_stats_fixture.mjs pruned"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_backfill_course_stats.sh`
Expected: FAIL — `./backfill_course_stats.mjs` not found.

- [ ] **Step 3: Create `tools/backfill_course_stats.mjs`**

```js
// Authoritative recount of EVERY `course_stats` doc (Plan 2B, Task 11).
//
// From Plan 2B on, `course_stats` is written ONLY by the onReviewWritten /
// onPostWritten Cloud Functions (a full recount per course). This tool runs the
// SAME recount — functions/lib/courseStats.js, loaded together with the
// Functions' own firebase-admin (M-17) — over every course that has reviews,
// posts or an aggregate. Run it once after the 2B deploy to replace the
// client-written (forgeable) Phase-1/2A aggregates; re-run any time to repair
// drift. It replaces tools/backfill_post_counts.mjs.
//
// SAFE BY DESIGN (same conventions as migrate_storage.mjs)
//   * Dry run is the DEFAULT: it prints which fields of which course WOULD
//     change and writes nothing. --apply writes.
//   * --project is mandatory (no fallback to an ambient project).
//   * Idempotent: a recount, not a delta; a second --apply reports changed=0.
//   * --prune-orphans (needs --apply) also deletes aggregates whose doc id is
//     not the slug of their own courseKey: no Function can ever write those
//     (they were forged under the old client-writable rules).
//
// Auth: Application Default Credentials — GOOGLE_APPLICATION_CREDENTIALS set in
// YOUR shell, or `gcloud auth application-default login`. This script never
// reads a key path itself. FIRESTORE_EMULATOR_HOST targets the emulator.
//
// Usage (build the Functions first, from the repo root: npm --prefix functions run build):
//   node backfill_course_stats.mjs --project kyodai-sns                          # dry run
//   node backfill_course_stats.mjs --project kyodai-sns --apply                  # write
//   node backfill_course_stats.mjs --project kyodai-sns --apply --prune-orphans  # + delete orphans

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const USAGE = `usage: node backfill_course_stats.mjs --project <id> [--apply] [--prune-orphans]
  default is a DRY RUN (nothing is written). --apply writes the recounts.
  --prune-orphans (needs --apply) deletes aggregates no Function can own.
  first: npm --prefix functions run build   (this tool runs the compiled trigger code)`;

export function parseArgs(argv) {
  const opts = { apply: false, pruneOrphans: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') opts.project = argv[++i];
    else if (a === '--apply') opts.apply = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--prune-orphans') opts.pruneOrphans = true;
    else return { error: `unknown argument: ${a}` };
  }
  if (!opts.project || opts.project.startsWith('--')) return { error: 'missing --project' };
  if (opts.apply && opts.dryRun) return { error: '--apply and --dry-run are mutually exclusive' };
  if (opts.pruneOrphans && !opts.apply) return { error: '--prune-orphans requires --apply' };
  delete opts.dryRun;
  return { opts };
}

// Firestore does not preserve map key order, so compare canonically.
const canon = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  : JSON.stringify(v));
const IGNORED = new Set(['aggregatedAt']);

/** Sorted names of the fields whose stored value differs from the recount. */
export function diffStats(stored, next) {
  const keys = new Set([...Object.keys(stored ?? {}), ...Object.keys(next)]);
  return [...keys].filter((k) => !IGNORED.has(k) && canon(stored?.[k]) !== canon(next[k])).sort();
}

async function main() {
  const { opts, error } = parseArgs(process.argv.slice(2));
  if (error) {
    console.error(`${error}\n${USAGE}`);
    process.exit(2);
  }
  const fnRequire = createRequire(new URL('../functions/package.json', import.meta.url));
  let stats;
  try {
    stats = fnRequire('./lib/courseStats.js');
  } catch {
    console.error('functions/lib/courseStats.js not found: run `npm --prefix functions run build` first');
    process.exit(2);
  }
  const { initializeApp, applicationDefault } = fnRequire('firebase-admin/app');
  const { getFirestore } = fnRequire('firebase-admin/firestore');

  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  console.log(`project: ${opts.project}  target: ${emulator ? 'EMULATOR' : 'LIVE'}`);
  console.log(`mode: ${opts.apply ? 'APPLY' : 'DRY RUN (no changes; pass --apply to write)'}${opts.pruneOrphans ? ' + PRUNE-ORPHANS' : ''}`);
  initializeApp({ projectId: opts.project, credential: applicationDefault() });
  const db = getFirestore();

  const keys = new Set();
  const add = (k) => { if (typeof k === 'string' && k !== '') keys.add(k); };
  for (const d of (await db.collection('reviews').select('courseKey').get()).docs) add(d.get('courseKey'));
  const orphans = [];
  for (const d of (await db.collection('course_stats').get()).docs) {
    const ck = d.get('courseKey');
    if (typeof ck === 'string' && ck !== '' && stats.statsRef(db, ck).id === d.id) add(ck);
    else orphans.push(d.id);
  }
  const subjects = new Set();
  for (const d of (await db.collection('posts').select('subjectId').get()).docs) {
    const s = d.get('subjectId');
    if (typeof s === 'string' && s !== '' && !s.includes('/')) subjects.add(s);
  }
  for (const s of subjects) add((await db.collection('courses').doc(s).get()).get('courseKey'));

  const tot = { courses: 0, changed: 0, unchanged: 0, orphans: orphans.length, pruned: 0 };
  for (const ck of [...keys].sort()) {
    tot.courses++;
    const ref = stats.statsRef(db, ck);
    const diff = diffStats((await ref.get()).data(), await stats.computeCourseStats(db, ck));
    if (diff.length === 0) { tot.unchanged++; continue; }
    tot.changed++;
    console.log(`${opts.apply ? 'RECOUNT' : 'WOULD RECOUNT'} course_stats/${ref.id}: ${diff.join(', ')}`);
    if (opts.apply) await stats.recomputeCourseStats(db, ck);
  }
  for (const id of orphans) {
    console.log(`${opts.pruneOrphans ? 'PRUNE' : 'ORPHAN (kept; --apply --prune-orphans deletes it)'} course_stats/${id}`);
    if (opts.pruneOrphans) { await db.collection('course_stats').doc(id).delete(); tot.pruned++; }
  }
  console.log(`totals: courses=${tot.courses} changed=${tot.changed} unchanged=${tot.unchanged} orphans=${tot.orphans} pruned=${tot.pruned}`);
  console.log(opts.apply ? 'done' : 'done (dry run: nothing written)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Retire the old backfill and document the new one**

Run: `git rm tools/backfill_post_counts.mjs tools/test_backfill.sh tools/test_backfill_fixture.mjs`

Append to `tools/README.md`:

```markdown
## course_stats recount (Plan 2B)

`course_stats` is maintained by the `onReviewWritten` / `onPostWritten` Cloud
Functions. `backfill_course_stats.mjs` runs the same recount (the compiled
`functions/lib/courseStats.js`) over every course: once after the 2B deploy, and
any time to repair drift. Dry run by default; `--apply` writes;
`--apply --prune-orphans` also deletes aggregates no Function can own.
Build first: `npm --prefix functions run build`. Emulator test:
`bash test_backfill_course_stats.sh`. (Replaces the removed
`backfill_post_counts.mjs`.)

## moderation CLI (Plan 2B)

There is no admin UI. `moderate.mjs` lists the moderation queue and open
takedown requests and hides / restores / deletes posts and closes requests,
through the same compiled code the Functions use (`functions/lib/moderation.js`).
Every mutating command is a dry run unless `--apply --operator <name>` is given;
the operator name goes into `moderation_log`. `strip-legacy-reports` removes the
pre-2B `posts.reports` arrays (they exposed reporter uids). Build first:
`npm --prefix functions run build`. Emulator test: `bash test_moderate.sh`.
```

- [ ] **Step 5: Run to verify it passes**

Run: `bash tools/test_backfill_course_stats.sh`
Expected: PASS — `backfill_course_stats pure: OK`, then every emulator step prints `assertions passed`; the tool's own output shows `changed=3` (dry run and first apply), `changed=0` (second apply), `pruned=1`.

- [ ] **Step 6: Commit**

```bash
git add tools/backfill_course_stats.mjs tools/test_backfill_course_stats_fixture.mjs tools/test_backfill_course_stats.sh tools/README.md
git commit -m "feat(tools): backfill_course_stats — recount every course with the trigger's own code; retire backfill_post_counts"
```

---

### Task 12: `tools/moderate.mjs` — the operator CLI (user-run, no admin UI)

**Files:**
- Create: `tools/moderate.mjs`, `tools/test_moderate_fixture.mjs`, `tools/test_moderate.sh`

**Interfaces:** CLI (see the header below). Exports the pure `parseArgs(argv) → {opts} | {error}` and `safeText(v, max = 120)` (control characters → `?`, bounded with `…`). Loads `functions/lib/moderation.js` (`listQueue`, `hidePost`, `restorePost`, `removePost`, `closeTakedown`) and `firebase-admin` from `functions/` via `createRequire` (M-17).

- [ ] **Step 1: Write the failing fixture test `tools/test_moderate_fixture.mjs`**

```js
// Pure asserts + emulator fixture for moderate.mjs (Plan 2B, Task 12).
//
//   node test_moderate_fixture.mjs                     # pure asserts
//   node test_moderate_fixture.mjs seed|listcheck|still-hidden|restored|deleted|closed|reports-kept|reports-stripped
//
// The emulator modes refuse to run unless FIRESTORE_EMULATOR_HOST is set.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseArgs, safeText } from './moderate.mjs';

const mode = process.argv[2];

if (!mode) {
  assert.deepEqual(parseArgs(['list', '--project', 'p']).opts, { command: 'list', apply: false, project: 'p' });
  const r = parseArgs(['restore', 'p1', '--project', 'p', '--apply', '--operator', 'me', '--note', 'ok']).opts;
  assert.deepEqual([r.command, r.target, r.apply, r.operator, r.note], ['restore', 'p1', true, 'me', 'ok']);
  for (const bad of [
    [], ['frob', '--project', 'p'], ['list'], ['restore', '--project', 'p'],
    ['restore', 'p1', '--project', 'p', '--apply'], // --apply without --operator
    ['list', '--project', 'p', '--apply', '--operator', 'x'], // list is read-only
    ['restore', 'p1', 'p2', '--project', 'p'], ['strip-legacy-reports', 'p1', '--project', 'p'],
  ]) {
    assert.ok(parseArgs(bad).error, JSON.stringify(bad));
  }
  assert.equal(safeText('ok\u001b[2Jbad\nline'), 'ok?[2Jbad?line');
  assert.equal(safeText('x'.repeat(130)).length, 121);
  assert.equal(safeText(undefined), '');
  console.log('moderate pure: OK');
  process.exit(0);
}

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('refusing to run outside the emulator'); process.exit(1); }
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ projectId: 'demo-mod' });
const db = getFirestore();
const get = async (p) => (await db.doc(p).get());

if (mode === 'seed') {
  await db.doc('hidden_posts/ph').set({
    authorId: 'ua', university_id: 'kyoto_u', title: '2024 期末', subjectId: 'c_1', category: 'past_exam',
    filePaths: ['resources/ua/1.pdf'], reports: ['old1'],
  });
  await db.doc('moderation_queue/ph').set({
    postId: 'ph', authorId: 'ua', postTitle: '2024 期末', subjectId: 'c_1', status: 'hidden', priority: 'normal',
    reportCount: 3, countedReports: 3, takedownRequestIds: [], hiddenBy: 'reports', hiddenByUid: null,
    autoHide: true, transitions: 1, needsReview: true, university_id: 'kyoto_u',
  });
  for (const r of ['r1', 'r2', 'r3']) await db.doc(`moderation_queue/ph/reports/${r}`).set({ counted: true, university_id: 'kyoto_u' });
  await db.doc('posts/pv').set({ authorId: 'ub', university_id: 'kyoto_u', title: 'visible', subjectId: 'c_1', category: 'other' });
  await db.doc('posts/pk').set({ authorId: 'uc', university_id: 'kyoto_u', title: 'legacy', subjectId: 'c_1', category: 'other', reports: ['x', 'y'] });
  await db.doc('takedown_requests/t1').set({
    status: 'open', verified: false, role: 'instructor', requesterName: 'Evil\u001b[2J', contactEmail: 'a@b.jp',
    description: 'please remove', postIds: ['ph'], university_id: 'kyoto_u',
  });
  await db.doc('credit_balances/ua').set({ balance: 7, university_id: 'kyoto_u' });
  console.log('fixture seeded');
  process.exit(0);
}

if (mode === 'listcheck') {
  const r = spawnSync(process.execPath, ['moderate.mjs', 'list', '--project', 'demo-mod'], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('ph'), 'queue lists the hidden post');
  assert.ok(r.stdout.includes('UNVERIFIED'), 'request shows it is unverified');
  assert.ok(r.stdout.includes('Evil?[2J'), 'escape sequence neutralised');
  assert.ok(!r.stdout.includes('\u001b'), 'no raw ESC reaches the terminal');
  console.log('listcheck: assertions passed');
  process.exit(0);
}

const checks = {
  'still-hidden': async () => {
    assert.equal((await get('hidden_posts/ph')).exists, true);
    assert.equal((await get('posts/ph')).exists, false);
    assert.equal((await get('moderation_queue/ph')).get('status'), 'hidden');
  },
  restored: async () => {
    assert.equal((await get('posts/ph')).get('title'), '2024 期末');
    assert.equal((await get('hidden_posts/ph')).exists, false);
    const q = (await get('moderation_queue/ph')).data();
    assert.deepEqual([q.status, q.autoHide, q.transitions], ['restored', false, 2]);
    const n = (await get('notifications/mod_ph_2')).data();
    assert.deepEqual([n.uid, n.type, n.university_id], ['ua', 'post_restored', 'kyoto_u']);
    for (const r of ['r1', 'r2', 'r3']) assert.equal((await get(`moderation_actors/${r}`)).get('restoredReports'), 1);
    const log = (await db.collection('moderation_log').where('target', '==', 'ph').get()).docs.map((d) => d.get('by'));
    assert.deepEqual(log, ['operator:tester']);
    assert.equal((await get('credit_balances/ua')).get('balance'), 7); // M-4
  },
  deleted: async () => {
    assert.equal((await get('posts/pv')).exists, false);
    assert.equal((await get('moderation_queue/pv')).get('status'), 'removed');
    const n = (await get('notifications/mod_pv_1')).data();
    assert.deepEqual([n.uid, n.type], ['ub', 'post_removed']);
  },
  closed: async () => {
    assert.equal((await get('takedown_requests/t1')).get('status'), 'closed');
    assert.equal((await get('takedown_requests/t1')).get('closedBy'), 'tester');
  },
  'reports-kept': async () => {
    assert.deepEqual((await get('posts/pk')).get('reports'), ['x', 'y']);
    assert.deepEqual((await get('posts/ph')).get('reports'), ['old1']);
  },
  'reports-stripped': async () => {
    assert.equal((await get('posts/pk')).get('reports'), undefined);
    assert.equal((await get('posts/ph')).get('reports'), undefined);
    assert.equal((await get('posts/pk')).get('title'), 'legacy');
  },
};
if (!checks[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
await checks[mode]();
console.log(`${mode}: assertions passed`);
process.exit(0);
```

`tools/test_moderate.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Pure + emulator tests for the moderation CLI (Plan 2B). Firestore emulator
# only (project demo-*): never touches production.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")"
npm --prefix ../functions run build   # the CLI runs the compiled moderation code (M-17)
node test_moderate_fixture.mjs
# Usage errors must refuse (exit non-zero) before touching anything.
if node moderate.mjs list >/dev/null 2>&1; then echo "expected usage failure (no --project)"; exit 1; fi
if node moderate.mjs restore ph --project demo-mod --apply >/dev/null 2>&1; then echo "expected usage failure (no --operator)"; exit 1; fi
firebase emulators:exec --only firestore --project demo-mod "\
  node test_moderate_fixture.mjs seed \
  && node test_moderate_fixture.mjs listcheck \
  && node moderate.mjs restore ph --project demo-mod \
  && node test_moderate_fixture.mjs still-hidden \
  && node moderate.mjs restore ph --project demo-mod --apply --operator tester \
  && node test_moderate_fixture.mjs restored \
  && node moderate.mjs delete pv --project demo-mod --apply --operator tester \
  && node test_moderate_fixture.mjs deleted \
  && ! node moderate.mjs delete nope --project demo-mod --apply --operator tester \
  && node moderate.mjs close t1 --project demo-mod --apply --operator tester \
  && node test_moderate_fixture.mjs closed \
  && node moderate.mjs strip-legacy-reports --project demo-mod \
  && node test_moderate_fixture.mjs reports-kept \
  && node moderate.mjs strip-legacy-reports --project demo-mod --apply --operator tester \
  && node test_moderate_fixture.mjs reports-stripped"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_moderate.sh`
Expected: FAIL — `./moderate.mjs` not found.

- [ ] **Step 3: Create `tools/moderate.mjs`**

```js
// Moderation CLI (Plan 2B, M-5). There is NO admin UI and NO admin callable:
// the operator is whoever holds the project's credentials and runs this on
// their own machine. Every state change goes through the same code the Cloud
// Functions use (functions/lib/moderation.js, with the Functions' own
// firebase-admin — M-17), so notifications, discredit counters and the
// moderation_log audit row are identical to an automatic hide.
//
// SAFE BY DESIGN
//   * Every mutating command is a DRY RUN unless --apply is given; the dry run
//     reads the current state and prints what WOULD happen.
//   * --project is mandatory. --apply requires --operator <name>, recorded in
//     moderation_log. No command touches a credit (spec §4.3, M-4).
//   * Queue text (titles, names, descriptions) is attacker-supplied: it is
//     printed through safeText, so a crafted takedown form cannot inject
//     terminal escape sequences into the operator's shell.
//
// Auth: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS in YOUR
// shell, or `gcloud auth application-default login`). FIRESTORE_EMULATOR_HOST
// targets the emulator. Build first: npm --prefix functions run build
//
// Usage:
//   node moderate.mjs list --project <id>
//   node moderate.mjs hide    <postId>    --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs restore <postId>    --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs delete  <postId>    --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs close   <requestId> --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs strip-legacy-reports --project <id> [--apply --operator <name>]
//
//   restore on a hidden post = move it back + notify the author; on a visible
//   queued post = acknowledge (it stays up and is never auto-hidden again).

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const TARGETED = new Set(['hide', 'restore', 'delete', 'close']);
const COMMANDS = new Set([...TARGETED, 'list', 'strip-legacy-reports']);
const USAGE = `usage: node moderate.mjs <list|hide|restore|delete|close|strip-legacy-reports> [id] --project <id> [--apply --operator <name>] [--note <text>]
  every mutating command is a DRY RUN unless --apply (with --operator) is given.
  first: npm --prefix functions run build   (this tool runs the compiled moderation code)`;

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) return { error: `unknown command: ${command ?? '(none)'}` };
  const opts = { command, apply: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--project') opts.project = rest[++i];
    else if (a === '--operator') opts.operator = rest[++i];
    else if (a === '--note') opts.note = rest[++i];
    else if (a === '--apply') opts.apply = true;
    else if (!a.startsWith('--') && TARGETED.has(command) && opts.target === undefined) opts.target = a;
    else return { error: `unknown argument: ${a}` };
  }
  if (!opts.project || opts.project.startsWith('--')) return { error: 'missing --project' };
  if (TARGETED.has(command) && !opts.target) return { error: `${command} needs an id` };
  if (command === 'list' && opts.apply) return { error: 'list is read-only' };
  if (opts.apply && (!opts.operator || opts.operator.startsWith('--'))) return { error: '--apply requires --operator <name>' };
  return { opts };
}

/** Control characters out, length bounded: queue text is attacker-supplied. */
export function safeText(v, max = 120) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function describe(db, cmd, id) {
  if (cmd === 'close') {
    const r = await db.collection('takedown_requests').doc(id).get();
    if (!r.exists) return `NOT FOUND (${safeText(id, 60)})`;
    return r.get('status') === 'closed' ? 'NOTHING TO DO (already closed)' : `WOULD CLOSE takedown request ${safeText(id, 60)}`;
  }
  const [p, h, q] = await Promise.all(['posts', 'hidden_posts', 'moderation_queue'].map((c) => db.collection(c).doc(id).get()));
  if (!p.exists && !h.exists) return `NOT FOUND (${safeText(id, 60)})`;
  const doc = p.exists ? p : h;
  const label = `${safeText(id, 60)} "${safeText(doc.get('title') ?? q.get('postTitle'))}" by ${safeText(doc.get('authorId'), 40)}`;
  switch (cmd) {
    case 'hide': return p.exists ? `WOULD HIDE ${label} (author notified)` : `NOTHING TO DO (${safeText(id, 60)} is already hidden)`;
    case 'restore': return h.exists
      ? `WOULD RESTORE ${label} (hidden -> visible, author notified, its hiders discredited)`
      : `WOULD ACKNOWLEDGE ${label} (stays visible, auto-hide off)`;
    default: return `WOULD DELETE ${label} (${p.exists ? 'visible' : 'hidden'}; files removed by the trigger; credits kept)`;
  }
}

async function main() {
  const { opts, error } = parseArgs(process.argv.slice(2));
  if (error) {
    console.error(`${error}\n${USAGE}`);
    process.exit(2);
  }
  const fnRequire = createRequire(new URL('../functions/package.json', import.meta.url));
  let mod;
  try {
    mod = fnRequire('./lib/moderation.js');
  } catch {
    console.error('functions/lib/moderation.js not found: run `npm --prefix functions run build` first');
    process.exit(2);
  }
  const { initializeApp, applicationDefault } = fnRequire('firebase-admin/app');
  const { getFirestore, FieldValue } = fnRequire('firebase-admin/firestore');

  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  console.log(`project: ${opts.project}  target: ${emulator ? 'EMULATOR' : 'LIVE'}  mode: ${opts.apply ? `APPLY as ${safeText(opts.operator, 50)}` : 'DRY RUN'}`);
  initializeApp({ projectId: opts.project, credential: applicationDefault() });
  const db = getFirestore();

  if (opts.command === 'list') {
    const { queue, requests } = await mod.listQueue(db, 200);
    console.log(`QUEUE (${queue.length})`);
    for (const q of queue) {
      console.log(`  ${q.priority === 'takedown' ? 'TAKEDOWN' : 'report  '} ${q.status.padEnd(8)} ${safeText(q.postId, 60)}`
        + ` reports=${q.reportCount} counted=${q.countedReports} hiddenBy=${q.hiddenBy ?? '-'}`
        + ` review=${q.needsReview ? 'yes' : 'no'} "${safeText(q.postTitle)}"`);
    }
    console.log(`OPEN TAKEDOWN REQUESTS (${requests.length})`);
    for (const r of requests) {
      const ids = (Array.isArray(r.postIds) ? r.postIds : []).map((x) => safeText(x, 60)).join(', ');
      console.log(`  ${safeText(r.id, 40)} ${r.verified ? 'verified' : 'UNVERIFIED'} ${safeText(r.role, 20)}`
        + ` ${safeText(r.requesterName, 40)} <${safeText(r.contactEmail, 80)}> posts=[${ids}]`);
      console.log(`    ${safeText(r.description, 300)}`);
    }
    return;
  }

  if (opts.command === 'strip-legacy-reports') {
    let n = 0;
    for (const c of ['posts', 'hidden_posts']) {
      for (const d of (await db.collection(c).get()).docs) {
        if (d.get('reports') === undefined) continue;
        n++;
        const len = Array.isArray(d.get('reports')) ? d.get('reports').length : '?';
        console.log(`${opts.apply ? 'STRIP' : 'WOULD STRIP'} ${c}/${safeText(d.id, 60)} reports (${len} entries)`);
        if (opts.apply) await d.ref.update({ reports: FieldValue.delete() });
      }
    }
    console.log(`totals: candidates=${n} stripped=${opts.apply ? n : 0}`);
    console.log(opts.apply ? 'done' : 'done (dry run: nothing written)');
    return;
  }

  if (!opts.apply) {
    console.log(await describe(db, opts.command, opts.target));
    console.log('done (dry run: nothing written)');
    return;
  }
  const fn = { hide: mod.hidePost, restore: mod.restorePost, delete: mod.removePost, close: mod.closeTakedown }[opts.command];
  const out = await fn(db, opts.target, { operator: opts.operator, note: opts.note ?? '' });
  console.log(`${opts.command.toUpperCase()} ${safeText(opts.target, 60)}: ${JSON.stringify(out)}`);
  console.log('done');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`FAILED: ${e.code ?? ''} ${e.message}`); process.exit(1); });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tools/test_moderate.sh`
Expected: PASS — `moderate pure: OK`, then `listcheck`, `still-hidden`, `restored`, `deleted`, `closed`, `reports-kept`, `reports-stripped` each print `assertions passed`; `delete nope` exits non-zero (`FAILED: not-found …`), which the `!` expects.

- [ ] **Step 5: Commit**

```bash
git add tools/moderate.mjs tools/test_moderate_fixture.mjs tools/test_moderate.sh
git commit -m "feat(tools): moderate.mjs — list/hide/restore/delete/close/strip-legacy-reports, dry-run default, audited"
```

---

## Deploy (2A + 2B together — order-dependent, do NOT improvise)

**This section supersedes the Deploy section of the 2A plan.** 2A has never been deployed; both plans ship in this one sequence. **Nothing here is run from the implementation environment.** The USER runs every step on their own machine (PowerShell 5.1: every command is one line, no `&&`, no `\` continuations; `;` chains). `gcloud` steps need the user's owner login (`gcloud auth login`); the migration, the backfill and the moderation CLI need Application Default Credentials — a freshly created service-account key in `$env:GOOGLE_APPLICATION_CREDENTIALS` (delete it afterwards), or `gcloud auth application-default login` with the owner account (then `gcloud auth application-default set-quota-project kyodai-sns`).

**Requirements:** the **Blaze plan**. The first functions deploy may ask about an **Artifact Registry cleanup policy** — accept (e.g. delete images older than 1 day).

```
PRE. From the repo root (PowerShell): npm --prefix functions ci; npm --prefix functions run build; flutter build web --release
     (the web build happens NOW so the old-client window in step 3 is as short as possible), then run every suite (Git Bash):
     bash tools/test_functions.sh (146) ; bash tools/test_rules.sh (127) ; bash tools/test_storage_rules.sh (6) ;
     bash tools/test_migrate_storage.sh ; bash tools/test_backfill_course_stats.sh ; bash tools/test_moderate.sh ;
     flutter analyze (22 issues) ; flutter test (107)

0. (2A) Read-only audit before anything is deployed: in the Firebase console (Firestore -> requests) note docs
   with isFulfilled == true or fulfilledPostId set that no real fulfilment produced; clear the bogus ones
   (isFulfilled false, fulfilledPostId null) after step 3.

1. Indexes first (2A credits_ledger + 2B notifications):
   firebase deploy --only firestore:indexes --project kyodai-sns
   # WAIT until BOTH composite indexes read "Enabled" in the console: the マイページ ledger and the お知らせ
   # queries fail FAILED_PRECONDITION until then.

2. USER (PowerShell), signed URLs without a key file (2A):
   gcloud services enable iamcredentials.googleapis.com --project kyodai-sns

3. ONE command for ALL functions and rules (2A + 2B):
   firebase deploy --only functions,firestore:rules,firestore:indexes,storage --project kyodai-sns
   # Deploys claimWelcomeCredits, downloadResource, reportPost, submitTakedown (callables) and onPostCreated,
   # onPostDeleted, onHiddenPostDeleted, onPostWritten, onReviewCreated, onReviewWritten (triggers).
   # Why one command: the new rules deny the client's course_stats writes and posts.reports writes at the same
   # moment onReviewWritten/onPostWritten and reportPost take over; and (2A) onPostCreated must never run against
   # the old requests rule. First functions deploy: accept the API prompts (Cloud Functions, Cloud Build,
   # Artifact Registry, Eventarc, Cloud Run, Pub/Sub). A Firestore trigger can fail the first time with an
   # Eventarc permission-propagation error: wait ~3 minutes and re-run the same command (idempotent).

4. USER (PowerShell), IMMEDIATELY after the first functions deploy (2A) — or downloadResource fails with
   "iam.serviceAccounts.signBlob" denied. ONE line:
   gcloud iam service-accounts add-iam-policy-binding 932624635949-compute@developer.gserviceaccount.com --member="serviceAccount:932624635949-compute@developer.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator" --project kyodai-sns

5. USER (PowerShell) — storage migration (2A), with credentials set explicitly:
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\key.json"
   Set-Location C:\path\to\kyoto-hub\tools
   npm install
   node migrate_storage.mjs --project kyodai-sns
   node migrate_storage.mjs --project kyodai-sns --apply
   # Dry run first (default), then the real run. Old root objects stay (no --delete-old yet).
   # DO NOT open migrated resources/... objects in the console Storage browser (it mints a new token).

6. Deploy hosting IMMEDIATELY after step 5 (the migration removed fileUrls, which breaks the OLD client; the old
   client also cannot report, write stats or list everyone's talk rooms under the new rules). The web build was made
   in PRE; if any source changed since, run flutter build web --release first.
   firebase deploy --only hosting --project kyodai-sns

7. USER (PowerShell, same session, still in tools) — 2B data steps, AFTER the hosting deploy:
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\key.json"
   node backfill_course_stats.mjs --project kyodai-sns
   node backfill_course_stats.mjs --project kyodai-sns --apply
   # Review the dry run first. If it listed ORPHAN rows and you agree they are junk:
   node backfill_course_stats.mjs --project kyodai-sns --apply --prune-orphans
   node moderate.mjs strip-legacy-reports --project kyodai-sns
   node moderate.mjs strip-legacy-reports --project kyodai-sns --apply --operator owner
   # Recounts every course with the trigger's code (erases client-forged aggregates) and removes the old
   # posts.reports arrays (they exposed reporter uids). Both are idempotent; strip-legacy-reports exits non-zero
   # if any document failed (re-run it) and writes one audit row per --apply run.

8. Tell testers to reload the app TWICE (the first load is served by the old service worker, the second runs the new build).

9. After the smoke test and a day (USER, credentials set again; absolute path):
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\key.json"
   Set-Location C:\path\to\kyoto-hub\tools
   node migrate_storage.mjs --project kyodai-sns --apply --delete-old
   # Removes the redundant public root objects. Delete the key file afterwards.
```

**Day-to-day moderation (USER, PowerShell, credentials set, in `tools`, after `npm --prefix ..\functions run build`):** `node moderate.mjs list --project kyodai-sns` shows the queue (takedown priority first) and open takedown requests. Inspect a post (dry run): `node moderate.mjs restore <postId> --project kyodai-sns`. Act: `node moderate.mjs restore <postId> --project kyodai-sns --apply --operator <you>` / `delete …` / `hide …` / `close <requestId> …`. Reply to a takedown requester by e-mail from the address in the listing.

**Rollback:** redeploying the previous hosting build alone is not enough (rules are stricter). To roll back 2B fully: rebuild hosting from the 2A commit (`git checkout bc72fb0`, `flutter build web --release`, `firebase deploy --only hosting --project kyodai-sns`, then return to your branch), and restore the 2A rules with `git checkout bc72fb0 -- firestore.rules` followed by `firebase deploy --only firestore:rules --project kyodai-sns`; the Functions can stay. **Rolling back the rules re-opens client writes to `posts.reports`, which publishes reporter uids to every KU reader again** (the legacy arrays were stripped; new ones would start filling) and re-opens `course_stats` client writes. Posts hidden meanwhile remain in `hidden_posts` — restore them with `moderate.mjs restore` before rolling back, or they stay invisible.

## Manual E2E (production smoke test, after step 8 of the Deploy section; user + browser)

Run the 2A E2E (credits, signed download, upload, reviews, requests, direct-URL check, invitation) first, then:

1. **Report → hide:** with three different verified KU accounts (three different MAILBOXES — one mailbox counts once even across accounts, M-20), report the same test post (通報 → category → 送信). The first two see 「通報を受け付けました」; the third sees 「…非表示になりました」 and the post disappears for everyone (course feed and the author's マイページ). The same account reporting twice sees 「既にこの投稿を通報済みです」; the author's own flag shows 「自分の投稿は通報できません」.
2. **Author notice:** the author's マイページ bell shows a badge; お知らせ says the post was hidden and 獲得済みのクレジットはそのまま; the balance is unchanged; opening the screen clears the badge.
3. **Operator:** `node moderate.mjs list --project kyodai-sns` lists the post (`hidden`, `reports=3`); the dry run `restore` prints WOULD RESTORE; `--apply --operator owner` brings it back for everyone and the author gets a 「再び表示」 notice. Three more reports from three mailboxes that have not reported this post yet now leave it visible (`review=yes` in `list`).
4. **Takedown, signed out:** log out → 「担当教員・権利者の方へ」 on the login screen → submit with a test post id → 「削除依頼を受け付けました」 + 受付番号; the post stays visible; `list` shows the request as `UNVERIFIED` and the post as `TAKEDOWN`.
5. **Takedown, verified:** signed in (a different account than the author), report dialog → 「担当教員・権利者の方はこちら」 (post id prefilled) → submit → 「対象の資料を非表示にしました」; the post disappears; the author is notified.
6. **Delete:** `node moderate.mjs delete <postId> --project kyodai-sns --apply --operator owner` → the author gets 「削除されました」; in the Storage console the `resources/<uid>/…` file is gone (list the folder only — do not open files).
7. **Stats:** post a review on a course → within ~5 s its summary card and the さがす rankings reflect it. From the browser console as a signed-in user (as in 2A E2E step 8), a write to `course_stats/<any>` is permission-denied.
8. **Privacy:** a direct read of another user's `users/<uid>` and of a talk room you are not in is permission-denied; the 参考書 chat still works for both parties of a room; a third account no longer sees that room or its 「トークルームを開く」 button.

## Self-Review

**Spec coverage:**
- §4.2 / §4.3 「通報 → 閾値で非表示＋運営キュー」 → T3 (hide = move, queue), T4 (`reportPost`, threshold 3 distinct, M-2/M-3), T7 (rules), T10 (dialog), T12 (operator CLI). ✓
- §4.3 「担当教員・権利者の方はこちら」フォーム, 優先キュー, 即時削除 → T5 (`submitTakedown`: priority + immediate hide for verified KU, M-6), T10 (TakedownScreen, signed-out entry), T12 (`list` shows takedown first). ✓
- §4.3 「投稿者に通知」 → T3 (`notifications`, M-10), T7 (rules), T8/T10 (お知らせ + bell). ✓
- §4.3 「獲得済みクレジットは没収しない」 → no 2B path writes credits; asserted in T3 (remove), T4 (hide), T12 (restore). ✓
- §4.5.5 「集計ドキュメントを事前計算（onWrite Function）」 → T2 (`course_stats` recount triggers), T7 (client write denied), T9 (client stops writing), T11 (backfill). Ranking/search unchanged and still read `course_stats` (T7 pool-query test, T9 `getStats` test). ✓
- §4.5.3 「全て request.auth 必須… 当事者のみ」 → T7 (`users` own-only, `talk_rooms` participants-only, M-15). `ku_verified` claim → M-16 (SKIP, reason recorded). ✓
- §10 open items decided: 通報の閾値 (M-2), 管理画面 (M-5: CLI, no UI). ✓
- **Not in 2B (deliberate):** reporting *reviews* (spec §4.2 mentions it; no review report UI exists yet — the same `moderation_queue` shape extends to `reviews` later), push/e-mail notices, App Check, staff sign-in for immediate takedowns, an admin UI. Phase 3: chat sub-collections, textbook market.

**Invariants a mutation must break (Tasks → assertion):**
- distinct reporters, threshold exactly 3 — T4 "3rd DISTINCT reporter hides", "one account cannot reach the threshold alone"; `reportHideThreshold` pinned in T1.
- hide is a move, data unchanged, files kept — T3 deepEqual of `hidden_posts` vs original; `postDeleted.test` hide/restore keep files; T4 the same deepEqual.
- hidden post undownloadable, nothing charged — T3.
- no credit changes — T3 (remove: balance + ledger), T4 (hide: balance 7), T12 (restore: balance 7).
- discredit boundaries — T4 (3 does not count, 2 counts), T5 (2 does not hide, 1 hides), T3 (only counted reporters / only the takedown requester / nobody for operator hides).
- operator decision final — T4 (cleared post not re-hidden), T5 (cleared post not hidden).
- anonymous never hides — T5 signed-out / unverified; `verified` taken from the caller, not the payload — T5 last test.
- caps — T4 (11th report), T5 (4th takedown, 21st anonymous; verified not in the anonymous pool).
- notifications: one per transition, own-read, read-only flip — T3/T4 (count 1), T7 (rules).
- `course_stats` parity and overwrite — T2 + T9 shared fixture, T2 forged-doc test, T11 fixture; client write denied — T7.
- Admin-only collections — T7 `ADMIN_ONLY` loop + list test; catch-all test unchanged.
- users / talk_rooms tightening — T7; participant merge — T8.

**Dry-run of this plan before committing it:** every code block of Tasks 1–12 was applied to a scratch copy of `master-wf96b2` (not to the branch): `tsc` clean; `bash tools/test_functions.sh` 130/130 (146 after the final-review fixes); `bash tools/test_rules.sh` 125/125 (127 after them), and the same tests against the OLD rules fail exactly the 9 new ones; `bash tools/test_backfill_course_stats.sh` and `bash tools/test_moderate.sh` green; `flutter analyze` 22 issues (baseline 24 − 2, none new); `flutter test` 106/106; `flutter build web --debug` clean. Six mutations (`handlePostGone` ignoring `hidden_posts`, discredit `<` → `<=`, takedown hiding for unverified callers, rakutanScore `35` → `30`, restore not clearing `autoHide`, `postStatsSubjects` never skipping) each failed the intended tests.

**Placeholder scan:** none — every step has the full code or an exact edit target (Task 7's edits name each test to replace and give the replacement; Task 9/10 edits give the replacement code and the exact anchor).

**Type / name consistency:** callables `reportPost` / `submitTakedown` (T6) = `ModerationService` (T8) names; region `asia-east1` in `common.ts` and `ModerationService._liveInvoker`. Wire values `REPORT_CATEGORIES` (T4) = `ReportCategory.value` (T8), `TAKEDOWN_ROLES` (T5) = `TakedownRole.value` (T8), both asserted in T8. Report statuses `reported|hidden|duplicate|already_hidden` (T4) = `ReportOutcome` mapping (T8). Notification types `post_hidden|post_restored|post_removed` and id `mod_<postId>_<transitions>` (T3) = `AppNotification.message` switch (T8) and the CLI fixture (T12). Collections `hidden_posts`, `moderation_queue/{postId}/reports/{uid}`, `moderation_actors`, `moderation_meta/takedown_anon_<day>`, `takedown_requests`, `moderation_log` (field `target`), `notifications` are spelled identically in T3–T5, T7 rules/tests and T12. `MODERATION` limits (T1) = Dart `kReportMaxDetail` / `kTakedown*` (T8). `CourseStatsDoc` fields (T2) = `CourseStats.fromMap` keys; `statsRef` uses `reviewSlug` = `Review.slug`. `handlePostGone` (T3) is the only file remover wired in T6. `AppStore` gains a 5th ctor argument (T9) and `main.dart` passes it (T9 Step 7).

## Owner decisions to confirm

Each is implemented as the ruling says and can be reversed cheaply (the "Cost if wrong" column):

1. **M-1** hide = move to `hidden_posts` (vs a `hidden` flag + backfill).
2. **M-2** threshold **3** distinct reporters.
3. **M-3** strip the legacy `posts.reports` arrays instead of importing them as report docs.
4. **M-5** no admin UI in 2B; moderation via `tools/moderate.mjs` with project credentials.
5. **M-6** any verified `@st.kyoto-u.ac.jp` **student** can hide a post at once via the takedown form (capped, discreditable) — or restrict immediate hide to `@kyoto-u.ac.jp` staff (students → priority queue only).
6. **M-6 / M-18** whether to add a staff e-mail-link verification so a professor's own request hides immediately (today: their request is a priority entry handled by the operator).
7. **M-7** caps: 10 reports/user/day, 3 takedowns/user/day, 20 unverified takedowns/day in total; no per-IP limit; whether to add **App Check** to protect the anonymous form.
8. **M-8** an operator restore permanently disables automatic hiding for that post.
9. **M-9** discredit thresholds: 3 restored report-hides (reports stop counting), 2 restored takedown-hides (no immediate hide).
10. **M-10** in-app notices only (no push / e-mail), three types, no reason text.
11. **M-11 / M-12 / M-13** `course_stats` full recount on every relevant write; hidden posts excluded from post counts; `lastReviewAt` = newest current review.
12. **M-15** `users` own-only and `talk_rooms` participants-only reads.
13. **M-16** skip the `ku_verified` custom claim again.
14. Reports on **reviews** (spec §4.2) are deferred — confirm that posts-only is enough for the Phase 2 launch.
15. **M-20** moderation identity = mailbox (a re-signup with the same address cannot reset caps or discredit).
16. **M-7 / Task 5** at most 3 posts hidden at once per requester per day; the result is `{requestId, hidden, queued}`.
17. **M-21** hide + re-upload no longer re-earns the upload credit.
18. **Anonymous takedown pool exhaustion:** the 20/day unverified pool can be used up by anyone and the form then answers `resource-exhausted` with no fallback route. **DECIDED (owner): the error shows a contact e-mail** — one constant `kOperatorContactEmail` in `lib/config/contact.dart`, empty by default (then the error points to the お問い合わせ screen); the owner sets it before the release build. App Check is not added.
19. **DECIDED (owner) — legacy points:** the old `users.points` / `transactions` are abandoned, discarded and not converted; everyone gets +3 credits at verification (existing verified users claim it automatically at their first login after the deploy).
20. **DECIDED (owner) — existing posts:** the 5 production past-exam posts are reviewed by the owner before the storage migration; copyright-problematic ones are deleted with `moderate.mjs delete`, the rest are migrated.
21. **DECIDED (owner) — no uploader reward for migrated posts:** the migration writes with Admin privileges and rewrites existing documents, so `onPostCreated` never fires and their uploaders earn no credit.
22. **DECIDED (owner) — one-time in-app notice** 「ポイント制がクレジット制に変わりました」 at the first login after the deploy (flag `users/{uid}.policyNoticeV2SeenAt`, written by the client on the user's own doc).
23. **DECIDED (owner) — M-6 immediate hide stays as is:** a verified KU student's takedown hides the post at once (capped, discreditable).
