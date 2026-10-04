# Phase 3 — Textbook Market, Chat Subcollections & AppStore Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 教科書マーケット as its own bottom-nav tab — 譲る / 売る / 買いたい listings with course filter, free-word search, 「買いたい」 match notices, a 30-day 「まだ有効?」 cycle, reports, blind mutual ratings and a 受け渡し不履行 path to the operator — with **no money and no credits anywhere in the app**; rebuild chat as `talk_rooms/{id}/messages/{msgId}` with pagination, Function-owned room summaries and a user-run migration of the legacy arrays; and split the 896-line `AppStore` into feature repositories behind characterization tests, without behaviour change.

**Architecture:** Same `functions/` codebase as Plans 2A/2B (Firebase Functions v2, Node 22, `asia-east1`, `maxInstances: 10`; pure handlers `(db, …)` tested on the Firestore emulator, thin wrappers in `index.ts`). **Every market write is Function-owned**: listings, rooms, ratings, reports and blocks are written only by six callables (`createListing`, `updateListing`, `openListingChat`, `blockRoom`, `rateDeal`, `reportMarket`) and three triggers (`onListingCreated` → match notices, `onListingDeleted` → photo cleanup, `onTalkMessageCreated` → room summary). Clients write exactly two things in the market: a chat message (rules: participant, as themselves, server time, ≤ 1000 chars, room not blocked) and their own read marker. Identity for caps and reputation is the **mailbox** (`emailKey`, 2B M-20). Listing moderation reuses 2B's identity, daily cap, threshold and discredit counters with a separate Admin-only `market_queue`; chat problems become operator `market_cases`; `tools/moderate.mjs` gains five commands. Flutter: `MarketService` / `ChatService` (callables + reads), new `TextbookListing` / reworked `TalkRoom` models, `MarketScreen` (さがす / トーク / 自分の出品), `ListingFormScreen`, `ListingDetailScreen`, a rebuilt `TalkRoomScreen`; `AppStore` keeps session state and notices and delegates data access to `UserRepository` / `PostRepository` / `RequestRepository` / `InquiryRepository` (`FirestoreService` is deleted).

**Tech Stack:** TypeScript 5 / Node 22 / `firebase-functions` ^7 (v2 API) / `firebase-admin` ^14 / `node:test` on the Firestore emulator; Flutter 3.41.9 / Dart ^3.11.5 / `cloud_functions` ^6.5 / `fake_cloud_firestore`; `@firebase/rules-unit-testing` for Firestore and Storage rules.

**Spec:** `docs/specs/2026-09-07-kyodai-info-redesign-design.md` §4.1 (教科書 = 独立タブ), §4.4 教科書マーケット (出品タイプ・フィールド・一覧/マッチング・金銭/安全・30日・教科書以外禁止), §4.5.3 (`textbook_listings` / `chats`: 当事者のみ書込), §4.5.5 (チャットはサブコレクション＋ページネーション、`arrayUnion` 廃止、AppStore 分割), §6 Phase 3 (マーケット、チャット作り直し、機能的バイラル), §7 (出品シェア), §8 (risks), §10.

**Builds on Plans 2A and 2B — both implemented on `master-wf96b2`, NEITHER deployed.** Everything below assumes the code on this branch as of the commit that adds this plan (functions 146 tests, rules 127, storage rules 6, `flutter test` 107, `flutter analyze` 22 issues). 2A, 2B and 3 are deployed **together, once**, by the Deploy section of this plan, which **supersedes** the Deploy sections of `2026-10-03-phase2a-credits-private-resources.md` and `2026-10-04-phase2b-moderation-stats.md` (it contains every 2A and 2B step unchanged, in the same order, with the Phase 3 steps inserted).

**Commit as soon as a task is green.** The implementation container can restart and lose uncommitted work: each task ends with its own commit step — run it the moment the task's verification passes, before starting the next task. Never batch several tasks into one commit.

## Global Constraints

- Flutter `3.41.9`, Dart `^3.11.5`. **No new Dart dependency** (badges are Material's `Badge`, share is `Clipboard`, photos are `Image.network(webHtmlElementStrategy: WebHtmlElementStrategy.prefer)` from `firebase_storage`, already a dependency). No new npm dependency in `functions/` or `tools/`. Functions: Node `22`, TypeScript, `firebase-functions/v2/*` only, region **`asia-east1`** and `maxInstances: 10` on every function (the existing `opts` object in `index.ts`).
- **No money, no credits in the market** (spec §4.4, 2A abolished the 20pt settlement). `price` is information shown to the other party. No Phase 3 code path reads or writes `credit_balances` / `credits_ledger` (asserted in Task 2; `grep` in Task 7).
- Every document written by a Function carries `university_id: 'kyoto_u'`: `textbook_listings`, `talk_rooms`, `market_identities`, `market_actors`, `market_blocks`, `market_inbox`, `market_ratings`, `market_reputation`, `market_profiles`, `market_queue` (+ `reports`), `market_cases`, `notifications`, `moderation_log`, `moderation_actors`. Chat messages carry it too (rules pin it).
- Every market callable calls `requireKuVerified` (verified `@st.kyoto-u.ac.jp`). Identity for caps and reputation is `emailKey(token email)` (2B M-20), never the uid alone.
- Transactions do **every read before any write** (Firestore Admin requirement and the 2A/2B convention); recounts are full recounts (never increments) that read their aggregate doc first as a lock (2B M-11).
- Admin-only collections get an explicit `allow read, write: if false` block **and** a rules test. The catch-all `match /{document=**} { allow read, write: if false; }` stays LAST. `firestore.rules` stays start-anchored on the KU email pattern.
- **Tests must fail when an invariant is broken.** Boundaries are tested on both sides (5 listings ok / 6th refused; renew at exactly 7 days left ok / 7 days + ε refused; a rating at exactly 14 days counts / 13.9 does not; 1000-char message ok / 1001 refused; 2 MiB photo ok / +1 byte refused). The Self-Review lists the mutation checks that were run.
- Test commands. Functions: `bash tools/test_functions.sh` (it runs `node --test test/*.test.mjs` — Node 22 rejects a bare `test/` directory, keep the glob). Rules: `bash tools/test_rules.sh`, `bash tools/test_storage_rules.sh`. Tools: `bash tools/test_migrate_chats.sh` (new), `bash tools/test_moderate.sh` (extended), and the unchanged `bash tools/test_migrate_storage.sh`, `bash tools/test_backfill_course_stats.sh`. The emulator scripts export the Windows `JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"`; on the Linux implementation box that path is a symlink to a JDK 21 — **never edit the scripts for it**; new scripts copy the same two `export` lines verbatim.
- Flutter is at `/opt/tools/flutter/bin`: `export PATH=/opt/tools/flutter/bin:$PATH CI=true` in the implementation shell. `flutter analyze` baseline is **22 issues**; Task 12 deletes `textbook_lending_screen.dart` (one of them), so from Task 12 on it is **21** and must stay 21: no new lints. In new UI code do not use `RadioListTile.groupValue` or `DropdownButtonFormField.value` (deprecated in 3.41 → new info lints); use `ChoiceChip`s.
- Commit scope: `functions/` (never `functions/node_modules/` or `functions/lib/`), `lib/`, `test/`, `tools/` (never `tools/node_modules/`), `firestore*`, `firestore-tests/`, `storage.rules`, `docs/`. **Never** `.superpowers/`, never a service-account key.
- PowerShell 5.1 is the user's shell: every command in Deploy / Manual E2E is a single line, no `&&`, no bash `\` continuations (`;` chains).
- **Production side effects: none from the implementation environment.** No `firebase deploy`, no tool run with `--project kyodai-sns`, no `gcloud` against the project. The Deploy section is the user's runbook, run on the user's machine.

## Rulings (the plan decides; each can be reversed cheaply — every one is also listed under "Owner decisions to confirm")

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| T-1 | **The market replaces the 参考書リクエスト board.** `textbook_requests` becomes read-only (no client write; old docs stay as history, not migrated — ~22 test users); its screen and the マイページ tile are removed; 「貸す」 is not offered (spec: v1 見送り). A 「買いたい」 listing is the new request. | One way to ask for a book; the old board had no listing, no rating and a write rule that let any verified user flip any request (`allow update: if kuVerified()`). | Convert open requests into 買いたい listings with a 20-line loop in a tool |
| T-2 | **Every market write is Function-owned** (6 callables, 3 triggers). Clients write only chat messages and their own read marker. Listing ids are server-generated, `ownerId` = the caller. | Rules cannot count per day, cannot sanitize text and cannot keep a rating aggregate honest; a callable can, and it makes id/ownership forgery impossible by construction. | Callable latency (~300 ms) on create; a rules-guarded direct create is possible later for the hot path |
| T-3 | **Prices are information only.** 売る needs an integer 1–100000 (sanity bound); 定価 is optional and the "cap" is a **recommendation** (the form and the detail screen warn when price > 定価; nothing is refused); 譲る has no price; 買いたい may name a budget. No credits, no fees, no escrow; the UI says so on the form, the list, the detail screen and in every chat. | Spec §4.4: アプリは金銭を扱わない・定価が上限の推奨. Enforcing a cap would need a trusted 定価 we do not have. | Enforce `price <= listPrice` in `parseListingFields` (one line) |
| T-4 | **Listing fields:** type (`give`/`sell`/`want`), title 1–100 (one line, sanitized), description ≤ 1000, optional course (must exist; its name is copied from `courses`, never trusted from the client), condition (`like_new`/`good`/`fair`/`marked`, required for 譲る/売る), price per T-3, place from 8 presets, ≤ 3 photos. Title, type, course and photos are immutable after create; the owner may edit description, condition, price, 定価 and place. | Spec §4.4 field list. Immutable identity fields keep a match notice describing the same book. | Allow title edits (and re-run matching) |
| T-5 | **Photos:** Storage `listings/<uid>/<one flat name>`, created by a verified owner only, never overwritten or deleted by a client, JPEG/PNG/WebP only (no SVG), ≤ 2 MiB each; readable by any KU address; the app asks for a download URL at display time and never stores it; shown through an `<img>` element on the web (no bucket CORS change); deleted with the listing by `onListingDeleted` (owner-prefix guard). The form tells users not to photograph faces, IDs or addresses. | Textbook photos are low-sensitivity and must be seen by buyers; the same create-only/own-prefix/type/size pattern as 2A resources. A download URL is a bearer token, hence "private-ish": only a KU account can mint one. | Make them fully private behind a signed-URL callable like `downloadResource` (~60 lines) |
| T-6 | **Rate limits per MAILBOX per JST day:** 5 new listings, 10 new chats (re-opening an existing chat is free); listing reports share 2B's 10 reports/day counter (`moderation_actors`). No per-message limit (see the adversarial table). | Bounds spam listings, match-notice volume and cold-contact harassment; mailbox keys survive delete-account + re-signup (M-20). | Constants in `MARKET` |
| T-7 | **Search:** the course filter is a server-side equality query (indexed); type and free words filter client-side over the newest 100 live listings. | A few hundred live listings at KU scale; Firestore has no full-text search. | Title tokens + `array-contains`, or an external index, when listings exceed a few hundred |
| T-8 | **30-day expiry, lazily.** `expiresAt` = create (or renew) + 30 days; the list query hides expired listings instantly (`expiresAt > now`); renew is allowed in the last 7 days or after expiry and extends to now + 30 days; `openListingChat` refuses expired listings. The 「まだ有効?」 prompt is client-side, in 自分の出品, during the last 7 days. **No scheduled Function.** | No Cloud Scheduler API, no cron to test; expiry is exact to the second. In-app notices are only seen when the app is open anyway (no push, 2B M-10), and the prompt is shown exactly then. | An `onSchedule` Function writing `listing_expiring` notices (~40 lines + the Cloud Scheduler API) |
| T-9 | **買いたい matching:** a new 譲る/売る listing (`onListingCreated`) notifies the owners of live 買いたい listings with the same course or a matching title (NFKC-normalized containment, ≥ 4 characters); ≤ 20 recipients per offer; ≤ 10 match notices per recipient per JST day; one notice per (offer, recipient) (deterministic id ⇒ retry-safe); never the offer's own owner; never across a block. A new 買いたい triggers nothing (its owner sees the list). | Spec: 「買いたい」に合致する出品が出たら通知. The caps make offer-flooding useless as a spam channel. | Constants in `MARKET`; a fuzzier matcher |
| T-10 | **Mutual rating:** only the two parties of a market room in which **both** have sent a message (Function-owned `lenderSent`/`borrowerSent`); one rating per (room, side), ★1–5 + ≤ 60 chars, immutable (`tx.create`); the aggregate counts the **newest** rating per rater mailbox (a friend trading again and again counts once); the KU-readable summary `market_profiles/{uid}` (count, sum, 5 newest comments, no rater identity) is Function-written. | Spec: 取引後に相互評価（★＋一言）. Each guard closes a forgery or inflation path (no-deal ratings, double ratings, sock-puppet repetition, client-written averages). | Count every rating (drop the per-rater map) |
| T-11 | **Blind ratings:** a rating counts only once the other side has rated too (the second rating reveals both) or after 14 days; the recount is lazy (on `rateDeal`, `createListing` by the ratee, `openListingChat` on the ratee's listing). | Nobody can see a low score coming and retaliate. Lazy reveal needs no scheduler; a user whose reputation matters (listing, being contacted) triggers it. | Count immediately (one condition), or a nightly recount |
| T-12 | **Market identity = mailbox** (as 2B M-20): caps, rater/ratee keys and the reputation aggregate are keyed by `emailKey`; Admin-only `market_identities/{uid}` maps a uid to its key; a re-signup with the same address gets its reputation back on its first market call. | Delete-account + re-signup must not reset reputation or caps. | Key by uid (one helper) |
| T-13 | **Impersonation:** names come only from Function-sanitized fields — `listing.ownerName`, `room.lenderName`/`borrowerName` (controls and bidi overrides stripped, ≤ 30 chars, operator-looking names such as 運営/公式/admin/InfoHub become 「京大生」); chat messages carry **no name** (rules `keys().hasOnly`) and the screen takes names from the room; listings show 「認証済み京大生」 and the rating summary. | `users.displayName` is owner-writable free text. | Allow names on messages again (rules + model) |
| T-14 | **Chat = `talk_rooms/{id}/messages/{msgId}`.** Rooms are created only by `openListingChat` (one per listing × requester, id `l_<listingId>_<uid>`). The room keeps 2B's `lenderId`/`borrowerId` (meaning "listing owner side" / "requester side") so 2B's participant read rule and the two participant queries stay valid; the old `messages` array is frozen by the rules and moved by `tools/migrate_chats.mjs`. Messages are immutable (no edit, no delete). | Spec §4.5.5: no 1 MiB array, no `arrayUnion` lost-update race, pagination. Renaming the fields would need a second migration and new indexes for no protection gain. | Rename to `ownerId`/`requesterId` with a migration |
| T-15 | **Contact-info warning:** the form and the chat input warn (not block) when the text looks like a phone number, an e-mail address or a LINE ID; the copy asks for meetings in public places. | Spec risk: personal data in public listings; blocking would push people to obfuscate. | Block on the server (regex in `parseListingDraft`) |
| T-16 | **Pagination:** the newest 30 messages live; older pages of 30 on demand (`createdAt < oldest shown`). | Bounded reads per room open. | `ChatService.pageSize` |
| T-17 | **Block:** either party ends the room for both (`closedBy`, Function-written; the message create rule refuses a closed room) and records `market_blocks/{blocker}_{blocked}`: no new chat between them in either direction, no match notices across it. Irreversible in the app (an operator can delete the block doc). | A minimal, immediate self-defence against harassment that needs no operator. | Add an unblock callable |
| T-18 | **Room summary by trigger, read marker by client.** `onTalkMessageCreated` writes `lastMessageText` (≤ 80), `lastMessageAt`, `lastSenderId` (monotonic: an older message processed late never wins) and `lenderSent`/`borrowerSent`. A participant may write only their own `lenderReadAt`/`borrowerReadAt`, and only `== request.time`. Unread = the other party's last message is newer than my marker. | A client-written summary would let a participant forge a preview of words the other never sent, and fake the "both spoke" condition that unlocks rating. | Client batch write of message + summary with `getAfter()` rules |
| T-19 | **Listing reports reuse 2B:** one report per (listing, mailbox) under Admin-only `market_queue/{listingId}/reports/{emailKey}`; 3 distinct counted reporters hide the listing (M-2), the 10/day cap (M-7), operator-cleared ⇒ never auto-hidden again (M-8), discredit on restore (M-9), all via `moderation_actors` and `moderation_log`. Hide is a **status flip** (`hidden`) in place — safe here because no client can write a listing — and a hidden listing is readable by its owner only (rules). The owner gets `listing_hidden`/`_restored`/`_removed` notices. | Spec: 通報. One moderation identity and one cap across posts and listings; no `hidden_*` copy needed. | A separate cap/threshold (constants) |
| T-20 | **受け渡し不履行 and harassment = cases, not sanctions.** A participant files `reportMarket {kind:'room'}` (harassment / no_show / fraud / other) → Admin-only `market_cases/{roomId}_{side}` (one open case per side), harassment/fraud high priority; the operator reads the room in the console, acts (e.g. disables the account in Firebase Authentication — 2B M-16) and closes it with `moderate.mjs case-close`. No automatic penalty, no rating effect. | Spec: 「受け渡し不履行」報告 → 運営対応. Automatic sanctions from one party's word would be a retaliation tool. | Auto-hide a user's listings after N closed-as-valid cases |
| T-21 | **Only operators delete listings;** owners close them (status `closed`). `onListingDeleted` removes the photos (owner prefix only). | Keeps rating/report history attached to a stable id. | Owner delete via `updateListing` + the same trigger |
| T-22 | **Viral bits:** listing share = copy a text (type, title, course, price label, app URL; no owner name, no deep link — the app has no routes). **Timetable share is DEFERRED:** timetables are private (`user_timetables` own-only, 2A/2B) and sharing needs a public snapshot doc (new rules + privacy copy) or an image export (a new dependency). | Spec §6/§7 機能的バイラル, "only if cheap": the listing text is 20 lines; the timetable is not cheap. | Timetable share = a later small plan (snapshot doc `timetable_shares/{id}` + read rule) |
| T-23 | **AppStore split without behaviour change:** first two seams (FirebaseAuth resolved lazily; the Firestore instance injectable) and 14 characterization tests that pin today's behaviour; then data access moves verbatim into `UserRepository`, `PostRepository`, `RequestRepository`, `InquiryRepository` and `FirestoreService` disappears; market/chat code lives in `MarketService`/`ChatService`. `AppStore` stays the façade (session state + notices) so no view changes for the split; `CreditService`/`ModerationService`/`ReviewService`/`RankingService` are untouched. | Spec §4.5.5 (priority 中). Moving data access is mechanical and test-guarded; reshaping the views' API is not needed to get the testable seams. | Extract an auth/session controller next |
| T-24 | **Legacy chat migration:** deterministic ids `legacy_NNNN`, only the four allowed fields (names dropped), offset-less legacy times read as **JST**, history marked read, the array deleted in the same batch as the last messages (a crash leaves a re-runnable room), dry-run default, `--project` required. | Same safety style as `migrate_storage.mjs`; the Dart client wrote local time without an offset. | Re-run after a fix (idempotent) |

Resolved 2B rulings carried forward: **M-15** (participant-only rooms — unchanged, now also for messages), **M-16** (still no custom claim; bans = disable the account), **M-20** (mailbox identity — extended to the market).

## Adversarial surfaces → mitigations → tests

| Surface | Attack | Mitigation | Test (task) |
|---|---|---|---|
| Spam listings | A script creates hundreds of listings | Callable only (rules deny client writes), 5/day per mailbox (survives re-signup), 30-day expiry, report-hide at 3 | listings "6th listing…" (T2); rules "no client writes" (T8); marketModeration "3rd reporter hides" (T6) |
| Non-textbook goods | Sells tickets, clothes, … | 教科書以外禁止 copy + `not_textbook` report category → threshold hide | marketModeration (T6) |
| Listing id / ownership forgery | Payload carries `ownerId`/`status`/`id`; edits someone else's listing | Whitelisted draft, server id, `ownerId` = caller; update checks the owner; rules deny every client write | listings whitelist + "only the owner" (T2); rules (T8); mutation "owner forgery" |
| Match-notice flooding | Many offers to spam a 買いたい owner | ≤ 20 recipients/offer, ≤ 10 notices/recipient/day, deterministic ids, 5 listings/day, blocks suppress | listingMatch caps + block tests (T3) |
| Rating forgery / inflation | Rate without a deal; rate twice; friend trades repeatedly; write the profile | `lenderSent`/`borrowerSent` are Function-owned; one create-only rating per (room, side); newest per rater mailbox; profiles Function-only | ratings (T5); rules `market_profiles` (T8) |
| Retaliation | See a low score coming and answer with one | Blind until both rated or 14 days; immutable; comments without rater identity | ratings T-11 tests (T5) |
| Reputation / cap reset | Delete account, re-sign-up | Mailbox keys + `market_identities` | ratings T-12, listings re-signup cap (T2, T5) |
| Chat harassment | Abusive messages, repeated cold contact | Block (room closed both ways, no new rooms, no notices), case to the operator, 10 new rooms/day | chat block (T4); rules closed room (T8); cases (T6) |
| Message flooding / cost | Thousands of messages in one room | ≤ 1000 chars, block ends it; **accepted residual:** no per-message rate limit in rules | rules bounds (T8) |
| Message forgery | Send as the other party, backdate, inject a name, rewrite or delete history, spoof the preview | Rules: `senderId == uid`, `createdAt == request.time`, `keys().hasOnly([...])`, no update/delete; summary Function-owned | rules messages (T8); chat summary (T4) |
| Impersonation | Display name 「運営」, bidi tricks | `displayNameFor`; names only from the room / listing | marketCore + listings (T1, T2); talk_room model (T12) |
| Private room enumeration | Guess `l_<listing>_<uid>` ids | Participant-only reads; a missing and a foreign room are denied identically; messages check the parent's parties | rules messages + 2B room-read tests (T8) |
| Hidden-listing leakage | Query `status == 'hidden'` | Hidden listings readable by the owner only | rules (T8) |
| Photo abuse | Huge files, SVG/HTML, another user's prefix, overwrite, a forged path list that makes cleanup delete someone else's file | Storage rules (2 MiB, png/jpeg/webp, own prefix, create-only); draft accepts only own flat paths; cleanup prefix guard | storage (T8); listings draft (T2); cleanup (T6) |
| Stale listings | Dead listings forever | `expiresAt` + query; renew window; expired listings refuse new chats | listings renew (T2); chat (T4); MarketService stream (T11); market screen (T13) |
| Legacy client writes | An old cached client appends to `messages` | Rules freeze the array; the migration removes it | rules (T8); migrate fixture (T14) |
| Operator terminal injection | ESC sequences in titles / case details | `safeText` | moderate market `listcheck` (T15) |
| Oversharing | Phone number in a public listing | Warnings in form and chat | MarketService + widget tests (T11, T13) |

## Amendments made in review (authoritative over the code blocks below)

**Final review, fix round 1 (committed after Tasks 1-15):** `processBlockRoom` closes every `talk_room` between the two users (both orderings, bounded, idempotent) and `firestore.rules` refuses a message when `market_blocks/{lender}_{borrower}` or the reverse exists; the chat screen switches its live stream to `createdAt >= oldest shown` after the first older page (`ChatService.streamSince`), so no message disappears; the chat length limit is counted in runes everywhere and a refused send shows a notice; the read marker is written once per last message; `MarketException.notice` has specific texts for `rating-closed`, `own-listing`, `legacy-room`, `self`, `not-active`, `expired`; `storage.rules` allows `get` (not `list`) on `listings/**`; `migrate_chats.mjs` skips legacy entries from non-participants (`foreign-senders`); the client photo name collapses `..`. Final counts: functions 220, rules 137, storage rules 9, `flutter test` 172, `flutter analyze` 21.

Round 1 fixes, implemented in `functions/` with tests (the code blocks in Tasks 1-7 below are the ORIGINAL text; where they differ, this note and the committed code win):

- **I-1** `rateDeal` verifies inside its transaction that `roomId === roomIdFor(listingId, borrowerId)` and that the listing exists with `ownerId === lenderId` (an operator-removed listing falls back to the `market_queue/{listingId}` tombstone's `ownerId`); anything else is `legacy-room`. `roomIdFor` moved to `marketCore.ts` (re-exported from `chat.ts`). `handleMessageCreated(db, roomId, msg, now?)` ignores a stored `lastMessageAt` more than 60 s in the future.
- **I-2** Blocks are stored twice: `market_blocks/{blockerUid}_{blockedUid}` (operator) and `market_blocks/mb_{blockerKey}_{blockedKey}` (mailbox, `mailboxBlockRef`). `processOpenChat` and `handleListingCreated` check all four directions/keys; a re-signup does not shed a block.
- **I-3** `rateDeal` refuses `failed-precondition 'rating-closed'` when the other side's rating is >= 14 days old (13.9 days accepted, exactly 14 refused).
- **I-4** The 買いたい match query adds `where('expiresAt','>',now).orderBy('expiresAt','desc')`; **Task 8's `firestore.indexes.json` gains** `textbook_listings: type ASC, status ASC, expiresAt DESC` (already committed in `firestore.indexes.json`; Task 8 must keep it).
- **I-5** `sanitizeLine`/`sanitizeText` strip `\p{Cc}`, `\p{Cf}` and the blank fillers U+3164/U+115F/U+1160/U+2800 (tab and newline are kept for folding); `displayNameFor` compares after NFKC and removing whitespace and Cf, and 運營 joins the reserved list; an invisible-only title is rejected.
- **Minor** M-1/M-2 reputation recounts in `openListingChat` (only when a room was created) and `rateDeal` are best-effort; M-3 slices by code point (`clip`); M-4 re-filing after a closed case writes a NEW case `{roomId}_{side}_{n}` and never touches the closed one (duplicate = any open case of that reporter in that room); M-5 `removeListing` is idempotent (`{changed:false}` via the `removed` tombstone); M-6 titles match only if the shorter is >= 50% of the longer; M-7 own-listing and self-rating compare the mailbox key too (`reportMarket` as well).
- **Task 14 (`migrate_chats`) MUST** reset `lastMessageText`/`lastMessageAt`/`lastSenderId`, `lenderSent`/`borrowerSent` and every listingId-derived claim on EVERY room that existed before the deploy (not only rooms with a `messages` array): pre-deploy rooms were client-writable and must not be trusted — the fixture's `new1` room that keeps `listingId: 'L'` must be reset too, and pre-deploy rooms never unlock a rating until real post-deploy messages set the flags.
- **Rulings:** T-17 now says "block by uid AND mailbox"; T-10 gains "rating refused once the other side's is 14 days old"; no new T-numbers.

## Existing data decisions (owner, final)

- **Legacy points are abandoned.** `users.points` and the old `transactions` ledger are not read, converted or migrated; the old points were discarded. Everyone gets **+3 credits** when verified, and existing verified users claim it automatically at their first login after the deploy (`claimWelcomeCredits`, once per mailbox).
- **Migrated past exams earn their uploaders NO credit.** The storage migration rewrites existing `posts` documents with Admin privileges; it does not create documents, so `onPostCreated` (the only upload-credit path) never fires for them.
- **Existing posts are reviewed first.** The 5 production past-exam posts are reviewed by the owner (Deploy step PRE-2) and any copyright-problematic ones are deleted with `moderate.mjs delete` before the storage migration.
- **One-time in-app notice.** At the first login after the deploy a verified user sees 「ポイント制がクレジット制に変わりました」 once (old points ended and were not converted, +3 credits at registration/verification, 1 credit per download, link to the credit-rules dialog). The flag is `users/{uid}.policyNoticeV2SeenAt`, written by the client on the user's own document (the `users` rule allows the owner's write; `notifications` are Function-owned). Brand-new accounts are marked seen at creation. A failed flag write never blocks or loops (the notice stays closed for the session).
- **Operator contact.** `lib/config/contact.dart` `kOperatorContactEmail` ships empty; set it before the release build (PRE checklist). Takedown form, daily pool exhausted: with an address the error shows 「こちらのメールからご連絡ください: <address>」 (selectable), without one 「お問い合わせ画面からご連絡ください」.

## File Structure

**Created**
- `functions/src/marketCore.ts` — `MARKET`, `LISTING_TYPES`, `BOOK_CONDITIONS`, `HANDOFF_PLACES`, `MarketCaller`, refs (`listingRef`, `roomRef`, `identityRef`, `marketActorRef`, `blockRef`), `DAY_MS`, `sanitizeLine`, `sanitizeText`, `normalizeTitle`, `displayNameFor`, `callerKey`, `keyFromIdentity`, `millisOf`, `intOrNull`, `isLive`
- `functions/src/listings.ts` — `parseListingFields`, `parseListingDraft`, `processCreateListing`, `processUpdateListing`
- `functions/src/listingMatch.ts` — `titlesMatch`, `listingsMatch`, `matchNoticeId`, `handleListingCreated`
- `functions/src/chat.ts` — `roomIdFor`, `ROOM_WARNING`, `processOpenChat`, `processBlockRoom`, `handleMessageCreated`
- `functions/src/ratings.ts` — `ratingRef`, `reputationRef`, `profileRef`, `aggregateRatings`, `refreshReputation`, `processRateDeal`
- `functions/src/marketModeration.ts` — report categories, `processMarketReport`, `hideListing`, `restoreListing`, `removeListing`, `closeCase`, `listMarketQueue`, `handleListingDeleted`
- `functions/testlib/market.mjs`; `functions/test/{marketCore,listings,listingMatch,chat,ratings,marketModeration}.test.mjs`
- `lib/repositories/{user,post,request,inquiry}_repository.dart`
- `lib/models/textbook_listing.dart`, `lib/services/market_service.dart`, `lib/services/chat_service.dart`
- `lib/views/market/{market_screen,listing_form_screen,listing_detail_screen}.dart`
- `test/support/store_harness.dart`, `test/services/app_store_test.dart`, `test/repositories/feature_repositories_test.dart`, `test/models/{textbook_listing,talk_room}_test.dart`, `test/services/{market_service,chat_service}_test.dart`, `test/views/{talk_room_screen,listing_form_screen,market_screen}_test.dart`
- `tools/migrate_chats.mjs`, `tools/test_migrate_chats.sh`, `tools/test_migrate_chats_fixture.mjs`, `tools/test_moderate_market_fixture.mjs`

**Modified**
- `functions/src/index.ts`; `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `firestore-tests/rules.test.mjs`, `firestore-tests/storage.test.mjs`
- `lib/services/app_store.dart`, `lib/models/talk_room.dart`, `lib/services/talk_room_queries.dart`, `lib/models/app_notification.dart`, `lib/views/textbook/talk_room_screen.dart` (rewritten), `lib/views/navigation_root_screen.dart`, `lib/views/mypage/my_page_screen.dart`, `lib/views/notifications/notifications_screen.dart`, `lib/views/contact/contact_screen.dart`, `lib/views/onboarding/onboarding_screen.dart`
- `test/services/talk_room_queries_test.dart`, `test/models/app_notification_test.dart`
- `tools/moderate.mjs`, `tools/test_moderate.sh`, `tools/README.md`

**Deleted**
- `lib/services/firestore_service.dart` (Task 10 empties it into the repositories; Task 12 removes the rest), `lib/views/textbook/textbook_lending_screen.dart`, `lib/models/textbook_request.dart` (T-1)

**Unchanged on purpose:** `lib/main.dart` (the new `AppStore` parameters are optional and default to the live instances), `CreditService`, `ModerationService`, `ReviewService`, `RankingService`, every 2A/2B Function.

---

### Task 1: Market core — limits, wire values, text helpers, refs

**Files:**
- Create: `functions/src/marketCore.ts`, `functions/test/marketCore.test.mjs`

**Interfaces:**
- Consumes: `emailKey` (common.ts, 2B).
- Produces (`marketCore.ts`):
  - `MARKET` (`listingDailyCap: 5, roomDailyCap: 10, listingDays: 30, renewWindowDays: 7, maxTitle: 100, maxDescription: 1000, maxPhotos: 3, maxPrice: 100000, maxMessage: 1000, maxComment: 60, maxDisplayName: 30, matchMaxRecipients: 20, matchNoticeDailyCap: 10, matchMinLength: 4, ratingRevealDays: 14, recentComments: 5, previewLength: 80`)
  - `LISTING_TYPES = ['give','sell','want']`, `BOOK_CONDITIONS = ['like_new','good','fair','marked']`, `HANDOFF_PLACES` (8 keys), types `ListingType`, `ListingStatus`, `interface MarketCaller { uid: string; email: string }`
  - refs `listingRef`, `roomRef`, `identityRef` (`market_identities/{uid}`), `marketActorRef` (`market_actors/{emailKey}`), `blockRef(db, blocker, blocked)` (`market_blocks/{blocker}_{blocked}`); `DAY_MS`
  - `sanitizeLine(v): string`, `sanitizeText(v): string`, `normalizeTitle(v): string`, `displayNameFor(v): string`, `callerKey(caller): string` (throws `permission-denied` without an email), `keyFromIdentity(snap, uid): string` (`uid:<uid>` fallback), `millisOf(v): number`, `intOrNull(v): number | null`, `isLive(doc, now): boolean`

- [ ] **Step 1: Write the failing test**

Create `functions/test/marketCore.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET, LISTING_TYPES, BOOK_CONDITIONS, HANDOFF_PLACES, sanitizeLine, sanitizeText, normalizeTitle, displayNameFor,
  callerKey, keyFromIdentity, isLive,
} from '../lib/marketCore.js';
import { emailKey } from '../lib/common.js';

test('market limits and wire values match the Plan 3 rulings (T-3, T-6, T-8, T-9, T-11)', () => {
  assert.deepEqual({ ...MARKET }, {
    listingDailyCap: 5, roomDailyCap: 10, listingDays: 30, renewWindowDays: 7, maxTitle: 100, maxDescription: 1000,
    maxPhotos: 3, maxPrice: 100000, maxMessage: 1000, maxComment: 60, maxDisplayName: 30, matchMaxRecipients: 20,
    matchNoticeDailyCap: 10, matchMinLength: 4, ratingRevealDays: 14, recentComments: 5, previewLength: 80,
  });
  assert.deepEqual([...LISTING_TYPES], ['give', 'sell', 'want']);
  assert.deepEqual([...BOOK_CONDITIONS], ['like_new', 'good', 'fair', 'marked']);
  assert.deepEqual([...HANDOFF_PLACES], ['clock_tower', 'coop_central', 'library', 'yoshida_south', 'north_campus', 'katsura', 'uji', 'other']);
});

test('sanitizeLine strips controls and bidi overrides, collapses whitespace, never throws on garbage', () => {
  assert.equal(sanitizeLine('  線形代数\t\n入門  '), '線形代数 入門');
  assert.equal(sanitizeLine('a\u0000b\u001b[2Jc‮d⁦e'), 'ab[2Jcde');
  for (const v of [undefined, null, 42, ['x'], { a: 1 }]) assert.equal(sanitizeLine(v), '');
});

test('sanitizeText keeps single and double newlines but no more, and no controls', () => {
  assert.equal(sanitizeText('a\r\nb\n\n\n\nc\u0007'), 'a\nb\n\nc');
  assert.equal(sanitizeText('  x   y  '), 'x y');
  assert.equal(sanitizeText(7), '');
});

test('normalizeTitle: NFKC, lower case, no spaces or punctuation (full-width folds to half-width)', () => {
  assert.equal(normalizeTitle('Ｃａｍｐｂｅｌｌ 生物学（第11版）'), 'campbell生物学第11版');
  assert.equal(normalizeTitle('線形代数・入門!'), '線形代数入門');
  assert.equal(normalizeTitle(null), '');
});

test('displayNameFor: operator-looking or empty names become 京大生; others are bounded', () => {
  for (const n of ['運営', '京大InfoHub運営', 'ADMIN', 'Ｏｆｆｉｃｉａｌ', '事務局です', '', '  ', null]) assert.equal(displayNameFor(n), '京大生', String(n));
  assert.equal(displayNameFor('京大生_1234'), '京大生_1234');
  assert.equal(displayNameFor('x'.repeat(40)).length, 30);
});

test('callerKey is the mailbox key; an empty email is refused', () => {
  assert.equal(callerKey({ uid: 'u', email: ' A@st.kyoto-u.ac.jp ' }), emailKey('a@st.kyoto-u.ac.jp'));
  assert.throws(() => callerKey({ uid: 'u', email: '' }), (e) => e.code === 'permission-denied');
});

test('keyFromIdentity falls back to uid:<uid>; isLive needs active AND unexpired', () => {
  assert.equal(keyFromIdentity({ exists: true, get: () => 'k1' }, 'u'), 'k1');
  assert.equal(keyFromIdentity({ exists: false, get: () => undefined }, 'u'), 'uid:u');
  const now = new Date('2027-04-01T00:00:00Z');
  const at = (ms) => ({ toMillis: () => ms });
  assert.equal(isLive({ status: 'active', expiresAt: at(now.getTime() + 1) }, now), true);
  assert.equal(isLive({ status: 'active', expiresAt: at(now.getTime()) }, now), false); // boundary: expired AT now
  assert.equal(isLive({ status: 'closed', expiresAt: at(now.getTime() + 1e9) }, now), false);
  assert.equal(isLive(undefined, now), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `tsc` passes but `marketCore.test.mjs` cannot import `../lib/marketCore.js`.

- [ ] **Step 3: Create `functions/src/marketCore.ts`**

Create `functions/src/marketCore.ts`:

```ts
import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { emailKey } from './common.js';

/**
 * Textbook market (Plan 3) — shared limits, wire values, refs and text helpers.
 * No money moves through the app (spec §4.4): `price` is information shown to
 * the other party, never charged, and nothing here touches a credit.
 */
export const MARKET = {
  listingDailyCap: 5, // listings created per MAILBOX per JST day (T-6)
  roomDailyCap: 10, // new chats opened per MAILBOX per JST day (T-6)
  listingDays: 30, // a listing is visible for 30 days unless renewed (T-8)
  renewWindowDays: 7, // renew only in the last 7 days (or after expiry)
  maxTitle: 100,
  maxDescription: 1000,
  maxPhotos: 3,
  maxPrice: 100000, // yen; a sanity bound, not a policy (T-3)
  maxMessage: 1000, // firestore.rules mirrors this
  maxComment: 60,
  maxDisplayName: 30,
  matchMaxRecipients: 20, // want-owners told about ONE new offer (T-9)
  matchNoticeDailyCap: 10, // match notices ONE recipient gets per JST day (T-9)
  matchMinLength: 4, // normalized title length below which titles never match
  ratingRevealDays: 14, // a one-sided rating counts after this many days (T-11)
  recentComments: 5,
  previewLength: 80,
} as const;

export const LISTING_TYPES = ['give', 'sell', 'want'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];
export const BOOK_CONDITIONS = ['like_new', 'good', 'fair', 'marked'] as const;
export const HANDOFF_PLACES = [
  'clock_tower', 'coop_central', 'library', 'yoshida_south', 'north_campus', 'katsura', 'uji', 'other',
] as const;
export type ListingStatus = 'active' | 'closed' | 'hidden';

/** The verified caller of a market callable. Identity for caps and reputation is the MAILBOX. */
export interface MarketCaller { uid: string; email: string }

export const listingRef = (db: Firestore, id: string) => db.collection('textbook_listings').doc(id);
export const roomRef = (db: Firestore, id: string) => db.collection('talk_rooms').doc(id);
/** Admin-only: uid -> emailKey of everyone who used a market callable (T-12). */
export const identityRef = (db: Firestore, uid: string) => db.collection('market_identities').doc(uid);
/** Admin-only per-mailbox market counters (listings / rooms per day). */
export const marketActorRef = (db: Firestore, key: string) => db.collection('market_actors').doc(key);
export const blockRef = (db: Firestore, blocker: string, blocked: string) =>
  db.collection('market_blocks').doc(`${blocker}_${blocked}`);

export const DAY_MS = 24 * 3600 * 1000;

// C0/C1 controls and the bidi overrides/isolates (U+202A-202E, U+2066-2069):
// an RLO in a name or title can make 「運営」 appear out of other text.
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** One line of user text: controls out, whitespace runs collapsed, trimmed. */
export function sanitizeLine(v: unknown): string {
  return typeof v === 'string' ? v.replace(CONTROLS, '').replace(/\s+/g, ' ').trim() : '';
}

/** Multi-line user text: controls out (newlines kept, at most 2 in a row), trimmed. */
export function sanitizeText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(CONTROLS, '').replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** Matching key of a title: NFKC, lower case, no whitespace / punctuation / symbols. */
export function normalizeTitle(v: unknown): string {
  return typeof v === 'string' ? v.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '') : '';
}

// Names that would let a student pass as the operator (T-13).
const RESERVED_NAME = /運営|公式|管理者|事務局|admin|official|support|infohub/i;

/** The name shown next to a listing or in a chat: sanitized, bounded, never an operator-looking name. */
export function displayNameFor(v: unknown): string {
  const s = sanitizeLine(v).slice(0, MARKET.maxDisplayName);
  return s === '' || RESERVED_NAME.test(s.normalize('NFKC')) ? '京大生' : s;
}

/** The mailbox key of a verified caller (throws if the token carries no email). */
export function callerKey(caller: MarketCaller): string {
  if (!caller.email || !caller.email.trim()) throw new HttpsError('permission-denied', 'email required');
  return emailKey(caller.email);
}

/** uid -> mailbox key from the Admin-only identity map; `uid:<uid>` when the user never used the market. */
export function keyFromIdentity(snap: { exists: boolean; get(f: string): unknown }, uid: string): string {
  const k = snap.exists ? snap.get('key') : undefined;
  return typeof k === 'string' && k !== '' ? k : `uid:${uid}`;
}

export const millisOf = (v: unknown): number =>
  v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : 0;

export const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** Whether a listing doc is visible to buyers right now. */
export function isLive(d: DocumentData | undefined, now: Date): boolean {
  return !!d && d.status === 'active' && millisOf(d.expiresAt) > now.getTime();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — 146 existing + 7 new = **153**; `tsc` clean.

- [ ] **Step 5: Commit (now — before the next task)**

```bash
git add functions/src/marketCore.ts functions/test/marketCore.test.mjs
git commit -m "feat(functions): market core — limits, wire values, sanitizers, mailbox identity helpers (Plan 3)"
```

---

### Task 2: `createListing` / `updateListing` and the reputation recount

**Files:**
- Create: `functions/testlib/market.mjs`, `functions/test/listings.test.mjs`, `functions/src/listings.ts`, `functions/src/ratings.ts` (first half; Task 5 adds `processRateDeal`)

**Interfaces:**
- Consumes: everything in `marketCore.ts` (T1); `UNIVERSITY_ID`, `isDocId`, `jstDay` (common); test helpers `db`, `uid`, `fakeDeps` (`functions/testlib/helpers.mjs`, 2A).
- Produces:
  - `ratings.ts`: `type Side = 'lender' | 'borrower'`, `ratingRef(db, roomId, side)` (`market_ratings/{roomId}_{side}`), `reputationRef(db, key)` (`market_reputation/{emailKey}`), `profileRef(db, uid)` (`market_profiles/{uid}`), `interface Reputation { ratingCount; ratingSum; recentComments: {stars, comment, at}[] }`, `aggregateRatings(ratings, now): Reputation` (pure), `refreshReputation(db, uid, now?): Promise<Reputation>` (transactional full recount)
  - `listings.ts`: `interface ListingFields { description; condition; price: number | null; listPrice: number | null; place }`, `interface ListingDraft extends ListingFields { type; title; courseId; photoPaths }`, `parseListingFields(type, input)`, `parseListingDraft(input, uid)` (both throw `invalid-argument`), `processCreateListing(db, caller, input, now?) → {listingId}`, `type UpdateAction = 'edit' | 'renew' | 'close'`, `processUpdateListing(db, caller, {listingId, action, …fields}, now?) → {listingId, status, expiresAtMs}`
  - `testlib/market.mjs`: `mail`, `as(uid, email?)`, `keyOf`, `get`, `NOW` (2027-04-10T03:00Z), `DAY`, `later(days, base?)`, `LISTING(over)`, `seedUser`, `seedCourse`, re-exports `db`, `uid`

**Listing document** (`textbook_listings/{serverId}`): `id, type, title, titleNorm, description, courseId, courseName, condition, price, listPrice, place, photoPaths, ownerId, ownerName, status ('active' | 'closed' | 'hidden'), renewCount, createdAt, expiresAt (Timestamps), updatedAt, university_id`.

- [ ] **Step 1: Write the shared test fixtures and the failing tests**

Create `functions/testlib/market.mjs`:

```js
// Shared fixtures for the Plan 3 market tests (emulator).
import { db, uid } from './helpers.mjs';
import { emailKey } from '../lib/common.js';

export const mail = (u) => `${u}@st.kyoto-u.ac.jp`;
/** A verified market caller: identity is the mailbox (T-12). */
export const as = (u, email = mail(u)) => ({ uid: u, email });
export const keyOf = (u) => emailKey(mail(u));
export const get = (path) => db.doc(path).get();
export const NOW = new Date('2027-04-10T03:00:00Z');
export const DAY = 24 * 3600 * 1000;
export const later = (days, base = NOW) => new Date(base.getTime() + days * DAY);

/** A valid 譲る/売る/買いたい payload; `over` replaces fields. */
export const LISTING = (over = {}) => ({
  type: 'sell', title: '線形代数入門 第2版', description: '書き込みなし', condition: 'good', price: 1500,
  listPrice: 3000, place: 'clock_tower', photoPaths: [], ...over,
});

export async function seedUser(u, displayName = `京大生_${u.slice(-4)}`) {
  await db.doc(`users/${u}`).set({ uid: u, displayName, university_id: 'kyoto_u' });
  return u;
}

export async function seedCourse(id = uid('c'), name = '線形代数A') {
  await db.doc(`courses/${id}`).set({ id, name, courseKey: `${name}|教員`, university_id: 'kyoto_u' });
  return id;
}

export { db, uid };
```

Create `functions/test/listings.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, as, keyOf, get, NOW, DAY, later, LISTING, seedUser, seedCourse } from '../testlib/market.mjs';
import { processCreateListing, processUpdateListing, parseListingDraft } from '../lib/listings.js';

const create = (u, over = {}, now = NOW) => processCreateListing(db, as(u), LISTING(over), now);

test('createListing writes a server-owned listing: server id, owner = caller, 30-day expiry, course name copied', async () => {
  const u = await seedUser(uid('s'), '  山田‮  ');
  const c = await seedCourse(uid('c'), '線形代数A');
  const { listingId } = await create(u, { courseId: c, ownerId: 'someone_else', status: 'hidden', id: 'forged' });
  const l = (await get(`textbook_listings/${listingId}`)).data();
  assert.equal(l.id, listingId);
  assert.equal(l.ownerId, u); // the payload's ownerId is ignored
  assert.equal(l.status, 'active'); // and its status
  assert.equal(l.ownerName, '山田');
  assert.equal(l.courseId, c);
  assert.equal(l.courseName, '線形代数A');
  assert.equal(l.titleNorm, '線形代数入門第2版');
  assert.equal(l.createdAt.toMillis(), NOW.getTime());
  assert.equal(l.expiresAt.toMillis(), NOW.getTime() + 30 * DAY);
  assert.equal(l.university_id, 'kyoto_u');
  assert.deepEqual([l.type, l.price, l.listPrice, l.condition, l.place], ['sell', 1500, 3000, 'good', 'clock_tower']);
  assert.equal((await get(`market_identities/${u}`)).get('key'), keyOf(u));
  assert.equal((await get(`market_profiles/${u}`)).get('ratingCount'), 0); // the public summary exists from the start
  assert.equal((await get(`credit_balances/${u}`)).exists, false); // no credits anywhere in the market (T-3)
});

test('a named course must exist; an operator-looking display name is replaced', async () => {
  const u = await seedUser(uid('s'), '京大InfoHub運営');
  await assert.rejects(create(u, { courseId: uid('nocourse') }), (e) => e.code === 'invalid-argument');
  const { listingId } = await create(u, { courseId: '' });
  const l = (await get(`textbook_listings/${listingId}`)).data();
  assert.equal(l.ownerName, '京大生');
  assert.equal(l.courseName, '');
});

test('T-6: the 6th listing of a JST day per MAILBOX is refused; the cap follows the mailbox across a re-signup; next day is fine', async () => {
  const u = await seedUser(uid('s'));
  for (let i = 0; i < 5; i++) await create(u);
  await assert.rejects(create(u), (e) => e.code === 'resource-exhausted');
  const reborn = await seedUser(uid('s')); // delete-account + re-signup: new uid, same address
  await assert.rejects(processCreateListing(db, as(reborn, `${u}@st.kyoto-u.ac.jp`), LISTING(), NOW), (e) => e.code === 'resource-exhausted');
  await create(u, {}, new Date('2027-04-10T15:00:01Z')); // 00:00:01 JST next day
});

test('price rules: 売る needs 1..100000, 譲る is free (0 or none), 買いたい may name a budget', async () => {
  const u = await seedUser(uid('s'));
  for (const over of [{ price: 0 }, { price: null }, { price: 100001 }, { price: 1.5 }, { price: '1500' }]) {
    assert.throws(() => parseListingDraft(LISTING(over), u), (e) => e.code === 'invalid-argument', JSON.stringify(over));
  }
  assert.equal(parseListingDraft(LISTING({ price: 100000 }), u).price, 100000); // boundary
  assert.equal(parseListingDraft(LISTING({ type: 'give', price: 0 }), u).price, null);
  assert.equal(parseListingDraft(LISTING({ type: 'give', price: undefined }), u).price, null);
  assert.throws(() => parseListingDraft(LISTING({ type: 'give', price: 500 }), u), (e) => e.code === 'invalid-argument');
  assert.equal(parseListingDraft(LISTING({ type: 'want', price: 800, condition: '' }), u).price, 800);
  assert.equal(parseListingDraft(LISTING({ type: 'want', price: undefined, condition: undefined }), u).condition, '');
});

test('the draft is whitelisted and bounded: type, title, condition, place, description, photos', () => {
  const u = 'u1';
  const bads = [
    { type: 'lend' }, { type: undefined }, { title: '' }, { title: ' \u0000 ' }, { title: 'x'.repeat(101) },
    { condition: 'mint' }, { condition: '' }, { place: 'my_room' }, { description: 'x'.repeat(1001) },
    { courseId: 'a/b' }, { photoPaths: 'listings/u1/a.jpg' },
    { photoPaths: ['listings/u2/a.jpg'] }, { photoPaths: ['resources/u1/a.pdf'] }, { photoPaths: ['listings/u1/sub/a.jpg'] },
    { photoPaths: ['listings/u1/'] }, { photoPaths: ['listings/u1/../u2/a.jpg'] },
    { photoPaths: ['listings/u1/1.jpg', 'listings/u1/2.jpg', 'listings/u1/3.jpg', 'listings/u1/4.jpg'] },
  ];
  for (const over of bads) assert.throws(() => parseListingDraft(LISTING(over), u), (e) => e.code === 'invalid-argument', JSON.stringify(over));
  const d = parseListingDraft({ ...LISTING({ photoPaths: ['listings/u1/a.jpg', 'listings/u1/a.jpg'] }), ownerId: 'x', injected: 1 }, u);
  assert.deepEqual(d.photoPaths, ['listings/u1/a.jpg']);
  assert.deepEqual(Object.keys(d).sort(), ['condition', 'courseId', 'description', 'listPrice', 'photoPaths', 'place', 'price', 'title', 'type']);
  assert.equal(parseListingDraft(LISTING({ title: 'x'.repeat(100) }), u).title.length, 100); // boundary
});

test('updateListing: only the owner; close is final; edit cannot touch title/type/course/owner', async () => {
  const u = await seedUser(uid('s'));
  const { listingId } = await create(u);
  await assert.rejects(processUpdateListing(db, as(uid('x')), { listingId, action: 'close' }, NOW), (e) => e.code === 'permission-denied');
  await processUpdateListing(db, as(u), { listingId, action: 'edit', ...LISTING({ price: 1200, title: '別の本', type: 'give', ownerId: 'x' }) }, NOW);
  const l = (await get(`textbook_listings/${listingId}`)).data();
  assert.deepEqual([l.price, l.title, l.type, l.ownerId], [1200, '線形代数入門 第2版', 'sell', u]);
  assert.equal((await processUpdateListing(db, as(u), { listingId, action: 'close' }, NOW)).status, 'closed');
  await assert.rejects(processUpdateListing(db, as(u), { listingId, action: 'edit', ...LISTING() }, NOW), (e) => e.code === 'failed-precondition');
  await assert.rejects(processUpdateListing(db, as(u), { listingId, action: 'frobnicate' }, NOW), (e) => e.code === 'invalid-argument');
  await assert.rejects(processUpdateListing(db, as(u), { listingId: uid('nope'), action: 'close' }, NOW), (e) => e.code === 'not-found');
});

test('T-8: renew only within the last 7 days (or after expiry), and it extends to now + 30 days', async () => {
  const u = await seedUser(uid('s'));
  const { listingId } = await create(u);
  await assert.rejects(processUpdateListing(db, as(u), { listingId, action: 'renew' }, later(22, NOW)), (e) => e.message === 'too-early');
  const at = later(23, NOW); // exactly 7 days left: allowed (boundary)
  const r = await processUpdateListing(db, as(u), { listingId, action: 'renew' }, at);
  assert.equal(r.expiresAtMs, at.getTime() + 30 * DAY);
  const l = (await get(`textbook_listings/${listingId}`)).data();
  assert.equal(l.expiresAt.toMillis(), at.getTime() + 30 * DAY);
  assert.equal(l.renewCount, 1);
  const late = later(100, NOW); // long expired: renew brings it back
  assert.equal((await processUpdateListing(db, as(u), { listingId, action: 'renew' }, late)).expiresAtMs, late.getTime() + 30 * DAY);
});

test('an expired listing cannot be edited (renew it first); a hidden one cannot be touched by its owner', async () => {
  const u = await seedUser(uid('s'));
  const { listingId } = await create(u);
  await assert.rejects(processUpdateListing(db, as(u), { listingId, action: 'edit', ...LISTING() }, later(31, NOW)), (e) => e.message === 'expired');
  await db.doc(`textbook_listings/${listingId}`).update({ status: 'hidden' });
  for (const action of ['edit', 'renew', 'close']) {
    await assert.rejects(processUpdateListing(db, as(u), { listingId, action, ...LISTING() }, NOW), (e) => e.message === 'not-active');
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `listings.test.mjs` cannot import `../lib/listings.js`.

- [ ] **Step 3: Create `functions/src/ratings.ts` (first half: the pure aggregate and the recount)**

Create `functions/src/ratings.ts`:

```ts
import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { UNIVERSITY_ID } from './common.js';
import { DAY_MS, MARKET, identityRef, keyFromIdentity, millisOf } from './marketCore.js';

export type Side = 'lender' | 'borrower';
/** Admin-only: one immutable rating per (room, side) — the id IS the uniqueness rule (T-10). */
export const ratingRef = (db: Firestore, roomId: string, side: Side) =>
  db.collection('market_ratings').doc(`${roomId}_${side}`);
/** Admin-only aggregate per MAILBOX; the KU-readable copy is market_profiles/{uid}. */
export const reputationRef = (db: Firestore, key: string) => db.collection('market_reputation').doc(key);
export const profileRef = (db: Firestore, uid: string) => db.collection('market_profiles').doc(uid);

export interface Reputation {
  ratingCount: number;
  ratingSum: number;
  recentComments: Array<{ stars: number; comment: string; at: string }>;
}

/**
 * Pure: the aggregate a set of rating docs produces at `now` (T-10, T-11).
 * A rating counts once it is revealed (both sides rated) or older than
 * `ratingRevealDays`; per rater MAILBOX only the newest counted rating counts,
 * so one friend cannot inflate a score by trading again and again.
 */
export function aggregateRatings(ratings: DocumentData[], now: Date): Reputation {
  const cutoff = now.getTime() - MARKET.ratingRevealDays * DAY_MS;
  const latest = new Map<string, DocumentData>();
  for (const r of ratings) {
    const stars = r.stars;
    if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) continue;
    if (r.revealed !== true && millisOf(r.createdAt) > cutoff) continue;
    const k = String(r.raterKey ?? '');
    const prev = latest.get(k);
    if (!prev || millisOf(r.createdAt) > millisOf(prev.createdAt)) latest.set(k, r);
  }
  const counted = [...latest.values()].sort((a, b) => millisOf(b.createdAt) - millisOf(a.createdAt));
  return {
    ratingCount: counted.length,
    ratingSum: counted.reduce((s, r) => s + (r.stars as number), 0),
    recentComments: counted.filter((r) => typeof r.comment === 'string' && r.comment !== '')
      .slice(0, MARKET.recentComments)
      .map((r) => ({ stars: r.stars as number, comment: String(r.comment), at: new Date(millisOf(r.createdAt)).toISOString() })),
  };
}

/**
 * Recount one user's reputation from every rating about their MAILBOX and write
 * it to the Admin-only aggregate and the KU-readable `market_profiles/{uid}`.
 * A full recount (never an increment): idempotent, self-healing, and a forged
 * or stale field cannot survive. The aggregate doc is read first so concurrent
 * recounts of the same mailbox serialise (the course_stats pattern, M-11).
 */
export async function refreshReputation(db: Firestore, uid: string, now: Date = new Date()): Promise<Reputation> {
  return db.runTransaction(async (tx) => {
    const key = keyFromIdentity(await tx.get(identityRef(db, uid)), uid);
    await tx.get(reputationRef(db, key));
    const ratings = (await tx.get(db.collection('market_ratings').where('rateeKey', '==', key))).docs.map((d) => d.data());
    const rep = aggregateRatings(ratings, now);
    tx.set(reputationRef(db, key), { ...rep, lastUid: uid, updatedAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID });
    tx.set(profileRef(db, uid), { ...rep, updatedAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID });
    return rep;
  });
}
```

- [ ] **Step 4: Create `functions/src/listings.ts`**

Create `functions/src/listings.ts`:

```ts
import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { UNIVERSITY_ID, isDocId, jstDay } from './common.js';
import {
  BOOK_CONDITIONS, DAY_MS, HANDOFF_PLACES, LISTING_TYPES, MARKET, callerKey, displayNameFor, identityRef,
  intOrNull, isLive, listingRef, marketActorRef, millisOf, normalizeTitle, sanitizeLine, sanitizeText,
  type ListingType, type MarketCaller,
} from './marketCore.js';
import { refreshReputation } from './ratings.js';

/** The editable, validated part of a listing (everything a client may choose). */
export interface ListingFields {
  description: string;
  condition: string;
  price: number | null;
  listPrice: number | null;
  place: string;
}
export interface ListingDraft extends ListingFields {
  type: ListingType;
  title: string;
  courseId: string;
  photoPaths: string[];
}

const bad = (what: string) => new HttpsError('invalid-argument', `bad ${what}`);

function price(v: unknown, what: string, required: boolean): number | null {
  if (v === undefined || v === null) {
    if (required) throw bad(what);
    return null;
  }
  const n = intOrNull(v);
  if (n === null || n < 0 || n > MARKET.maxPrice) throw bad(what);
  return n;
}

/** Validation of the fields an owner may set at create AND later edit (T-3). */
export function parseListingFields(type: ListingType, input: Record<string, unknown>): ListingFields {
  const description = sanitizeText(input.description);
  if (description.length > MARKET.maxDescription) throw bad('description');
  const condition = typeof input.condition === 'string' ? input.condition : '';
  if (type === 'want') {
    if (condition !== '' && !(BOOK_CONDITIONS as readonly string[]).includes(condition)) throw bad('condition');
  } else if (!(BOOK_CONDITIONS as readonly string[]).includes(condition)) {
    throw bad('condition');
  }
  // 売る needs a price (>= 1); 譲る is free by definition; 買いたい may name a budget.
  let p = price(input.price, 'price', type === 'sell');
  if (type === 'sell' && (p === null || p < 1)) throw bad('price');
  if (type === 'give') {
    if (p !== null && p !== 0) throw bad('price');
    p = null;
  }
  const listPrice = price(input.listPrice, 'listPrice', false);
  const place = typeof input.place === 'string' ? input.place : '';
  if (!(HANDOFF_PLACES as readonly string[]).includes(place)) throw bad('place');
  return { description, condition, price: p, listPrice, place };
}

/** Whitelist + bounds for a new listing. Only these fields ever reach Firestore. */
export function parseListingDraft(input: Record<string, unknown>, uid: string): ListingDraft {
  const type = input?.type;
  if (typeof type !== 'string' || !(LISTING_TYPES as readonly string[]).includes(type)) throw bad('type');
  const title = sanitizeLine(input.title);
  if (title.length < 1 || title.length > MARKET.maxTitle) throw bad('title');
  const courseId = input.courseId === undefined || input.courseId === null || input.courseId === '' ? '' : input.courseId;
  if (courseId !== '' && !isDocId(courseId)) throw bad('course');
  const raw = input.photoPaths ?? [];
  const prefix = `listings/${uid}/`;
  if (!Array.isArray(raw) || raw.length > MARKET.maxPhotos || !raw.every((p) =>
    typeof p === 'string' && p.startsWith(prefix) && p.length > prefix.length && p.length <= 300 &&
    !p.slice(prefix.length).includes('/') && !p.includes('..'))) {
    throw bad('photos'); // only the caller's own flat objects (storage.rules writes the same shape)
  }
  return {
    type: type as ListingType,
    title,
    courseId: courseId as string,
    photoPaths: [...new Set(raw as string[])],
    ...parseListingFields(type as ListingType, input),
  };
}

/**
 * `createListing` (T-2..T-6). One transaction, reads first: the course (a
 * named course must exist; its name is copied, never trusted from the client),
 * the caller's profile (display name, sanitized) and their per-mailbox daily
 * counter. The listing id is server-generated and `ownerId` is the caller, so
 * no client can forge ownership or squat an id. Afterwards the caller's public
 * rating summary is refreshed (a re-signup with the same mailbox gets its
 * reputation back, T-12).
 */
export async function processCreateListing(
  db: Firestore, caller: MarketCaller, input: Record<string, unknown>, now: Date = new Date(),
): Promise<{ listingId: string }> {
  const draft = parseListingDraft(input ?? {}, caller.uid);
  const key = callerKey(caller);
  const day = jstDay(now);
  const ref = db.collection('textbook_listings').doc();
  await db.runTransaction(async (tx) => {
    const course = draft.courseId ? await tx.get(db.collection('courses').doc(draft.courseId)) : null;
    const profile = await tx.get(db.collection('users').doc(caller.uid));
    const actor = await tx.get(marketActorRef(db, key));
    if (course && !course.exists) throw bad('course');
    const used = actor.get('listingDay') === day ? Number(actor.get('listingsToday') ?? 0) : 0;
    if (used >= MARKET.listingDailyCap) throw new HttpsError('resource-exhausted', 'listing-limit');
    tx.create(ref, {
      id: ref.id,
      ...draft,
      titleNorm: normalizeTitle(draft.title),
      courseName: course ? sanitizeLine(course.get('name')).slice(0, 100) : '',
      ownerId: caller.uid,
      ownerName: displayNameFor(profile.get('displayName')),
      status: 'active',
      renewCount: 0,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromMillis(now.getTime() + MARKET.listingDays * DAY_MS),
      updatedAt: FieldValue.serverTimestamp(),
      university_id: UNIVERSITY_ID,
    });
    tx.set(marketActorRef(db, key), { listingDay: day, listingsToday: used + 1, university_id: UNIVERSITY_ID }, { merge: true });
    tx.set(identityRef(db, caller.uid), { key, updatedAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID }, { merge: true });
  });
  // Best-effort: the listing is committed; a failed recount must not make the
  // client retry and create a duplicate (the next market call recounts again).
  await refreshReputation(db, caller.uid, now).catch((e) => console.warn('refreshReputation failed', e));
  return { listingId: ref.id };
}

export type UpdateAction = 'edit' | 'renew' | 'close';

/**
 * `updateListing`: the owner edits the free fields, renews (only in the last
 * `renewWindowDays` or after expiry) or closes. Title, type, course, photos and
 * owner are immutable (a match notice must keep describing the same book). A
 * hidden listing cannot be touched by its owner (moderation decides).
 */
export async function processUpdateListing(
  db: Firestore, caller: MarketCaller, input: Record<string, unknown>, now: Date = new Date(),
): Promise<{ listingId: string; status: string; expiresAtMs: number }> {
  const id = input?.listingId;
  if (!isDocId(id)) throw bad('listing id');
  const action = input.action;
  if (action !== 'edit' && action !== 'renew' && action !== 'close') throw bad('action');
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(listingRef(db, id));
    if (!snap.exists) throw new HttpsError('not-found', 'listing not found');
    const d = snap.data() as DocumentData;
    if (d.ownerId !== caller.uid) throw new HttpsError('permission-denied', 'not-owner');
    if (d.status !== 'active') throw new HttpsError('failed-precondition', 'not-active');
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    let expiresAtMs = millisOf(d.expiresAt);
    if (action === 'close') {
      patch.status = 'closed';
    } else if (action === 'renew') {
      if (expiresAtMs - now.getTime() > MARKET.renewWindowDays * DAY_MS) throw new HttpsError('failed-precondition', 'too-early');
      expiresAtMs = now.getTime() + MARKET.listingDays * DAY_MS;
      patch.expiresAt = Timestamp.fromMillis(expiresAtMs);
      patch.renewCount = Number(d.renewCount ?? 0) + 1;
    } else {
      if (!isLive(d, now)) throw new HttpsError('failed-precondition', 'expired');
      Object.assign(patch, parseListingFields(d.type as ListingType, input));
    }
    tx.update(listingRef(db, id), patch);
    return { listingId: id, status: String(patch.status ?? d.status), expiresAtMs };
  });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — 153 + 8 = **161**; `tsc` clean.

- [ ] **Step 6: Commit (now — before the next task)**

```bash
git add functions/testlib/market.mjs functions/test/listings.test.mjs functions/src/listings.ts functions/src/ratings.ts
git commit -m "feat(functions): createListing / updateListing — server-owned listings, mailbox caps, 30-day expiry and renew window (Plan 3)"
```

---

### Task 3: `onListingCreated` — 買いたい match notices with caps

**Files:**
- Create: `functions/src/listingMatch.ts`, `functions/test/listingMatch.test.mjs`

**Interfaces:**
- Consumes: `MARKET`, `blockRef`, `isLive`, `listingRef`, `millisOf`, `normalizeTitle` (T1); `processCreateListing` (T2, tests); `UNIVERSITY_ID`, `jstDay` (common).
- Produces: `titlesMatch(a, b)` (normalized inputs), `listingsMatch(offer, want)`, `matchNoticeId(offerId, uid)` = `mkt_match_<offerId>_<uid>`, `handleListingCreated(db, listingId, now?) → Promise<string[]>` (uids notified by this call). Notification doc: `{uid, type: 'listing_match', listingId, postId: '', postTitle: <offer title>, read: false, createdAt, university_id}`; per-recipient counter `market_inbox/{uid}` `{day, count}` (Admin-only).

- [ ] **Step 1: Write the failing tests**

Create `functions/test/listingMatch.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, as, get, NOW, later, LISTING, seedUser, seedCourse } from '../testlib/market.mjs';
import { processCreateListing } from '../lib/listings.js';
import { handleListingCreated, titlesMatch, listingsMatch } from '../lib/listingMatch.js';
import { normalizeTitle } from '../lib/marketCore.js';

// Every test uses its own unique title words, so the shared emulator's other
// want listings can never match (the query is global by design).
const T = () => `${uid('本')}の線形代数`;
const want = async (u, over = {}, now = NOW) => (await processCreateListing(db, as(u), LISTING({ type: 'want', condition: '', price: undefined, ...over }), now)).listingId;
const offer = async (u, over = {}, now = NOW) => (await processCreateListing(db, as(u), LISTING(over), now)).listingId;
const notes = async (listingId) => (await db.collection('notifications').where('listingId', '==', listingId).get()).docs.map((d) => d.data());

test('titlesMatch: containment of normalized titles, never below 4 characters', () => {
  assert.equal(titlesMatch(normalizeTitle('線形代数'), normalizeTitle('線形代数入門 第2版')), true);
  assert.equal(titlesMatch(normalizeTitle('Campbell Biology'), normalizeTitle('ｃａｍｐｂｅｌｌ ｂｉｏｌｏｇｙ 11th')), true);
  assert.equal(titlesMatch('数学', '数学入門'), false); // 2 chars: too loose
  assert.equal(titlesMatch('abc', 'abcd'), false); // boundary: 3 never matches
  assert.equal(titlesMatch('abcd', 'xabcdx'), true); // boundary: 4 does
  assert.equal(listingsMatch({ courseId: 'c1', title: 'A本' }, { courseId: 'c1', title: '全然ちがう' }), true);
  assert.equal(listingsMatch({ courseId: '', title: 'A本' }, { courseId: '', title: '全然ちがう' }), false);
});

test('a new offer notifies the owners of matching live wants once, never its own owner', async () => {
  const title = T();
  const seller = await seedUser(uid('s')); const w1 = await seedUser(uid('w')); const w2 = await seedUser(uid('w'));
  await want(w1, { title });
  await want(w2, { title: `${title} 第3版` });
  await want(seller, { title }); // the seller's own want: no self-notice
  const other = await seedUser(uid('w'));
  await want(other, { title: `${uid('x')}まったく別の本` });
  const id = await offer(seller, { title });
  const got = await handleListingCreated(db, id, NOW);
  assert.deepEqual(got.sort(), [w1, w2].sort());
  const n = (await get(`notifications/mkt_match_${id}_${w1}`)).data();
  assert.deepEqual([n.uid, n.type, n.listingId, n.postTitle, n.read, n.university_id], [w1, 'listing_match', id, title, false, 'kyoto_u']);
  assert.deepEqual(await handleListingCreated(db, id, NOW), []); // a trigger retry writes nothing new
  assert.equal((await notes(id)).length, 2);
});

test('a want with the same course matches whatever the title', async () => {
  const c = await seedCourse();
  const seller = await seedUser(uid('s')); const w = await seedUser(uid('w'));
  await want(w, { title: `${uid('x')}教科書ならなんでも`, courseId: c });
  const id = await offer(seller, { title: T(), courseId: c });
  assert.deepEqual(await handleListingCreated(db, id, NOW), [w]);
});

test('expired, closed or hidden wants and want-type listings never notify', async () => {
  const title = T();
  const seller = await seedUser(uid('s'));
  const old = await seedUser(uid('w')); const closed = await seedUser(uid('w')); const hidden = await seedUser(uid('w'));
  await want(old, { title }, later(-31));
  const c = await want(closed, { title });
  await db.doc(`textbook_listings/${c}`).update({ status: 'closed' });
  const h = await want(hidden, { title });
  await db.doc(`textbook_listings/${h}`).update({ status: 'hidden' });
  const id = await offer(seller, { title });
  assert.deepEqual(await handleListingCreated(db, id, NOW), []);
  const w = await seedUser(uid('w'));
  await want(w, { title });
  const wantId = await want(await seedUser(uid('w')), { title });
  assert.deepEqual(await handleListingCreated(db, wantId, NOW), []); // a NEW want triggers nothing
});

test('T-9: at most 20 recipients per offer', async () => {
  const title = T();
  for (let i = 0; i < 22; i++) await want(await seedUser(uid('w')), { title });
  const id = await offer(await seedUser(uid('s')), { title });
  assert.equal((await handleListingCreated(db, id, NOW)).length, 20);
  assert.equal((await notes(id)).length, 20);
});

test('T-9: at most 10 match notices per recipient per JST day — offer flooding cannot spam a wanter', async () => {
  const w = await seedUser(uid('w'));
  const title = T();
  await want(w, { title });
  const sellers = [];
  for (let i = 0; i < 3; i++) sellers.push(await seedUser(uid('s')));
  let sent = 0;
  for (let i = 0; i < 12; i++) {
    const id = await offer(sellers[i % 3], { title: `${title}${i}` });
    sent += (await handleListingCreated(db, id, NOW)).length;
  }
  assert.equal(sent, 10);
  const id = await offer(sellers[0], { title }, later(1));
  assert.deepEqual(await handleListingCreated(db, id, later(1)), [w]); // the next JST day
});

test('a block in either direction suppresses match notices', async () => {
  const title = T();
  const seller = await seedUser(uid('s')); const w1 = await seedUser(uid('w')); const w2 = await seedUser(uid('w'));
  await want(w1, { title });
  await want(w2, { title });
  await db.doc(`market_blocks/${w1}_${seller}`).set({ blocker: w1, blocked: seller });
  await db.doc(`market_blocks/${seller}_${w2}`).set({ blocker: seller, blocked: w2 });
  const id = await offer(seller, { title });
  assert.deepEqual(await handleListingCreated(db, id, NOW), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `listingMatch.test.mjs` cannot import `../lib/listingMatch.js`.

- [ ] **Step 3: Create `functions/src/listingMatch.ts`**

Create `functions/src/listingMatch.ts`:

```ts
import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { UNIVERSITY_ID, jstDay } from './common.js';
import { MARKET, blockRef, isLive, listingRef, millisOf, normalizeTitle } from './marketCore.js';

/** Two normalized titles match when the shorter (>= matchMinLength) is contained in the longer. */
export function titlesMatch(a: string, b: string): boolean {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= MARKET.matchMinLength && l.includes(s);
}

/** A 買いたい listing matches an offer by the same course, or by title. */
export function listingsMatch(offer: DocumentData, want: DocumentData): boolean {
  if (typeof offer.courseId === 'string' && offer.courseId !== '' && offer.courseId === want.courseId) return true;
  return titlesMatch(normalizeTitle(offer.title), normalizeTitle(want.title));
}

export const matchNoticeId = (offerId: string, uid: string) => `mkt_match_${offerId}_${uid}`;
const inboxRef = (db: Firestore, uid: string) => db.collection('market_inbox').doc(uid);

/**
 * `onListingCreated` (T-9): a new 譲る/売る listing tells the owners of matching
 * live 買いたい listings — at most `matchMaxRecipients` people per offer, at most
 * `matchNoticeDailyCap` match notices per recipient per JST day, never the
 * offer's own owner, never someone who blocked the offerer (or was blocked),
 * one notice per (offer, recipient) (deterministic id, so a trigger retry
 * writes nothing new). Returns the uids notified by THIS call.
 */
export async function handleListingCreated(db: Firestore, listingId: string, now: Date = new Date()): Promise<string[]> {
  const snap = await listingRef(db, listingId).get();
  const offer = snap.data();
  if (!offer || offer.type === 'want' || !isLive(offer, now)) return [];
  const wants = await db.collection('textbook_listings').where('type', '==', 'want').where('status', '==', 'active').limit(500).get();
  const byOwner = new Map<string, DocumentData>();
  for (const d of wants.docs.map((x) => x.data()).sort((a, b) => millisOf(b.createdAt) - millisOf(a.createdAt))) {
    const owner = String(d.ownerId ?? '');
    if (owner === '' || owner === offer.ownerId || byOwner.has(owner) || !isLive(d, now) || !listingsMatch(offer, d)) continue;
    byOwner.set(owner, d);
  }
  const day = jstDay(now);
  const notified: string[] = [];
  for (const uid of [...byOwner.keys()].slice(0, MARKET.matchMaxRecipients)) {
    const sent = await db.runTransaction(async (tx) => {
      const note = await tx.get(db.collection('notifications').doc(matchNoticeId(listingId, uid)));
      const inbox = await tx.get(inboxRef(db, uid));
      const b1 = await tx.get(blockRef(db, uid, String(offer.ownerId)));
      const b2 = await tx.get(blockRef(db, String(offer.ownerId), uid));
      if (note.exists || b1.exists || b2.exists) return false;
      const used = inbox.get('day') === day ? Number(inbox.get('count') ?? 0) : 0;
      if (used >= MARKET.matchNoticeDailyCap) return false;
      tx.create(db.collection('notifications').doc(matchNoticeId(listingId, uid)), {
        uid, type: 'listing_match', listingId, postId: '', postTitle: String(offer.title ?? '').slice(0, 200),
        read: false, createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
      });
      tx.set(inboxRef(db, uid), { day, count: used + 1, university_id: UNIVERSITY_ID });
      return true;
    });
    if (sent) notified.push(uid);
  }
  return notified;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — 161 + 7 = **168**.

- [ ] **Step 5: Commit (now — before the next task)**

```bash
git add functions/src/listingMatch.ts functions/test/listingMatch.test.mjs
git commit -m "feat(functions): onListingCreated — 買いたい match notices, per-offer and per-recipient caps, blocks respected (Plan 3)"
```

---

### Task 4: Chat rooms — `openListingChat`, `blockRoom`, `onTalkMessageCreated` summary

**Files:**
- Create: `functions/src/chat.ts`, `functions/test/chat.test.mjs`

**Interfaces:**
- Consumes: T1 helpers; `refreshReputation` (T2); `processCreateListing`, `processUpdateListing` (T2, tests).
- Produces: `roomIdFor(listingId, uid)` = `l_<listingId>_<uid>`, `ROOM_WARNING`, `processOpenChat(db, caller, {listingId}, now?) → {roomId, created}`, `processBlockRoom(db, caller, {roomId}) → {changed}`, `handleMessageCreated(db, roomId, msg) → Promise<boolean>`.

**Room document** (Function-created): `id, university_id, listingId, listingType, requestId: '', bookTitle, subjectName, lenderId (= listing owner), lenderName, borrowerId (= requester), borrowerName, createdAt (ISO string, as legacy rooms), warningNotice, lastMessageText, lastMessageAt, lastSenderId, lenderSent, borrowerSent, lenderReadAt, borrowerReadAt, closedBy`. No `messages` array.

- [ ] **Step 1: Write the failing tests**

Create `functions/test/chat.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { db, uid, as, get, NOW, later, LISTING, seedUser } from '../testlib/market.mjs';
import { processCreateListing, processUpdateListing } from '../lib/listings.js';
import { processOpenChat, processBlockRoom, handleMessageCreated, roomIdFor } from '../lib/chat.js';

const setup = async (over = {}) => {
  const owner = await seedUser(uid('o'), 'オーナー'); const buyer = await seedUser(uid('b'), '買う人');
  const { listingId } = await processCreateListing(db, as(owner), LISTING(over), NOW);
  return { owner, buyer, listingId };
};
const msg = (senderId, text, ms) => ({ senderId, senderName: 'x', text, createdAt: Timestamp.fromMillis(ms), university_id: 'kyoto_u' });

test('openListingChat creates ONE Function-owned room per (listing, requester): owner = lenderId, caller = borrowerId', async () => {
  const { owner, buyer, listingId } = await setup();
  const r = await processOpenChat(db, as(buyer), { listingId }, NOW);
  assert.deepEqual(r, { roomId: roomIdFor(listingId, buyer), created: true });
  const room = (await get(`talk_rooms/${r.roomId}`)).data();
  assert.deepEqual(
    [room.lenderId, room.lenderName, room.borrowerId, room.borrowerName, room.listingId, room.bookTitle, room.university_id],
    [owner, 'オーナー', buyer, '買う人', listingId, '線形代数入門 第2版', 'kyoto_u']);
  assert.deepEqual([room.lenderSent, room.borrowerSent, room.closedBy, room.lastMessageAt], [false, false, null, null]);
  assert.equal(room.messages, undefined); // no array any more (spec §4.5.5)
  assert.match(room.warningNotice, /お金を扱いません/);
  assert.deepEqual(await processOpenChat(db, as(buyer), { listingId }, NOW), { roomId: r.roomId, created: false });
});

test('the owner cannot open a chat on their own listing; closed, hidden or expired listings refuse NEW rooms', async () => {
  const { owner, buyer, listingId } = await setup();
  await assert.rejects(processOpenChat(db, as(owner), { listingId }, NOW), (e) => e.message === 'own-listing');
  await assert.rejects(processOpenChat(db, as(buyer), { listingId }, later(31)), (e) => e.message === 'listing-closed');
  await processUpdateListing(db, as(owner), { listingId, action: 'close' }, NOW);
  await assert.rejects(processOpenChat(db, as(buyer), { listingId }, NOW), (e) => e.message === 'listing-closed');
  await assert.rejects(processOpenChat(db, as(buyer), { listingId: uid('nope') }, NOW), (e) => e.code === 'not-found');
  await assert.rejects(processOpenChat(db, as(buyer), { listingId: 'a/b' }, NOW), (e) => e.code === 'invalid-argument');
});

test('T-6: the 11th NEW room of a JST day per mailbox is refused; re-opening is free', async () => {
  const buyer = await seedUser(uid('b'));
  const ids = [];
  for (let i = 0; i < 11; i++) {
    const owner = await seedUser(uid('o'));
    ids.push((await processCreateListing(db, as(owner), LISTING(), NOW)).listingId);
  }
  for (let i = 0; i < 10; i++) await processOpenChat(db, as(buyer), { listingId: ids[i] }, NOW);
  await assert.rejects(processOpenChat(db, as(buyer), { listingId: ids[10] }, NOW), (e) => e.code === 'resource-exhausted');
  assert.equal((await processOpenChat(db, as(buyer), { listingId: ids[0] }, NOW)).created, false);
  assert.equal((await processOpenChat(db, as(buyer), { listingId: ids[10] }, later(1))).created, true);
});

test('T-17: block closes the room for both and stops new chats in either direction', async () => {
  const { owner, buyer, listingId } = await setup();
  const { roomId } = await processOpenChat(db, as(buyer), { listingId }, NOW);
  await assert.rejects(processBlockRoom(db, as(uid('x')), { roomId }), (e) => e.code === 'permission-denied');
  assert.deepEqual(await processBlockRoom(db, as(owner), { roomId }), { changed: true });
  assert.equal((await get(`talk_rooms/${roomId}`)).get('closedBy'), owner);
  assert.equal((await get(`market_blocks/${owner}_${buyer}`)).get('blocked'), buyer);
  assert.deepEqual(await processBlockRoom(db, as(buyer), { roomId }), { changed: false });
  const second = (await processCreateListing(db, as(owner), LISTING(), NOW)).listingId;
  await assert.rejects(processOpenChat(db, as(buyer), { listingId: second }, NOW), (e) => e.message === 'blocked');
  const theirs = (await processCreateListing(db, as(buyer), LISTING(), NOW)).listingId;
  await assert.rejects(processOpenChat(db, as(owner), { listingId: theirs }, NOW), (e) => e.message === 'blocked');
});

test('T-18: the message trigger keeps a monotonic summary and records who has spoken', async () => {
  const { owner, buyer, listingId } = await setup();
  const { roomId } = await processOpenChat(db, as(buyer), { listingId }, NOW);
  const t = NOW.getTime();
  assert.equal(await handleMessageCreated(db, roomId, msg(buyer, 'こんにちは\u0000！', t + 1000)), true);
  let room = (await get(`talk_rooms/${roomId}`)).data();
  assert.deepEqual([room.lastMessageText, room.lastSenderId, room.borrowerSent, room.lenderSent], ['こんにちは！', buyer, true, false]);
  await handleMessageCreated(db, roomId, msg(owner, 'x'.repeat(200), t + 3000));
  await handleMessageCreated(db, roomId, msg(buyer, 'older, processed late', t + 2000));
  room = (await get(`talk_rooms/${roomId}`)).data();
  assert.equal(room.lastMessageText, 'x'.repeat(80));
  assert.equal(room.lastSenderId, owner);
  assert.equal(room.lastMessageAt.toMillis(), t + 3000);
  assert.deepEqual([room.borrowerSent, room.lenderSent], [true, true]);
});

test('a message from a non-participant (or to an unknown room) changes nothing', async () => {
  const { buyer, listingId } = await setup();
  const { roomId } = await processOpenChat(db, as(buyer), { listingId }, NOW);
  assert.equal(await handleMessageCreated(db, roomId, msg(uid('x'), 'spoof', NOW.getTime() + 5)), false);
  assert.equal(await handleMessageCreated(db, roomId, msg('', 'empty sender', NOW.getTime() + 5)), false);
  assert.equal(await handleMessageCreated(db, uid('noroom'), msg(buyer, 'hi', NOW.getTime())), false);
  const room = (await get(`talk_rooms/${roomId}`)).data();
  assert.deepEqual([room.lastMessageText, room.lenderSent, room.borrowerSent], ['', false, false]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `chat.test.mjs` cannot import `../lib/chat.js`.

- [ ] **Step 3: Create `functions/src/chat.ts`**

Create `functions/src/chat.ts`:

```ts
import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { UNIVERSITY_ID, isDocId, jstDay } from './common.js';
import {
  MARKET, blockRef, callerKey, displayNameFor, identityRef, isLive, listingRef, marketActorRef, millisOf, roomRef,
  sanitizeLine, type MarketCaller,
} from './marketCore.js';
import { refreshReputation } from './ratings.js';

/** One room per (listing, requester): opening twice returns the same room (T-14). */
export const roomIdFor = (listingId: string, uid: string) => `l_${listingId}_${uid}`;

export const ROOM_WARNING =
  'アプリはお金を扱いません。代金は受け渡しのときに当事者どうしで直接やりとりしてください。電話番号・住所などの個人情報は送らないでください。';

/**
 * `openListingChat` (T-14..T-16). The caller (not the owner) asks about a live
 * listing; the room is created by this Function only (rules deny client
 * creates), with `lenderId` = the listing owner and `borrowerId` = the caller
 * (the historical field names mean "owner side" / "requester side"). Refused
 * when either party has blocked the other. At most `roomDailyCap` NEW rooms per
 * mailbox per JST day; re-opening an existing room is free.
 */
export async function processOpenChat(
  db: Firestore, caller: MarketCaller, input: Record<string, unknown>, now: Date = new Date(),
): Promise<{ roomId: string; created: boolean }> {
  const listingId = input?.listingId;
  if (!isDocId(listingId)) throw new HttpsError('invalid-argument', 'bad listing id');
  const key = callerKey(caller);
  const day = jstDay(now);
  const roomId = roomIdFor(listingId, caller.uid);
  const out = await db.runTransaction(async (tx) => {
    const listing = await tx.get(listingRef(db, listingId));
    const room = await tx.get(roomRef(db, roomId));
    const actor = await tx.get(marketActorRef(db, key));
    const profile = await tx.get(db.collection('users').doc(caller.uid));
    if (!listing.exists) throw new HttpsError('not-found', 'listing not found');
    const l = listing.data()!;
    const ownerId = String(l.ownerId ?? '');
    const blocked = await tx.get(blockRef(db, ownerId, caller.uid));
    const blocking = await tx.get(blockRef(db, caller.uid, ownerId));
    if (ownerId === caller.uid) throw new HttpsError('failed-precondition', 'own-listing');
    if (blocked.exists || blocking.exists) throw new HttpsError('failed-precondition', 'blocked');
    if (room.exists) return { roomId, created: false, ownerId };
    if (!isLive(l, now)) throw new HttpsError('failed-precondition', 'listing-closed');
    const used = actor.get('roomDay') === day ? Number(actor.get('roomsToday') ?? 0) : 0;
    if (used >= MARKET.roomDailyCap) throw new HttpsError('resource-exhausted', 'room-limit');

    tx.create(roomRef(db, roomId), {
      id: roomId,
      university_id: UNIVERSITY_ID,
      listingId,
      listingType: String(l.type ?? ''),
      requestId: '',
      bookTitle: String(l.title ?? ''),
      subjectName: String(l.courseName ?? ''),
      lenderId: ownerId,
      lenderName: String(l.ownerName ?? '京大生'),
      borrowerId: caller.uid,
      borrowerName: displayNameFor(profile.get('displayName')),
      createdAt: now.toISOString(),
      warningNotice: ROOM_WARNING,
      lastMessageText: '',
      lastMessageAt: null,
      lastSenderId: '',
      lenderSent: false,
      borrowerSent: false,
      lenderReadAt: null,
      borrowerReadAt: null,
      closedBy: null,
    });
    tx.set(marketActorRef(db, key), { roomDay: day, roomsToday: used + 1, university_id: UNIVERSITY_ID }, { merge: true });
    tx.set(identityRef(db, caller.uid), { key, updatedAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID }, { merge: true });
    return { roomId, created: true, ownerId };
  });
  await refreshReputation(db, out.ownerId, now); // lazy reveal of the owner's old one-sided ratings (T-11)
  return { roomId: out.roomId, created: out.created };
}

/**
 * `blockRoom` (T-17): either participant closes the room for good (no more
 * messages from either side — the messages create rule checks `closedBy`) and
 * records a block, so the blocked user can neither open a new chat with the
 * blocker nor trigger match notices to them.
 */
export async function processBlockRoom(
  db: Firestore, caller: MarketCaller, input: Record<string, unknown>,
): Promise<{ changed: boolean }> {
  const roomId = input?.roomId;
  if (!isDocId(roomId)) throw new HttpsError('invalid-argument', 'bad room id');
  return db.runTransaction(async (tx) => {
    const room = await tx.get(roomRef(db, roomId));
    if (!room.exists) throw new HttpsError('not-found', 'room not found');
    const r = room.data()!;
    const other = r.lenderId === caller.uid ? r.borrowerId : r.borrowerId === caller.uid ? r.lenderId : null;
    if (typeof other !== 'string' || other === '') throw new HttpsError('permission-denied', 'not-participant');
    if (r.closedBy) return { changed: false };
    tx.update(roomRef(db, roomId), { closedBy: caller.uid, closedAt: FieldValue.serverTimestamp() });
    tx.set(blockRef(db, caller.uid, other), {
      blocker: caller.uid, blocked: other, roomId, createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
    });
    return { changed: true };
  });
}

/**
 * `onTalkMessageCreated` (T-18): the room summary (last message preview, time,
 * sender, and whether each side has spoken) is Function-owned, so a participant
 * can neither forge a preview of words the other never sent nor fake the
 * "both sides talked" condition that unlocks rating. Monotonic: an older
 * message processed late (trigger retries, the chat migration) never moves the
 * preview backwards. Returns false when the message is not from a participant.
 */
export async function handleMessageCreated(db: Firestore, roomId: string, msg: DocumentData | undefined): Promise<boolean> {
  if (!msg || !isDocId(roomId)) return false;
  return db.runTransaction(async (tx) => {
    const room = await tx.get(roomRef(db, roomId));
    if (!room.exists) return false;
    const r = room.data()!;
    const sender = String(msg.senderId ?? '');
    const side = sender !== '' && sender === r.lenderId ? 'lender' : sender !== '' && sender === r.borrowerId ? 'borrower' : null;
    if (!side) return false;
    const patch: Record<string, unknown> = { [`${side}Sent`]: true };
    const at = millisOf(msg.createdAt);
    if (at > 0 && at >= millisOf(r.lastMessageAt)) {
      patch.lastMessageText = sanitizeLine(msg.text).slice(0, MARKET.previewLength);
      patch.lastMessageAt = msg.createdAt;
      patch.lastSenderId = sender;
    }
    tx.update(roomRef(db, roomId), patch);
    return true;
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — 168 + 6 = **174**.

- [ ] **Step 5: Commit (now — before the next task)**

```bash
git add functions/src/chat.ts functions/test/chat.test.mjs
git commit -m "feat(functions): openListingChat, blockRoom and the Function-owned room summary (Plan 3)"
```

---

### Task 5: `rateDeal` — blind, immutable, one per side, newest per rater mailbox

**Files:**
- Modify: `functions/src/ratings.ts`
- Create: `functions/test/ratings.test.mjs`

**Interfaces:**
- Consumes: `refreshReputation`, `aggregateRatings` (T2); `processOpenChat`, `handleMessageCreated` (T4, tests); `callerKey`, `roomRef`, `sanitizeLine` (T1).
- Produces: `type RateStatus = 'rated' | 'duplicate'`, `processRateDeal(db, caller, {roomId, stars, comment}, now?) → {status, revealed}`. Rating doc `market_ratings/{roomId}_{side}`: `{roomId, listingId, raterSide, raterUid, raterKey, rateeUid, rateeKey, stars, comment, revealed, createdAt, university_id}`.

- [ ] **Step 1: Write the failing tests**

Create `functions/test/ratings.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { db, uid, as, keyOf, get, NOW, DAY, later, LISTING, seedUser } from '../testlib/market.mjs';
import { processCreateListing } from '../lib/listings.js';
import { processOpenChat, handleMessageCreated } from '../lib/chat.js';
import { processRateDeal, refreshReputation, aggregateRatings } from '../lib/ratings.js';

/** A market room in which both parties have spoken (the rating precondition). */
const deal = async ({ owner, buyer, talk = true } = {}) => {
  owner = owner ?? await seedUser(uid('o'));
  buyer = buyer ?? await seedUser(uid('b'));
  const { listingId } = await processCreateListing(db, as(owner), LISTING(), NOW);
  const { roomId } = await processOpenChat(db, as(buyer), { listingId }, NOW);
  if (talk) {
    await handleMessageCreated(db, roomId, { senderId: buyer, text: 'hi', createdAt: Timestamp.fromMillis(NOW.getTime() + 1) });
    await handleMessageCreated(db, roomId, { senderId: owner, text: 'hello', createdAt: Timestamp.fromMillis(NOW.getTime() + 2) });
  }
  return { owner, buyer, roomId };
};
const rate = (u, roomId, stars, comment = '', now = NOW) => processRateDeal(db, as(u), { roomId, stars, comment }, now);
const profile = async (u) => (await get(`market_profiles/${u}`)).data();

test('rating needs a market room where BOTH sides spoke; only its two parties may rate', async () => {
  const silent = await deal({ talk: false });
  await assert.rejects(rate(silent.buyer, silent.roomId, 5), (e) => e.message === 'no-exchange');
  await handleMessageCreated(db, silent.roomId, { senderId: silent.buyer, text: 'hi', createdAt: Timestamp.fromMillis(NOW.getTime() + 1) });
  await assert.rejects(rate(silent.buyer, silent.roomId, 5), (e) => e.message === 'no-exchange'); // one side is not enough
  const d = await deal();
  await assert.rejects(rate(uid('x'), d.roomId, 5), (e) => e.code === 'permission-denied');
  await db.doc('talk_rooms/legacy_room').set({ lenderId: d.owner, borrowerId: d.buyer, lenderSent: true, borrowerSent: true });
  await assert.rejects(rate(d.buyer, 'legacy_room', 5), (e) => e.message === 'legacy-room');
});

test('stars must be an integer 1..5 and the comment at most 60 characters', async () => {
  const d = await deal();
  for (const s of [0, 6, 4.5, '5', null]) await assert.rejects(rate(d.buyer, d.roomId, s), (e) => e.code === 'invalid-argument', String(s));
  await assert.rejects(rate(d.buyer, d.roomId, 5, 'x'.repeat(61)), (e) => e.code === 'invalid-argument');
  assert.equal((await rate(d.buyer, d.roomId, 5, 'x'.repeat(60))).status, 'rated'); // boundary
});

test('T-10: one immutable rating per (room, side): a second call is a duplicate and changes nothing', async () => {
  const d = await deal();
  assert.deepEqual(await rate(d.buyer, d.roomId, 2, 'うーん'), { status: 'rated', revealed: false });
  assert.deepEqual(await rate(d.buyer, d.roomId, 5, '最高'), { status: 'duplicate', revealed: false });
  const r = (await get(`market_ratings/${d.roomId}_borrower`)).data();
  assert.deepEqual([r.stars, r.comment, r.raterUid, r.rateeUid, r.raterKey, r.rateeKey, r.university_id],
    [2, 'うーん', d.buyer, d.owner, keyOf(d.buyer), keyOf(d.owner), 'kyoto_u']);
});

test('T-11: blind until both rated — a lone rating does not count; the second reveals both at once', async () => {
  const d = await deal();
  await rate(d.buyer, d.roomId, 1, 'ひどい');
  assert.equal((await profile(d.owner)).ratingCount, 0); // the owner cannot see a low score coming
  assert.deepEqual(await rate(d.owner, d.roomId, 4, 'よかった'), { status: 'rated', revealed: true });
  const o = await profile(d.owner); const b = await profile(d.buyer);
  assert.deepEqual([o.ratingCount, o.ratingSum, b.ratingCount, b.ratingSum], [1, 1, 1, 4]);
  assert.deepEqual(o.recentComments.map((c) => [c.stars, c.comment]), [[1, 'ひどい']]);
  assert.equal(o.recentComments[0].raterUid, undefined); // comments never name the rater
});

test('T-11: a one-sided rating counts after 14 days (lazy: on the next refresh)', async () => {
  const d = await deal();
  await rate(d.buyer, d.roomId, 3);
  assert.equal((await refreshReputation(db, d.owner, later(13.9))).ratingCount, 0);
  assert.equal((await refreshReputation(db, d.owner, later(14))).ratingCount, 1); // boundary: exactly 14 days
  assert.equal((await profile(d.owner)).ratingSum, 3);
});

test('T-10: one friend trading again and again counts once (newest rating per rater mailbox)', async () => {
  const owner = await seedUser(uid('o')); const friend = await seedUser(uid('b'));
  for (const [i, stars] of [5, 5, 4].entries()) {
    const d = await deal({ owner, buyer: friend });
    await rate(friend, d.roomId, stars, '', later(i + 1)); // the last deal is the newest
    await rate(owner, d.roomId, 5, '', later(i + 1));
  }
  const p = await profile(owner);
  assert.deepEqual([p.ratingCount, p.ratingSum], [1, 4]);
});

test('T-12: reputation follows the MAILBOX — a re-signup (new uid, same address) gets it back on its first listing', async () => {
  const d = await deal();
  await rate(d.buyer, d.roomId, 2);
  await rate(d.owner, d.roomId, 5);
  assert.equal((await profile(d.owner)).ratingCount, 1);
  const reborn = await seedUser(uid('o'));
  await processCreateListing(db, as(reborn, `${d.owner}@st.kyoto-u.ac.jp`), LISTING(), NOW);
  const p = await profile(reborn);
  assert.deepEqual([p.ratingCount, p.ratingSum], [1, 2]);
});

test('refreshReputation is a full recount: a forged public profile is overwritten', async () => {
  const d = await deal();
  await db.doc(`market_profiles/${d.owner}`).set({ ratingCount: 99, ratingSum: 495, pinned: true });
  await refreshReputation(db, d.owner, NOW);
  const p = await profile(d.owner);
  assert.deepEqual([p.ratingCount, p.ratingSum, p.pinned, p.university_id], [0, 0, undefined, 'kyoto_u']);
});

test('aggregateRatings ignores malformed stars and keeps the 5 newest comments, newest first', () => {
  const at = (d) => Timestamp.fromMillis(NOW.getTime() - d * DAY);
  const rs = [
    { raterKey: 'a', stars: 9, revealed: true, createdAt: at(1) },
    { raterKey: 'b', stars: 2.5, revealed: true, createdAt: at(1) },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({ raterKey: `k${i}`, stars: 4, comment: `c${i}`, revealed: true, createdAt: at(i) })),
  ];
  const out = aggregateRatings(rs, NOW);
  assert.equal(out.ratingCount, 6);
  assert.deepEqual(out.recentComments.map((c) => c.comment), ['c1', 'c2', 'c3', 'c4', 'c5']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `ratings.test.mjs`: `../lib/ratings.js` does not provide an export named `processRateDeal`.

- [ ] **Step 3: Extend `functions/src/ratings.ts`**

In `functions/src/ratings.ts` replace

```ts
import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { UNIVERSITY_ID } from './common.js';
import { DAY_MS, MARKET, identityRef, keyFromIdentity, millisOf } from './marketCore.js';
```

with

```ts
import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { UNIVERSITY_ID, isDocId } from './common.js';
import {
  DAY_MS, MARKET, callerKey, identityRef, keyFromIdentity, millisOf, roomRef, sanitizeLine, type MarketCaller,
} from './marketCore.js';
```

Append to `functions/src/ratings.ts`:

```ts

export type RateStatus = 'rated' | 'duplicate';

/**
 * `rateDeal` (T-10, T-11): after a deal, each party rates the other ONCE
 * (★1-5 + one line, immutable). Only the two parties of a market room in which
 * BOTH have sent a message (Function-owned `lenderSent` / `borrowerSent`) may
 * rate. Blind: a rating is hidden from every aggregate until the other side has
 * rated too or `ratingRevealDays` have passed, so nobody can see a low score
 * coming and retaliate.
 */
export async function processRateDeal(
  db: Firestore, caller: MarketCaller, input: Record<string, unknown>, now: Date = new Date(),
): Promise<{ status: RateStatus; revealed: boolean }> {
  const roomId = input?.roomId;
  if (!isDocId(roomId)) throw new HttpsError('invalid-argument', 'bad room id');
  const stars = input.stars;
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new HttpsError('invalid-argument', 'bad stars');
  }
  const comment = sanitizeLine(input.comment);
  if (comment.length > MARKET.maxComment) throw new HttpsError('invalid-argument', 'bad comment');
  const raterKey = callerKey(caller);

  const out = await db.runTransaction(async (tx) => {
    const room = await tx.get(roomRef(db, roomId));
    if (!room.exists) throw new HttpsError('not-found', 'room not found');
    const r = room.data()!;
    const side: Side | null = r.lenderId === caller.uid ? 'lender' : r.borrowerId === caller.uid ? 'borrower' : null;
    if (!side) throw new HttpsError('permission-denied', 'not-participant');
    const other: Side = side === 'lender' ? 'borrower' : 'lender';
    const rateeUid = String(r[`${other}Id`] ?? '');
    const mine = await tx.get(ratingRef(db, roomId, side));
    const theirs = await tx.get(ratingRef(db, roomId, other));
    const rateeKey = keyFromIdentity(await tx.get(identityRef(db, rateeUid)), rateeUid);
    if (!r.listingId) throw new HttpsError('failed-precondition', 'legacy-room');
    if (r.lenderSent !== true || r.borrowerSent !== true) throw new HttpsError('failed-precondition', 'no-exchange');
    if (mine.exists) return { status: 'duplicate' as const, revealed: theirs.exists, rateeUid };
    if (rateeKey === raterKey) throw new HttpsError('failed-precondition', 'self'); // same mailbox on both sides

    tx.create(ratingRef(db, roomId, side), {
      roomId, listingId: r.listingId, raterSide: side, raterUid: caller.uid, raterKey, rateeUid, rateeKey,
      stars, comment, revealed: theirs.exists, createdAt: Timestamp.fromDate(now), university_id: UNIVERSITY_ID,
    });
    if (theirs.exists) tx.update(ratingRef(db, roomId, other), { revealed: true });
    tx.set(identityRef(db, caller.uid), { key: raterKey, updatedAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID }, { merge: true });
    return { status: 'rated' as const, revealed: theirs.exists, rateeUid };
  });
  if (out.status === 'rated') {
    await refreshReputation(db, out.rateeUid, now);
    if (out.revealed) await refreshReputation(db, caller.uid, now);
  }
  return { status: out.status, revealed: out.revealed };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — 174 + 9 = **183**.

- [ ] **Step 5: Commit (now — before the next task)**

```bash
git add functions/src/ratings.ts functions/test/ratings.test.mjs
git commit -m "feat(functions): rateDeal — mutual ratings only after both spoke, blind until both rated or 14 days, mailbox-keyed (Plan 3)"
```

---

### Task 6: Market moderation — listing reports, chat cases, operator actions, photo cleanup

**Files:**
- Create: `functions/src/marketModeration.ts`, `functions/test/marketModeration.test.mjs`

**Interfaces:**
- Consumes: `MODERATION`, `isDocId`, `jstDay` (common); `actorRef`, `num`, `OperatorAction` (moderation.ts, 2B); `DeleteDeps` (postDeleted.ts, 2A); T1 helpers; `fakeDeps` (helpers.mjs).
- Produces: `LISTING_REPORT_CATEGORIES = ['not_textbook','spam','inappropriate','other']`, `ROOM_REPORT_CATEGORIES = ['harassment','no_show','fraud','other']`, `type MarketReportStatus = 'reported' | 'hidden' | 'duplicate' | 'already_hidden' | 'case_opened'`, refs `marketQueueRef`, `listingReportRef(db, id, key)`, `caseRef`, `listingNoticeId(listingId, transitions)` = `mkt_<listingId>_<n>`, `interface MarketQueueDoc`, `processMarketReport(db, reporter, {kind, targetId, category, detail}, now?) → {status}`, operator `hideListing`, `restoreListing → {changed, discredited}`, `removeListing`, `closeCase` (all `(db, id, {operator, note?})`), `listMarketQueue(db, limit?) → {listings, cases}`, `handleListingDeleted(deps, listing) → string[]`.

- [ ] **Step 1: Write the failing tests**

Create `functions/test/marketModeration.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, as, keyOf, get, NOW, LISTING, seedUser } from '../testlib/market.mjs';
import { fakeDeps } from '../testlib/helpers.mjs';
import { processCreateListing } from '../lib/listings.js';
import { processOpenChat } from '../lib/chat.js';
import {
  processMarketReport, hideListing, restoreListing, removeListing, closeCase, listMarketQueue, handleListingDeleted,
} from '../lib/marketModeration.js';

const OP = { operator: 'tester' };
const mk = async (over = {}) => {
  const owner = await seedUser(uid('o'));
  const { listingId } = await processCreateListing(db, as(owner), LISTING(over), NOW);
  return { owner, listingId };
};
const report = (u, targetId, over = {}) =>
  processMarketReport(db, as(u), { kind: 'listing', targetId, category: 'not_textbook', detail: '教科書ではない', ...over }, NOW);
const status = async (id) => (await get(`textbook_listings/${id}`)).get('status');

test('one report per (listing, mailbox); the 3rd distinct reporter hides it in place and tells the owner once', async () => {
  const { owner, listingId } = await mk();
  const r1 = await seedUser(uid('r'));
  assert.deepEqual(await report(r1, listingId), { status: 'reported' });
  assert.deepEqual(await report(r1, listingId), { status: 'duplicate' });
  const rep = (await get(`market_queue/${listingId}/reports/${keyOf(r1)}`)).data();
  assert.deepEqual([rep.reporterUid, rep.category, rep.counted, rep.university_id], [r1, 'not_textbook', true, 'kyoto_u']);
  assert.equal((await report(await seedUser(uid('r')), listingId)).status, 'reported');
  assert.equal(await status(listingId), 'active');
  assert.equal((await report(await seedUser(uid('r')), listingId)).status, 'hidden');
  assert.equal(await status(listingId), 'hidden');
  const n = (await get(`notifications/mkt_${listingId}_1`)).data();
  assert.deepEqual([n.uid, n.type, n.listingId, n.university_id], [owner, 'listing_hidden', listingId, 'kyoto_u']);
  assert.equal((await report(await seedUser(uid('r')), listingId)).status, 'already_hidden');
  const q = (await get(`market_queue/${listingId}`)).data();
  assert.deepEqual([q.status, q.hiddenBy, q.transitions, q.needsReview, q.university_id], ['hidden', 'reports', 1, true, 'kyoto_u']);
});

test('the owner cannot report their own listing; reports share the post-report daily cap (10/day per mailbox)', async () => {
  const { owner, listingId } = await mk();
  await assert.rejects(report(owner, listingId), (e) => e.message === 'own-listing');
  const r = await seedUser(uid('r'));
  await db.doc(`moderation_actors/${keyOf(r)}`).set({ reportDay: '2027-04-10', reportsToday: 10 });
  await assert.rejects(report(r, listingId), (e) => e.code === 'resource-exhausted');
  assert.equal((await get(`market_queue/${listingId}/reports/${keyOf(r)}`)).exists, false);
});

test('M-9 reuse: a discredited reporter is recorded but not counted; restore discredits the counted reporters', async () => {
  const { listingId } = await mk();
  const bad = await seedUser(uid('r'));
  await db.doc(`moderation_actors/${keyOf(bad)}`).set({ restoredReports: 3 });
  const good = [await seedUser(uid('r')), await seedUser(uid('r'))];
  for (const g of good) await report(g, listingId);
  assert.equal((await report(bad, listingId)).status, 'reported'); // silent
  assert.equal(await status(listingId), 'active');
  const third = await seedUser(uid('r'));
  assert.equal((await report(third, listingId)).status, 'hidden');
  const out = await restoreListing(db, listingId, OP);
  assert.deepEqual(out.discredited.sort(), [...good, third].map(keyOf).sort());
  assert.equal(await status(listingId), 'active');
  assert.equal((await get(`moderation_actors/${keyOf(third)}`)).get('restoredReports'), 1);
  assert.equal((await get(`notifications/mkt_${listingId}_2`)).get('type'), 'listing_restored');
  for (let i = 0; i < 3; i++) await report(await seedUser(uid('r')), listingId); // M-8: cleared once, never auto-hidden again
  assert.equal(await status(listingId), 'active');
  assert.equal((await get(`market_queue/${listingId}`)).get('needsReview'), true);
});

test('operator hide/restore returns a CLOSED listing to closed, not to active', async () => {
  const { owner, listingId } = await mk();
  await db.doc(`textbook_listings/${listingId}`).update({ status: 'closed' });
  assert.deepEqual(await hideListing(db, listingId, OP), { changed: true });
  assert.deepEqual(await hideListing(db, listingId, OP), { changed: false });
  assert.equal(await status(listingId), 'hidden');
  assert.equal((await restoreListing(db, listingId, OP)).changed, true);
  assert.equal(await status(listingId), 'closed');
  assert.equal((await get(`notifications/mkt_${listingId}_1`)).get('uid'), owner);
});

test('remove deletes the listing, notifies, and the photo cleanup touches only the owner prefix', async () => {
  const owner = await seedUser(uid('o'));
  const { listingId } = await processCreateListing(db, as(owner), LISTING({ photoPaths: [`listings/${owner}/1.jpg`] }), NOW);
  assert.deepEqual(await removeListing(db, listingId, OP), { changed: true });
  assert.equal((await get(`textbook_listings/${listingId}`)).exists, false);
  assert.equal((await get(`notifications/mkt_${listingId}_1`)).get('type'), 'listing_removed');
  const deps = fakeDeps();
  const out = await handleListingDeleted(deps, {
    ownerId: owner, photoPaths: [`listings/${owner}/1.jpg`, 'listings/victim/2.jpg', `listings/${owner}/../victim/3.jpg`, `resources/${owner}/a.pdf`],
  });
  assert.deepEqual(out, [`listings/${owner}/1.jpg`]);
  assert.deepEqual(deps.removed, [`listings/${owner}/1.jpg`]);
  assert.deepEqual(await handleListingDeleted(fakeDeps(), { photoPaths: ['listings//x.jpg'] }), []); // no owner: nothing
});

test('room cases: only a participant, one open case per (room, side), priority for harassment', async () => {
  const { owner, listingId } = await mk();
  const buyer = await seedUser(uid('b'));
  const { roomId } = await processOpenChat(db, as(buyer), { listingId }, NOW);
  const file = (u, category) => processMarketReport(db, as(u), { kind: 'room', targetId: roomId, category, detail: '来なかった' }, NOW);
  await assert.rejects(file(uid('x'), 'no_show'), (e) => e.code === 'permission-denied');
  await assert.rejects(file(buyer, 'not_textbook'), (e) => e.code === 'invalid-argument'); // a listing category
  assert.deepEqual(await file(buyer, 'no_show'), { status: 'case_opened' });
  assert.deepEqual(await file(buyer, 'harassment'), { status: 'duplicate' });
  const c = (await get(`market_cases/${roomId}_borrower`)).data();
  assert.deepEqual([c.reporterUid, c.reportedUid, c.category, c.status, c.priority, c.university_id], [buyer, owner, 'no_show', 'open', 'normal', 'kyoto_u']);
  assert.deepEqual(await file(owner, 'harassment'), { status: 'case_opened' });
  const { cases } = await listMarketQueue(db, 500);
  const mine = cases.filter((x) => x.roomId === roomId);
  assert.deepEqual(mine.map((x) => x.id), [`${roomId}_lender`, `${roomId}_borrower`]); // high priority first
  assert.deepEqual(await closeCase(db, `${roomId}_borrower`, OP), { changed: true });
  assert.deepEqual(await closeCase(db, `${roomId}_borrower`, OP), { changed: false });
  assert.deepEqual(await file(buyer, 'harassment'), { status: 'case_opened' }); // a closed case can be re-filed
});

test('operator actions need an operator name and a valid id; every action is audited', async () => {
  const { listingId } = await mk();
  for (const fn of [hideListing, restoreListing, removeListing, closeCase]) {
    await assert.rejects(fn(db, listingId, { operator: '' }), (e) => e.code === 'invalid-argument');
    await assert.rejects(fn(db, 'a/b', OP), (e) => e.code === 'invalid-argument');
    await assert.rejects(fn(db, uid('nope'), OP), (e) => e.code === 'not-found');
  }
  await hideListing(db, listingId, { operator: 'alice', note: 'spam' });
  const rows = (await db.collection('moderation_log').where('target', '==', listingId).get()).docs.map((d) => d.data());
  assert.deepEqual(rows.map((r) => [r.action, r.by, r.note]), [['listing_hide:operator', 'operator:alice', 'spam']]);
});

test('bad report input is refused before anything is written', async () => {
  const { listingId } = await mk();
  const r = await seedUser(uid('r'));
  for (const over of [{ kind: 'post' }, { targetId: 'a/b' }, { category: 'copyright' }, { detail: 'x'.repeat(501) }]) {
    await assert.rejects(report(r, listingId, over), (e) => e.code === 'invalid-argument', JSON.stringify(over));
  }
  assert.equal((await get(`moderation_actors/${keyOf(r)}`)).exists, false);
  await assert.rejects(report(r, uid('nope')), (e) => e.code === 'not-found');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `marketModeration.test.mjs` cannot import `../lib/marketModeration.js`.

- [ ] **Step 3: Create `functions/src/marketModeration.ts`**

Create `functions/src/marketModeration.ts`:

```ts
import {
  FieldValue, type DocumentData, type DocumentSnapshot, type Firestore, type Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { MODERATION, UNIVERSITY_ID, isDocId, jstDay } from './common.js';
import { actorRef, num, type OperatorAction } from './moderation.js';
import type { DeleteDeps } from './postDeleted.js';
import { callerKey, listingRef, millisOf, roomRef, sanitizeText, type MarketCaller } from './marketCore.js';

export const LISTING_REPORT_CATEGORIES = ['not_textbook', 'spam', 'inappropriate', 'other'] as const;
export const ROOM_REPORT_CATEGORIES = ['harassment', 'no_show', 'fraud', 'other'] as const;
export type MarketReportStatus = 'reported' | 'hidden' | 'duplicate' | 'already_hidden' | 'case_opened';
export type ListingNotice = 'listing_hidden' | 'listing_restored' | 'listing_removed';

/** Admin-only: `market_queue/{listingId}` (+ `reports/{emailKey}`) and `market_cases/{roomId}_{side}`. */
export const marketQueueRef = (db: Firestore, id: string) => db.collection('market_queue').doc(id);
export const listingReportRef = (db: Firestore, id: string, key: string) => marketQueueRef(db, id).collection('reports').doc(key);
export const caseRef = (db: Firestore, id: string) => db.collection('market_cases').doc(id);
export const listingNoticeId = (listingId: string, transitions: number) => `mkt_${listingId}_${transitions}`;

export interface MarketQueueDoc {
  listingId: string;
  ownerId: string;
  title: string;
  status: 'open' | 'hidden' | 'restored' | 'removed';
  reportCount: number;
  countedReports: number;
  hiddenBy: 'reports' | 'operator' | null;
  statusBeforeHide: 'active' | 'closed';
  autoHide: boolean;
  transitions: number;
  needsReview: boolean;
}

function readMarketQueue(snap: DocumentSnapshot, listingId: string, l?: DocumentData): MarketQueueDoc {
  const d: DocumentData = (snap.exists ? snap.data() : undefined) ?? {};
  return {
    listingId,
    ownerId: String(l?.ownerId ?? d.ownerId ?? ''),
    title: String(l?.title ?? d.title ?? '').slice(0, 200),
    status: ['open', 'hidden', 'restored', 'removed'].includes(d.status) ? d.status : 'open',
    reportCount: num(d.reportCount),
    countedReports: num(d.countedReports),
    hiddenBy: d.hiddenBy === 'reports' || d.hiddenBy === 'operator' ? d.hiddenBy : null,
    statusBeforeHide: d.statusBeforeHide === 'closed' ? 'closed' : 'active',
    autoHide: d.autoHide !== false,
    transitions: num(d.transitions),
    needsReview: d.needsReview === true,
  };
}

function writeMarketQueue(tx: Transaction, db: Firestore, q: MarketQueueDoc, isNew: boolean): void {
  tx.set(marketQueueRef(db, q.listingId), {
    ...q, university_id: UNIVERSITY_ID, updatedAt: FieldValue.serverTimestamp(),
    ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}),
  }, { merge: true });
}

function notifyOwner(tx: Transaction, db: Firestore, q: MarketQueueDoc, type: ListingNotice): void {
  if (!q.ownerId) return;
  tx.set(db.collection('notifications').doc(listingNoticeId(q.listingId, q.transitions)), {
    uid: q.ownerId, type, listingId: q.listingId, postId: '', postTitle: q.title,
    read: false, createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
  });
}

function log(tx: Transaction, db: Firestore, action: string, target: string, by: string, note = ''): void {
  tx.set(db.collection('moderation_log').doc(), {
    action, target, by, note: String(note ?? '').slice(0, 500), at: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
  });
}

/** Hide a listing in place: listing writes are Function-only, so a status flip is as final as the 2B move (T-19). */
function hideListingTx(
  tx: Transaction, db: Firestore, q: MarketQueueDoc, l: DocumentData, by: 'reports' | 'operator', actor: string, note = '',
): void {
  q.statusBeforeHide = l.status === 'closed' ? 'closed' : 'active';
  tx.update(listingRef(db, q.listingId), { status: 'hidden', updatedAt: FieldValue.serverTimestamp() });
  q.status = 'hidden';
  q.hiddenBy = by;
  q.transitions += 1;
  q.needsReview = true;
  notifyOwner(tx, db, q, 'listing_hidden');
  log(tx, db, `listing_hide:${by}`, q.listingId, actor, note);
}

/**
 * `reportMarket` (T-19, T-20). kind 'listing': one report per (listing,
 * mailbox), the same daily cap and discredit counters as post reports
 * (`moderation_actors/{emailKey}`, M-7/M-9/M-20); 3 distinct counted reporters
 * hide the listing unless an operator already cleared it. kind 'room': a
 * participant files a case about the other party (harassment, 受け渡し不履行 =
 * `no_show`, fraud) — one open case per (room, side), operator-handled, never
 * an automatic sanction.
 */
export async function processMarketReport(
  db: Firestore, reporter: MarketCaller, input: Record<string, unknown>, now: Date = new Date(),
): Promise<{ status: MarketReportStatus }> {
  const kind = input?.kind;
  const targetId = input?.targetId;
  if (kind !== 'listing' && kind !== 'room') throw new HttpsError('invalid-argument', 'bad kind');
  if (!isDocId(targetId)) throw new HttpsError('invalid-argument', 'bad target');
  const cats: readonly string[] = kind === 'listing' ? LISTING_REPORT_CATEGORIES : ROOM_REPORT_CATEGORIES;
  const category = input.category;
  if (typeof category !== 'string' || !cats.includes(category)) throw new HttpsError('invalid-argument', 'bad category');
  const detail = sanitizeText(input.detail);
  if (detail.length > MODERATION.maxDetail) throw new HttpsError('invalid-argument', 'detail too long');
  const key = callerKey(reporter);
  const day = jstDay(now);

  return db.runTransaction(async (tx) => {
    const actorSnap = await tx.get(actorRef(db, key));
    const actor = actorSnap.data() ?? {};
    const usedToday = actor.reportDay === day ? num(actor.reportsToday) : 0;
    const bump = () => tx.set(actorRef(db, key), { reportDay: day, reportsToday: usedToday + 1, university_id: UNIVERSITY_ID }, { merge: true });

    if (kind === 'room') {
      const room = await tx.get(roomRef(db, targetId));
      if (!room.exists) throw new HttpsError('not-found', 'room not found');
      const r = room.data()!;
      const side = r.lenderId === reporter.uid ? 'lender' : r.borrowerId === reporter.uid ? 'borrower' : null;
      if (!side) throw new HttpsError('permission-denied', 'not-participant');
      const ref = caseRef(db, `${targetId}_${side}`);
      const existing = await tx.get(ref);
      if (existing.exists && existing.get('status') === 'open') return { status: 'duplicate' as const };
      if (usedToday >= MODERATION.reportDailyCap) throw new HttpsError('resource-exhausted', 'report-limit');
      tx.set(ref, {
        roomId: targetId, listingId: String(r.listingId ?? ''), category, detail, status: 'open',
        reporterUid: reporter.uid, reportedUid: side === 'lender' ? r.borrowerId : r.lenderId,
        priority: category === 'harassment' || category === 'fraud' ? 'high' : 'normal',
        createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
      });
      bump();
      return { status: 'case_opened' as const };
    }

    const listing = await tx.get(listingRef(db, targetId));
    const mine = await tx.get(listingReportRef(db, targetId, key));
    const qs = await tx.get(marketQueueRef(db, targetId));
    if (!listing.exists) throw new HttpsError('not-found', 'listing not found');
    const l = listing.data()!;
    if (l.status === 'hidden') return { status: 'already_hidden' as const };
    if (l.ownerId === reporter.uid) throw new HttpsError('failed-precondition', 'own-listing');
    if (mine.exists) return { status: 'duplicate' as const };
    if (usedToday >= MODERATION.reportDailyCap) throw new HttpsError('resource-exhausted', 'report-limit');
    const counted = num(actor.restoredReports) < MODERATION.discreditRestoredReports;
    const q = readMarketQueue(qs, targetId, l);
    q.reportCount += 1;
    if (counted) q.countedReports += 1;
    tx.create(listingReportRef(db, targetId, key), {
      listingId: targetId, reporterUid: reporter.uid, category, detail, counted,
      createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
    });
    bump();
    let status: MarketReportStatus = 'reported';
    if (q.autoHide && q.countedReports >= MODERATION.reportHideThreshold) {
      hideListingTx(tx, db, q, l, 'reports', 'system');
      status = 'hidden';
    } else if (!q.autoHide) {
      q.needsReview = true;
    }
    writeMarketQueue(tx, db, q, !qs.exists);
    return { status };
  });
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

/** Operator: hide a listing (any status but hidden). Idempotent. */
export async function hideListing(db: Firestore, idIn: unknown, act: OperatorAction): Promise<{ changed: boolean }> {
  const op = operatorName(act);
  const id = requireId(idIn);
  return db.runTransaction(async (tx) => {
    const l = await tx.get(listingRef(db, id));
    const qs = await tx.get(marketQueueRef(db, id));
    if (!l.exists) throw new HttpsError('not-found', 'listing not found');
    if (l.get('status') === 'hidden') return { changed: false };
    const q = readMarketQueue(qs, id, l.data());
    hideListingTx(tx, db, q, l.data()!, 'operator', `operator:${op}`, act.note);
    writeMarketQueue(tx, db, q, !qs.exists);
    return { changed: true };
  });
}

/**
 * Operator: the listing is fine. A hidden listing goes back to the status it had
 * (its expiry is unchanged, so an expired one simply stays out of the list);
 * auto-hide is switched off for it (M-8) and the reporters behind a report-hide
 * are discredited exactly like post reporters (M-9).
 */
export async function restoreListing(
  db: Firestore, idIn: unknown, act: OperatorAction,
): Promise<{ changed: boolean; discredited: string[] }> {
  const op = operatorName(act);
  const id = requireId(idIn);
  return db.runTransaction(async (tx) => {
    const l = await tx.get(listingRef(db, id));
    const qs = await tx.get(marketQueueRef(db, id));
    const counted = await tx.get(marketQueueRef(db, id).collection('reports').where('counted', '==', true));
    if (!l.exists) throw new HttpsError('not-found', 'listing not found');
    const q = readMarketQueue(qs, id, l.data());
    const hidden = l.get('status') === 'hidden';
    const discredited: string[] = [];
    if (hidden) {
      tx.update(listingRef(db, id), { status: q.statusBeforeHide, updatedAt: FieldValue.serverTimestamp() });
      if (q.hiddenBy === 'reports') for (const r of counted.docs) discredited.push(r.id);
      for (const k of discredited) {
        tx.set(actorRef(db, k), { restoredReports: FieldValue.increment(1), university_id: UNIVERSITY_ID }, { merge: true });
        log(tx, db, 'discredit', k, `operator:${op}`, `restoredReports+1 for listing ${id}`);
      }
      q.transitions += 1;
      notifyOwner(tx, db, q, 'listing_restored');
    }
    q.status = 'restored';
    q.autoHide = false;
    q.needsReview = false;
    log(tx, db, hidden ? 'listing_restore' : 'listing_acknowledge', id, `operator:${op}`, act.note);
    writeMarketQueue(tx, db, q, !qs.exists);
    return { changed: hidden, discredited };
  });
}

/** Operator: delete a listing for good. Its photos go via onListingDeleted. */
export async function removeListing(db: Firestore, idIn: unknown, act: OperatorAction): Promise<{ changed: boolean }> {
  const op = operatorName(act);
  const id = requireId(idIn);
  return db.runTransaction(async (tx) => {
    const l = await tx.get(listingRef(db, id));
    const qs = await tx.get(marketQueueRef(db, id));
    if (!l.exists) throw new HttpsError('not-found', 'listing not found');
    const q = readMarketQueue(qs, id, l.data());
    tx.delete(listingRef(db, id));
    q.status = 'removed';
    q.autoHide = false;
    q.needsReview = false;
    q.transitions += 1;
    notifyOwner(tx, db, q, 'listing_removed');
    log(tx, db, 'listing_remove', id, `operator:${op}`, act.note);
    writeMarketQueue(tx, db, q, !qs.exists);
    return { changed: true };
  });
}

/** Operator: a room case (harassment / 受け渡し不履行 / fraud) has been dealt with. */
export async function closeCase(db: Firestore, idIn: unknown, act: OperatorAction): Promise<{ changed: boolean }> {
  const op = operatorName(act);
  const id = requireId(idIn);
  return db.runTransaction(async (tx) => {
    const c = await tx.get(caseRef(db, id));
    if (!c.exists) throw new HttpsError('not-found', 'case not found');
    if (c.get('status') === 'closed') return { changed: false };
    tx.update(caseRef(db, id), { status: 'closed', closedBy: op, closedAt: FieldValue.serverTimestamp() });
    log(tx, db, 'case_close', id, `operator:${op}`, act.note);
    return { changed: true };
  });
}

/** What needs an operator in the market: reported/hidden/flagged listings and open cases (high priority first). */
export async function listMarketQueue(db: Firestore, limit = 50): Promise<{
  listings: Array<MarketQueueDoc & { updatedAtMs: number }>;
  cases: Array<DocumentData & { id: string }>;
}> {
  const [active, flagged, open] = await Promise.all([
    db.collection('market_queue').where('status', 'in', ['open', 'hidden']).limit(limit).get(),
    db.collection('market_queue').where('needsReview', '==', true).limit(limit).get(),
    db.collection('market_cases').where('status', '==', 'open').limit(limit).get(),
  ]);
  const byId = new Map<string, MarketQueueDoc & { updatedAtMs: number }>();
  for (const d of [...active.docs, ...flagged.docs]) byId.set(d.id, { ...readMarketQueue(d, d.id), updatedAtMs: millisOf(d.get('updatedAt')) });
  const cases = open.docs.map((d): DocumentData & { id: string } => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1) || millisOf(b.createdAt) - millisOf(a.createdAt));
  return { listings: [...byId.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs), cases };
}

/**
 * `onListingDeleted` (T-21): a listing is deleted only by an operator; its photos
 * go too — but ONLY objects under the owner's own `listings/<ownerId>/` prefix,
 * so a forged path list could never delete someone else's file.
 */
export async function handleListingDeleted(deps: DeleteDeps, listing: Record<string, unknown>): Promise<string[]> {
  const owner = String(listing.ownerId ?? '');
  const prefix = `listings/${owner}/`;
  const paths = !owner || !Array.isArray(listing.photoPaths) ? [] : listing.photoPaths.filter((p): p is string =>
    typeof p === 'string' && p.startsWith(prefix) && !p.slice(prefix.length).includes('/') && !p.includes('..'));
  for (const p of paths) {
    try { await deps.remove(p); } catch { /* already gone */ }
  }
  return paths;
}

```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — 183 + 8 = **191**.

- [ ] **Step 5: Commit (now — before the next task)**

```bash
git add functions/src/marketModeration.ts functions/test/marketModeration.test.mjs
git commit -m "feat(functions): market moderation — listing reports reuse 2B caps/threshold/discredit, chat cases, operator actions, photo cleanup (Plan 3)"
```

---

### Task 7: Wire the market callables and triggers in `index.ts`

**Files:**
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `processCreateListing`, `processUpdateListing` (T2), `handleListingCreated` (T3), `processOpenChat`, `processBlockRoom`, `handleMessageCreated` (T4), `processRateDeal` (T5), `processMarketReport`, `handleListingDeleted` (T6), `requireKuVerified` (common), the existing `db`, `opts`, `storageDeps`.
- Produces (exported Firebase functions): callables **`createListing`**, **`updateListing`**, **`openListingChat`**, **`blockRoom`**, **`rateDeal`**, **`reportMarket`**; triggers **`onListingCreated`** (`textbook_listings/{listingId}` created), **`onListingDeleted`** (`textbook_listings/{listingId}` deleted), **`onTalkMessageCreated`** (`talk_rooms/{roomId}/messages/{messageId}` created). Every 2A/2B export is unchanged.

- [ ] **Step 1: Edit `functions/src/index.ts`**

In `functions/src/index.ts` replace

```ts
import { handlePostWritten, handleReviewWritten } from './courseStats.js';
```

with

```ts
import { handlePostWritten, handleReviewWritten } from './courseStats.js';
import { processCreateListing, processUpdateListing } from './listings.js';
import { handleListingCreated } from './listingMatch.js';
import { handleMessageCreated, processBlockRoom, processOpenChat } from './chat.js';
import { processRateDeal } from './ratings.js';
import { handleListingDeleted, processMarketReport } from './marketModeration.js';
import type { MarketCaller } from './marketCore.js';
```

Append to `functions/src/index.ts`:

```ts

// --- Textbook market + chat (Plan 3) ------------------------------------------
// Every market write goes through these: listings, rooms, ratings, reports and
// blocks are Function-owned (firestore.rules deny client writes). The caller is
// always a verified KU student; identity for caps and reputation is the mailbox.
const marketCaller = (auth: Parameters<typeof requireKuVerified>[0]): MarketCaller =>
  ({ uid: requireKuVerified(auth), email: String(auth?.token.email ?? '') });
const payload = (data: unknown) => (data ?? {}) as Record<string, unknown>;

export const createListing = onCall(opts, async (req) => processCreateListing(db, marketCaller(req.auth), payload(req.data)));
export const updateListing = onCall(opts, async (req) => processUpdateListing(db, marketCaller(req.auth), payload(req.data)));
export const openListingChat = onCall(opts, async (req) => processOpenChat(db, marketCaller(req.auth), payload(req.data)));
export const blockRoom = onCall(opts, async (req) => processBlockRoom(db, marketCaller(req.auth), payload(req.data)));
export const rateDeal = onCall(opts, async (req) => processRateDeal(db, marketCaller(req.auth), payload(req.data)));
export const reportMarket = onCall(opts, async (req) => processMarketReport(db, marketCaller(req.auth), payload(req.data)));

export const onListingCreated = onDocumentCreated({ ...opts, document: 'textbook_listings/{listingId}' }, async (event) => {
  await handleListingCreated(db, event.params.listingId);
});

export const onListingDeleted = onDocumentDeleted({ ...opts, document: 'textbook_listings/{listingId}' }, async (event) => {
  const data = event.data?.data();
  if (data) await handleListingDeleted(storageDeps, data);
});

export const onTalkMessageCreated = onDocumentCreated(
  { ...opts, document: 'talk_rooms/{roomId}/messages/{messageId}' },
  async (event) => { await handleMessageCreated(db, event.params.roomId, event.data?.data()); },
);
```

- [ ] **Step 2: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — **191** tests, `tsc` clean (it type-checks `index.ts`).

- [ ] **Step 3: Verify**

Run: `grep -cE "^exports\.(createListing|updateListing|openListingChat|blockRoom|rateDeal|reportMarket|onListingCreated|onListingDeleted|onTalkMessageCreated) = \(0," functions/lib/index.js`
Expected: `9`.

- [ ] **Step 4: Verify**

Run: `grep -nE "credit_balances|credits_ledger|writeCredit" functions/src/marketCore.ts functions/src/listings.ts functions/src/listingMatch.ts functions/src/chat.ts functions/src/ratings.ts functions/src/marketModeration.ts`
Expected: no output (T-3: the market never touches credits).

- [ ] **Step 5: Commit (now — before the next task)**

```bash
git add functions/src/index.ts
git commit -m "feat(functions): wire createListing, updateListing, openListingChat, blockRoom, rateDeal, reportMarket and the three market triggers (Plan 3)"
```

---

### Task 8: Firestore rules, indexes, Storage rules and their tests

**Files:**
- Modify: `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `firestore-tests/rules.test.mjs`, `firestore-tests/storage.test.mjs`

**Interfaces:**
- Produces (rules): `textbook_requests` — read `kuDomain()`, **no write** (T-1). `talk_rooms` — read unchanged (participants, 2B M-15); **create/delete denied** (rooms come from `openListingChat`); update = only the caller's own `lenderReadAt`/`borrowerReadAt`, equal to `request.time` (T-18). `talk_rooms/{id}/messages/{msgId}` — read: the room's two parties; create: a verified party, `senderId == uid`, `keys().hasOnly(['senderId','text','createdAt','university_id'])`, text 1–1000, `createdAt == request.time`, `university_id == 'kyoto_u'`, room not `closedBy`; no update/delete. `textbook_listings` — read `kuDomain()` except a `hidden` listing (owner only), **no write**. `market_profiles` — read `kuDomain()`, no write. Admin-only with explicit denies: `market_identities`, `market_actors`, `market_blocks`, `market_inbox`, `market_ratings`, `market_reputation`, `market_queue` (+ `reports`), `market_cases`.
- Produces (indexes): `textbook_listings` `(status ASC, expiresAt DESC)` and `(courseId ASC, status ASC, expiresAt DESC)`.
- Produces (Storage): `kuDomain()`; `listings/{uid}/{file}` — read `kuDomain()`; create by the verified owner, ≤ 2 MiB, `image/(png|jpeg|webp)`, never over an existing object; no update/delete.

- [ ] **Step 1: Update the Firestore rules tests first — `firestore-tests/rules.test.mjs`**

In `firestore-tests/rules.test.mjs` replace

```js
  setDoc, getDoc, updateDoc, deleteDoc, doc,
  getDocs, query, where, collection,
} from 'firebase/firestore';
```

with

```js
  setDoc, getDoc, updateDoc, deleteDoc, doc,
  getDocs, query, where, collection, orderBy, limit, serverTimestamp, Timestamp,
} from 'firebase/firestore';
```

In `firestore-tests/rules.test.mjs` replace

```js
    await setDoc(doc(db, 'secret_admin_stuff/s_1'), { university_id: 'kyoto_u' });
  });
});
```

with

```js
    await setDoc(doc(db, 'secret_admin_stuff/s_1'), { university_id: 'kyoto_u' });
    // Plan 3: a market room (u1 = owner/lender, u2 = requester/borrower) with
    // one message, a room u2 blocked, a live listing by u1 and a hidden one.
    await setDoc(doc(db, 'talk_rooms/room_1/messages/m1'), {
      senderId: 'u1', text: 'hello', createdAt: Timestamp.fromMillis(1), university_id: 'kyoto_u',
    });
    await setDoc(doc(db, 'talk_rooms/room_closed'), {
      lenderId: 'u1', borrowerId: 'u2', university_id: 'kyoto_u', closedBy: 'u2',
    });
    await setDoc(doc(db, 'textbook_listings/l_1'), {
      id: 'l_1', ownerId: 'u1', type: 'sell', title: '線形代数入門', status: 'active', price: 1500,
      expiresAt: Timestamp.fromMillis(Date.now() + 86400000), university_id: 'kyoto_u',
    });
    await setDoc(doc(db, 'textbook_listings/l_hidden'), {
      id: 'l_hidden', ownerId: 'u1', type: 'sell', title: '通報で非表示', status: 'hidden',
      expiresAt: Timestamp.fromMillis(Date.now() + 86400000), university_id: 'kyoto_u',
    });
    await setDoc(doc(db, 'market_profiles/u1'), { ratingCount: 1, ratingSum: 5, recentComments: [], university_id: 'kyoto_u' });
  });
});
```

In `firestore-tests/rules.test.mjs` replace everything from the line `// --- textbook_requests -------------------------------------------------------` up to (not including) the line `// --- talk_rooms --------------------------------------------------------------` with:

```js
// --- textbook_requests: retired (Plan 3, T-1) --------------------------------

test('textbook_requests: no client may create, update or delete one any more (3)', async () => {
  await assertFails(setDoc(doc(asKu(), 'textbook_requests/tb_new'), {
    requesterId: 'u1', university_id: 'kyoto_u', status: 'open',
  }));
  await assertFails(updateDoc(doc(asKu2(), 'textbook_requests/tb_u1'), { status: 'matched' }));
  await assertFails(updateDoc(doc(asKu(), 'textbook_requests/tb_u1'), { status: 'completed' })); // not even the requester
  await assertFails(setDoc(doc(asKu2(), 'textbook_requests/tb_full'), fullTextbookRequest({
    status: 'matched', responderId: 'u2', responderName: '貸主', talkRoomId: 'room_9',
  })));
  await assertFails(deleteDoc(doc(asKu(), 'textbook_requests/tb_u1')));
});

```

In `firestore-tests/rules.test.mjs` replace everything from the line `// --- talk_rooms --------------------------------------------------------------` up to (not including) the line `// --- talk_rooms: participants only (Plan 2B, M-15) --------------------------` with:

```js
// --- talk_rooms: Function-created, summary Function-owned (Plan 3) ----------

const stranger = () => env.authenticatedContext('u7', { email: 'g@st.kyoto-u.ac.jp', email_verified: true }).firestore();

test('talk_rooms: no client creates a room — not even a would-be participant (3, T-14)', async () => {
  await assertFails(setDoc(doc(asKu(), 'talk_rooms/room_new'), {
    lenderId: 'u1', borrowerId: 'u2', university_id: 'kyoto_u',
  }));
  await assertFails(setDoc(doc(asKu2(), 'talk_rooms/l_l_1_u2'), {
    lenderId: 'u1', borrowerId: 'u2', listingId: 'l_1', university_id: 'kyoto_u',
  }));
});

test('talk_rooms: the legacy messages array is frozen and the summary is Function-owned (3, T-18)', async () => {
  await assertFails(updateDoc(doc(asKu(), 'talk_rooms/room_chat'), {
    messages: [{ id: 'm1', text: 'hello' }, { id: 'm2', text: 'reply' }, { id: 'm3', text: 'more' }],
  }));
  for (const patch of [
    { warningNotice: 'x' }, { lastMessageText: '振込先は…' }, { lastSenderId: 'u2' }, { lenderSent: true },
    { borrowerSent: true }, { closedBy: null }, { lenderId: 'u3' }, { borrowerId: 'u1' }, { university_id: 'other_u' },
  ]) {
    await assertFails(updateDoc(doc(asKu(), 'talk_rooms/room_1'), patch), JSON.stringify(patch));
  }
});

test('talk_rooms: each party may set ONLY their own read marker, and only to the server time (3)', async () => {
  await assertSucceeds(updateDoc(doc(asKu(), 'talk_rooms/room_1'), { lenderReadAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(asKu2(), 'talk_rooms/room_1'), { borrowerReadAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(asKu(), 'talk_rooms/room_1'), { borrowerReadAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(asKu2(), 'talk_rooms/room_1'), { lenderReadAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(asKu(), 'talk_rooms/room_1'), { lenderReadAt: Timestamp.fromMillis(4102444800000) }));
  await assertFails(updateDoc(doc(asKu(), 'talk_rooms/room_1'), { lenderReadAt: serverTimestamp(), lenderSent: true }));
  await assertFails(updateDoc(doc(stranger(), 'talk_rooms/room_1'), { lenderReadAt: serverTimestamp() }));
});

test('talk rooms cannot be deleted', async () => {
  await assertFails(deleteDoc(doc(asKu(), 'talk_rooms/room_1')));
});

// --- talk_rooms/{id}/messages (Plan 3, spec §4.5.5) --------------------------

const goodMsg = (over = {}) => ({ senderId: 'u1', text: 'こんにちは', createdAt: serverTimestamp(), university_id: 'kyoto_u', ...over });

test('messages: only the two parties can read them, page by page; nobody else (3)', async () => {
  const page = (db) => getDocs(query(collection(db, 'talk_rooms/room_1/messages'), orderBy('createdAt', 'desc'), limit(30)));
  await assertSucceeds(page(asKu()));
  await assertSucceeds(page(asKu2()));
  await assertFails(page(stranger()));
  await assertFails(page(asOutsider()));
  await assertSucceeds(getDoc(doc(asKu2(), 'talk_rooms/room_1/messages/m1')));
  await assertFails(getDoc(doc(stranger(), 'talk_rooms/room_1/messages/m1')));
});

test('messages: a verified party posts as themselves, stamped with the server time (3)', async () => {
  await assertSucceeds(setDoc(doc(asKu(), 'talk_rooms/room_1/messages/a1'), goodMsg()));
  await assertSucceeds(setDoc(doc(asKu2(), 'talk_rooms/room_1/messages/a2'), goodMsg({ senderId: 'u2' })));
  await assertSucceeds(setDoc(doc(asKu(), 'talk_rooms/room_1/messages/a3'), goodMsg({ text: 'x'.repeat(1000) }))); // boundary
  const bads = [
    goodMsg({ senderId: 'u2' }), goodMsg({ text: '' }), goodMsg({ text: 'x'.repeat(1001) }), goodMsg({ text: 42 }),
    goodMsg({ createdAt: Timestamp.fromMillis(1) }), goodMsg({ university_id: 'other_u' }),
    goodMsg({ senderName: '運営' }), goodMsg({ lastMessageText: 'x' }),
  ];
  for (const [i, m] of bads.entries()) {
    await assertFails(setDoc(doc(asKu(), `talk_rooms/room_1/messages/b${i}`), m), JSON.stringify(m));
  }
});

test('messages: strangers, unverified parties and outsiders cannot post (3)', async () => {
  await assertFails(setDoc(doc(stranger(), 'talk_rooms/room_1/messages/s1'), goodMsg({ senderId: 'u7' })));
  await assertFails(setDoc(doc(asKuUnverified(), 'talk_rooms/room_1/messages/s2'), goodMsg({ senderId: 'u2' })));
  await assertFails(setDoc(doc(asOutsider(), 'talk_rooms/room_1/messages/s3'), goodMsg({ senderId: 'u3' })));
  await assertFails(setDoc(doc(asKu(), 'talk_rooms/no_such_room/messages/s4'), goodMsg()));
});

test('messages: immutable — no edit, no delete, not even by the sender (3)', async () => {
  await assertFails(updateDoc(doc(asKu(), 'talk_rooms/room_1/messages/m1'), { text: 'rewritten' }));
  await assertFails(deleteDoc(doc(asKu(), 'talk_rooms/room_1/messages/m1')));
  await assertFails(deleteDoc(doc(asKu2(), 'talk_rooms/room_1/messages/m1')));
});

test('messages: a closed (blocked) room accepts nothing from either side (3, T-17)', async () => {
  await assertFails(setDoc(doc(asKu(), 'talk_rooms/room_closed/messages/c1'), goodMsg()));
  await assertFails(setDoc(doc(asKu2(), 'talk_rooms/room_closed/messages/c2'), goodMsg({ senderId: 'u2' })));
});

```

In `firestore-tests/rules.test.mjs` insert directly before the line `// --- catch-all ---------------------------------------------------------------`:

```js
// --- textbook market (Plan 3) -------------------------------------------------

test('textbook_listings: any KU address reads and runs the list queries; no client writes, not even the owner (3)', async () => {
  await assertSucceeds(getDoc(doc(asKuUnverified(), 'textbook_listings/l_1')));
  await assertFails(getDoc(doc(asOutsider(), 'textbook_listings/l_1')));
  const now = Timestamp.now();
  await assertSucceeds(getDocs(query(collection(asKu(), 'textbook_listings'),
    where('status', '==', 'active'), where('expiresAt', '>', now), orderBy('expiresAt', 'desc'), limit(50))));
  await assertSucceeds(getDocs(query(collection(asKu(), 'textbook_listings'), where('ownerId', '==', 'u1'))));
  const owner = asKu();
  await assertFails(setDoc(doc(owner, 'textbook_listings/l_new'), {
    id: 'l_new', ownerId: 'u1', type: 'give', title: 't', status: 'active', university_id: 'kyoto_u',
  }));
  await assertFails(updateDoc(doc(owner, 'textbook_listings/l_1'), { price: 1 }));
  await assertFails(updateDoc(doc(owner, 'textbook_listings/l_1'), { status: 'active', expiresAt: Timestamp.fromMillis(4102444800000) }));
  await assertFails(updateDoc(doc(asKu2(), 'textbook_listings/l_1'), { ownerId: 'u2' }));
  await assertFails(deleteDoc(doc(owner, 'textbook_listings/l_1')));
});

test('textbook_listings: a listing hidden by moderation is readable by its owner only; an unfiltered list is refused (3, T-19)', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'textbook_listings/l_hidden')));
  await assertFails(getDoc(doc(asKu2(), 'textbook_listings/l_hidden')));
  await assertSucceeds(getDocs(query(collection(asKu(), 'textbook_listings'), where('ownerId', '==', 'u1'))));
  await assertFails(getDocs(query(collection(asKu2(), 'textbook_listings'), where('ownerId', '==', 'u1'))));
  await assertFails(getDocs(query(collection(asKu2(), 'textbook_listings'), where('status', '==', 'hidden'))));
  await assertFails(getDocs(collection(asKu2(), 'textbook_listings')));
});

test('market_profiles: KU-readable rating summaries that no client can forge (3, T-10)', async () => {
  await assertSucceeds(getDoc(doc(asKu2(), 'market_profiles/u1')));
  await assertFails(getDoc(doc(asOutsider(), 'market_profiles/u1')));
  await assertFails(setDoc(doc(asKu(), 'market_profiles/u1'), { ratingCount: 99, ratingSum: 495 }));
  await assertFails(updateDoc(doc(asKu(), 'market_profiles/u1'), { ratingSum: 5000 }));
  await assertFails(setDoc(doc(asKu2(), 'market_profiles/u2'), { ratingCount: 1, ratingSum: 5 }));
});

const MARKET_ADMIN_ONLY = [
  'market_identities/u1', 'market_actors/k1', 'market_blocks/u1_u2', 'market_inbox/u1', 'market_ratings/room_1_lender',
  'market_reputation/k1', 'market_queue/l_1', 'market_queue/l_1/reports/k1', 'market_cases/room_1_borrower',
];
for (const path of MARKET_ADMIN_ONLY) {
  test(`${path}: Admin-only — no client may get, create or delete (3)`, async () => {
    for (const db of [asKu(), asKu2()]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { uid: 'u1', stars: 5, university_id: 'kyoto_u' }));
      await assertFails(deleteDoc(doc(db, path)));
    }
  });
}

test('market collections cannot be listed by any client (3)', async () => {
  for (const name of ['market_identities', 'market_actors', 'market_blocks', 'market_inbox', 'market_ratings',
    'market_reputation', 'market_queue', 'market_cases']) {
    await assertFails(getDocs(collection(asKu(), name)));
  }
  await assertFails(getDocs(collection(asKu(), 'market_queue/l_1/reports')));
  await assertFails(getDocs(query(collection(asKu(), 'market_ratings'), where('rateeUid', '==', 'u1'))));
});

```

This removes the six 参考書リクエスト tests (create / flip / full-write ×3 / delete) and the eight array-era talk-room tests (participant create, participant post, the four M6 append-only tests, re-point, delete — delete is re-added), and adds 23 (net **+9**). The 2B tests `talk_rooms: only the two participants can read a room` and `the participant queries are allowed` stay as they are.

- [ ] **Step 2: Append the Storage rules tests — `firestore-tests/storage.test.mjs`**

Append to `firestore-tests/storage.test.mjs`:

```js

// --- listing photos (Plan 3, T-5) ---------------------------------------------

const jpeg = { contentType: 'image/jpeg' };

test('listing photos: a verified owner creates small images under their own listings/ prefix only', async () => {
  const s = st('u1', KU);
  await assertSucceeds(uploadBytes(ref(s, 'listings/u1/1_a.jpg'), bytes, jpeg));
  await assertSucceeds(uploadBytes(ref(s, 'listings/u1/2_a.webp'), new Uint8Array(2 * 1024 * 1024), { contentType: 'image/webp' })); // boundary
  await assertFails(uploadBytes(ref(s, 'listings/u1/big.jpg'), new Uint8Array(2 * 1024 * 1024 + 1), jpeg));
  await assertFails(uploadBytes(ref(s, 'listings/u2/1_a.jpg'), bytes, jpeg));
  await assertFails(uploadBytes(ref(s, 'listings/u1/sub/a.jpg'), bytes, jpeg));
  await assertFails(uploadBytes(ref(s, 'listings/u1/a.pdf'), bytes, pdf));
  await assertFails(uploadBytes(ref(s, 'listings/u1/a.svg'), bytes, { contentType: 'image/svg+xml' }));
  await assertFails(uploadBytes(ref(st('u2', KU_UNVERIFIED), 'listings/u2/a.jpg'), bytes, jpeg));
  await assertFails(uploadBytes(ref(st('u3', OUTSIDER), 'listings/u3/a.jpg'), bytes, jpeg));
});

test('listing photos: any KU address may read; outsiders and anonymous may not; nobody overwrites or deletes', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), 'listings/u1/seeded.jpg'), bytes, jpeg);
  });
  await assertSucceeds(getBytes(ref(st('u2', KU_UNVERIFIED), 'listings/u1/seeded.jpg')));
  await assertSucceeds(getBytes(ref(st('u1', KU), 'listings/u1/seeded.jpg')));
  await assertFails(getBytes(ref(st('u3', OUTSIDER), 'listings/u1/seeded.jpg')));
  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), 'listings/u1/seeded.jpg')));
  await assertFails(uploadBytes(ref(st('u1', KU), 'listings/u1/seeded.jpg'), bytes, jpeg));
  await assertFails(deleteObject(ref(st('u1', KU), 'listings/u1/seeded.jpg')));
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `bash tools/test_rules.sh ; bash tools/test_storage_rules.sh`
Expected: FAIL — rules: exactly **9** of 136 (the retired-requests test, the three new talk-room tests, the messages read and post tests, both `textbook_listings` tests and the `market_profiles` test: the old rules allow request/room/array writes and have no `textbook_listings`, `market_profiles` or `messages` blocks; the Admin-only and the deny-only message tests already pass under the catch-all — they pin the explicit blocks). Storage: the 2 new tests fail (no `listings/` block).

- [ ] **Step 4: Edit `firestore.rules`**

In `firestore.rules` replace everything from the line `match /textbook_requests/{id} {` up to (not including) the line `match /transactions/{id} {` with:

```
    // Plan 3 (T-1): the 参考書リクエスト board is retired — the textbook market
    // (`textbook_listings`, 買いたい) replaces it. Old documents stay readable as
    // history; no client may write one any more.
    match /textbook_requests/{id} {
      allow read: if kuDomain();
      allow write: if false;
    }

    // A talk room is a two-party chat, created ONLY by the `openListingChat`
    // Cloud Function (Plan 3, T-14). Messages live in the `messages`
    // subcollection (spec §4.5.5); the old `messages` array is frozen. The room
    // summary (last message, who has spoken, closedBy) is Function-owned (T-18),
    // so the only field a participant may write is their OWN read marker, and
    // only to the server time.
    function roomParty(room) {
      return signedIn() && (room.lenderId == request.auth.uid || room.borrowerId == request.auth.uid);
    }
    function readMarker(room) {
      return room.lenderId == request.auth.uid ? 'lenderReadAt' : 'borrowerReadAt';
    }
    match /talk_rooms/{id} {
      // Plan 2B (M-15): only the two parties may read a room; the client
      // listens with `where('lenderId'|'borrowerId', '==', <own uid>)`.
      allow read: if kuDomain()
        && (resource.data.lenderId == request.auth.uid
            || resource.data.borrowerId == request.auth.uid);
      allow create, delete: if false;
      allow update: if roomParty(resource.data)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([readMarker(resource.data)])
        && request.resource.data[readMarker(resource.data)] == request.time;

      // One document per message: no 1 MiB array, no lost-update race. Only the
      // two parties read; a verified party posts as themselves, stamped with the
      // server time, while the room is not closed (blocked, T-17). The name
      // shown is taken from the room (Function-sanitized), never from here.
      // Immutable: no edit, no delete.
      match /messages/{msgId} {
        allow read: if kuDomain()
          && roomParty(get(/databases/$(database)/documents/talk_rooms/$(id)).data);
        allow create: if kuVerified()
          && roomParty(get(/databases/$(database)/documents/talk_rooms/$(id)).data)
          && get(/databases/$(database)/documents/talk_rooms/$(id)).data.get('closedBy', null) == null
          && request.resource.data.keys().hasOnly(['senderId', 'text', 'createdAt', 'university_id'])
          && request.resource.data.senderId == request.auth.uid
          && request.resource.data.text is string
          && request.resource.data.text.size() >= 1
          && request.resource.data.text.size() <= 1000
          && request.resource.data.createdAt == request.time
          && request.resource.data.university_id == 'kyoto_u';
        allow update, delete: if false;
      }
    }

```

In `firestore.rules` insert directly before the line `match /{document=**} {`:

```
    // Textbook market (Plan 3). Listings and the public rating summaries are
    // written ONLY by Cloud Functions (createListing / updateListing / the
    // moderation tools; refreshReputation): server ids, owner = caller, daily
    // caps and validation cannot be bypassed. Any KU address may read them,
    // except that a listing hidden by moderation (T-19) is readable by its owner
    // only — so the list query must say `where('status', '==', 'active')` (or
    // `where('ownerId', '==', <own uid>)`). Closed and expired listings are
    // left out by that query (T-8).
    match /textbook_listings/{id} {
      allow read: if kuDomain()
        && (resource.data.status != 'hidden' || resource.data.ownerId == request.auth.uid);
      allow write: if false;
    }
    match /market_profiles/{uid} {
      allow read: if kuDomain();
      allow write: if false;
    }

    // Market state (Plan 3): Admin-only. Identities (uid -> mailbox key), daily
    // counters, blocks, match-notice caps, individual ratings (blind until
    // revealed, T-11), the per-mailbox reputation, the listing report queue and
    // the room cases (harassment / 受け渡し不履行).
    match /market_identities/{uid} {
      allow read, write: if false;
    }
    match /market_actors/{key} {
      allow read, write: if false;
    }
    match /market_blocks/{id} {
      allow read, write: if false;
    }
    match /market_inbox/{uid} {
      allow read, write: if false;
    }
    match /market_ratings/{id} {
      allow read, write: if false;
    }
    match /market_reputation/{key} {
      allow read, write: if false;
    }
    match /market_queue/{listingId} {
      allow read, write: if false;
      match /reports/{reporterKey} {
        allow read, write: if false;
      }
    }
    match /market_cases/{id} {
      allow read, write: if false;
    }

```

- [ ] **Step 5: Add the indexes — `firestore.indexes.json`**

In `firestore.indexes.json` replace

```json
        { "fieldPath": "uid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ],
```

with

```json
        { "fieldPath": "uid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "textbook_listings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "expiresAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "textbook_listings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "courseId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "expiresAt", "order": "DESCENDING" }
      ]
    }
  ],
```

- [ ] **Step 6: Edit `storage.rules`**

In `storage.rules` replace

```
        && request.auth.token.email_verified == true;
    }
```

with

```
        && request.auth.token.email_verified == true;
    }

    // A Kyoto University address, verified or not (firestore.rules kuDomain()).
    function kuDomain() {
      return request.auth != null
        && request.auth.token.email is string
        && request.auth.token.email.lower().matches('^[^@]+@st[.]kyoto-u[.]ac[.]jp$');
    }
```

In `storage.rules` insert directly before the line `match /{allPaths=**} {`:

```
    // Plan 3 (T-5): textbook listing photos. Readable by any KU address (the
    // app asks for a download URL at display time — never stored in Firestore);
    // a verified owner may CREATE small images under their own prefix, never
    // overwrite or delete (operator removal cleans up via onListingDeleted).
    // SVG and every non-image type are refused (script-capable / not a photo).
    match /listings/{uid}/{file} {
      allow read: if kuDomain();
      allow create: if resource == null
        && kuVerified()
        && request.auth.uid == uid
        && request.resource.size <= 2 * 1024 * 1024
        && request.resource.contentType.matches('image/(png|jpeg|webp)');
      allow update, delete: if false;
    }

```

- [ ] **Step 7: Run to verify it passes**

Run: `bash tools/test_rules.sh ; bash tools/test_storage_rules.sh ; python3 -c "import json; json.load(open('firestore.indexes.json'))"`
Expected: PASS — rules **136**/136 (127 − 14 + 23), storage **8**/8; the index file parses.

- [ ] **Step 8: Commit (now — before the next task)**

```bash
git add firestore.rules firestore.indexes.json storage.rules firestore-tests/rules.test.mjs firestore-tests/storage.test.mjs
git commit -m "feat(rules): Function-owned market and rooms, messages subcollection, retired textbook_requests, listing photos (Plan 3)"
```

---

### Task 9: AppStore seams + characterization tests (no behaviour change)

**Files:**
- Create: `test/support/store_harness.dart`, `test/services/app_store_test.dart`
- Modify: `lib/services/app_store.dart`, `lib/services/firestore_service.dart`

**Interfaces:**
- Produces: `AppStore(courses, reviews, ranking, credits, moderation, {FirebaseFirestore? db})` (the named parameter defaults to `FirebaseFirestore.instance`, so `main.dart` is unchanged); `FirestoreService([FirebaseFirestore? db])`; `AppStore._firebaseAuth` becomes a getter (resolved on use). Test-only: `Harness` (`db`, `store`, `calls`, `reply`, `signIn({uid, verified, name})`, `seedCourse(id, name)`).

**Why these two seams are behaviour-neutral:** in production `db` is `FirebaseFirestore.instance` exactly as before, and `FirebaseAuth.instance` is read on first use instead of at construction — the first use is still `_initFirebaseSync()`, called from the constructor. In a test (no Firebase app) the getter throws inside `_initFirebaseSync`'s existing `try/catch`, which leaves `isFirebaseConnected = false` and nothing else.

- [ ] **Step 1: Write the characterization tests (they pin TODAY's behaviour)**

Create `test/support/store_harness.dart`:

```dart
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:kyoto_exam_hub/models/user_profile.dart';
import 'package:kyoto_exam_hub/repositories/course_repository.dart';
import 'package:kyoto_exam_hub/services/app_store.dart';
import 'package:kyoto_exam_hub/services/credit_service.dart';
import 'package:kyoto_exam_hub/services/moderation_service.dart';
import 'package:kyoto_exam_hub/services/ranking_service.dart';
import 'package:kyoto_exam_hub/services/review_service.dart';

/// An AppStore on fake_cloud_firestore (Plan 3, Task 9). Every Firestore call
/// goes to [db]; every callable to [calls] (answered by [reply]); FirebaseAuth
/// is never touched (it is resolved lazily and the constructor's sync swallows
/// its absence). Shared by the characterization and widget tests.
class Harness {
  Harness() {
    store = AppStore(
      CourseRepository(db),
      ReviewService(db),
      RankingService(db),
      CreditService(db, _invoke),
      ModerationService(db, _invoke),
      db: db,
    );
  }

  final FakeFirebaseFirestore db = FakeFirebaseFirestore();
  late final AppStore store;
  final List<(String, Map<String, dynamic>)> calls = [];
  Map<String, dynamic> Function(String name, Map<String, dynamic> data) reply = (_, _) => {};

  Future<Map<String, dynamic>> _invoke(String name, Map<String, dynamic> data) async {
    calls.add((name, data));
    return reply(name, data);
  }

  void signIn({String uid = 'u1', bool verified = true, String name = '京大生_1234'}) {
    store.currentUser = UserProfile(
      uid: uid,
      email: '$uid@st.kyoto-u.ac.jp',
      displayName: name,
      createdAt: DateTime(2026, 4, 1),
      isVerified: verified,
    );
  }

  Future<void> seedCourse(String id, String name) => db.collection('courses').doc(id).set({
        'id': id, 'name': name, 'faculty': '全学共通', 'dayOfWeek': 'Mon', 'period': 1,
        'lecturer': '山田', 'courseKey': '$name|山田', 'university_id': 'kyoto_u',
      });
}
```

Create `test/services/app_store_test.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/app_notification.dart';
import 'package:kyoto_exam_hub/models/post.dart';
import 'package:kyoto_exam_hub/models/review.dart';
import 'package:kyoto_exam_hub/services/credit_service.dart';
import 'package:kyoto_exam_hub/services/moderation_service.dart';

import '../support/store_harness.dart';

// Characterization tests (Plan 3, Task 9): they pin what AppStore does TODAY,
// so the repository split (Task 10) and the market wiring (Task 12) are
// provably behaviour-preserving.

Future<Map<String, dynamic>?> _doc(FakeFirebaseFirestore db, String path) async => (await db.doc(path).get()).data();

void main() {
  test('a store builds without a Firebase app and starts signed out', () {
    final h = Harness();
    expect(h.store.currentUser, isNull);
    expect(h.store.posts, isEmpty);
  });

  test('addPost: signed out does nothing; signed in writes the post (tenant + server stamp), inserts it first, says so', () async {
    final h = Harness();
    expect(await h.store.addPost(subjectId: 'c1', category: PostCategory.pastExam, title: 't', description: '', fileNames: ['a.pdf'], filePaths: ['resources/u1/1_a.pdf']), isFalse);
    expect((await h.db.collection('posts').get()).docs, isEmpty);
    h.signIn();
    await h.seedCourse('c1', '線形代数A');
    final ok = await h.store.addPost(
      subjectId: 'c1', category: PostCategory.pastExam, year: 2025, title: '2025 期末', description: 'd',
      fileNames: ['a.pdf'], filePaths: ['resources/u1/1_a.pdf'], requestId: 'req_1',
    );
    expect(ok, isTrue);
    final p = h.store.posts.first;
    expect(p.id, startsWith('post_'));
    final stored = (await _doc(h.db, 'posts/${p.id}'))!;
    expect(stored['university_id'], 'kyoto_u');
    expect(stored.containsKey('created_at_ts'), isTrue);
    expect([stored['authorId'], stored['authorName'], stored['subjectName'], stored['requestId']],
        ['u1', '京大生_1234', '線形代数A', 'req_1']);
    expect(h.store.lastNoticeMessage, '資料をアップロードしました！確認後、クレジットが付与されます。');
  });

  test('getPostsForSubject: that subject and category only, newest first', () {
    final h = Harness();
    Post post(String id, String subject, PostCategory c, int day) => Post(
          id: id, subjectId: subject, subjectName: 's', authorId: 'a', authorName: 'a', category: c, title: id,
          description: '', filePaths: const [], fileNames: const [], createdAt: DateTime(2026, 1, day),
        );
    h.store.posts = [post('old', 'c1', PostCategory.pastExam, 1), post('new', 'c1', PostCategory.pastExam, 9),
      post('other', 'c2', PostCategory.pastExam, 5), post('cat', 'c1', PostCategory.other, 7)];
    expect(h.store.getPostsForSubject('c1', PostCategory.pastExam).map((p) => p.id), ['new', 'old']);
  });

  test('deletePost removes the post locally and in Firestore', () async {
    final h = Harness();
    h.signIn();
    await h.seedCourse('c1', '線形代数A');
    await h.store.addPost(subjectId: 'c1', category: PostCategory.other, title: 't', description: '', fileNames: ['a.pdf'], filePaths: ['resources/u1/1_a.pdf']);
    final id = h.store.posts.first.id;
    await h.store.deletePost(id);
    expect(h.store.posts, isEmpty);
    expect(await _doc(h.db, 'posts/$id'), isNull);
  });

  test('addMaterialRequest writes an unfulfilled, cost-free request and says so', () async {
    final h = Harness();
    h.signIn();
    await h.seedCourse('c1', '線形代数A');
    expect(await h.store.addMaterialRequest(subjectId: 'c1', category: PostCategory.pastExam, year: 2024, title: 'ほしい', description: ''), isTrue);
    final r = h.store.requests.first;
    final stored = (await _doc(h.db, 'requests/${r.id}'))!;
    expect([stored['university_id'], stored['costSpent'], stored['rewardPoints'], stored['isFulfilled'], stored['subjectName']],
        ['kyoto_u', 0, 0, false, '線形代数A']);
    expect(h.store.lastNoticeMessage, 'Cloud Firestoreへリクエストを投稿しました！');
  });

  test('timetable: register and remove write the whole map to user_timetables/{uid}', () async {
    final h = Harness();
    h.signIn();
    h.store.registerTimetableSubject('Mon', 1, 'c1');
    h.store.registerTimetableSubject('Tue', 2, 'c2');
    h.store.removeTimetableSubject('Mon', 1);
    await Future<void>.delayed(Duration.zero);
    final stored = (await _doc(h.db, 'user_timetables/u1'))!;
    expect(stored['timetable'], {'Tue_2': 'c2'});
    expect([stored['user_id'], stored['university_id']], ['u1', 'kyoto_u']);
    expect(h.store.userTimetable, {'Tue_2': 'c2'});
  });

  test('getRegisteredSubjects resolves the timetable to courses, once each', () async {
    final h = Harness();
    await h.seedCourse('c1', '線形代数A');
    h.store.userTimetable = {'Mon_1': 'c1', 'Thu_3': 'c1', 'Fri_5': 'missing'};
    expect((await h.store.getRegisteredSubjects()).map((s) => s.id), ['c1']);
  });

  test('submitInquiry files a tenant-stamped inquiry', () async {
    final h = Harness();
    h.signIn();
    h.store.submitInquiry(category: 'other', content: '質問', contactInfo: 'x@example.com');
    await Future<void>.delayed(Duration.zero);
    final docs = (await h.db.collection('inquiries').get()).docs;
    expect(docs.single.data()['university_id'], 'kyoto_u');
    expect(docs.single.data()['userId'], 'u1');
    expect(h.store.lastNoticeMessage, 'お問い合わせを送信しました。運営からの連絡をお待ちください。');
  });

  test('updateDisplayName: empty is refused; a name is trimmed and saved with the tenant', () async {
    final h = Harness();
    h.signIn();
    expect(await h.store.updateDisplayName('  '), isFalse);
    expect(h.store.lastNoticeMessage, 'エラー: ユーザー名を入力してください');
    expect(await h.store.updateDisplayName('  新しい名前 '), isTrue);
    final u = (await _doc(h.db, 'users/u1'))!;
    expect([u['displayName'], u['university_id']], ['新しい名前', 'kyoto_u']);
  });

  test('reportPost maps every callable outcome and error to its notice, and drops a hidden post', () async {
    final h = Harness();
    h.signIn();
    h.store.posts = [Post(id: 'p1', subjectId: 'c', subjectName: 's', authorId: 'a', authorName: 'a', category: PostCategory.other,
        title: 't', description: '', filePaths: const [], fileNames: const [], createdAt: DateTime(2026))];
    h.reply = (_, _) => {'status': 'reported'};
    await h.store.reportPost('p1', category: ReportCategory.copyright, detail: ' x ');
    expect(h.calls.last.$1, 'reportPost');
    expect(h.calls.last.$2, {'postId': 'p1', 'category': 'copyright', 'detail': 'x'});
    expect(h.store.lastNoticeMessage, '通報を受け付けました。ご協力ありがとうございます。');
    h.reply = (_, _) => {'status': 'duplicate'};
    await h.store.reportPost('p1', category: ReportCategory.other);
    expect(h.store.lastNoticeMessage, '既にこの投稿を通報済みです。');
    h.reply = (_, _) => throw ModerationException('resource-exhausted', 'report-limit');
    await h.store.reportPost('p1', category: ReportCategory.other);
    expect(h.store.lastNoticeMessage, '本日の通報の上限に達しました。明日以降にもう一度お試しください。');
    h.reply = (_, _) => {'status': 'hidden'};
    await h.store.reportPost('p1', category: ReportCategory.other);
    expect(h.store.posts, isEmpty);
    expect(h.store.lastNoticeMessage, '通報が一定数に達したため、この投稿は非表示になりました。運営が内容を確認します。');
  });

  test('downloadPost: charged / free / insufficient credits each have their notice', () async {
    final h = Harness();
    h.signIn();
    final post = Post(id: 'p1', subjectId: 'c', subjectName: 's', authorId: 'a', authorName: 'a', category: PostCategory.other,
        title: 't', description: '', filePaths: const [], fileNames: const [], createdAt: DateTime(2026));
    h.reply = (_, _) => {'url': 'https://signed.test/x', 'charged': true, 'balance': 2};
    expect(await h.store.downloadPost(post), isTrue);
    expect(h.store.lastNoticeMessage, '資料のダウンロードを開始しました（1クレジット消費）');
    h.reply = (_, _) => {'url': 'https://signed.test/x', 'charged': false, 'balance': 2};
    await h.store.downloadPost(post);
    expect(h.store.lastNoticeMessage, '資料のダウンロードを開始しました');
    h.reply = (_, _) => throw CreditException(CreditErrorKind.insufficient, 'insufficient-credits');
    expect(await h.store.downloadPost(post), isFalse);
    expect(h.store.lastNoticeMessage, 'クレジットが足りません。資料をアップロードするとクレジットを獲得できます。');
  });

  test('submitReview: unverified is refused; verified creates, then a second submit is an edit', () async {
    final h = Harness();
    h.signIn(verified: false);
    Future<bool> submit(int rating) => h.store.submitReview(
          courseKey: '線形代数a|山田', courseName: '線形代数A', rating: rating, rakutan: Rakutan.raku,
          attendance: Attendance.none, grading: GradingStyle.examOnly, pastExam: PastExamUsefulness.asIs,
          bringIn: BringIn.no, comment: '  よい  ',
        );
    expect(await submit(5), isFalse);
    expect(h.store.lastNoticeMessage, 'メール認証の完了後にレビューを投稿できます。');
    h.signIn();
    expect(await submit(5), isTrue);
    expect(h.store.lastNoticeMessage, 'レビューを投稿しました！');
    expect(await submit(3), isTrue);
    expect(h.store.lastNoticeMessage, 'レビューを更新しました。');
    final stored = (await _doc(h.db, 'reviews/${Review.docId('線形代数a|山田', 'u1')}'))!;
    expect([stored['rating'], stored['comment'], stored['authorId']], [3, 'よい', 'u1']);
  });

  test('markNotificationsRead flips only the unread ones', () async {
    final h = Harness();
    h.signIn();
    for (final (id, read) in [('n1', false), ('n2', true)]) {
      await h.db.collection('notifications').doc(id).set({'uid': 'u1', 'type': 'post_hidden', 'read': read, 'createdAt': Timestamp.now()});
    }
    h.store.notifications = [
      AppNotification(id: 'n1', type: 'post_hidden', postId: '', postTitle: '', read: false, createdAt: DateTime(2026)),
      AppNotification(id: 'n2', type: 'post_hidden', postId: '', postTitle: '', read: true, createdAt: DateTime(2026)),
    ];
    expect(h.store.unreadNotificationCount, 1);
    await h.store.markNotificationsRead();
    expect((await _doc(h.db, 'notifications/n1'))!['read'], isTrue);
  });

  test('logout clears the session state', () {
    final h = Harness();
    h.signIn();
    h.store.userTimetable = {'Mon_1': 'c1'};
    h.store.creditBalance = 5;
    h.store.logout();
    expect([h.store.currentUser, h.store.userTimetable, h.store.creditBalance, h.store.talkRooms], [null, <String, String>{}, 0, []]);
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `flutter test test/services/app_store_test.dart`
Expected: FAIL — compile error: `AppStore` has no named parameter `db` (the tests themselves describe current behaviour; nothing else is expected to fail once it compiles).

- [ ] **Step 3: Add the two seams**

In `lib/services/firestore_service.dart` replace

```dart
class FirestoreService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;
```

with

```dart
class FirestoreService {
  /// Plan 3 (Task 9): the database is injectable so AppStore's behaviour can be
  /// pinned against `fake_cloud_firestore`; production passes the default.
  FirestoreService([FirebaseFirestore? db]) : _db = db ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;
```

In `lib/services/app_store.dart` replace

```dart
import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb_auth;
```

with

```dart
import 'package:flutter/foundation.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb_auth;
```

In `lib/services/app_store.dart` replace

```dart
  final FirestoreService _firestore = FirestoreService();
  final fb_auth.FirebaseAuth _firebaseAuth = fb_auth.FirebaseAuth.instance;
```

with

```dart
  /// Plan 3 (Task 9): injectable so tests run AppStore on `fake_cloud_firestore`.
  final FirebaseFirestore _db;
  late final FirestoreService _firestore = FirestoreService(_db);

  /// Resolved on use, not at construction: a test (no Firebase app) can build an
  /// AppStore; `_initFirebaseSync` then fails inside its own try/catch.
  fb_auth.FirebaseAuth get _firebaseAuth => fb_auth.FirebaseAuth.instance;
```

In `lib/services/app_store.dart` replace

```dart
  AppStore(this.courses, this.reviews, this.ranking, this.credits, this.moderation) {
```

with

```dart
  AppStore(this.courses, this.reviews, this.ranking, this.credits, this.moderation, {FirebaseFirestore? db})
      : _db = db ?? FirebaseFirestore.instance {
```

- [ ] **Step 4: Run to verify it passes**

Run: `flutter test test/services/app_store_test.dart ; flutter test ; flutter analyze`
Expected: PASS — 14 new; full suite 107 + 14 = **121**; `flutter analyze` **22** issues (unchanged).

- [ ] **Step 5: Commit (now — before the next task)**

```bash
git add lib/services/app_store.dart lib/services/firestore_service.dart test/support/store_harness.dart test/services/app_store_test.dart
git commit -m "test: characterization tests pin AppStore behaviour; injectable Firestore, lazily resolved FirebaseAuth (Plan 3)"
```

---

### Task 10: Split AppStore data access into feature repositories

**Files:**
- Create: `lib/repositories/user_repository.dart`, `lib/repositories/post_repository.dart`, `lib/repositories/request_repository.dart`, `lib/repositories/inquiry_repository.dart`, `test/repositories/feature_repositories_test.dart`
- Modify: `lib/services/app_store.dart`, `lib/services/firestore_service.dart` (only the legacy textbook/talk-room methods stay until Task 12)

**Interfaces:**
- Produces: `UserRepository(db)`: `saveUserProfile`, `getUserProfile`, `saveUserTimetable`, `getUserTimetable`; `PostRepository(db)`: `createPost`, `streamPosts`, `deletePost`, `static safeFileName(name)`, `static resourcePath(uid, fileName, millis)`, `static contentTypeFor(fileName)`; `RequestRepository(db)`: `createMaterialRequest`, `streamMaterialRequests`; `InquiryRepository(db)`: `submitInquiry`. The method bodies are moved **verbatim** from `FirestoreService` / `AppStore.uploadFileToStorage`.

- [ ] **Step 1: Write the failing repository tests**

Create `test/repositories/feature_repositories_test.dart`:

```dart
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/inquiry.dart';
import 'package:kyoto_exam_hub/models/post.dart';
import 'package:kyoto_exam_hub/models/request.dart';
import 'package:kyoto_exam_hub/models/user_profile.dart';
import 'package:kyoto_exam_hub/repositories/inquiry_repository.dart';
import 'package:kyoto_exam_hub/repositories/post_repository.dart';
import 'package:kyoto_exam_hub/repositories/request_repository.dart';
import 'package:kyoto_exam_hub/repositories/user_repository.dart';

Post _post(String id, {String uni = 'kyoto_u'}) => Post(
      id: id, universityId: uni, subjectId: 'c1', subjectName: 's', authorId: 'u1', authorName: 'a',
      category: PostCategory.other, title: 't', description: '', filePaths: const ['resources/u1/1_a.pdf'],
      fileNames: const ['a.pdf'], createdAt: DateTime(2026, 4, 1),
    );

void main() {
  test('PostRepository.resourcePath: own prefix, millis, sanitised flat name that keeps its extension', () {
    expect(PostRepository.resourcePath('u1', '期末 2025(1).pdf', 1700), 'resources/u1/1700_期末_2025_1_.pdf');
    expect(PostRepository.resourcePath('u1', '../../evil.pdf', 1), 'resources/u1/1_.._.._evil.pdf');
    final long = PostRepository.resourcePath('u1', '${'a' * 150}.pdf', 1);
    expect(long.endsWith('.pdf'), isTrue);
    expect(long.split('/').last.length, '1_'.length + 100);
  });

  test('PostRepository.contentTypeFor: pdf / png / webp, everything else jpeg (as before)', () {
    expect(PostRepository.contentTypeFor('A.PDF'), 'application/pdf');
    expect(PostRepository.contentTypeFor('x.png'), 'image/png');
    expect(PostRepository.contentTypeFor('x.webp'), 'image/webp');
    expect(PostRepository.contentTypeFor('x.jpeg'), 'image/jpeg');
  });

  test('PostRepository: create stamps tenant + server time; the stream is tenant-scoped; delete removes', () async {
    final db = FakeFirebaseFirestore();
    final repo = PostRepository(db);
    await repo.createPost(_post('p1'));
    await db.collection('posts').doc('foreign').set(_post('foreign', uni: 'other_u').toMap());
    final stored = (await db.doc('posts/p1').get()).data()!;
    expect(stored['university_id'], 'kyoto_u');
    expect(stored.containsKey('created_at_ts'), isTrue);
    expect((await repo.streamPosts().first).map((p) => p.id), ['p1']);
    await repo.deletePost('p1');
    expect((await db.doc('posts/p1').get()).exists, isFalse);
  });

  test('UserRepository: profile merge-save with tenant; timetable round-trips as strings', () async {
    final db = FakeFirebaseFirestore();
    final repo = UserRepository(db);
    await db.doc('users/u1').set({'invitationNote': 'kept by merge'});
    await repo.saveUserProfile(UserProfile(uid: 'u1', email: 'a@st.kyoto-u.ac.jp', displayName: 'me', createdAt: DateTime(2026)));
    final u = (await db.doc('users/u1').get()).data()!;
    expect([u['displayName'], u['university_id'], u['invitationNote']], ['me', 'kyoto_u', 'kept by merge']);
    expect((await repo.getUserProfile('u1'))!.displayName, 'me');
    expect(await repo.getUserProfile('nobody'), isNull);
    await repo.saveUserTimetable('u1', {'Mon_1': 'c1'});
    expect(await repo.getUserTimetable('u1'), {'Mon_1': 'c1'});
    expect(await repo.getUserTimetable('nobody'), <String, String>{});
  });

  test('RequestRepository and InquiryRepository stamp the tenant', () async {
    final db = FakeFirebaseFirestore();
    await RequestRepository(db).createMaterialRequest(MaterialRequest(
      id: 'r1', subjectId: 'c1', subjectName: 's', authorId: 'u1', authorName: 'a', category: PostCategory.pastExam,
      title: 't', description: '', costSpent: 0, rewardPoints: 0, createdAt: DateTime(2026),
    ));
    expect((await db.doc('requests/r1').get()).data()!['university_id'], 'kyoto_u');
    expect((await RequestRepository(db).streamMaterialRequests().first).map((r) => r.id), ['r1']);
    await InquiryRepository(db).submitInquiry(Inquiry(id: 'i1', userId: 'u1', category: 'other', content: 'c', contactInfo: '', createdAt: DateTime(2026)));
    expect((await db.doc('inquiries/i1').get()).data()!['university_id'], 'kyoto_u');
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `flutter test test/repositories/feature_repositories_test.dart`
Expected: FAIL — the repository files do not exist.

- [ ] **Step 3: Create the repositories**

Create `lib/repositories/user_repository.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/user_profile.dart';

/// The caller's own `users/{uid}` profile and `user_timetables/{uid}` (Plan 3,
/// Task 10: moved verbatim out of FirestoreService). Rules: own documents only.
class UserRepository {
  UserRepository(this._db);
  final FirebaseFirestore _db;
  static const String universityId = 'kyoto_u';

  Future<void> saveUserProfile(UserProfile profile) async {
    final map = profile.toMap();
    map['university_id'] = universityId;
    await _db.collection('users').doc(profile.uid).set(map, SetOptions(merge: true));
  }

  Future<UserProfile?> getUserProfile(String uid) async {
    final doc = await _db.collection('users').doc(uid).get();
    if (doc.exists && doc.data() != null) {
      return UserProfile.fromMap(doc.data()!);
    }
    return null;
  }

  Future<void> saveUserTimetable(String uid, Map<String, String> timetable) async {
    await _db.collection('user_timetables').doc(uid).set({
      'university_id': universityId,
      'user_id': uid,
      'timetable': timetable,
      'updated_at': FieldValue.serverTimestamp(),
    });
  }

  Future<Map<String, String>> getUserTimetable(String uid) async {
    final doc = await _db.collection('user_timetables').doc(uid).get();
    if (doc.exists && doc.data() != null && doc.data()!['timetable'] != null) {
      final map = doc.data()!['timetable'] as Map<String, dynamic>;
      return map.map((key, value) => MapEntry(key, value.toString()));
    }
    return {};
  }
}
```

Create `lib/repositories/post_repository.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/post.dart';

/// Past-exam / resource posts (Plan 3, Task 10: moved verbatim out of
/// FirestoreService and AppStore). Credits, downloads and moderation stay with
/// CreditService / ModerationService; this is only the `posts` collection and
/// the storage-path rules the upload must follow.
class PostRepository {
  PostRepository(this._db);
  final FirebaseFirestore _db;
  static const String universityId = 'kyoto_u';

  /// Same sanitisation as tools/migrate_storage.mjs `sanitizeName`: every char
  /// outside [\w.-] / kana / CJK becomes '_', and only the last 100 are kept
  /// (so the extension survives).
  static String safeFileName(String fileName) {
    var safe = fileName.replaceAll(RegExp(r'[^\w.\-぀-ヿ一-鿿]'), '_');
    if (safe.length > 100) safe = safe.substring(safe.length - 100);
    return safe;
  }

  /// `resources/<uid>/<millis>_<safe name>` — the only shape storage.rules accept.
  static String resourcePath(String uid, String fileName, int millis) =>
      'resources/$uid/${millis}_${safeFileName(fileName)}';

  /// The content type the private bucket accepts for a resource upload.
  static String contentTypeFor(String fileName) {
    final lower = fileName.toLowerCase();
    return lower.endsWith('.pdf')
        ? 'application/pdf'
        : lower.endsWith('.png')
            ? 'image/png'
            : lower.endsWith('.webp')
                ? 'image/webp'
                : 'image/jpeg';
  }

  Future<void> createPost(Post post) async {
    final data = post.toMap();
    data['university_id'] = universityId;
    data['created_at_ts'] = FieldValue.serverTimestamp();
    await _db.collection('posts').doc(post.id).set(data);
  }

  Stream<List<Post>> streamPosts() {
    return _db
        .collection('posts')
        .where('university_id', isEqualTo: universityId)
        .snapshots()
        .map((snapshot) => snapshot.docs.map((d) => Post.fromMap(d.data())).toList());
  }

  Future<void> deletePost(String postId) async {
    await _db.collection('posts').doc(postId).delete();
  }
}
```

Create `lib/repositories/request_repository.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/request.dart';

/// The 資料リクエスト board (`requests`). Plan 3, Task 10: moved verbatim out of
/// FirestoreService. Fulfilment is the onPostCreated trigger's job (2A).
class RequestRepository {
  RequestRepository(this._db);
  final FirebaseFirestore _db;
  static const String universityId = 'kyoto_u';

  Future<void> createMaterialRequest(MaterialRequest req) async {
    final data = req.toMap();
    data['university_id'] = universityId;
    await _db.collection('requests').doc(req.id).set(data);
  }

  Stream<List<MaterialRequest>> streamMaterialRequests() {
    return _db
        .collection('requests')
        .where('university_id', isEqualTo: universityId)
        .snapshots()
        .map((snapshot) => snapshot.docs.map((d) => MaterialRequest.fromMap(d.data())).toList());
  }
}
```

Create `lib/repositories/inquiry_repository.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/inquiry.dart';

/// お問い合わせ: a write-only mailbox (rules: create only, nobody reads).
/// Plan 3, Task 10: moved verbatim out of FirestoreService.
class InquiryRepository {
  InquiryRepository(this._db);
  final FirebaseFirestore _db;
  static const String universityId = 'kyoto_u';

  Future<void> submitInquiry(Inquiry inquiry) async {
    final data = inquiry.toMap();
    data['university_id'] = universityId;
    await _db.collection('inquiries').doc(inquiry.id).set(data);
  }
}
```

- [ ] **Step 4: Point AppStore at them and empty FirestoreService**

In `lib/services/app_store.dart` replace

```dart
import '../repositories/course_repository.dart';
```

with

```dart
import '../repositories/course_repository.dart';
import '../repositories/inquiry_repository.dart';
import '../repositories/post_repository.dart';
import '../repositories/request_repository.dart';
import '../repositories/user_repository.dart';
```

In `lib/services/app_store.dart` replace

```dart
  late final FirestoreService _firestore = FirestoreService(_db);
```

with

```dart
  late final FirestoreService _firestore = FirestoreService(_db);

  /// Feature repositories (Plan 3, Task 10): AppStore keeps the session state
  /// and the UI-facing notices; data access lives in these.
  late final UserRepository _userRepo = UserRepository(_db);
  late final PostRepository _postRepo = PostRepository(_db);
  late final RequestRepository _requestRepo = RequestRepository(_db);
  late final InquiryRepository _inquiryRepo = InquiryRepository(_db);
```

In `lib/services/app_store.dart` replace **every** occurrence of `_firestore.getUserProfile(` with `_userRepo.getUserProfile(`.

In `lib/services/app_store.dart` replace **every** occurrence of `_firestore.saveUserProfile(` with `_userRepo.saveUserProfile(`.

In `lib/services/app_store.dart` replace **every** occurrence of `_firestore.getUserTimetable(` with `_userRepo.getUserTimetable(`.

In `lib/services/app_store.dart` replace **every** occurrence of `_firestore.saveUserTimetable(` with `_userRepo.saveUserTimetable(`.

In `lib/services/app_store.dart` replace **every** occurrence of `_firestore.streamPosts(` with `_postRepo.streamPosts(`.

In `lib/services/app_store.dart` replace **every** occurrence of `_firestore.createPost(` with `_postRepo.createPost(`.

In `lib/services/app_store.dart` replace **every** occurrence of `_firestore.deletePost(` with `_postRepo.deletePost(`.

In `lib/services/app_store.dart` replace **every** occurrence of `_firestore.streamMaterialRequests(` with `_requestRepo.streamMaterialRequests(`.

In `lib/services/app_store.dart` replace **every** occurrence of `_firestore.createMaterialRequest(` with `_requestRepo.createMaterialRequest(`.

In `lib/services/app_store.dart` replace **every** occurrence of `_firestore.submitInquiry(` with `_inquiryRepo.submitInquiry(`.

In `lib/services/app_store.dart` replace

```dart
    try {
      var safe = fileName.replaceAll(RegExp(r'[^\w.\-぀-ヿ一-鿿]'), '_');
      if (safe.length > 100) safe = safe.substring(safe.length - 100); // keep the extension
      final path = 'resources/$uid/${DateTime.now().millisecondsSinceEpoch}_$safe';
      final lower = fileName.toLowerCase();
      final contentType = lower.endsWith('.pdf')
          ? 'application/pdf'
          : lower.endsWith('.png')
              ? 'image/png'
              : lower.endsWith('.webp')
                  ? 'image/webp'
                  : 'image/jpeg';
      await fb_storage.FirebaseStorage.instance
```

with

```dart
    try {
      final path = PostRepository.resourcePath(uid, fileName, DateTime.now().millisecondsSinceEpoch);
      final contentType = PostRepository.contentTypeFor(fileName);
      await fb_storage.FirebaseStorage.instance
```

Replace the whole of `lib/services/firestore_service.dart` with:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/textbook_request.dart';
import '../models/talk_room.dart';
import 'talk_room_queries.dart';

class FirestoreService {
  /// Plan 3 (Task 9): the database is injectable so AppStore's behaviour can be
  /// pinned against `fake_cloud_firestore`; production passes the default.
  FirestoreService([FirebaseFirestore? db]) : _db = db ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;
  static const String universityId = 'kyoto_u';

  // Profiles, timetables, posts, requests and inquiries moved to
  // lib/repositories/ (Plan 3, Task 10). What is left here is the legacy
  // textbook-request / talk-room code that Task 12 removes.

  // --- 6. TEXTBOOK REQUESTS & TALK ROOMS ---

  Future<void> createTextbookRequest(TextbookRequest req) async {
    final data = req.toMap();
    data['university_id'] = universityId;
    await _db.collection('textbook_requests').doc(req.id).set(data);
  }

  Stream<List<TextbookRequest>> streamTextbookRequests() {
    return _db
        .collection('textbook_requests')
        .where('university_id', isEqualTo: universityId)
        .snapshots()
        .map((snapshot) => snapshot.docs.map((d) => TextbookRequest.fromMap(d.data())).toList());
  }

  Future<void> createTalkRoom(TalkRoom room) async {
    final data = room.toMap();
    data['university_id'] = universityId;
    await _db.collection('talk_rooms').doc(room.id).set(data);
  }

  /// Plan 2B (M-15): only the rooms the caller takes part in (rules: participants only).
  Stream<List<TalkRoom>> streamTalkRoomsFor(String uid) => participantTalkRooms(_db, uid);

  Future<void> addChatMessage(String roomId, ChatMessage message) async {
    await _db.collection('talk_rooms').doc(roomId).update({
      'messages': FieldValue.arrayUnion([message.toMap()]),
    });
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `flutter test ; flutter analyze ; grep -nE "_firestore\.(get|save|stream(Posts|Material)|create(Post|Material)|deletePost|submitInquiry)" lib/services/app_store.dart`
Expected: PASS — 121 + 5 = **126** (the 14 characterization tests unchanged and green); **22** issues; the grep prints nothing.

- [ ] **Step 6: Commit (now — before the next task)**

```bash
git add lib/repositories lib/services/app_store.dart lib/services/firestore_service.dart test/repositories/feature_repositories_test.dart
git commit -m "refactor: move AppStore data access into User/Post/Request/Inquiry repositories, behaviour pinned (Plan 3)"
```

---

### Task 11: Flutter — `TextbookListing` model and `MarketService`

**Files:**
- Create: `lib/models/textbook_listing.dart`, `lib/services/market_service.dart`, `test/models/textbook_listing_test.dart`, `test/services/market_service_test.dart`

**Interfaces:**
- Consumes: `CallableInvoker` (credit_service.dart, 2A); `PostRepository.safeFileName` (T10).
- Produces:
  - `enum ListingType { give, sell, want }` + `ListingTypeX.value/.label/.fromValue`; `enum BookCondition { likeNew, good, fair, marked }` + `BookConditionX`; `const kHandoffPlaces` (8 keys = `HANDOFF_PLACES`)
  - `class TextbookListing { id, type, title, description, courseId, courseName, condition, price, listPrice, place, photoPaths, ownerId, ownerName, status, createdAt, expiresAt, renewCount; isLive(now); canRenew(now); placeLabel; priceAboveList; priceLabel; factory fromMap(id, map) }` (total), `class RatingComment`, `class MarketProfile { ratingCount, ratingSum, recentComments; average; summary; factory fromMap(map?) }`
  - `market_service.dart`: limits `kListingMaxTitle`, `kListingMaxDescription`, `kListingMaxPhotos`, `kListingMaxPrice`, `kListingPhotoMaxBytes`, `kChatMaxMessage`, `kRatingMaxComment`; `enum ListingReportCategory`, `enum RoomReportCategory` (+ `.value/.label`), `enum MarketReportOutcome`, `class MarketException { code, message, isLimit, isBlocked, isListingClosed, isNotFound, notice }`, `class ListingDraft { … toPayload() }`, `validateListingDraft(d)`, `containsContactInfo(text)`, `filterListings(all, {type, query})`, `listingShareText(l)`, `class MarketService(db, call)` with `factory live(db)`, `static photoPath(uid, fileName, millis)`, `static photoContentType(fileName)`, `streamListings({courseId, now, limit})`, `streamMyListings(uid)`, `getListing(id)`, `streamProfile(uid)`, `createListing(draft)`, `editListing(id, draft)`, `renewListing(id)`, `closeListing(id)`, `openChat(listingId)`, `blockRoom(roomId)`, `reportListing(id, c, detail)`, `reportRoom(roomId, c, detail)`, `rateDeal(roomId, stars, comment)`.

- [ ] **Step 1: Write the failing tests**

Create `test/models/textbook_listing_test.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/textbook_listing.dart';

void main() {
  final now = DateTime.utc(2027, 4, 10, 3);

  test('wire values match functions/src/marketCore.ts (LISTING_TYPES, BOOK_CONDITIONS, HANDOFF_PLACES)', () {
    expect(ListingType.values.map((t) => t.value), ['give', 'sell', 'want']);
    expect(BookCondition.values.map((c) => c.value), ['like_new', 'good', 'fair', 'marked']);
    expect(kHandoffPlaces.keys, ['clock_tower', 'coop_central', 'library', 'yoshida_south', 'north_campus', 'katsura', 'uji', 'other']);
  });

  test('parses a Function-written listing', () {
    final l = TextbookListing.fromMap('l1', {
      'type': 'sell', 'title': '線形代数入門', 'description': 'd', 'courseId': 'c1', 'courseName': '線形代数A',
      'condition': 'good', 'price': 1500, 'listPrice': 3000, 'place': 'library', 'photoPaths': ['listings/u1/a.jpg', 7],
      'ownerId': 'u1', 'ownerName': '山田', 'status': 'active', 'renewCount': 1,
      'createdAt': Timestamp.fromDate(now), 'expiresAt': Timestamp.fromDate(now.add(const Duration(days: 30))),
    });
    expect([l.type, l.condition, l.price, l.listPrice, l.placeLabel, l.photoPaths, l.priceLabel],
        [ListingType.sell, BookCondition.good, 1500, 3000, '附属図書館前', ['listings/u1/a.jpg'], '¥1500']);
    expect(l.isLive(now), isTrue);
    expect(l.priceAboveList, isFalse);
  });

  test('is total: garbage degrades (unknown type -> want, unknown place -> other, missing status -> closed)', () {
    final l = TextbookListing.fromMap('x', {'type': 'lend', 'price': '100', 'place': 'my_room', 'photoPaths': 'x', 'createdAt': 5});
    expect([l.type, l.price, l.place, l.photoPaths, l.status, l.ownerName], [ListingType.want, null, 'other', <String>[], 'closed', '京大生']);
    expect(l.isLive(now), isFalse);
  });

  test('isLive needs active AND unexpired; canRenew opens 7 days before expiry (boundary included)', () {
    TextbookListing at(Duration left, {String status = 'active'}) => TextbookListing(
          id: 'l', type: ListingType.give, title: 't', ownerId: 'u', ownerName: 'n', status: status,
          createdAt: now, expiresAt: now.add(left),
        );
    expect(at(const Duration(seconds: 1)).isLive(now), isTrue);
    expect(at(Duration.zero).isLive(now), isFalse);
    expect(at(const Duration(days: 1), status: 'hidden').isLive(now), isFalse);
    expect(at(const Duration(days: 7)).canRenew(now), isTrue);
    expect(at(const Duration(days: 7, seconds: 1)).canRenew(now), isFalse);
    expect(at(const Duration(days: -40)).canRenew(now), isTrue);
    expect(at(const Duration(days: 1), status: 'closed').canRenew(now), isFalse);
  });

  test('price labels and the above-list-price warning (informational only)', () {
    TextbookListing l(ListingType t, {int? price, int? list}) => TextbookListing(
          id: 'l', type: t, title: 't', ownerId: 'u', ownerName: 'n', price: price, listPrice: list, createdAt: now, expiresAt: now,
        );
    expect(l(ListingType.give).priceLabel, '無料');
    expect(l(ListingType.want, price: 800).priceLabel, '予算 ¥800');
    expect(l(ListingType.want).priceLabel, '予算未設定');
    expect(l(ListingType.sell, price: 3500, list: 3000).priceAboveList, isTrue);
    expect(l(ListingType.sell, price: 3000, list: 3000).priceAboveList, isFalse);
  });

  test('MarketProfile: average, summary, and only well-formed comments', () {
    expect(MarketProfile.fromMap(null).summary, '評価はまだありません');
    final p = MarketProfile.fromMap({'ratingCount': 2, 'ratingSum': 9, 'recentComments': [
      {'stars': 5, 'comment': '丁寧'}, {'stars': 9, 'comment': 'bad'}, 'junk',
    ]});
    expect(p.average, 4.5);
    expect(p.summary, '★4.5（2件）');
    expect(p.recentComments.map((c) => c.comment), ['丁寧']);
  });
}
```

Create `test/services/market_service_test.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/textbook_listing.dart';
import 'package:kyoto_exam_hub/services/market_service.dart';

Map<String, dynamic> _listing(String owner, {String status = 'active', int days = 10, String type = 'sell', String courseId = '', String title = '線形代数入門'}) => {
      'type': type, 'title': title, 'ownerId': owner, 'ownerName': 'n', 'status': status, 'courseId': courseId,
      'courseName': courseId.isEmpty ? '' : '線形代数A', 'condition': 'good', 'price': 1000, 'place': 'clock_tower',
      'createdAt': Timestamp.fromDate(DateTime.utc(2027, 4, 1)),
      'expiresAt': Timestamp.fromDate(DateTime.utc(2027, 4, 10).add(Duration(days: days))),
    };

void main() {
  final now = DateTime.utc(2027, 4, 10);

  test('wire values match functions/src/marketModeration.ts', () {
    expect(ListingReportCategory.values.map((c) => c.value), ['not_textbook', 'spam', 'inappropriate', 'other']);
    expect(RoomReportCategory.values.map((c) => c.value), ['harassment', 'no_show', 'fraud', 'other']);
  });

  test('streamListings shows only live listings (active AND unexpired), optionally one course', () async {
    final db = FakeFirebaseFirestore();
    await db.collection('textbook_listings').doc('live').set(_listing('u1'));
    await db.collection('textbook_listings').doc('course').set(_listing('u2', courseId: 'c1'));
    await db.collection('textbook_listings').doc('expired').set(_listing('u1', days: -1));
    await db.collection('textbook_listings').doc('closed').set(_listing('u1', status: 'closed'));
    await db.collection('textbook_listings').doc('hidden').set(_listing('u1', status: 'hidden'));
    final svc = MarketService(db, (_, _) async => {});
    expect((await svc.streamListings(now: now).first).map((l) => l.id).toSet(), {'live', 'course'});
    expect((await svc.streamListings(courseId: 'c1', now: now).first).map((l) => l.id), ['course']);
    expect((await svc.streamMyListings('u1').first).map((l) => l.id).toSet(), {'live', 'expired', 'closed', 'hidden'});
  });

  test('createListing sends the whitelisted payload; 譲る never sends a price', () async {
    final sent = <(String, Map<String, dynamic>)>[];
    final svc = MarketService(FakeFirebaseFirestore(), (name, data) async {
      sent.add((name, data));
      return {'listingId': 'L1'};
    });
    expect(await svc.createListing(const ListingDraft(
      type: ListingType.give, title: '  微積分  ', condition: BookCondition.fair, price: 500, place: 'library',
    )), 'L1');
    expect(sent.single.$1, 'createListing');
    expect(sent.single.$2, {
      'type': 'give', 'title': '微積分', 'description': '', 'courseId': '', 'condition': 'fair', 'price': null,
      'listPrice': null, 'place': 'library', 'photoPaths': <String>[],
    });
  });

  test('the update / chat / block / rate / report callables carry exactly their arguments', () async {
    final sent = <(String, Map<String, dynamic>)>[];
    var reply = <String, dynamic>{};
    final svc = MarketService(FakeFirebaseFirestore(), (name, data) async {
      sent.add((name, data));
      return reply;
    });
    await svc.renewListing('L1');
    await svc.closeListing('L1');
    reply = {'roomId': 'l_L1_u2'};
    expect(await svc.openChat('L1'), 'l_L1_u2');
    await svc.blockRoom('R1');
    reply = {'status': 'rated', 'revealed': false};
    expect(await svc.rateDeal('R1', 4, ' よかった '), isTrue);
    reply = {'status': 'case_opened'};
    expect(await svc.reportRoom('R1', RoomReportCategory.noShow, ' 来なかった '), MarketReportOutcome.caseOpened);
    reply = {'status': 'hidden'};
    expect(await svc.reportListing('L1', ListingReportCategory.notTextbook, ''), MarketReportOutcome.hidden);
    expect(sent.map((s) => s.$1), ['updateListing', 'updateListing', 'openListingChat', 'blockRoom', 'rateDeal', 'reportMarket', 'reportMarket']);
    expect(sent[0].$2, {'listingId': 'L1', 'action': 'renew'});
    expect(sent[1].$2, {'listingId': 'L1', 'action': 'close'});
    expect(sent[4].$2, {'roomId': 'R1', 'stars': 4, 'comment': 'よかった'});
    expect(sent[5].$2, {'kind': 'room', 'targetId': 'R1', 'category': 'no_show', 'detail': '来なかった'});
  });

  test('validateListingDraft mirrors the server rules', () {
    const ok = ListingDraft(type: ListingType.sell, title: '本', condition: BookCondition.good, price: 1);
    expect(validateListingDraft(ok), isNull);
    expect(validateListingDraft(const ListingDraft(type: ListingType.sell, title: ' ', condition: BookCondition.good, price: 1)), isNotNull);
    expect(validateListingDraft(ListingDraft(type: ListingType.sell, title: 'x' * 101, condition: BookCondition.good, price: 1)), isNotNull);
    expect(validateListingDraft(const ListingDraft(type: ListingType.sell, title: '本', condition: BookCondition.good)), isNotNull);
    expect(validateListingDraft(const ListingDraft(type: ListingType.sell, title: '本', condition: BookCondition.good, price: 100001)), isNotNull);
    expect(validateListingDraft(const ListingDraft(type: ListingType.give, title: '本')), isNotNull); // condition required
    expect(validateListingDraft(const ListingDraft(type: ListingType.want, title: '本')), isNull);
    expect(validateListingDraft(const ListingDraft(type: ListingType.want, title: '本', place: 'my_room')), isNotNull);
  });

  test('containsContactInfo flags phone numbers, e-mail addresses and LINE IDs', () {
    expect(containsContactInfo('090-1234-5678 に電話'), isTrue);
    expect(containsContactInfo('連絡は a@b.jp まで'), isTrue);
    expect(containsContactInfo('LINE ID: kyodai'), isTrue);
    expect(containsContactInfo('時計台前で12時に'), isFalse);
  });

  test('filterListings: type + every word in title/course/description, case and space insensitive', () {
    TextbookListing l(String id, ListingType t, String title, {String course = ''}) => TextbookListing(
          id: id, type: t, title: title, courseName: course, ownerId: 'u', ownerName: 'n', createdAt: now, expiresAt: now,
        );
    final all = [l('a', ListingType.sell, 'Campbell Biology'), l('b', ListingType.give, '線形代数入門', course: '線形代数A'),
      l('c', ListingType.want, '微分積分')];
    expect(filterListings(all, query: 'campbell').map((x) => x.id), ['a']);
    expect(filterListings(all, query: '線形 代数A').map((x) => x.id), ['b']);
    expect(filterListings(all, type: ListingType.want).map((x) => x.id), ['c']);
    expect(filterListings(all).length, 3);
  });

  test('photo paths and types: own listings/ prefix, images only', () {
    expect(MarketService.photoPath('u1', 'my book.JPG', 7), 'listings/u1/7_my_book.JPG');
    expect(MarketService.photoContentType('a.JPG'), 'image/jpeg');
    expect(MarketService.photoContentType('a.webp'), 'image/webp');
    expect(MarketService.photoContentType('a.pdf'), isNull);
    expect(MarketService.photoContentType('a.svg'), isNull);
  });

  test('listingShareText names the book and the app, never the owner', () {
    final l = TextbookListing(id: 'l', type: ListingType.give, title: '線形代数入門', courseName: '線形代数A', ownerId: 'u', ownerName: '山田',
        createdAt: now, expiresAt: now);
    final t = listingShareText(l);
    expect(t, contains('譲ります: 『線形代数入門』（線形代数A） 無料'));
    expect(t, contains('https://kyodai-info.web.app/'));
    expect(t, isNot(contains('山田')));
  });

  test('MarketException.notice covers the server codes the UI shows', () {
    expect(MarketException('resource-exhausted', 'listing-limit').notice, contains('上限'));
    expect(MarketException('failed-precondition', 'blocked').notice, contains('やりとりできません'));
    expect(MarketException('failed-precondition', 'listing-closed').notice, contains('受付を終了'));
    expect(MarketException('failed-precondition', 'no-exchange').notice, contains('双方'));
    expect(MarketException('failed-precondition', 'too-early').notice, contains('7日前'));
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `flutter test test/models/textbook_listing_test.dart test/services/market_service_test.dart`
Expected: FAIL — the files under test do not exist.

- [ ] **Step 3: Create the model and the service**

Create `lib/models/textbook_listing.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';

/// Wire values must equal `LISTING_TYPES` in functions/src/marketCore.ts.
/// 「貸す」 is deliberately absent (spec §4.4: v1 見送り).
enum ListingType { give, sell, want }

extension ListingTypeX on ListingType {
  String get value => switch (this) {
        ListingType.give => 'give',
        ListingType.sell => 'sell',
        ListingType.want => 'want',
      };

  String get label => switch (this) {
        ListingType.give => '譲ります',
        ListingType.sell => '売ります',
        ListingType.want => '買いたい',
      };

  static ListingType? fromValue(Object? v) {
    for (final t in ListingType.values) {
      if (t.value == v) return t;
    }
    return null;
  }
}

/// Wire values must equal `BOOK_CONDITIONS` in functions/src/marketCore.ts.
enum BookCondition { likeNew, good, fair, marked }

extension BookConditionX on BookCondition {
  String get value => switch (this) {
        BookCondition.likeNew => 'like_new',
        BookCondition.good => 'good',
        BookCondition.fair => 'fair',
        BookCondition.marked => 'marked',
      };

  String get label => switch (this) {
        BookCondition.likeNew => '新品同様',
        BookCondition.good => '目立った傷なし',
        BookCondition.fair => '使用感あり',
        BookCondition.marked => '書き込み多め',
      };

  static BookCondition? fromValue(Object? v) {
    for (final c in BookCondition.values) {
      if (c.value == v) return c;
    }
    return null;
  }
}

/// Handoff-place presets; keys must equal `HANDOFF_PLACES` in marketCore.ts.
const Map<String, String> kHandoffPlaces = {
  'clock_tower': '時計台前',
  'coop_central': '中央食堂・生協前',
  'library': '附属図書館前',
  'yoshida_south': '吉田南構内',
  'north_campus': '北部構内',
  'katsura': '桂キャンパス',
  'uji': '宇治キャンパス',
  'other': 'チャットで相談',
};

DateTime _time(dynamic v) {
  if (v is Timestamp) return v.toDate();
  if (v is String) return DateTime.tryParse(v) ?? DateTime.fromMillisecondsSinceEpoch(0);
  return DateTime.fromMillisecondsSinceEpoch(0);
}

int? _int(dynamic v) => v is int ? v : (v is num && v == v.roundToDouble() ? v.toInt() : null);
String _str(dynamic v) => v is String ? v : '';

/// One `textbook_listings/{id}` document (Plan 3). Written ONLY by the
/// createListing / updateListing Functions; the reader is total.
class TextbookListing {
  const TextbookListing({
    required this.id,
    required this.type,
    required this.title,
    this.description = '',
    this.courseId = '',
    this.courseName = '',
    this.condition,
    this.price,
    this.listPrice,
    this.place = 'other',
    this.photoPaths = const [],
    required this.ownerId,
    required this.ownerName,
    this.status = 'active',
    required this.createdAt,
    required this.expiresAt,
    this.renewCount = 0,
  });

  static const Duration lifetime = Duration(days: 30);
  static const Duration renewWindow = Duration(days: 7);

  final String id;
  final ListingType type;
  final String title;
  final String description;
  final String courseId;
  final String courseName;
  final BookCondition? condition;
  final int? price; // yen; information only — the app never handles money
  final int? listPrice; // 定価 (recommended upper bound for 売る)
  final String place;
  final List<String> photoPaths;
  final String ownerId;
  final String ownerName;
  final String status; // active | closed | hidden
  final DateTime createdAt;
  final DateTime expiresAt;
  final int renewCount;

  bool isLive(DateTime now) => status == 'active' && expiresAt.isAfter(now);

  /// 「まだ有効?」: an active listing in its last [renewWindow] (or expired) may be renewed.
  bool canRenew(DateTime now) => status == 'active' && !expiresAt.subtract(renewWindow).isAfter(now);

  String get placeLabel => kHandoffPlaces[place] ?? 'チャットで相談';

  /// A 売る price above the 定価 the seller entered (shown as a warning, never enforced, T-3).
  bool get priceAboveList => type == ListingType.sell && price != null && listPrice != null && price! > listPrice!;

  String get priceLabel => switch (type) {
        ListingType.give => '無料',
        ListingType.sell => price == null ? '価格未設定' : '¥$price',
        ListingType.want => price == null ? '予算未設定' : '予算 ¥$price',
      };

  factory TextbookListing.fromMap(String id, Map<String, dynamic> map) => TextbookListing(
        id: id,
        type: ListingTypeX.fromValue(map['type']) ?? ListingType.want,
        title: _str(map['title']),
        description: _str(map['description']),
        courseId: _str(map['courseId']),
        courseName: _str(map['courseName']),
        condition: BookConditionX.fromValue(map['condition']),
        price: _int(map['price']),
        listPrice: _int(map['listPrice']),
        place: kHandoffPlaces.containsKey(map['place']) ? map['place'] as String : 'other',
        photoPaths: map['photoPaths'] is List ? (map['photoPaths'] as List).whereType<String>().toList() : const [],
        ownerId: _str(map['ownerId']),
        ownerName: _str(map['ownerName']).isEmpty ? '京大生' : _str(map['ownerName']),
        status: _str(map['status']).isEmpty ? 'closed' : _str(map['status']),
        createdAt: _time(map['createdAt']),
        expiresAt: _time(map['expiresAt']),
        renewCount: _int(map['renewCount']) ?? 0,
      );
}

class RatingComment {
  const RatingComment({required this.stars, required this.comment});
  final int stars;
  final String comment;
}

/// `market_profiles/{uid}`: the KU-readable rating summary (Function-written, T-10).
class MarketProfile {
  const MarketProfile({this.ratingCount = 0, this.ratingSum = 0, this.recentComments = const []});

  final int ratingCount;
  final int ratingSum;
  final List<RatingComment> recentComments;

  double? get average => ratingCount == 0 ? null : ratingSum / ratingCount;

  String get summary => ratingCount == 0 ? '評価はまだありません' : '★${average!.toStringAsFixed(1)}（$ratingCount件）';

  factory MarketProfile.fromMap(Map<String, dynamic>? map) {
    if (map == null) return const MarketProfile();
    final raw = map['recentComments'];
    return MarketProfile(
      ratingCount: _int(map['ratingCount']) ?? 0,
      ratingSum: _int(map['ratingSum']) ?? 0,
      recentComments: raw is List
          ? raw
              .whereType<Map>()
              .map((m) => RatingComment(stars: _int(m['stars']) ?? 0, comment: _str(m['comment'])))
              .where((c) => c.stars >= 1 && c.stars <= 5)
              .toList()
          : const [],
    );
  }
}
```

Create `lib/services/market_service.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/textbook_listing.dart';
import '../repositories/post_repository.dart';
import 'credit_service.dart' show CallableInvoker;

/// Limits mirrored from functions/src/marketCore.ts `MARKET`; the server re-checks.
const int kListingMaxTitle = 100;
const int kListingMaxDescription = 1000;
const int kListingMaxPhotos = 3;
const int kListingMaxPrice = 100000;
const int kListingPhotoMaxBytes = 2 * 1024 * 1024;
const int kChatMaxMessage = 1000;
const int kRatingMaxComment = 60;

/// Wire values must equal `LISTING_REPORT_CATEGORIES` in marketModeration.ts.
enum ListingReportCategory { notTextbook, spam, inappropriate, other }

extension ListingReportCategoryX on ListingReportCategory {
  String get value => switch (this) {
        ListingReportCategory.notTextbook => 'not_textbook',
        ListingReportCategory.spam => 'spam',
        ListingReportCategory.inappropriate => 'inappropriate',
        ListingReportCategory.other => 'other',
      };

  String get label => switch (this) {
        ListingReportCategory.notTextbook => '教科書・参考書ではない',
        ListingReportCategory.spam => 'スパム・重複出品',
        ListingReportCategory.inappropriate => '不適切な内容',
        ListingReportCategory.other => 'その他',
      };
}

/// Wire values must equal `ROOM_REPORT_CATEGORIES` in marketModeration.ts.
enum RoomReportCategory { harassment, noShow, fraud, other }

extension RoomReportCategoryX on RoomReportCategory {
  String get value => switch (this) {
        RoomReportCategory.harassment => 'harassment',
        RoomReportCategory.noShow => 'no_show',
        RoomReportCategory.fraud => 'fraud',
        RoomReportCategory.other => 'other',
      };

  String get label => switch (this) {
        RoomReportCategory.harassment => '嫌がらせ・迷惑行為',
        RoomReportCategory.noShow => '受け渡し不履行（来なかった・連絡が途絶えた）',
        RoomReportCategory.fraud => '詐欺・金銭トラブル',
        RoomReportCategory.other => 'その他',
      };
}

enum MarketReportOutcome { reported, hidden, duplicate, alreadyHidden, caseOpened }

class MarketException implements Exception {
  MarketException(this.code, this.message);
  final String code;
  final String message;

  bool get isLimit => code == 'resource-exhausted';
  bool get isBlocked => message.contains('blocked');
  bool get isListingClosed => message.contains('listing-closed');
  bool get isNotFound => code == 'not-found';

  /// The notice to show for this error.
  String get notice => isLimit
      ? '本日の上限に達しました。明日以降にもう一度お試しください。'
      : isBlocked
          ? 'この相手とはやりとりできません。'
          : isListingClosed
              ? 'この出品は受付を終了しています。'
              : isNotFound
                  ? '見つかりませんでした。削除された可能性があります。'
                  : message.contains('no-exchange')
                      ? '双方がメッセージを送った取引だけ評価できます。'
                      : message.contains('too-early')
                          ? '掲載期限の7日前から延長できます。'
                          : '処理に失敗しました。メール認証の状態と通信環境を確認してください。';

  @override
  String toString() => 'MarketException($code, $message)';
}

/// What a seller/buyer fills in. Title, type, course and photos are fixed after
/// creation (the server ignores them on edit).
class ListingDraft {
  const ListingDraft({
    required this.type,
    required this.title,
    this.description = '',
    this.courseId = '',
    this.condition,
    this.price,
    this.listPrice,
    this.place = 'clock_tower',
    this.photoPaths = const [],
  });

  final ListingType type;
  final String title;
  final String description;
  final String courseId;
  final BookCondition? condition;
  final int? price;
  final int? listPrice;
  final String place;
  final List<String> photoPaths;

  Map<String, dynamic> toPayload() => {
        'type': type.value,
        'title': title.trim(),
        'description': description.trim(),
        'courseId': courseId,
        'condition': condition?.value ?? '',
        'price': type == ListingType.give ? null : price,
        'listPrice': listPrice,
        'place': place,
        'photoPaths': photoPaths,
      };
}

/// Null when [d] is acceptable, otherwise the message to show (mirrors parseListingDraft).
String? validateListingDraft(ListingDraft d) {
  final title = d.title.trim();
  if (title.isEmpty || title.length > kListingMaxTitle) return '本のタイトルを入力してください（100文字まで）';
  if (d.description.trim().length > kListingMaxDescription) return '説明は1000文字までです';
  if (d.type != ListingType.want && d.condition == null) return '本の状態を選んでください';
  if (d.type == ListingType.sell && (d.price == null || d.price! < 1 || d.price! > kListingMaxPrice)) {
    return '価格を1〜100000円で入力してください';
  }
  if (d.type == ListingType.want && d.price != null && (d.price! < 0 || d.price! > kListingMaxPrice)) {
    return '予算は0〜100000円で入力してください';
  }
  if (d.listPrice != null && (d.listPrice! < 0 || d.listPrice! > kListingMaxPrice)) return '定価は0〜100000円で入力してください';
  if (!kHandoffPlaces.containsKey(d.place)) return '受け渡し場所を選んでください';
  if (d.photoPaths.length > kListingMaxPhotos) return '写真は3枚までです';
  return null;
}

final RegExp _phone = RegExp(r'0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}');
final RegExp _email = RegExp(r'[^@\s]+@[^@\s]+\.[^@\s]+');
final RegExp _lineId = RegExp(r'(line|ライン|LINE)\s*(id|ID|ＩＤ)?\s*[:：]', caseSensitive: false);

/// True when [text] looks like it carries a phone number, an e-mail address or
/// a LINE ID — the form and chat show a warning (T-15); nothing is blocked.
bool containsContactInfo(String text) =>
    _phone.hasMatch(text) || _email.hasMatch(text) || _lineId.hasMatch(text);

String _fold(String s) => s.toLowerCase().replaceAll(RegExp(r'\s+'), '');

/// Client-side search over the live list (T-7): type filter + free words, every
/// word must appear in the title, the course name or the description.
List<TextbookListing> filterListings(List<TextbookListing> all, {ListingType? type, String query = ''}) {
  final words = query.split(RegExp(r'\s+')).map(_fold).where((w) => w.isNotEmpty).toList();
  return all.where((l) {
    if (type != null && l.type != type) return false;
    final hay = _fold('${l.title} ${l.courseName} ${l.description}');
    return words.every(hay.contains);
  }).toList();
}

/// The text the 「シェア」 button copies (T-22): no deep link (the app has no
/// routes), no owner name, no price for 譲る/買いたい beyond the label.
String listingShareText(TextbookListing l) {
  final course = l.courseName.isEmpty ? '' : '（${l.courseName}）';
  return '【京大InfoHub 教科書】${l.type.label}: 『${l.title}』$course ${l.priceLabel}\n'
      '京大生ならアプリの「教科書」タブで見られます → https://kyodai-info.web.app/';
}

/// Plan 3 market client: listings (read), the six market callables, rating
/// summaries. The client never writes a listing, room, rating or report.
class MarketService {
  MarketService(this._db, this._call);

  factory MarketService.live(FirebaseFirestore db) => MarketService(db, _liveInvoker);

  final FirebaseFirestore _db;
  final CallableInvoker _call;

  static Future<Map<String, dynamic>> _liveInvoker(String name, Map<String, dynamic> data) async {
    try {
      final res = await FirebaseFunctions.instanceFor(region: 'asia-east1')
          .httpsCallable(name)
          .call<Map<Object?, Object?>>(data);
      return Map<String, dynamic>.from(res.data);
    } on FirebaseFunctionsException catch (e) {
      throw MarketException(e.code, e.message ?? e.code);
    }
  }

  /// `listings/<uid>/<millis>_<safe name>` — the only shape storage.rules accept.
  static String photoPath(String uid, String fileName, int millis) =>
      'listings/$uid/${millis}_${PostRepository.safeFileName(fileName)}';

  /// The content type of an accepted photo, or null (pdf, gif, svg, … are refused).
  static String? photoContentType(String fileName) {
    final lower = fileName.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    return null;
  }

  CollectionReference<Map<String, dynamic>> get _listings => _db.collection('textbook_listings');

  List<TextbookListing> _parse(QuerySnapshot<Map<String, dynamic>> q) =>
      q.docs.map((d) => TextbookListing.fromMap(d.id, d.data())).toList();

  /// Live (active, unexpired) listings, newest expiry first; optionally one
  /// course. Needs the (status, expiresAt) / (courseId, status, expiresAt) indexes.
  Stream<List<TextbookListing>> streamListings({String courseId = '', DateTime? now, int limit = 100}) {
    final at = now ?? DateTime.now();
    Query<Map<String, dynamic>> q = _listings;
    if (courseId.isNotEmpty) q = q.where('courseId', isEqualTo: courseId);
    return q
        .where('status', isEqualTo: 'active')
        .where('expiresAt', isGreaterThan: Timestamp.fromDate(at))
        .orderBy('expiresAt', descending: true)
        .limit(limit)
        .snapshots()
        .map((s) => _parse(s).where((l) => l.isLive(at)).toList());
  }

  /// Every listing of [uid] (any status), newest first.
  Stream<List<TextbookListing>> streamMyListings(String uid) => _listings
      .where('ownerId', isEqualTo: uid)
      .snapshots()
      .map((s) => _parse(s)..sort((a, b) => b.createdAt.compareTo(a.createdAt)));

  Future<TextbookListing?> getListing(String id) async {
    final d = await _listings.doc(id).get();
    return d.exists ? TextbookListing.fromMap(d.id, d.data()!) : null;
  }

  Stream<MarketProfile> streamProfile(String uid) =>
      _db.collection('market_profiles').doc(uid).snapshots().map((s) => MarketProfile.fromMap(s.data()));

  Future<String> createListing(ListingDraft d) async {
    final r = await _call('createListing', d.toPayload());
    return r['listingId'] is String ? r['listingId'] as String : '';
  }

  Future<void> editListing(String listingId, ListingDraft d) =>
      _call('updateListing', {...d.toPayload(), 'listingId': listingId, 'action': 'edit'});

  Future<void> renewListing(String listingId) => _call('updateListing', {'listingId': listingId, 'action': 'renew'});

  Future<void> closeListing(String listingId) => _call('updateListing', {'listingId': listingId, 'action': 'close'});

  /// Opens (or re-opens) the chat about [listingId]; returns the room id.
  Future<String> openChat(String listingId) async {
    final r = await _call('openListingChat', {'listingId': listingId});
    return r['roomId'] is String ? r['roomId'] as String : '';
  }

  Future<void> blockRoom(String roomId) => _call('blockRoom', {'roomId': roomId});

  Future<MarketReportOutcome> reportListing(String listingId, ListingReportCategory c, String detail) =>
      _report('listing', listingId, c.value, detail);

  Future<MarketReportOutcome> reportRoom(String roomId, RoomReportCategory c, String detail) =>
      _report('room', roomId, c.value, detail);

  Future<MarketReportOutcome> _report(String kind, String id, String category, String detail) async {
    final r = await _call('reportMarket', {'kind': kind, 'targetId': id, 'category': category, 'detail': detail.trim()});
    return switch (r['status']) {
      'hidden' => MarketReportOutcome.hidden,
      'duplicate' => MarketReportOutcome.duplicate,
      'already_hidden' => MarketReportOutcome.alreadyHidden,
      'case_opened' => MarketReportOutcome.caseOpened,
      _ => MarketReportOutcome.reported,
    };
  }

  /// Returns whether the rating was accepted now (false: already rated).
  Future<bool> rateDeal(String roomId, int stars, String comment) async {
    final r = await _call('rateDeal', {'roomId': roomId, 'stars': stars, 'comment': comment.trim()});
    return r['status'] == 'rated';
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `flutter test ; flutter analyze`
Expected: PASS — 126 + 16 = **142**; **22** issues.

- [ ] **Step 5: Commit (now — before the next task)**

```bash
git add lib/models/textbook_listing.dart lib/services/market_service.dart test/models/textbook_listing_test.dart test/services/market_service_test.dart
git commit -m "feat: TextbookListing model and MarketService (callables, live-listing query, client search, share text) (Plan 3)"
```

---

### Task 12: Flutter — chat on the subcollection: `TalkRoom`, `ChatService`, AppStore wiring, `TalkRoomScreen`; retire the 参考書 board

**Files:**
- Create: `lib/services/chat_service.dart`, `test/models/talk_room_test.dart`, `test/services/chat_service_test.dart`, `test/views/talk_room_screen_test.dart`
- Modify: `lib/models/talk_room.dart` (rewritten), `lib/services/talk_room_queries.dart`, `lib/services/app_store.dart` (full replacement below), `lib/views/textbook/talk_room_screen.dart` (rewritten), `lib/views/mypage/my_page_screen.dart`, `test/services/talk_room_queries_test.dart` (rewritten), `test/services/app_store_test.dart`, `test/support/store_harness.dart`
- Delete: `lib/services/firestore_service.dart`, `lib/views/textbook/textbook_lending_screen.dart`, `lib/models/textbook_request.dart`

**Interfaces:**
- Consumes: `MarketService`, `kChatMaxMessage`, `kRatingMaxComment`, `RoomReportCategory`, `MarketReportOutcome`, `MarketException`, `containsContactInfo`, `kListingPhotoMaxBytes` (T11); `participantTalkRooms` (2B); repositories (T10).
- Produces:
  - `class ChatMessage { id, senderId, text, createdAt, pending; factory fromMap(id, map) }` (no name field — T-13)
  - `class TalkRoom { …2B fields…, listingId, listingType, lastMessageText, lastMessageAt, lastSenderId, lenderSent, borrowerSent, lenderReadAt, borrowerReadAt, closedBy; isLegacy; isClosed; bothSpoke; lastActivity; isParty(uid); nameOf(senderId); otherName(uid); isUnreadFor(uid); toMap(); factory fromMap(map) }` — the `messages` list is gone; `static const kRoomWarning`
  - `class ChatService(db)`: `pageSize = 30`, `streamRooms(uid)`, `streamLatest(roomId, {limit})`, `loadOlder(roomId, before, {limit})`, `send(roomId, uid, text) → Future<bool>`, `markRead(room, uid)`
  - `AppStore(…, {FirebaseFirestore? db, MarketService? market, ChatService? chat})`; fields `market`, `chat`; `int get unreadRoomCount`; `Future<String?> uploadListingPhoto(fileName, bytes)`. **Removed:** `textbookRequests`, `addTextbookRequest`, `respondToTextbookRequest`, `sendMessageToTalkRoom` (T-1, T-14).
  - `TalkRoomScreen({required AppStore store, required String roomId})` (same constructor as before).

- [ ] **Step 1: Write the failing tests**

Create `test/models/talk_room_test.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/talk_room.dart';

void main() {
  TalkRoom room({DateTime? last, String lastSender = 'u2', DateTime? lenderRead, DateTime? borrowerRead}) => TalkRoom(
        id: 'r', listingId: 'l', bookTitle: 'b', subjectName: 's', lenderId: 'u1', lenderName: 'オーナー',
        borrowerId: 'u2', borrowerName: '買う人', createdAt: DateTime.utc(2027, 4, 1), lastMessageAt: last,
        lastSenderId: lastSender, lenderReadAt: lenderRead, borrowerReadAt: borrowerRead,
      );

  test('a Function-written room parses, including Timestamps and the summary', () {
    final r = TalkRoom.fromMap({
      'id': 'l_x_u2', 'listingId': 'x', 'bookTitle': '本', 'lenderId': 'u1', 'lenderName': 'A', 'borrowerId': 'u2', 'borrowerName': 'B',
      'createdAt': '2027-04-10T03:00:00.000Z', 'lastMessageText': 'hi', 'lastMessageAt': Timestamp.fromDate(DateTime.utc(2027, 4, 11)),
      'lastSenderId': 'u2', 'lenderSent': true, 'borrowerSent': true, 'closedBy': null,
    });
    expect([r.isLegacy, r.bothSpoke, r.isClosed, r.lastMessageText], [false, true, false, 'hi']);
    expect(r.lastActivity.toUtc(), DateTime.utc(2027, 4, 11));
  });

  test('a legacy 参考書 room (messages array, no listing) still parses and is not ratable', () {
    final r = TalkRoom.fromMap({
      'id': 'room_1', 'requestId': 'tb_1', 'lenderId': 'u1', 'borrowerId': 'u2', 'createdAt': '2026-09-01T10:00:00.000',
      'messages': [{'text': 'old'}], 'warningNotice': '',
    });
    expect([r.isLegacy, r.bothSpoke, r.lastMessageAt], [true, false, null]);
    expect(r.warningNotice, TalkRoom.kRoomWarning);
    expect(r.lastActivity, DateTime(2026, 9, 1, 10));
  });

  test('is total: garbage degrades instead of throwing', () {
    final r = TalkRoom.fromMap({'id': 7, 'createdAt': {'x': 1}, 'lastMessageAt': 'nope', 'closedBy': 5, 'lenderSent': 'yes'});
    expect([r.id, r.lastMessageAt, r.closedBy, r.lenderSent], ['', null, null, false]);
  });

  test('isUnreadFor: only a newer message from the OTHER party, only for a party', () {
    final t = DateTime.utc(2027, 4, 10, 12);
    expect(room(last: t).isUnreadFor('u1'), isTrue); // never read
    expect(room(last: t, lenderRead: t.subtract(const Duration(seconds: 1))).isUnreadFor('u1'), isTrue);
    expect(room(last: t, lenderRead: t).isUnreadFor('u1'), isFalse); // read exactly then
    expect(room(last: t).isUnreadFor('u2'), isFalse); // my own last message
    expect(room().isUnreadFor('u1'), isFalse); // no message yet
    expect(room(last: t).isUnreadFor('stranger'), isFalse);
    expect(room(last: t).isUnreadFor(null), isFalse);
  });

  test('names come from the room, never from a message', () {
    final r = room();
    expect([r.nameOf('u1'), r.nameOf('u2'), r.nameOf('x')], ['オーナー', '買う人', '京大生']);
    expect([r.otherName('u1'), r.otherName('u2')], ['買う人', 'オーナー']);
  });

  test('ChatMessage: a pending server timestamp is flagged, garbage degrades', () {
    final m = ChatMessage.fromMap('m', {'senderId': 'u1', 'text': 'hi', 'createdAt': null});
    expect(m.pending, isTrue);
    final ok = ChatMessage.fromMap('m', {'senderId': 'u1', 'text': 'hi', 'createdAt': Timestamp.fromDate(DateTime.utc(2027))});
    expect([ok.pending, ok.createdAt.toUtc()], [false, DateTime.utc(2027)]);
    expect(ChatMessage.fromMap('m', {'text': 3}).text, '');
  });
}
```

Create `test/services/chat_service_test.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/talk_room.dart';
import 'package:kyoto_exam_hub/services/chat_service.dart';

Future<void> _seed(FakeFirebaseFirestore db, String room, int n) async {
  for (var i = 0; i < n; i++) {
    await db.collection('talk_rooms').doc(room).collection('messages').doc('m${i.toString().padLeft(3, '0')}').set({
      'senderId': i.isEven ? 'u1' : 'u2', 'text': 'msg $i',
      'createdAt': Timestamp.fromDate(DateTime.utc(2027, 4, 1).add(Duration(minutes: i))), 'university_id': 'kyoto_u',
    });
  }
}

void main() {
  test('send writes exactly the four fields the rules allow, trimmed; empty or too long writes nothing', () async {
    final db = FakeFirebaseFirestore();
    final chat = ChatService(db);
    expect(await chat.send('r1', 'u1', '  こんにちは  '), isTrue);
    expect(await chat.send('r1', 'u1', '   '), isFalse);
    expect(await chat.send('r1', 'u1', 'x' * 1001), isFalse);
    expect(await chat.send('r1', 'u1', 'x' * 1000), isTrue); // boundary
    final docs = (await db.collection('talk_rooms/r1/messages').get()).docs.map((d) => d.data()).toList();
    expect(docs.length, 2);
    final first = docs.firstWhere((d) => d['text'] == 'こんにちは');
    expect(first.keys.toSet(), {'senderId', 'text', 'createdAt', 'university_id'});
    expect([first['senderId'], first['university_id']], ['u1', 'kyoto_u']);
    expect(first['createdAt'], isA<Timestamp>());
  });

  test('streamLatest gives the newest page oldest-first; loadOlder pages back until empty', () async {
    final db = FakeFirebaseFirestore();
    await _seed(db, 'r1', 70);
    final chat = ChatService(db);
    final latest = await chat.streamLatest('r1').first;
    expect(latest.length, 30);
    expect([latest.first.text, latest.last.text], ['msg 40', 'msg 69']);
    final p2 = await chat.loadOlder('r1', latest.first.createdAt);
    expect([p2.length, p2.first.text, p2.last.text], [30, 'msg 10', 'msg 39']);
    final p3 = await chat.loadOlder('r1', p2.first.createdAt);
    expect([p3.length, p3.first.text, p3.last.text], [10, 'msg 0', 'msg 9']);
    expect(await chat.loadOlder('r1', p3.first.createdAt), isEmpty);
  });

  test('markRead moves only the caller’s own marker; a non-party writes nothing', () async {
    final db = FakeFirebaseFirestore();
    final room = TalkRoom(id: 'r1', listingId: 'l', bookTitle: 'b', subjectName: 's', lenderId: 'u1', lenderName: 'A',
        borrowerId: 'u2', borrowerName: 'B', createdAt: DateTime.utc(2027));
    await db.collection('talk_rooms').doc('r1').set(room.toMap());
    final chat = ChatService(db);
    await chat.markRead(room, 'u2');
    var d = (await db.doc('talk_rooms/r1').get()).data()!;
    expect([d['borrowerReadAt'] is Timestamp, d['lenderReadAt']], [true, null]);
    await chat.markRead(room, 'stranger');
    d = (await db.doc('talk_rooms/r1').get()).data()!;
    expect(d['lenderReadAt'], isNull);
  });
}
```

Create `test/views/talk_room_screen_test.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/talk_room.dart';
import 'package:kyoto_exam_hub/views/textbook/talk_room_screen.dart';

import '../support/store_harness.dart';

TalkRoom _room({String? closedBy, String listingId = 'l1', bool spoke = true}) => TalkRoom(
      id: 'room1', listingId: listingId, bookTitle: '線形代数入門', subjectName: '', lenderId: 'u1', lenderName: 'オーナー',
      borrowerId: 'u2', borrowerName: '買う人', createdAt: DateTime.utc(2027, 4, 1), closedBy: closedBy,
      lenderSent: spoke, borrowerSent: spoke,
    );

Future<Harness> _open(WidgetTester tester, TalkRoom room) async {
  final h = Harness()..signIn(uid: 'u2', name: 'ここの名前は使われない');
  await h.db.collection('talk_rooms').doc(room.id).set(room.toMap());
  await h.db.collection('talk_rooms/${room.id}/messages').doc('m1').set({
    'senderId': 'u1', 'text': '時計台前でどうですか', 'createdAt': Timestamp.fromDate(DateTime.utc(2027, 4, 2)), 'university_id': 'kyoto_u',
  });
  h.store.talkRooms = [room];
  await tester.pumpWidget(MaterialApp(home: TalkRoomScreen(store: h.store, roomId: room.id)));
  await tester.pumpAndSettle();
  return h;
}

void main() {
  testWidgets('shows the messages with the ROOM’s names and the no-money warning; sending writes a message', (tester) async {
    final h = await _open(tester, _room());
    expect(find.text('時計台前でどうですか'), findsOneWidget);
    expect(find.text('オーナー'), findsOneWidget);
    expect(find.textContaining('お金を扱いません'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '12時に行きます');
    await tester.tap(find.byTooltip('送信'));
    await tester.pumpAndSettle();
    final sent = (await h.db.collection('talk_rooms/room1/messages').where('text', isEqualTo: '12時に行きます').get()).docs;
    expect(sent.single.data()['senderId'], 'u2');
    expect(find.text('12時に行きます'), findsOneWidget);
  });

  testWidgets('typing a phone number shows the contact-info warning', (tester) async {
    await _open(tester, _room());
    await tester.enterText(find.byType(TextField), '090-1234-5678');
    await tester.pump();
    expect(find.textContaining('連絡先は、なるべく送らないでください'), findsOneWidget);
  });

  testWidgets('a blocked room shows that it is closed and has no input', (tester) async {
    await _open(tester, _room(closedBy: 'u1'));
    expect(find.textContaining('このトークは終了しています'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
  });

  testWidgets('the menu offers rating only for a market room where both sides spoke', (tester) async {
    await _open(tester, _room(spoke: false));
    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    expect(find.text('取引を評価する'), findsNothing);
    expect(find.text('受け渡し不履行・トラブルを報告'), findsOneWidget);
    expect(find.text('ブロックする'), findsOneWidget);
  });

  testWidgets('rating sends rateDeal with the chosen stars', (tester) async {
    final h = await _open(tester, _room());
    h.reply = (_, _) => {'status': 'rated', 'revealed': false};
    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('取引を評価する'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('★4'));
    await tester.tap(find.text('送信'));
    await tester.pumpAndSettle();
    expect(h.calls.last.$1, 'rateDeal');
    expect(h.calls.last.$2, {'roomId': 'room1', 'stars': 4, 'comment': ''});
    expect(find.text('評価を送信しました。'), findsOneWidget);
  });
}
```

Replace the whole of `test/services/talk_room_queries_test.dart` with:

```dart
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/talk_room.dart';
import 'package:kyoto_exam_hub/services/talk_room_queries.dart';

TalkRoom room(String id, String lender, String borrower, int day, {int? lastMessageDay}) => TalkRoom(
      id: id, requestId: 'r', bookTitle: 'b', subjectName: 's',
      borrowerId: borrower, borrowerName: 'B', lenderId: lender, lenderName: 'L',
      createdAt: DateTime(2027, 1, day),
      lastMessageAt: lastMessageDay == null ? null : DateTime(2027, 1, lastMessageDay),
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

  test('Plan 3: a room with a recent message sorts before a newer but silent room', () async {
    final db = FakeFirebaseFirestore();
    for (final r in [room('busy', 'u1', 'u2', 1, lastMessageDay: 9), room('silent', 'u3', 'u1', 5)]) {
      await db.collection('talk_rooms').doc(r.id).set(r.toMap());
    }
    await expectLater(
      participantTalkRooms(db, 'u1'),
      emitsThrough(predicate<List<TalkRoom>>((l) => l.map((r) => r.id).join(',') == 'busy,silent', 'last activity first')),
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

In `test/support/store_harness.dart` replace

```dart
import 'package:kyoto_exam_hub/services/credit_service.dart';
```

with

```dart
import 'package:kyoto_exam_hub/services/credit_service.dart';
import 'package:kyoto_exam_hub/services/market_service.dart';
```

In `test/support/store_harness.dart` replace

```dart
      db: db,
```

with

```dart
      db: db,
      market: MarketService(db, _invoke),
```

In `test/services/app_store_test.dart` replace

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
```

with

```dart
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
```

In `test/services/app_store_test.dart` replace

```dart
import 'package:kyoto_exam_hub/models/review.dart';
```

with

```dart
import 'package:kyoto_exam_hub/models/review.dart';
import 'package:kyoto_exam_hub/models/talk_room.dart';
```

In `test/services/app_store_test.dart` replace

```dart
  test('logout clears the session state', () {
    final h = Harness();
    h.signIn();
    h.store.userTimetable = {'Mon_1': 'c1'};
    h.store.creditBalance = 5;
    h.store.logout();
    expect([h.store.currentUser, h.store.userTimetable, h.store.creditBalance, h.store.talkRooms], [null, <String, String>{}, 0, []]);
  });
```

with

```dart
  test('logout clears the session state', () {
    final h = Harness();
    h.signIn();
    h.store.userTimetable = {'Mon_1': 'c1'};
    h.store.creditBalance = 5;
    h.store.logout();
    expect([h.store.currentUser, h.store.userTimetable, h.store.creditBalance, h.store.talkRooms], [null, <String, String>{}, 0, []]);
  });

  test('Plan 3: unreadRoomCount counts rooms with a newer message from the other party', () {
    final h = Harness();
    h.signIn();
    TalkRoom room(String id, {required String last, DateTime? read}) => TalkRoom(
          id: id, listingId: 'l', bookTitle: 'b', subjectName: 's', lenderId: 'u1', lenderName: 'A', borrowerId: 'u2',
          borrowerName: 'B', createdAt: DateTime.utc(2027), lastMessageAt: DateTime.utc(2027, 2), lastSenderId: last, lenderReadAt: read,
        );
    h.store.talkRooms = [room('a', last: 'u2'), room('b', last: 'u1'), room('c', last: 'u2', read: DateTime.utc(2027, 3))];
    expect(h.store.unreadRoomCount, 1);
  });

  test('Plan 3: uploadListingPhoto refuses non-images and photos over 2 MiB before touching Storage', () async {
    final h = Harness();
    h.signIn();
    expect(await h.store.uploadListingPhoto('a.pdf', Uint8List(10)), isNull);
    expect(h.store.lastNoticeMessage, '写真は JPEG / PNG / WebP のみアップロードできます。');
    expect(await h.store.uploadListingPhoto('a.jpg', Uint8List(2 * 1024 * 1024 + 1)), isNull);
    expect(h.store.lastNoticeMessage, '写真は1枚2MBまでです。');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `flutter test`
Expected: FAIL — compile errors: `TalkRoom` has no `lastMessageAt`/`isUnreadFor`, `ChatService` does not exist, `AppStore` has no `market`/`unreadRoomCount`/`uploadListingPhoto`.

- [ ] **Step 3: Rewrite the model and the room query order; add ChatService**

Replace the whole of `lib/models/talk_room.dart` with:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';

DateTime? _time(dynamic v) {
  if (v is Timestamp) return v.toDate();
  if (v is String) return DateTime.tryParse(v);
  return null;
}

String _str(dynamic v) => v is String ? v : '';

/// One document of `talk_rooms/{roomId}/messages` (Plan 3, spec §4.5.5).
/// The sender's NAME is not stored: the screen takes it from the room, whose
/// names the Function sanitized (T-13). Total: garbage degrades, never throws.
class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.senderId,
    required this.text,
    required this.createdAt,
    this.pending = false,
  });

  final String id;
  final String senderId;
  final String text;
  final DateTime createdAt;

  /// True while the server timestamp of a just-sent message is not back yet.
  final bool pending;

  factory ChatMessage.fromMap(String id, Map<String, dynamic> map) {
    final at = _time(map['createdAt']);
    return ChatMessage(
      id: id,
      senderId: _str(map['senderId']),
      text: _str(map['text']),
      createdAt: at ?? DateTime.now(),
      pending: at == null,
    );
  }
}

/// A two-party chat about one listing (Plan 3). Created only by the
/// `openListingChat` Function; `lenderId` = the listing owner, `borrowerId` =
/// the person who asked (historical names, kept so 2B's participant rules and
/// queries stay valid). The summary fields are written by `onTalkMessageCreated`;
/// a participant may only move their own read marker.
class TalkRoom {
  TalkRoom({
    required this.id,
    this.universityId = 'kyoto_u',
    this.listingId = '',
    this.listingType = '',
    this.requestId = '',
    required this.bookTitle,
    required this.subjectName,
    required this.borrowerId,
    required this.borrowerName,
    required this.lenderId,
    required this.lenderName,
    required this.createdAt,
    this.warningNotice = kRoomWarning,
    this.lastMessageText = '',
    this.lastMessageAt,
    this.lastSenderId = '',
    this.lenderSent = false,
    this.borrowerSent = false,
    this.lenderReadAt,
    this.borrowerReadAt,
    this.closedBy,
  });

  static const String kRoomWarning =
      'アプリはお金を扱いません。代金は受け渡しのときに当事者どうしで直接やりとりしてください。電話番号・住所などの個人情報は送らないでください。';

  final String id;
  final String universityId;
  final String listingId; // '' = a legacy 参考書 room (no rating, T-10)
  final String listingType;
  final String requestId;
  final String bookTitle;
  final String subjectName;
  final String borrowerId;
  final String borrowerName;
  final String lenderId;
  final String lenderName;
  final DateTime createdAt;
  final String warningNotice;
  final String lastMessageText;
  final DateTime? lastMessageAt;
  final String lastSenderId;
  final bool lenderSent;
  final bool borrowerSent;
  final DateTime? lenderReadAt;
  final DateTime? borrowerReadAt;
  final String? closedBy;

  bool get isLegacy => listingId.isEmpty;
  bool get isClosed => (closedBy ?? '').isNotEmpty;
  bool get bothSpoke => lenderSent && borrowerSent;
  DateTime get lastActivity => lastMessageAt ?? createdAt;
  bool isParty(String? uid) => uid != null && uid.isNotEmpty && (uid == lenderId || uid == borrowerId);

  /// The name shown for [senderId] (from the room, never from the message).
  String nameOf(String senderId) =>
      senderId == lenderId ? lenderName : senderId == borrowerId ? borrowerName : '京大生';
  String otherName(String uid) => uid == lenderId ? borrowerName : lenderName;

  /// A message from the other party is newer than my read marker.
  bool isUnreadFor(String? uid) {
    final at = lastMessageAt;
    if (!isParty(uid) || at == null || lastSenderId == uid) return false;
    final mine = uid == lenderId ? lenderReadAt : borrowerReadAt;
    return mine == null || mine.isBefore(at);
  }

  /// Test seeding / legacy shape only — the client never writes a room.
  Map<String, dynamic> toMap() => {
        'id': id,
        'university_id': universityId,
        'listingId': listingId,
        'listingType': listingType,
        'requestId': requestId,
        'bookTitle': bookTitle,
        'subjectName': subjectName,
        'borrowerId': borrowerId,
        'borrowerName': borrowerName,
        'lenderId': lenderId,
        'lenderName': lenderName,
        'createdAt': createdAt.toIso8601String(),
        'warningNotice': warningNotice,
        'lastMessageText': lastMessageText,
        'lastMessageAt': lastMessageAt == null ? null : Timestamp.fromDate(lastMessageAt!),
        'lastSenderId': lastSenderId,
        'lenderSent': lenderSent,
        'borrowerSent': borrowerSent,
        'lenderReadAt': lenderReadAt == null ? null : Timestamp.fromDate(lenderReadAt!),
        'borrowerReadAt': borrowerReadAt == null ? null : Timestamp.fromDate(borrowerReadAt!),
        'closedBy': closedBy,
      };

  factory TalkRoom.fromMap(Map<String, dynamic> map) => TalkRoom(
        id: _str(map['id']),
        universityId: map['university_id'] is String ? map['university_id'] as String : 'kyoto_u',
        listingId: _str(map['listingId']),
        listingType: _str(map['listingType']),
        requestId: _str(map['requestId']),
        bookTitle: _str(map['bookTitle']),
        subjectName: _str(map['subjectName']),
        borrowerId: _str(map['borrowerId']),
        borrowerName: _str(map['borrowerName']),
        lenderId: _str(map['lenderId']),
        lenderName: _str(map['lenderName']),
        createdAt: _time(map['createdAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
        warningNotice: map['warningNotice'] is String && (map['warningNotice'] as String).isNotEmpty
            ? map['warningNotice'] as String
            : kRoomWarning,
        lastMessageText: _str(map['lastMessageText']),
        lastMessageAt: _time(map['lastMessageAt']),
        lastSenderId: _str(map['lastSenderId']),
        lenderSent: map['lenderSent'] == true,
        borrowerSent: map['borrowerSent'] == true,
        lenderReadAt: _time(map['lenderReadAt']),
        borrowerReadAt: _time(map['borrowerReadAt']),
        closedBy: map['closedBy'] is String ? map['closedBy'] as String : null,
      );
}
```

In `lib/services/talk_room_queries.dart` replace

```dart
/// single-field equality queries the rules can prove — and merges them, newest
/// first. (A university-wide stream is now refused by the rules.)
```

with

```dart
/// single-field equality queries the rules can prove — and merges them, most
/// recent activity (last message, else creation) first. (A university-wide
/// stream is refused by the rules.)
```

In `lib/services/talk_room_queries.dart` replace

```dart
    out.add(byId.values.toList()..sort((x, y) => y.createdAt.compareTo(x.createdAt)));
```

with

```dart
    out.add(byId.values.toList()..sort((x, y) => y.lastActivity.compareTo(x.lastActivity)));
```

Create `lib/services/chat_service.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/talk_room.dart';
import 'market_service.dart' show kChatMaxMessage;
import 'talk_room_queries.dart';

/// Chat on `talk_rooms/{roomId}/messages` (Plan 3, spec §4.5.5): one document
/// per message, read a page at a time — no array, no `arrayUnion`, no 1 MiB
/// ceiling. Rooms are created by the `openListingChat` Function; the client
/// only sends messages and moves its own read marker (firestore.rules).
class ChatService {
  ChatService(this._db);
  final FirebaseFirestore _db;

  static const int pageSize = 30;

  CollectionReference<Map<String, dynamic>> _messages(String roomId) =>
      _db.collection('talk_rooms').doc(roomId).collection('messages');

  List<ChatMessage> _oldestFirst(QuerySnapshot<Map<String, dynamic>> q) =>
      q.docs.map((d) => ChatMessage.fromMap(d.id, d.data())).toList().reversed.toList();

  /// The rooms [uid] takes part in, most recent activity first (2B M-15 query).
  Stream<List<TalkRoom>> streamRooms(String uid) => participantTalkRooms(_db, uid);

  /// The newest [limit] messages, oldest first, live.
  Stream<List<ChatMessage>> streamLatest(String roomId, {int limit = pageSize}) =>
      _messages(roomId).orderBy('createdAt', descending: true).limit(limit).snapshots().map(_oldestFirst);

  /// The [limit] messages before [before], oldest first (one page of history).
  Future<List<ChatMessage>> loadOlder(String roomId, DateTime before, {int limit = pageSize}) async => _oldestFirst(
        await _messages(roomId)
            .where('createdAt', isLessThan: Timestamp.fromDate(before))
            .orderBy('createdAt', descending: true)
            .limit(limit)
            .get(),
      );

  /// Sends [text] as [uid]; returns false (nothing written) when it is empty or too long.
  Future<bool> send(String roomId, String uid, String text) async {
    final t = text.trim();
    if (t.isEmpty || t.length > kChatMaxMessage) return false;
    await _messages(roomId).add({
      'senderId': uid,
      'text': t,
      'createdAt': FieldValue.serverTimestamp(),
      'university_id': 'kyoto_u',
    });
    return true;
  }

  /// Moves the caller's own read marker to the server time (the only room write the rules allow).
  Future<void> markRead(TalkRoom room, String uid) async {
    if (!room.isParty(uid)) return;
    await _db.collection('talk_rooms').doc(room.id).update({
      uid == room.lenderId ? 'lenderReadAt' : 'borrowerReadAt': FieldValue.serverTimestamp(),
    });
  }
}
```

- [ ] **Step 4: Replace `lib/services/app_store.dart` and retire the 参考書 board**

Replace the whole of `lib/services/app_store.dart` with:

```dart
import 'package:flutter/foundation.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb_auth;
import 'dart:async';
import 'dart:math';

import '../models/user_profile.dart';
import '../models/subject.dart';
import '../models/post.dart';
import '../models/request.dart';
import '../models/talk_room.dart';
import '../models/credit_ledger_entry.dart';
import '../models/inquiry.dart';
import '../models/review.dart';
import '../repositories/course_repository.dart';
import '../repositories/inquiry_repository.dart';
import '../repositories/post_repository.dart';
import '../repositories/request_repository.dart';
import '../repositories/user_repository.dart';
import 'review_service.dart';
import 'ranking_service.dart';
import 'credit_service.dart';
import 'moderation_service.dart';
import 'market_service.dart';
import 'chat_service.dart';
import '../models/app_notification.dart';
import '../utils/download_helper.dart';
import 'package:firebase_storage/firebase_storage.dart' as fb_storage;

class AppStore extends ChangeNotifier {
  /// Course catalog, backed by the Firestore `courses` collection.
  final CourseRepository courses;

  /// Firestore data layer for the review layer (Plan A).
  final ReviewService reviews;

  /// Client-side rankings over course_stats pool.
  final RankingService ranking;

  /// Plan 3 (Task 9): injectable so tests run AppStore on `fake_cloud_firestore`.
  final FirebaseFirestore _db;

  /// Feature repositories (Plan 3, Task 10): AppStore keeps the session state
  /// and the UI-facing notices; data access lives in these.
  late final UserRepository _userRepo = UserRepository(_db);
  late final PostRepository _postRepo = PostRepository(_db);
  late final RequestRepository _requestRepo = RequestRepository(_db);
  late final InquiryRepository _inquiryRepo = InquiryRepository(_db);

  /// Resolved on use, not at construction: a test (no Firebase app) can build an
  /// AppStore; `_initFirebaseSync` then fails inside its own try/catch.
  fb_auth.FirebaseAuth get _firebaseAuth => fb_auth.FirebaseAuth.instance;

  UserProfile? currentUser;
  Map<String, String> userTimetable = {};

  List<Post> posts = [];
  List<MaterialRequest> requests = [];
  List<TalkRoom> talkRooms = [];
  List<Inquiry> inquiries = [];

  String? lastNoticeMessage;
  bool isFirebaseConnected = false;
  bool showOnboardingFlow = false;

  void completeOnboarding() {
    showOnboardingFlow = false;
    notifyListeners();
  }

  /// Credit balance/ledger streams and the signed-download callable (Plan 2A).
  final CreditService credits;
  int creditBalance = 0;
  List<CreditLedgerEntry> ledger = [];
  String? invitationCode; // own code, issued server-side (P2-2)
  StreamSubscription<String?>? _codeSub;
  StreamSubscription<int>? _balanceSub;
  StreamSubscription<List<CreditLedgerEntry>>? _ledgerSub;

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
    _roomsSub = chat.streamRooms(uid).listen((rooms) {
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

  void _watchCredits(String uid) {
    _balanceSub?.cancel();
    _codeSub?.cancel();
    _ledgerSub?.cancel();
    _balanceSub = credits.streamBalance(uid).listen((b) {
      creditBalance = b;
      notifyListeners();
    }, onError: (_) {});
    _codeSub = credits.streamInvitationCode(uid).listen((c) {
      invitationCode = c;
      notifyListeners();
    }, onError: (_) {});
    _ledgerSub = credits.streamLedger(uid).listen((l) {
      ledger = l;
      notifyListeners();
    }, onError: (_) {});
  }

  /// Idempotent server-side (a flag on the balance doc), so calling it on every
  /// verified login is cheap and also back-fills users who verified before
  /// Plan 2A shipped.
  /// Returns null when the call failed (retried on the next login or
  /// verification check), otherwise whether this call actually granted credits.
  bool _welcomePending = false;
  Future<bool?> _claimWelcome() async {
    try {
      final r = await credits.claimWelcome();
      _welcomePending = false;
      return r.granted;
    } catch (_) {
      _welcomePending = true;
      return null;
    }
  }

  /// Textbook market callables + listing reads (Plan 3).
  final MarketService market;

  /// Chat on `talk_rooms/{id}/messages` (Plan 3).
  final ChatService chat;

  /// Rooms with a message from the other party newer than my read marker (教科書 tab badge).
  int get unreadRoomCount => talkRooms.where((r) => r.isUnreadFor(currentUser?.uid)).length;

  AppStore(
    this.courses,
    this.reviews,
    this.ranking,
    this.credits,
    this.moderation, {
    FirebaseFirestore? db,
    MarketService? market,
    ChatService? chat,
  })  : _db = db ?? FirebaseFirestore.instance,
        market = market ?? MarketService.live(db ?? FirebaseFirestore.instance),
        chat = chat ?? ChatService(db ?? FirebaseFirestore.instance) {
    // _initSampleData(); // Commented out for production release
    _initFirebaseSync();
  }

  Future<void> _initFirebaseSync() async {
    try {
      // Prime the course catalog cache so the first search / timetable render
      // does not have to wait on a cold collection fetch.
      courses.warmUp().catchError((_) {});

      final href = getUriHref();
      if (href.isNotEmpty && _firebaseAuth.isSignInWithEmailLink(href)) {
        final email = getEmailForSignIn();
        if (email != null && email.isNotEmpty) {
          try {
            final userCredential = await _firebaseAuth.signInWithEmailLink(email: email, emailLink: href);
            final uid = userCredential.user!.uid;

            var profile = await _userRepo.getUserProfile(uid);
            if (profile == null) {
              final randomNum = Random().nextInt(9000) + 1000;
              profile = UserProfile(
                uid: uid,
                universityId: 'kyoto_u',
                email: email,
                displayName: '京大生_$randomNum',
                createdAt: DateTime.now(),
              );
              await _userRepo.saveUserProfile(profile);

            }

            currentUser = profile;
            saveEmailForSignIn('');
            notifyListeners();
          } catch (e) {
            print('Sign in with email link error: $e');
            lastNoticeMessage = 'サインイン用リンクの認証に失敗しました。期限切れか無効なリンクです。';
            notifyListeners();
          }
        }
      }

      _firebaseAuth.authStateChanges().listen((fbUser) async {
        if (fbUser != null && fbUser.email != null) {
          final profile = await _userRepo.getUserProfile(fbUser.uid);
          if (profile != null) {
            currentUser = profile;
            _watchCredits(fbUser.uid);
            _watchUserStreams(fbUser.uid);
            if (fbUser.emailVerified) _claimWelcome();

            final timetable = await _userRepo.getUserTimetable(fbUser.uid);
            userTimetable = timetable;

            notifyListeners();
          }
        }
      }, onError: (_) {});

      _postRepo.streamPosts().listen((remotePosts) {
        if (remotePosts.isNotEmpty) {
          posts = remotePosts;
          notifyListeners();
        }
      }, onError: (_) {});

      _requestRepo.streamMaterialRequests().listen((remoteRequests) {
        if (remoteRequests.isNotEmpty) {
          requests = remoteRequests;
          notifyListeners();
        }
      }, onError: (_) {});

      isFirebaseConnected = true;
    } catch (e) {
      isFirebaseConnected = false;
    }
  }

  // --- ADD / IMPORT CUSTOM SUBJECT (REAL KULASIS DATA) ---

  Future<Subject> addCustomSubject({
    required String name,
    required String faculty,
    required String dayOfWeek,
    required int period,
    required String lecturer,
    required String category,
  }) async {
    final newSubject = await courses.addCustomCourse(
      name: name,
      faculty: faculty,
      dayOfWeek: dayOfWeek,
      period: period,
      lecturer: lecturer,
      category: category,
    );

    lastNoticeMessage = '『$name』をKULASIS科目マスタおよびFirestoreに追加しました！';
    notifyListeners();
    return newSubject;
  }

  Future<void> importSubjectsFromBatch(List<Map<String, dynamic>> subjectList) async {
    int addedCount = 0;
    for (final item in subjectList) {
      if (item['name'] != null && item['dayOfWeek'] != null && item['period'] != null) {
        await addCustomSubject(
          name: item['name'].toString(),
          faculty: item['faculty']?.toString() ?? '全学共通',
          dayOfWeek: item['dayOfWeek'].toString(),
          period: int.tryParse(item['period'].toString()) ?? 1,
          lecturer: item['lecturer']?.toString() ?? '担当教員未定',
          category: item['category']?.toString() ?? '専門/教養',
        );
        addedCount++;
      }
    }
    lastNoticeMessage = '$addedCount 件の科目データを一括登録しました！';
    notifyListeners();
  }

  // --- 1. AUTH & SIGNUP FLOW ---

  /// Rules cap the hint at 16 chars; the server validates it for real.
  String? _cleanReferral(String? raw) {
    final t = raw?.trim().toUpperCase() ?? '';
    if (t.isEmpty) return null;
    return t.length > 16 ? t.substring(0, 16) : t;
  }

  Future<bool> signUpWithPassword(String email, String password, {String? referralCode}) async {
    if (!email.endsWith('@st.kyoto-u.ac.jp')) {
      lastNoticeMessage = 'エラー: @st.kyoto-u.ac.jp のメールアドレスのみ登録可能です';
      notifyListeners();
      return false;
    }
    if (password.length < 6) {
      lastNoticeMessage = 'エラー: パスワードは6文字以上で入力してください';
      notifyListeners();
      return false;
    }

    try {
      final userCredential = await _firebaseAuth.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );
      final uid = userCredential.user!.uid;
      final randomNum = Random().nextInt(9000) + 1000;

      await userCredential.user!.sendEmailVerification().catchError((e) {
        print('sendEmailVerification error: $e');
      });

      final profile = UserProfile(
        uid: uid,
        universityId: 'kyoto_u',
        email: email,
        displayName: '京大生_$randomNum',
        createdAt: DateTime.now(),
        isVerified: false,
        pendingReferralCode: _cleanReferral(referralCode),
      );

      await _userRepo.saveUserProfile(profile);
      currentUser = profile;
      _watchCredits(uid); // authStateChanges may fire before the profile exists
      _watchUserStreams(uid);

      showOnboardingFlow = true;
      notifyListeners();
      return true;
    } catch (e) {
      print('Signup error: $e');
      lastNoticeMessage = '登録に失敗しました。このメールアドレスは既に登録されている可能性があります。';
      notifyListeners();
      return false;
    }
  }

  Future<bool> signInWithPassword(String email, String password) async {
    if (!email.endsWith('@st.kyoto-u.ac.jp')) {
      lastNoticeMessage = 'エラー: @st.kyoto-u.ac.jp のメールアドレスのみログイン可能です';
      notifyListeners();
      return false;
    }

    try {
      final userCredential = await _firebaseAuth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );
      final uid = userCredential.user!.uid;

      final profile = await _userRepo.getUserProfile(uid);
      if (profile != null) {
        currentUser = profile;
        notifyListeners();
        return true;
      } else {
        lastNoticeMessage = 'ユーザープロファイルが見つかりません。';
        notifyListeners();
        return false;
      }
    } catch (e) {
      print('SignIn error: $e');
      lastNoticeMessage = 'ログインに失敗しました。メールアドレスまたはパスワードが正しくありません。';
      notifyListeners();
      return false;
    }
  }

  void logout() {
    _balanceSub?.cancel();
    _codeSub?.cancel();
    _ledgerSub?.cancel();
    _notifSub?.cancel();
    _roomsSub?.cancel();
    notifications = [];
    talkRooms = [];
    creditBalance = 0;
    invitationCode = null;
    ledger = [];
    currentUser = null;
    userTimetable.clear();
    notifyListeners();
  }

  Future<bool> checkEmailVerification() async {
    final fbUser = _firebaseAuth.currentUser;
    if (fbUser == null) return false;

    await fbUser.reload(); // Refresh the user state
    // `reload()` refreshes the user record but NOT the cached ID token, and the
    // Firestore rules read `request.auth.token.email_verified`. Without a forced
    // token refresh a freshly-verified user would be denied every content write
    // until the token expired (~1h). Cheap and harmless when already fresh.
    await fbUser.getIdToken(true);
    final isEmailVerified = fbUser.emailVerified;

    if (isEmailVerified && currentUser != null && (!currentUser!.isVerified || _welcomePending)) {
      if (!currentUser!.isVerified) {
        currentUser = currentUser!.copyWith(isVerified: true);
        await _userRepo.saveUserProfile(currentUser!);
      }
      final granted = await _claimWelcome();
      lastNoticeMessage = granted == null
          ? 'メールアドレスの検証が完了しました！ クレジットの付与は次回ログイン時に再試行されます。'
          : granted
              ? 'メールアドレスの検証が完了しました！ ご登録ボーナスとして3クレジットを付与しました。'
              : 'メールアドレスの検証が完了しました！';
      notifyListeners();
      return true;
    }
    return isEmailVerified;
  }

  Future<void> resendVerificationEmail() async {
    final fbUser = _firebaseAuth.currentUser;
    if (fbUser != null) {
      await fbUser.sendEmailVerification();
      lastNoticeMessage = '検証用の確認メールを再送信しました。';
      notifyListeners();
    }
  }

  Future<bool> updateDisplayName(String newName) async {
    if (newName.trim().isEmpty) {
      lastNoticeMessage = 'エラー: ユーザー名を入力してください';
      notifyListeners();
      return false;
    }
    if (currentUser == null) return false;

    try {
      currentUser = currentUser!.copyWith(displayName: newName.trim());
      await _userRepo.saveUserProfile(currentUser!);
      lastNoticeMessage = 'ユーザー名を更新しました！';
      notifyListeners();
      return true;
    } catch (e) {
      print('Update displayName error: $e');
      lastNoticeMessage = 'ユーザー名の更新に失敗しました。';
      notifyListeners();
      return false;
    }
  }

  // --- 2. TIMETABLE REGISTRATION ---

  void registerTimetableSubject(String dayOfWeek, int period, String subjectId) {
    final key = '${dayOfWeek}_$period';
    userTimetable[key] = subjectId;

    if (currentUser != null) {
      _userRepo.saveUserTimetable(currentUser!.uid, userTimetable).catchError((_) {});
    }

    notifyListeners();
  }

  void removeTimetableSubject(String dayOfWeek, int period) {
    final key = '${dayOfWeek}_$period';
    userTimetable.remove(key);

    if (currentUser != null) {
      _userRepo.saveUserTimetable(currentUser!.uid, userTimetable).catchError((_) {});
    }

    notifyListeners();
  }

  Future<List<Subject>> getRegisteredSubjects() async {
    final List<Subject> list = [];
    for (final id in userTimetable.values.toSet()) {
      final sub = await courses.byId(id);
      if (sub != null && !list.any((element) => element.id == sub.id)) {
        list.add(sub);
      }
    }
    return list;
  }

  // --- 3. POSTS & POINT REWARDS ENGINE ---

  List<Post> getPostsForSubject(String subjectId, PostCategory category) {
    return posts
        .where((p) => p.subjectId == subjectId && p.category == category)
        .toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }

  List<MaterialRequest> getRequestsForSubject(String subjectId, PostCategory category) {
    return requests
        .where((r) => r.subjectId == subjectId && r.category == category)
        .toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }

  Future<bool> addPost({
    required String subjectId,
    required PostCategory category,
    int? year,
    required String title,
    required String description,
    required List<String> fileNames,
    required List<String> filePaths,
    String? requestId,
  }) async {
    if (currentUser == null) return false;
    final sub = await courses.byId(subjectId);
    final newPost = Post(
      id: 'post_${DateTime.now().millisecondsSinceEpoch}',
      universityId: 'kyoto_u',
      subjectId: subjectId,
      subjectName: sub?.name ?? '不明な科目',
      authorId: currentUser!.uid,
      authorName: currentUser!.displayName,
      category: category,
      year: year,
      title: title,
      description: description,
      filePaths: filePaths,
      fileNames: fileNames,
      createdAt: DateTime.now(),
      requestId: requestId,
    );
    // Await the write: rules can deny it (bad path, unverified, ...) and the UI
    // must not claim success. Only then add it locally and bump the counter.
    try {
      await _postRepo.createPost(newPost);
    } catch (_) {
      lastNoticeMessage = '投稿に失敗しました。ファイルの形式・サイズやメール認証の状態を確認して、もう一度お試しください。';
      notifyListeners();
      return false;
    }
    posts.insert(0, newPost);
    // Credits are granted by the `onPostCreated` trigger once it has validated
    // the files; the balance arrives through the `credits` stream. If the post
    // is rejected there the trigger deletes it and the posts stream drops it.
    lastNoticeMessage = '資料をアップロードしました！確認後、クレジットが付与されます。';
    notifyListeners();
    return true;
  }

  Future<bool> downloadPost(Post post) async {
    if (currentUser == null) return false;
    try {
      final r = await credits.downloadResource(post.id);
      startDownload(r.url);
      lastNoticeMessage = r.charged
          ? '資料のダウンロードを開始しました（1クレジット消費）'
          : '資料のダウンロードを開始しました';
      notifyListeners();
      return true;
    } on CreditException catch (e) {
      lastNoticeMessage = switch (e.kind) {
        CreditErrorKind.insufficient => 'クレジットが足りません。資料をアップロードするとクレジットを獲得できます。',
        CreditErrorKind.notFound => 'この資料は削除されたか、見つかりませんでした。',
        _ => 'ダウンロードに失敗しました。時間をおいて再度お試しください。',
      };
      notifyListeners();
      return false;
    } catch (_) {
      lastNoticeMessage = 'ダウンロードに失敗しました。時間をおいて再度お試しください。';
      notifyListeners();
      return false;
    }
  }

  /// Uploads to the private per-user prefix and returns the storage PATH.
  /// Storage rules allow create-only at `resources/<uid>/<one flat segment>`,
  /// so every attempt (including retries) uses a fresh timestamped name.
  Future<String?> uploadFileToStorage(String fileName, Uint8List fileBytes) async {
    final uid = currentUser?.uid;
    if (uid == null) return null;
    if (fileBytes.length > 20 * 1024 * 1024) {
      lastNoticeMessage = 'ファイルサイズは20MBまでです。';
      notifyListeners();
      return null;
    }
    try {
      final path = PostRepository.resourcePath(uid, fileName, DateTime.now().millisecondsSinceEpoch);
      final contentType = PostRepository.contentTypeFor(fileName);
      await fb_storage.FirebaseStorage.instance
          .ref()
          .child(path)
          .putData(fileBytes, fb_storage.SettableMetadata(contentType: contentType));
      return path;
    } catch (e) {
      lastNoticeMessage = 'ストレージへのファイルアップロードに失敗しました。';
      notifyListeners();
      return null;
    }
  }

  /// Uploads one listing photo to `listings/<uid>/…` (Plan 3, T-5) and returns
  /// its storage PATH (the listing stores paths; download URLs are asked for at
  /// display time). Images only, at most 2 MiB — storage.rules enforce the same.
  Future<String?> uploadListingPhoto(String fileName, Uint8List bytes) async {
    final uid = currentUser?.uid;
    if (uid == null) return null;
    final contentType = MarketService.photoContentType(fileName);
    if (contentType == null) {
      lastNoticeMessage = '写真は JPEG / PNG / WebP のみアップロードできます。';
      notifyListeners();
      return null;
    }
    if (bytes.length > kListingPhotoMaxBytes) {
      lastNoticeMessage = '写真は1枚2MBまでです。';
      notifyListeners();
      return null;
    }
    try {
      final path = MarketService.photoPath(uid, fileName, DateTime.now().millisecondsSinceEpoch);
      await fb_storage.FirebaseStorage.instance
          .ref()
          .child(path)
          .putData(bytes, fb_storage.SettableMetadata(contentType: contentType));
      return path;
    } catch (_) {
      lastNoticeMessage = '写真のアップロードに失敗しました。';
      notifyListeners();
      return null;
    }
  }

  Future<void> deletePost(String postId) async {
    final idx = posts.indexWhere((p) => p.id == postId);
    if (idx == -1) return;
    posts.removeAt(idx);
    await _postRepo.deletePost(postId).catchError((_) {});

    notifyListeners();
  }

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

  Future<bool> addMaterialRequest({
    required String subjectId,
    required PostCategory category,
    int? year,
    required String title,
    required String description,
  }) async {
    if (currentUser == null) return false;

    final sub = await courses.byId(subjectId);

    final req = MaterialRequest(
      id: 'req_${DateTime.now().millisecondsSinceEpoch}',
      universityId: 'kyoto_u',
      subjectId: subjectId,
      subjectName: sub?.name ?? '不明な科目',
      authorId: currentUser!.uid,
      authorName: currentUser!.displayName,
      category: category,
      year: year,
      title: title,
      description: description,
      costSpent: 0,
      rewardPoints: 0,
      createdAt: DateTime.now(),
    );

    try {
      await _requestRepo.createMaterialRequest(req);
    } catch (_) {
      lastNoticeMessage = 'リクエストの投稿に失敗しました。時間をおいて再度お試しください。';
      notifyListeners();
      return false;
    }
    requests.insert(0, req);

    lastNoticeMessage = 'Cloud Firestoreへリクエストを投稿しました！';
    notifyListeners();
    return true;
  }

  void submitInquiry({
    required String category,
    required String content,
    required String contactInfo,
    String? targetPostId,
  }) {
    if (currentUser == null) return;

    final inq = Inquiry(
      id: 'inq_${DateTime.now().millisecondsSinceEpoch}',
      universityId: 'kyoto_u',
      userId: currentUser!.uid,
      category: category,
      content: content,
      contactInfo: contactInfo,
      targetPostId: targetPostId,
      createdAt: DateTime.now(),
    );

    inquiries.add(inq);
    _inquiryRepo.submitInquiry(inq).catchError((_) {});

    lastNoticeMessage = 'お問い合わせを送信しました。運営からの連絡をお待ちください。';
    notifyListeners();
  }

  // --- Review layer (Plan A) -------------------------------------------------

  /// Create or edit the signed-in user's review for a course. Returns whether
  /// the write landed; on failure [lastNoticeMessage] carries the reason.
  Future<bool> submitReview({
    required String courseKey,
    required String courseName,
    required int rating,
    required Rakutan rakutan,
    required Attendance attendance,
    required GradingStyle grading,
    required PastExamUsefulness pastExam,
    required BringIn bringIn,
    required String comment,
    String? termTaken,
    String? gradeTaken,
  }) async {
    final user = currentUser;
    if (user == null) return false;
    if (!user.isVerified) {
      lastNoticeMessage = 'メール認証の完了後にレビューを投稿できます。';
      notifyListeners();
      return false;
    }
    final existing = await reviews.getMyReview(courseKey, user.uid);
    final now = DateTime.now();
    final review = Review(
      id: Review.docId(courseKey, user.uid),
      courseKey: courseKey,
      // C1: the `reviews` create rule pins the document id to
      // `courseSlug + '_' + uid`, so the escaped key has to be ON the document.
      courseSlug: Review.slug(courseKey),
      courseName: courseName,
      authorId: user.uid,
      authorName: user.displayName,
      rating: rating,
      rakutan: rakutan,
      attendance: attendance,
      grading: grading,
      pastExam: pastExam,
      bringIn: bringIn,
      comment: comment.trim(),
      termTaken: termTaken,
      gradeTaken: gradeTaken,
      helpfulBy: existing?.helpfulBy ?? const [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    );
    try {
      await reviews.submitReview(review);
      lastNoticeMessage =
          existing == null ? 'レビューを投稿しました！' : 'レビューを更新しました。';
      notifyListeners();
      return true;
    } catch (e) {
      lastNoticeMessage = 'レビューの保存に失敗しました。通信環境を確認してください。';
      notifyListeners();
      return false;
    }
  }

  /// Remove the signed-in user's review for [courseKey], if any.
  Future<void> deleteMyReview(String courseKey) async {
    final user = currentUser;
    if (user == null) return;
    final existing = await reviews.getMyReview(courseKey, user.uid);
    if (existing == null) return;
    try {
      await reviews.deleteReview(existing);
      lastNoticeMessage = 'レビューを削除しました。';
    } catch (_) {
      lastNoticeMessage = 'レビューの削除に失敗しました。';
    }
    notifyListeners();
  }

  /// Mark a review as helpful (best-effort; idempotent in [ReviewService]).
  Future<void> markReviewHelpful(String reviewId) async {
    final user = currentUser;
    if (user == null || !user.isVerified) return;
    try {
      await reviews.markHelpful(reviewId: reviewId, uid: user.uid);
    } catch (_) {/* best-effort */}
    notifyListeners();
  }
}
```

Delete `lib/services/firestore_service.dart` (`git rm lib/services/firestore_service.dart`).

Delete `lib/views/textbook/textbook_lending_screen.dart` (`git rm lib/views/textbook/textbook_lending_screen.dart`).

Delete `lib/models/textbook_request.dart` (`git rm lib/models/textbook_request.dart`).

In `lib/views/mypage/my_page_screen.dart` replace

```dart
import '../textbook/textbook_lending_screen.dart';
```

with

```dart

```

In `lib/views/mypage/my_page_screen.dart` replace

```dart
                  const Divider(height: 1, color: Color(0xFFE2E8F0)),
                  ListTile(
                    leading: const Icon(Icons.menu_book_outlined, color: Color(0xFF0F4C81)),
                    title: const Text('参考書の貸し借り', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Color(0xFF1E293B))),
                    trailing: const Icon(Icons.chevron_right, color: Color(0xFF94A3B8)),
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => TextbookLendingScreen(store: widget.store)),
                    ),
                  ),
```

with

```dart

```

Compared with Task 10's AppStore this only: drops the `FirestoreService` field and its import, the `textbook_request` import, `textbookRequests`, the `streamTextbookRequests` subscription, `addTextbookRequest`, `respondToTextbookRequest` and `sendMessageToTalkRoom`; listens to rooms through `chat.streamRooms`; adds `market`, `chat`, `unreadRoomCount`, the two optional constructor parameters and `uploadListingPhoto`. Everything else is byte-identical (the 14 characterization tests prove it).

- [ ] **Step 5: Rewrite `lib/views/textbook/talk_room_screen.dart`**

Replace the whole of `lib/views/textbook/talk_room_screen.dart` with:

```dart
import 'package:flutter/material.dart';

import '../../models/talk_room.dart';
import '../../services/app_store.dart';
import '../../services/chat_service.dart';
import '../../services/market_service.dart';

const _brand = Color(0xFF0F4C81);

/// A two-party chat (Plan 3, spec §4.5.5): the newest page live, older pages on
/// demand, names from the room (never from a message), the no-money warning,
/// and the safety tools — rate the deal (T-10), report harassment or a failed
/// handoff (T-20), block (T-17).
class TalkRoomScreen extends StatefulWidget {
  const TalkRoomScreen({super.key, required this.store, required this.roomId});

  final AppStore store;
  final String roomId;

  @override
  State<TalkRoomScreen> createState() => _TalkRoomScreenState();
}

class _TalkRoomScreenState extends State<TalkRoomScreen> {
  final _text = TextEditingController();
  late final Stream<List<ChatMessage>> _latest = widget.store.chat.streamLatest(widget.roomId);
  List<ChatMessage> _older = const [];
  bool _loadingOlder = false;
  bool _noMoreOlder = false;
  bool _sending = false;

  AppStore get store => widget.store;
  String get _me => store.currentUser?.uid ?? '';

  TalkRoom? get _room {
    for (final r in store.talkRooms) {
      if (r.id == widget.roomId) return r;
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    store.addListener(_onStore);
    _text.addListener(_onStore);
  }

  @override
  void dispose() {
    store.removeListener(_onStore);
    _text.dispose();
    super.dispose();
  }

  void _onStore() {
    if (mounted) setState(() {});
  }

  void _notice(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  void _markReadIfNeeded(TalkRoom room) {
    if (room.isUnreadFor(_me)) store.chat.markRead(room, _me).catchError((_) {});
  }

  Future<void> _loadOlder(DateTime before) async {
    setState(() => _loadingOlder = true);
    try {
      final page = await store.chat.loadOlder(widget.roomId, before);
      if (!mounted) return;
      setState(() {
        _older = [...page, ..._older];
        _noMoreOlder = page.length < ChatService.pageSize;
      });
    } catch (_) {
      _notice('過去のメッセージを読み込めませんでした。');
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  Future<void> _send(TalkRoom room) async {
    final text = _text.text;
    if (text.trim().isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      if (await store.chat.send(room.id, _me, text)) _text.clear();
    } catch (_) {
      _notice('送信できませんでした。メール認証の状態と通信環境を確認してください。');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _rate(TalkRoom room) async {
    var stars = 5;
    final comment = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('取引を評価する'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${room.otherName(_me)} さんとの取引はいかがでしたか？', style: const TextStyle(fontSize: 13)),
              const SizedBox(height: 8),
              Wrap(spacing: 6, children: [
                for (var s = 1; s <= 5; s++)
                  ChoiceChip(label: Text('★$s'), selected: stars == s, onSelected: (_) => setLocal(() => stars = s)),
              ]),
              TextField(
                controller: comment,
                maxLength: kRatingMaxComment,
                decoration: const InputDecoration(hintText: 'ひとこと（任意）'),
              ),
              const Text('評価は取り消せません。お互いが評価するか14日たつと公開されます。',
                  style: TextStyle(fontSize: 11, color: Color(0xFF64748B))),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('キャンセル')),
            ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('送信')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      final rated = await store.market.rateDeal(room.id, stars, comment.text);
      _notice(rated ? '評価を送信しました。' : 'この取引はすでに評価済みです。');
    } on MarketException catch (e) {
      _notice(e.notice);
    } catch (_) {
      _notice('評価を送信できませんでした。');
    }
  }

  Future<void> _report(TalkRoom room) async {
    var category = RoomReportCategory.noShow;
    final detail = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('運営に報告する'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Wrap(spacing: 6, runSpacing: 4, children: [
                  for (final c in RoomReportCategory.values)
                    ChoiceChip(
                      label: Text(c.label, style: const TextStyle(fontSize: 12)),
                      selected: c == category,
                      onSelected: (_) => setLocal(() => category = c),
                    ),
                ]),
                TextField(
                  controller: detail,
                  maxLines: 3,
                  maxLength: 500,
                  decoration: const InputDecoration(hintText: '状況（任意）'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('キャンセル')),
            ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('報告する')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      final r = await store.market.reportRoom(room.id, category, detail.text);
      _notice(r == MarketReportOutcome.duplicate ? 'すでに報告済みです。運営の対応をお待ちください。' : '運営に報告しました。確認して対応します。');
    } on MarketException catch (e) {
      _notice(e.notice);
    } catch (_) {
      _notice('報告を送信できませんでした。');
    }
  }

  Future<void> _block(TalkRoom room) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('ブロックしますか？'),
        content: Text('${room.otherName(_me)} さんとのトークを終了し、今後この相手とはやりとりできなくなります。元に戻せません。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('キャンセル')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('ブロック')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await store.market.blockRoom(room.id);
      _notice('ブロックしました。');
    } on MarketException catch (e) {
      _notice(e.notice);
    } catch (_) {
      _notice('ブロックできませんでした。');
    }
  }

  Widget _bubble(TalkRoom room, ChatMessage m) {
    final mine = m.senderId == _me;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: mine ? _brand : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: mine ? null : Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Column(
          crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            Text(room.nameOf(m.senderId),
                style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: mine ? Colors.white70 : const Color(0xFF64748B))),
            const SizedBox(height: 4),
            Text(m.text, style: TextStyle(fontSize: 14, color: mine ? Colors.white : const Color(0xFF1E293B))),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final room = _room;
    if (room == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('トーク')),
        // A room just opened by openListingChat arrives through the participant
        // stream within a moment; a room the user is not part of never does.
        body: const Center(child: Text('トークルームを読み込んでいます…', style: TextStyle(color: Color(0xFF94A3B8)))),
      );
    }
    final warnContact = containsContactInfo(_text.text);
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('『${room.bookTitle}』', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16), overflow: TextOverflow.ellipsis),
            Text('${room.otherName(_me)} さんとのトーク', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
          ],
        ),
        actions: [
          PopupMenuButton<String>(
            onSelected: (v) => switch (v) {
              'rate' => _rate(room),
              'report' => _report(room),
              _ => _block(room),
            },
            itemBuilder: (_) => [
              if (!room.isLegacy && room.bothSpoke) const PopupMenuItem(value: 'rate', child: Text('取引を評価する')),
              const PopupMenuItem(value: 'report', child: Text('受け渡し不履行・トラブルを報告')),
              if (!room.isClosed) const PopupMenuItem(value: 'block', child: Text('ブロックする')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            color: const Color(0xFFFEF2F2),
            child: Text(room.warningNotice,
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFFB91C1C))),
          ),
          if (room.isClosed)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              color: const Color(0xFFF1F5F9),
              child: const Text('このトークは終了しています（ブロック）。新しいメッセージは送れません。',
                  style: TextStyle(fontSize: 12, color: Color(0xFF475569))),
            ),
          Expanded(
            child: StreamBuilder<List<ChatMessage>>(
              stream: _latest,
              builder: (context, snap) {
                final latest = snap.data ?? const <ChatMessage>[];
                WidgetsBinding.instance.addPostFrameCallback((_) => _markReadIfNeeded(room));
                final seen = <String>{};
                final all = [..._older, ...latest].where((m) => seen.add(m.id)).toList();
                final canLoadOlder = !_noMoreOlder && latest.length >= ChatService.pageSize && all.isNotEmpty;
                return ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (canLoadOlder)
                      Center(
                        child: TextButton(
                          onPressed: _loadingOlder ? null : () => _loadOlder(all.first.createdAt),
                          child: const Text('以前のメッセージを読み込む'),
                        ),
                      ),
                    if (all.isEmpty)
                      const Padding(
                        padding: EdgeInsets.only(top: 24),
                        child: Center(
                          child: Text('受け渡しの場所と日時を相談しましょう。', style: TextStyle(color: Color(0xFF94A3B8))),
                        ),
                      ),
                    for (final m in all) _bubble(room, m),
                  ],
                );
              },
            ),
          ),
          if (!room.isClosed)
            SafeArea(
              child: Container(
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (warnContact)
                      const Padding(
                        padding: EdgeInsets.only(bottom: 4),
                        child: Text('電話番号・メールアドレス・LINE IDなどの連絡先は、なるべく送らないでください。',
                            style: TextStyle(fontSize: 11, color: Color(0xFFB45309))),
                      ),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _text,
                            maxLength: kChatMaxMessage,
                            decoration: const InputDecoration(
                              hintText: '受け渡し場所・日時をメッセージ…',
                              counterText: '',
                              border: OutlineInputBorder(),
                              isDense: true,
                            ),
                            onSubmitted: (_) => _send(room),
                          ),
                        ),
                        IconButton(
                          tooltip: '送信',
                          icon: const Icon(Icons.send_rounded, color: _brand),
                          onPressed: _sending ? null : () => _send(room),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `flutter test ; flutter analyze ; grep -rnE "'messages': FieldValue|textbook_request|TextbookRequest|sendMessageToTalkRoom|FirestoreService\\(|firestore_service" lib/`
Expected: PASS — 142 + 17 = **159** (talk_room 6, chat_service 3, talk_room_screen 5, app_store +2, talk_room_queries +1); `flutter analyze` **21** issues (the deleted `textbook_lending_screen.dart` carried one; nothing new); the grep prints nothing.

- [ ] **Step 7: Commit (now — before the next task)**

```bash
git add lib test
git commit -m "feat: chat on talk_rooms/{id}/messages with pagination, read markers and safety menu; AppStore wires market/chat; retire the 参考書 board (Plan 3)"
```

---

### Task 13: Flutter — the 教科書 tab: market, listing form, listing detail, notices, copy

**Files:**
- Create: `lib/views/market/market_screen.dart`, `lib/views/market/listing_form_screen.dart`, `lib/views/market/listing_detail_screen.dart`, `test/views/listing_form_screen_test.dart`, `test/views/market_screen_test.dart`
- Modify: `lib/views/navigation_root_screen.dart`, `lib/models/app_notification.dart`, `lib/views/notifications/notifications_screen.dart`, `lib/views/contact/contact_screen.dart`, `lib/views/onboarding/onboarding_screen.dart`, `test/models/app_notification_test.dart`

**Interfaces:**
- Consumes: `AppStore.market`, `.chat`, `.talkRooms`, `.unreadRoomCount`, `.uploadListingPhoto`, `.getRegisteredSubjects` (T12); everything in `market_service.dart` / `textbook_listing.dart` (T11); `TalkRoomScreen` (T12); `pickFile` (`lib/utils/file_picker_helper.dart`).
- Produces: `MarketScreen({required AppStore store})` (tabs さがす / トーク / 自分の出品, FAB 出品する), `ListingFormScreen({required AppStore store})` (pops `true` after a create), `ListingDetailScreen({required AppStore store, required TextbookListing listing})`; `AppNotification.listingId` (`''` default) and the four `listing_*` messages; the bottom nav has four tabs — さがす / 時間割 / **教科書** (badge = `unreadRoomCount`) / マイページ.

- [ ] **Step 1: Write the failing widget and model tests**

Create `test/views/listing_form_screen_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/views/market/listing_form_screen.dart';

import '../support/store_harness.dart';

Future<Harness> _open(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1000, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final h = Harness()..signIn();
  h.reply = (_, _) => {'listingId': 'L1'};
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: Builder(builder: (context) => TextButton(
    onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ListingFormScreen(store: h.store))),
    child: const Text('open'),
  )))));
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return h;
}

void main() {
  testWidgets('a 売る listing sends createListing with the chosen fields and closes the form', (tester) async {
    final h = await _open(tester);
    await tester.enterText(find.widgetWithText(TextField, '例: 線形代数入門 第2版（東京大学出版会）'), '線形代数入門');
    await tester.tap(find.text('目立った傷なし'));
    await tester.enterText(find.widgetWithText(TextField, '例: 1500'), '1200');
    await tester.enterText(find.widgetWithText(TextField, '定価以下の価格をおすすめします'), '3000');
    await tester.tap(find.text('附属図書館前'));
    await tester.tap(find.text('出品する'));
    await tester.pumpAndSettle();
    expect(h.calls.single.$1, 'createListing');
    expect(h.calls.single.$2, {
      'type': 'sell', 'title': '線形代数入門', 'description': '', 'courseId': '', 'condition': 'good', 'price': 1200,
      'listPrice': 3000, 'place': 'library', 'photoPaths': <String>[],
    });
    expect(find.text('open'), findsOneWidget); // popped
  });

  testWidgets('an invalid form is not sent and says why; a price above 定価 is warned about, not blocked', (tester) async {
    final h = await _open(tester);
    await tester.tap(find.text('出品する'));
    await tester.pump();
    expect(h.calls, isEmpty);
    expect(find.text('本のタイトルを入力してください（100文字まで）'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, '例: 1500'), '5000');
    await tester.enterText(find.widgetWithText(TextField, '定価以下の価格をおすすめします'), '3000');
    await tester.pump();
    expect(find.text('定価より高い価格になっています。'), findsOneWidget);
  });

  testWidgets('譲る hides the price; contact info in the text is warned about', (tester) async {
    await _open(tester);
    await tester.tap(find.text('譲ります'));
    await tester.pump();
    expect(find.widgetWithText(TextField, '例: 1500'), findsNothing);
    await tester.enterText(find.widgetWithText(TextField, '書き込みの有無、版、受け渡し可能な曜日など'), 'LINE ID: abc');
    await tester.pump();
    expect(find.textContaining('LINE IDなどは書かないでください'), findsOneWidget);
  });
}
```

Create `test/views/market_screen_test.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/views/market/market_screen.dart';

import '../support/store_harness.dart';

Future<void> _listing(Harness h, String id, {String type = 'sell', String title = '線形代数入門', String owner = 'u9', int days = 10, String status = 'active'}) =>
    h.db.collection('textbook_listings').doc(id).set({
      'id': id, 'type': type, 'title': title, 'ownerId': owner, 'ownerName': '出品者', 'status': status, 'condition': 'good',
      'price': type == 'give' ? null : 1000, 'place': 'clock_tower', 'courseId': '', 'courseName': '',
      'createdAt': Timestamp.fromDate(DateTime.now().subtract(const Duration(days: 1))),
      'expiresAt': Timestamp.fromDate(DateTime.now().add(Duration(days: days))),
    });

Future<Harness> _open(WidgetTester tester, Future<void> Function(Harness) seed) async {
  tester.view.physicalSize = const Size(1000, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final h = Harness()..signIn();
  await seed(h);
  await tester.pumpWidget(MaterialApp(home: MarketScreen(store: h.store)));
  await tester.pumpAndSettle();
  return h;
}

void main() {
  testWidgets('さがす lists live listings only, filtered by type chip and free words', (tester) async {
    await _open(tester, (h) async {
      await _listing(h, 'a', title: '線形代数入門');
      await _listing(h, 'b', type: 'give', title: 'Campbell Biology');
      await _listing(h, 'c', type: 'want', title: '微分積分学');
      await _listing(h, 'gone', title: '期限切れの本', days: -1);
      await _listing(h, 'hid', title: '非表示の本', status: 'hidden');
    });
    expect(find.text('『線形代数入門』'), findsOneWidget);
    expect(find.text('『Campbell Biology』'), findsOneWidget);
    expect(find.text('『期限切れの本』'), findsNothing);
    expect(find.text('『非表示の本』'), findsNothing);
    await tester.tap(find.text('買いたい'));
    await tester.pumpAndSettle();
    expect(find.text('『微分積分学』'), findsOneWidget);
    expect(find.text('『線形代数入門』'), findsNothing);
    await tester.tap(find.text('すべて'));
    await tester.enterText(find.byType(TextField), 'campbell');
    await tester.pumpAndSettle();
    expect(find.text('『Campbell Biology』'), findsOneWidget);
    expect(find.text('『線形代数入門』'), findsNothing);
  });

  testWidgets('a listing opens its detail; asking calls openListingChat', (tester) async {
    final h = await _open(tester, (h) => _listing(h, 'a'));
    h.reply = (_, _) => {'roomId': 'l_a_u1'};
    await tester.tap(find.text('『線形代数入門』'));
    await tester.pumpAndSettle();
    expect(find.textContaining('アプリはお金を扱いません'), findsOneWidget);
    expect(find.text('評価はまだありません'), findsOneWidget);
    await tester.tap(find.text('チャットで相談する'));
    await tester.pumpAndSettle();
    expect(h.calls.last.$1, 'openListingChat');
    expect(h.calls.last.$2, {'listingId': 'a'});
  });

  testWidgets('my own listing has no chat or report button', (tester) async {
    await _open(tester, (h) => _listing(h, 'mine', owner: 'u1', title: '自分の本'));
    await tester.tap(find.text('『自分の本』'));
    await tester.pumpAndSettle();
    expect(find.text('チャットで相談する'), findsNothing);
    expect(find.byTooltip('通報'), findsNothing);
  });

  testWidgets('自分の出品 asks 「まだ有効?」 in the last 7 days and renews through updateListing', (tester) async {
    final h = await _open(tester, (h) async {
      await _listing(h, 'soon', owner: 'u1', title: 'もうすぐ期限', days: 3);
      await _listing(h, 'fresh', owner: 'u1', title: 'まだ先', days: 20);
    });
    await tester.tap(find.text('自分の出品'));
    await tester.pumpAndSettle();
    expect(find.textContaining('『もうすぐ期限』はまだ有効ですか？'), findsOneWidget);
    expect(find.textContaining('『まだ先』はまだ有効ですか？'), findsNothing);
    await tester.tap(find.text('延長する'));
    await tester.pumpAndSettle();
    expect(h.calls.last.$1, 'updateListing');
    expect(h.calls.last.$2, {'listingId': 'soon', 'action': 'renew'});
  });
}
```

In `test/models/app_notification_test.dart` replace

```dart
    expect(n.message, contains('あなたの投稿'));
  });
```

with

```dart
    expect(n.message, contains('あなたの投稿'));
  });

  test('Plan 3: market notices have their own copy and carry the listing id', () {
    AppNotification n(String t) => AppNotification.fromMap('x', {'type': t, 'postTitle': '線形代数入門', 'listingId': 'L1'});
    expect(n('listing_match').message, contains('「線形代数入門」が出品されました'));
    expect(n('listing_hidden').message, contains('非表示'));
    expect(n('listing_restored').message, contains('再び表示'));
    expect(n('listing_removed').message, contains('削除'));
    expect(n('listing_match').listingId, 'L1');
    expect(AppNotification.fromMap('x', {'listingId': 7}).listingId, '');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `flutter test test/views/listing_form_screen_test.dart test/views/market_screen_test.dart test/models/app_notification_test.dart`
Expected: FAIL — the market screens do not exist; `AppNotification` has no `listingId`.

- [ ] **Step 3: Create the three market screens**

Create `lib/views/market/listing_form_screen.dart`:

```dart
import 'package:flutter/material.dart';

import '../../models/subject.dart';
import '../../models/textbook_listing.dart';
import '../../services/app_store.dart';
import '../../services/market_service.dart';
import '../../utils/file_picker_helper.dart';

const _brand = Color(0xFF0F4C81);

/// 出品する (Plan 3, spec §4.4): 譲る / 売る / 買いたい, free-text title,
/// optional course, condition, price (売る; 定価 is the recommended cap), up to
/// 3 photos, handoff-place preset. The server validates everything again and
/// owns the document; the form only collects and pre-checks.
class ListingFormScreen extends StatefulWidget {
  const ListingFormScreen({super.key, required this.store});

  final AppStore store;

  @override
  State<ListingFormScreen> createState() => _ListingFormScreenState();
}

class _ListingFormScreenState extends State<ListingFormScreen> {
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _price = TextEditingController();
  final _listPrice = TextEditingController();
  ListingType _type = ListingType.sell;
  BookCondition? _condition;
  String _place = 'clock_tower';
  String _courseId = '';
  List<Subject> _courses = const [];
  final List<String> _photos = [];
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    widget.store.getRegisteredSubjects().then((c) {
      if (mounted) setState(() => _courses = c);
    }).catchError((_) {});
    for (final c in [_title, _description, _price, _listPrice]) {
      c.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    for (final c in [_title, _description, _price, _listPrice]) {
      c.dispose();
    }
    super.dispose();
  }

  int? _int(TextEditingController c) => int.tryParse(c.text.trim());

  ListingDraft get _draft => ListingDraft(
        type: _type,
        title: _title.text,
        description: _description.text,
        courseId: _courseId,
        condition: _type == ListingType.want ? null : _condition,
        price: _type == ListingType.give ? null : _int(_price),
        listPrice: _int(_listPrice),
        place: _place,
        photoPaths: List.of(_photos),
      );

  Future<void> _addPhoto() async {
    final picked = await pickFile();
    if (picked == null) return;
    setState(() => _busy = true);
    final path = await widget.store.uploadListingPhoto(picked.name, picked.bytes);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (path != null) _photos.add(path);
      _error = path == null ? widget.store.lastNoticeMessage : null;
    });
  }

  Future<void> _submit() async {
    final draft = _draft;
    final invalid = validateListingDraft(draft);
    if (invalid != null) {
      setState(() => _error = invalid);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.store.market.createListing(draft);
      if (!mounted) return;
      Navigator.pop(context, true);
    } on MarketException catch (e) {
      if (mounted) setState(() => _error = e.notice);
    } catch (_) {
      if (mounted) setState(() => _error = '出品できませんでした。通信環境を確認してください。');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _label(String t) => Padding(
        padding: const EdgeInsets.only(top: 16, bottom: 6),
        child: Text(t, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF334155))),
      );

  Widget _chips<T>(Iterable<T> values, T selected, String Function(T) label, void Function(T) onSelect) => Wrap(
        spacing: 6,
        runSpacing: 4,
        children: [
          for (final v in values)
            ChoiceChip(
              label: Text(label(v), style: const TextStyle(fontSize: 12)),
              selected: v == selected,
              onSelected: (_) => setState(() => onSelect(v)),
            ),
        ],
      );

  @override
  Widget build(BuildContext context) {
    final d = _draft;
    final contact = containsContactInfo('${_title.text} ${_description.text}');
    final overList = d.type == ListingType.sell && d.price != null && d.listPrice != null && d.price! > d.listPrice!;
    return Scaffold(
      appBar: AppBar(title: const Text('教科書を出品する')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: const Color(0xFFFFFBEB), borderRadius: BorderRadius.circular(10)),
              child: const Text(
                '出品できるのは教科書・参考書だけです。アプリはお金を扱いません（決済・手数料なし）。代金は受け渡しのときに当事者どうしで直接やりとりしてください。',
                style: TextStyle(fontSize: 12, color: Color(0xFF92400E)),
              ),
            ),
            _label('出品の種類'),
            _chips(ListingType.values, _type, (t) => t.label, (t) => _type = t),
            _label('本のタイトル'),
            TextField(
              controller: _title,
              maxLength: kListingMaxTitle,
              decoration: const InputDecoration(hintText: '例: 線形代数入門 第2版（東京大学出版会）', border: OutlineInputBorder()),
            ),
            _label('関連する科目（任意・時間割から）'),
            _chips<String>(['', ..._courses.map((c) => c.id)], _courseId,
                (id) => id.isEmpty ? '指定しない' : _courses.firstWhere((c) => c.id == id).name, (id) => _courseId = id),
            if (_type != ListingType.want) ...[
              _label('本の状態'),
              _chips<BookCondition?>(BookCondition.values, _condition, (c) => c!.label, (c) => _condition = c),
            ],
            if (_type != ListingType.give) ...[
              _label(_type == ListingType.sell ? '価格（円）' : '予算（円・任意）'),
              TextField(
                controller: _price,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '例: 1500'),
              ),
            ],
            if (_type == ListingType.sell) ...[
              _label('定価（円・任意）'),
              TextField(
                controller: _listPrice,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '定価以下の価格をおすすめします'),
              ),
              if (overList)
                const Padding(
                  padding: EdgeInsets.only(top: 4),
                  child: Text('定価より高い価格になっています。', style: TextStyle(fontSize: 12, color: Color(0xFFB45309))),
                ),
            ],
            _label('受け渡し場所'),
            _chips(kHandoffPlaces.keys, _place, (k) => kHandoffPlaces[k]!, (k) => _place = k),
            _label('説明（任意）'),
            TextField(
              controller: _description,
              maxLines: 4,
              maxLength: kListingMaxDescription,
              decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '書き込みの有無、版、受け渡し可能な曜日など'),
            ),
            if (contact)
              const Text('電話番号・メールアドレス・LINE IDなどは書かないでください（チャットで相談できます）。',
                  style: TextStyle(fontSize: 12, color: Color(0xFFB45309))),
            _label('写真（任意・3枚まで・各2MBまで）'),
            Row(
              children: [
                Text('${_photos.length}/$kListingMaxPhotos 枚', style: const TextStyle(fontSize: 12)),
                const SizedBox(width: 12),
                OutlinedButton.icon(
                  onPressed: _busy || _photos.length >= kListingMaxPhotos ? null : _addPhoto,
                  icon: const Icon(Icons.add_a_photo_outlined, size: 18),
                  label: const Text('写真を追加'),
                ),
              ],
            ),
            const Text('写真は京大生なら誰でも見られます。顔・学生証・住所が写らないようにしてください。',
                style: TextStyle(fontSize: 11, color: Color(0xFF64748B))),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13)),
            ],
            const SizedBox(height: 20),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: _busy ? null : _submit,
                style: ElevatedButton.styleFrom(backgroundColor: _brand, foregroundColor: Colors.white),
                child: const Text('出品する', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
```

Create `lib/views/market/listing_detail_screen.dart`:

```dart
import 'package:firebase_storage/firebase_storage.dart' as fb_storage;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../models/textbook_listing.dart';
import '../../services/app_store.dart';
import '../../services/market_service.dart';
import '../textbook/talk_room_screen.dart';

const _brand = Color(0xFF0F4C81);

/// One listing (Plan 3): photos, the owner's rating summary (T-10), the
/// no-money notice, and the actions — chat (openListingChat), report (T-19),
/// share as text (T-22).
class ListingDetailScreen extends StatelessWidget {
  const ListingDetailScreen({super.key, required this.store, required this.listing});

  final AppStore store;
  final TextbookListing listing;

  void _notice(BuildContext context, String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _chat(BuildContext context) async {
    try {
      final roomId = await store.market.openChat(listing.id);
      if (!context.mounted || roomId.isEmpty) return;
      Navigator.push(context, MaterialPageRoute(builder: (_) => TalkRoomScreen(store: store, roomId: roomId)));
    } on MarketException catch (e) {
      if (context.mounted) _notice(context, e.notice);
    } catch (_) {
      if (context.mounted) _notice(context, 'チャットを開けませんでした。メール認証の状態と通信環境を確認してください。');
    }
  }

  Future<void> _report(BuildContext context) async {
    var category = ListingReportCategory.notTextbook;
    final detail = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('この出品を通報'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Text('3人以上から通報された出品は非表示になり、運営が確認します。', style: TextStyle(fontSize: 12)),
              const SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 4, children: [
                for (final c in ListingReportCategory.values)
                  ChoiceChip(
                    label: Text(c.label, style: const TextStyle(fontSize: 12)),
                    selected: c == category,
                    onSelected: (_) => setLocal(() => category = c),
                  ),
              ]),
              TextField(controller: detail, maxLength: 500, decoration: const InputDecoration(hintText: '理由（任意）')),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('キャンセル')),
            ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('通報する')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      final r = await store.market.reportListing(listing.id, category, detail.text);
      if (!context.mounted) return;
      _notice(context, switch (r) {
        MarketReportOutcome.duplicate => 'この出品はすでに通報済みです。',
        MarketReportOutcome.hidden || MarketReportOutcome.alreadyHidden => 'この出品は非表示になりました。運営が確認します。',
        _ => '通報を受け付けました。',
      });
    } on MarketException catch (e) {
      if (context.mounted) _notice(context, e.notice);
    } catch (_) {
      if (context.mounted) _notice(context, '通報を送信できませんでした。');
    }
  }

  @override
  Widget build(BuildContext context) {
    final mine = listing.ownerId == store.currentUser?.uid;
    final l = listing;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.type.label),
        actions: [
          IconButton(
            tooltip: 'シェア（テキストをコピー）',
            icon: const Icon(Icons.ios_share_rounded),
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: listingShareText(l)));
              if (context.mounted) _notice(context, '紹介文をコピーしました。');
            },
          ),
          if (!mine)
            IconButton(tooltip: '通報', icon: const Icon(Icons.flag_outlined), onPressed: () => _report(context)),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (l.photoPaths.isNotEmpty)
            SizedBox(
              height: 180,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [for (final p in l.photoPaths) _ListingPhoto(path: p)],
              ),
            ),
          const SizedBox(height: 12),
          Text('『${l.title}』', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
          const SizedBox(height: 6),
          Text(l.priceLabel, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: _brand)),
          if (l.listPrice != null) Text('定価 ¥${l.listPrice}', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
          if (l.priceAboveList)
            const Text('※ 定価より高い価格です', style: TextStyle(fontSize: 12, color: Color(0xFFB45309))),
          const SizedBox(height: 12),
          if (l.courseName.isNotEmpty) Text('科目: ${l.courseName}'),
          if (l.condition != null) Text('状態: ${l.condition!.label}'),
          Text('受け渡し: ${l.placeLabel}'),
          if (l.description.isNotEmpty) ...[const SizedBox(height: 12), Text(l.description)],
          const SizedBox(height: 16),
          StreamBuilder<MarketProfile>(
            stream: store.market.streamProfile(l.ownerId),
            builder: (context, snap) {
              final p = snap.data ?? const MarketProfile();
              return Card(
                elevation: 0,
                child: ListTile(
                  leading: const Icon(Icons.verified_user_outlined, color: _brand),
                  title: Text('${l.ownerName}（認証済み京大生）'),
                  subtitle: Text(p.summary),
                ),
              );
            },
          ),
          const SizedBox(height: 12),
          const Text(
            'アプリはお金を扱いません。代金は受け渡しのときに直接やりとりしてください。人目のある場所・明るい時間の受け渡しをおすすめします。',
            style: TextStyle(fontSize: 12, color: Color(0xFF92400E)),
          ),
          const SizedBox(height: 20),
          if (!mine)
            SizedBox(
              height: 48,
              child: ElevatedButton.icon(
                onPressed: () => _chat(context),
                icon: const Icon(Icons.chat_bubble_outline_rounded),
                label: Text(l.type == ListingType.want ? '持っているので連絡する' : 'チャットで相談する'),
                style: ElevatedButton.styleFrom(backgroundColor: _brand, foregroundColor: Colors.white),
              ),
            ),
        ],
      ),
    );
  }
}

/// A listing photo: the download URL is asked for at display time (storage.rules
/// let any KU address read `listings/…`, T-5) and shown with an <img> element on
/// the web, so the bucket needs no CORS configuration.
class _ListingPhoto extends StatelessWidget {
  const _ListingPhoto({required this.path});

  final String path;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: FutureBuilder<String>(
          future: fb_storage.FirebaseStorage.instance.ref(path).getDownloadURL(),
          builder: (context, snap) => SizedBox(
            width: 180,
            child: snap.hasData
                ? Image.network(snap.data!, fit: BoxFit.cover, webHtmlElementStrategy: WebHtmlElementStrategy.prefer)
                : const ColoredBox(color: Color(0xFFE2E8F0), child: Icon(Icons.image_outlined, color: Color(0xFF94A3B8))),
          ),
        ),
      );
}
```

Create `lib/views/market/market_screen.dart`:

```dart
import 'package:flutter/material.dart';

import '../../models/subject.dart';
import '../../models/textbook_listing.dart';
import '../../services/app_store.dart';
import '../../services/market_service.dart';
import '../textbook/talk_room_screen.dart';
import 'listing_detail_screen.dart';
import 'listing_form_screen.dart';

const _brand = Color(0xFF0F4C81);

/// 教科書 tab (Plan 3, spec §4.1/§4.4): さがす (live listings, course filter,
/// free words, type chips), トーク (my rooms, unread first-class), 自分の出品
/// (renew / close, the 「まだ有効?」 prompt — T-8).
class MarketScreen extends StatefulWidget {
  const MarketScreen({super.key, required this.store});

  final AppStore store;

  @override
  State<MarketScreen> createState() => _MarketScreenState();
}

class _MarketScreenState extends State<MarketScreen> {
  final _query = TextEditingController();
  ListingType? _type;
  String _courseId = '';
  List<Subject> _courses = const [];
  late Stream<List<TextbookListing>> _listings = widget.store.market.streamListings();
  late final Stream<List<TextbookListing>> _mine = widget.store.market.streamMyListings(widget.store.currentUser?.uid ?? '');

  AppStore get store => widget.store;

  @override
  void initState() {
    super.initState();
    store.addListener(_onStore);
    _query.addListener(_onStore);
    store.getRegisteredSubjects().then((c) {
      if (mounted) setState(() => _courses = c);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    store.removeListener(_onStore);
    _query.dispose();
    super.dispose();
  }

  void _onStore() {
    if (mounted) setState(() {});
  }

  void _setCourse(String id) => setState(() {
        _courseId = id;
        _listings = store.market.streamListings(courseId: id);
      });

  void _notice(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _newListing() async {
    final created = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => ListingFormScreen(store: store)));
    if (created == true && mounted) _notice('出品しました。30日間掲載されます。');
  }

  Future<void> _act(Future<void> Function() call, String done) async {
    try {
      await call();
      if (mounted) _notice(done);
    } on MarketException catch (e) {
      if (mounted) _notice(e.notice);
    } catch (_) {
      if (mounted) _notice('処理に失敗しました。');
    }
  }

  Widget _card(TextbookListing l, {Widget? trailing, String? status}) => Card(
        margin: const EdgeInsets.only(bottom: 10),
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        child: ListTile(
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ListingDetailScreen(store: store, listing: l))),
          leading: CircleAvatar(
            backgroundColor: const Color(0xFFEFF6FF),
            child: Text(l.type.label.substring(0, 1), style: const TextStyle(color: _brand, fontWeight: FontWeight.bold)),
          ),
          title: Text('『${l.title}』', style: const TextStyle(fontWeight: FontWeight.bold)),
          subtitle: Text([
            l.type.label,
            l.priceLabel,
            if (l.courseName.isNotEmpty) l.courseName,
            l.placeLabel,
            ?status,
          ].join(' ・ ')),
          trailing: trailing,
        ),
      );

  Widget _searchTab() => StreamBuilder<List<TextbookListing>>(
        stream: _listings,
        builder: (context, snap) {
          final shown = filterListings(snap.data ?? const [], type: _type, query: _query.text);
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text(
                '京大生どうしで教科書を譲る・売る・探す掲示板です。アプリはお金を扱いません（代金は受け渡し時に直接）。教科書・参考書以外の出品は禁止です。',
                style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _query,
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search_rounded),
                  hintText: '本のタイトル・科目名でさがす',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 4, children: [
                ChoiceChip(label: const Text('すべて'), selected: _type == null, onSelected: (_) => setState(() => _type = null)),
                for (final t in ListingType.values)
                  ChoiceChip(label: Text(t.label), selected: _type == t, onSelected: (_) => setState(() => _type = t)),
              ]),
              if (_courses.isNotEmpty) ...[
                const SizedBox(height: 6),
                Wrap(spacing: 6, runSpacing: 4, children: [
                  ChoiceChip(label: const Text('全科目'), selected: _courseId.isEmpty, onSelected: (_) => _setCourse('')),
                  for (final c in _courses)
                    ChoiceChip(label: Text(c.name), selected: _courseId == c.id, onSelected: (_) => _setCourse(c.id)),
                ]),
              ],
              const SizedBox(height: 12),
              if (snap.connectionState == ConnectionState.waiting && !snap.hasData)
                const Center(child: CircularProgressIndicator())
              else if (shown.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: Text('該当する出品はありません', style: TextStyle(color: Color(0xFF94A3B8)))),
                )
              else
                for (final l in shown) _card(l),
            ],
          );
        },
      );

  Widget _roomsTab() {
    final me = store.currentUser?.uid ?? '';
    final rooms = store.talkRooms;
    if (rooms.isEmpty) {
      return const Center(child: Text('まだトークはありません', style: TextStyle(color: Color(0xFF94A3B8))));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        for (final r in rooms)
          Card(
            elevation: 0,
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: Badge(
                isLabelVisible: r.isUnreadFor(me),
                child: const Icon(Icons.chat_bubble_outline_rounded, color: _brand),
              ),
              title: Text('『${r.bookTitle}』 ${r.otherName(me)} さん', style: const TextStyle(fontWeight: FontWeight.bold)),
              subtitle: Text(r.isClosed ? '終了したトーク' : (r.lastMessageText.isEmpty ? 'メッセージはまだありません' : r.lastMessageText),
                  maxLines: 1, overflow: TextOverflow.ellipsis),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => TalkRoomScreen(store: store, roomId: r.id))),
            ),
          ),
      ],
    );
  }

  Widget _mineTab() {
    return StreamBuilder<List<TextbookListing>>(
      stream: _mine,
      builder: (context, snap) {
        final mine = snap.data ?? const <TextbookListing>[];
        final now = DateTime.now();
        if (mine.isEmpty) {
          return const Center(child: Text('出品はまだありません', style: TextStyle(color: Color(0xFF94A3B8))));
        }
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            for (final l in mine)
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (l.canRenew(now))
                    Container(
                      padding: const EdgeInsets.all(10),
                      color: const Color(0xFFFFFBEB),
                      child: Row(children: [
                        Expanded(
                          child: Text(
                            l.isLive(now) ? '『${l.title}』はまだ有効ですか？ まもなく掲載が終わります。' : '『${l.title}』の掲載期限が切れました。',
                            style: const TextStyle(fontSize: 12, color: Color(0xFF92400E)),
                          ),
                        ),
                        TextButton(
                          onPressed: () => _act(() => store.market.renewListing(l.id), '掲載を30日延長しました。'),
                          child: const Text('延長する'),
                        ),
                      ]),
                    ),
                  _card(
                    l,
                    status: switch (l.status) {
                      'active' => l.isLive(now) ? '掲載中' : '期限切れ',
                      'hidden' => '非表示（運営確認中）',
                      _ => '取り下げ済み',
                    },
                    trailing: l.status == 'active'
                        ? TextButton(
                            onPressed: () => _act(() => store.market.closeListing(l.id), '出品を取り下げました。'),
                            child: const Text('取り下げ'),
                          )
                        : null,
                  ),
                ],
              ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final unread = store.unreadRoomCount;
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('教科書'),
          bottom: TabBar(
            labelColor: _brand,
            tabs: [
              const Tab(text: 'さがす'),
              Tab(child: Badge(isLabelVisible: unread > 0, label: Text('$unread'), child: const Text('トーク'))),
              const Tab(text: '自分の出品'),
            ],
          ),
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _newListing,
          backgroundColor: _brand,
          foregroundColor: Colors.white,
          icon: const Icon(Icons.add_rounded),
          label: const Text('出品する'),
        ),
        body: TabBarView(children: [_searchTab(), _roomsTab(), _mineTab()]),
      ),
    );
  }
}
```

- [ ] **Step 4: The 教科書 tab, market notices, copy**

In `lib/views/navigation_root_screen.dart` replace

```dart
import 'mypage/my_page_screen.dart';
```

with

```dart
import 'mypage/my_page_screen.dart';
import 'market/market_screen.dart';
```

In `lib/views/navigation_root_screen.dart` replace

```dart
      HomeScreen(store: widget.store),
      MyPageScreen(store: widget.store),
```

with

```dart
      HomeScreen(store: widget.store),
      MarketScreen(store: widget.store), // Plan 3: the textbook market is its own tab (spec §4.1)
      MyPageScreen(store: widget.store),
```

In `lib/views/navigation_root_screen.dart` replace

```dart
          items: const [
            BottomNavigationBarItem(
              icon: Icon(Icons.search_outlined),
              activeIcon: Icon(Icons.search_rounded),
              label: 'さがす',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.calendar_today_outlined),
              activeIcon: Icon(Icons.calendar_today_rounded),
              label: '時間割',
            ),
            BottomNavigationBarItem(
```

with

```dart
          items: [
            const BottomNavigationBarItem(
              icon: Icon(Icons.search_outlined),
              activeIcon: Icon(Icons.search_rounded),
              label: 'さがす',
            ),
            const BottomNavigationBarItem(
              icon: Icon(Icons.calendar_today_outlined),
              activeIcon: Icon(Icons.calendar_today_rounded),
              label: '時間割',
            ),
            BottomNavigationBarItem(
              icon: Badge(
                isLabelVisible: widget.store.unreadRoomCount > 0,
                label: Text('${widget.store.unreadRoomCount}'),
                child: const Icon(Icons.menu_book_outlined),
              ),
              activeIcon: const Icon(Icons.menu_book_rounded),
              label: '教科書',
            ),
            const BottomNavigationBarItem(
```

In `lib/models/app_notification.dart` replace

```dart
    required this.createdAt,
  });
```

with

```dart
    required this.createdAt,
    this.listingId = '',
  });
```

In `lib/models/app_notification.dart` replace

```dart
  final String type; // post_hidden | post_restored | post_removed
  final String postId;
  final String postTitle;
  final bool read;
  final DateTime createdAt;
```

with

```dart
  final String type; // post_* (2B) | listing_match / listing_hidden / listing_restored / listing_removed (Plan 3)
  final String postId;
  final String postTitle; // the title of the post OR listing the notice is about
  final bool read;
  final DateTime createdAt;
  final String listingId; // Plan 3: set on listing_* notices
```

In `lib/models/app_notification.dart` replace

```dart
      'post_removed' => '$tは、運営の確認の結果、削除されました。獲得済みのクレジットはそのままです。',
```

with

```dart
      'post_removed' => '$tは、運営の確認の結果、削除されました。獲得済みのクレジットはそのままです。',
      'listing_match' => '「買いたい」に合いそうな教科書$tが出品されました。教科書タブで確認してください。',
      'listing_hidden' => 'あなたの出品$tは、通報により非表示になりました。運営が内容を確認します。',
      'listing_restored' => 'あなたの出品$tは、運営の確認の結果、再び表示されるようになりました。',
      'listing_removed' => 'あなたの出品$tは、運営の確認の結果、削除されました。',
```

In `lib/models/app_notification.dart` replace

```dart
        createdAt: _time(map['createdAt']),
      );
```

with

```dart
        createdAt: _time(map['createdAt']),
        listingId: _str(map['listingId']),
      );
```

In `lib/views/notifications/notifications_screen.dart` replace

```dart
/// お知らせ (Plan 2B, M-10): the moderation notices the Functions write for the
/// signed-in user. Opening the screen marks them read.
```

with

```dart
/// お知らせ (Plan 2B, M-10): the moderation notices the Functions write for the
/// signed-in user, and (Plan 3) the market notices — a match for a 買いたい, a
/// listing hidden / restored / removed. Opening the screen marks them read.
```

In `lib/views/notifications/notifications_screen.dart` replace

```dart
import '../../services/app_store.dart';
```

with

```dart
import '../../services/app_store.dart';
import '../market/listing_detail_screen.dart';
```

In `lib/views/notifications/notifications_screen.dart` replace

```dart
        'post_removed' => Icons.delete_outline_rounded,
        _ => Icons.notifications_none_rounded,
      };
```

with

```dart
        'post_removed' => Icons.delete_outline_rounded,
        'listing_match' => Icons.menu_book_rounded,
        'listing_hidden' => Icons.visibility_off_outlined,
        'listing_restored' => Icons.visibility_outlined,
        'listing_removed' => Icons.delete_outline_rounded,
        _ => Icons.notifications_none_rounded,
      };

  /// Plan 3: a match notice opens the listing it is about (if it is still there).
  Future<void> _open(AppNotification n) async {
    if (n.type != 'listing_match' || n.listingId.isEmpty) return;
    final listing = await widget.store.market.getListing(n.listingId).catchError((_) => null);
    if (!mounted) return;
    if (listing == null || !listing.isLive(DateTime.now())) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('この出品はもう掲載されていません。')));
      return;
    }
    Navigator.push(context, MaterialPageRoute(builder: (_) => ListingDetailScreen(store: widget.store, listing: listing)));
  }
```

In `lib/views/notifications/notifications_screen.dart` replace

```dart
                  child: ListTile(
                    leading: Icon(_icon(n), color: const Color(0xFF0F4C81)),
```

with

```dart
                  child: ListTile(
                    onTap: () => _open(n),
                    leading: Icon(_icon(n), color: const Color(0xFF0F4C81)),
```

In `lib/views/contact/contact_screen.dart` replace

```dart
参考書取引が不成立だった状況を具体的にご入力ください。
```

with

```dart
教科書の受け渡しトラブルの状況を具体的にご入力ください（トーク画面の「報告」からも運営に伝えられます）。
```

In `lib/views/onboarding/onboarding_screen.dart` replace

```dart
過去問・テスト対策資料の共有や参考書の貸し借りがスムーズに行えます。
```

with

```dart
授業レビュー・過去問の共有や教科書の譲り合いができます。
```

In `lib/views/onboarding/onboarding_screen.dart` replace

```dart
      'title': '参考書の貸し借りもサポート',
      'subtitle': '不要になった参考書や探している本をリクエスト掲示板でマッチング！安全な個別トークルームが開設されます。',
```

with

```dart
      'title': '教科書を譲る・売る・探す',
      'subtitle': '「教科書」タブで、使わなくなった教科書を譲ったり売ったり、欲しい本を「買いたい」で探せます。アプリはお金を扱いません（代金は受け渡し時に直接）。',
```

- [ ] **Step 5: Run to verify it passes**

Run: `flutter test ; flutter analyze ; flutter build web --debug ; grep -rn "参考書の貸し借り\|20pt" lib/`
Expected: PASS — 159 + 8 = **167** (form 3, market 4, notification 1); **21** issues; the web build is clean; the grep prints nothing.

- [ ] **Step 6: Manual check**

Manual (`flutter run -d chrome --web-port 5000` against the emulators or a test project — never production): four bottom tabs; 教科書 → 出品する opens the form with the no-money notice; a 売る listing above 定価 shows the warning; さがす filters by type chip and by free words.

- [ ] **Step 7: Commit (now — before the next task)**

```bash
git add lib test
git commit -m "feat: 教科書 tab — listings, search, form, detail, share text, 自分の出品 with renew prompt, market notices (Plan 3)"
```

---

### Task 14: `tools/migrate_chats.mjs` — legacy message arrays → subcollection (user-run)

**Files:**
- Create: `tools/migrate_chats.mjs`, `tools/test_migrate_chats_fixture.mjs`, `tools/test_migrate_chats.sh`
- Modify: `tools/README.md`

**Interfaces:**
CLI `node migrate_chats.mjs --project <id> [--apply]`, run by the USER (Application Default Credentials; `tools/`' own `firebase-admin`, like `migrate_storage.mjs`). Exports the pure `parseArgs(argv) → {opts} | {error}`, `planRoom(roomData) → null | {messages: [{id, senderId, text, createdAtMs}], skipped, summary}`, `ms(isoString) → number | null` (offset-less = JST), `MAX_TEXT`. Output: one `WOULD MIGRATE` / `MIGRATE talk_rooms/<id>: N message(s), k skipped` line per room and `totals: rooms=… migrate=… skip=… messages=… skipped-messages=… failed=…`; exit 1 when any room failed. Test hook (emulator only): `MIGRATE_CHATS_TEST_FAIL=<roomId>` fails that room's final batch.

- [ ] **Step 1: Write the failing fixture test and script**

Create `tools/test_migrate_chats_fixture.mjs`:

```js
// Pure asserts + emulator fixture for migrate_chats.mjs (Plan 3, Task 14).
//
//   node test_migrate_chats_fixture.mjs                         # pure asserts
//   node test_migrate_chats_fixture.mjs seed|unchanged|migrated|partial
//   node test_migrate_chats_fixture.mjs run <exit> <stdout-substring> [tool args]
//
// The emulator modes refuse to run unless FIRESTORE_EMULATOR_HOST is set.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseArgs, planRoom, ms } from './migrate_chats.mjs';

const mode = process.argv[2];

if (!mode) {
  assert.deepEqual(parseArgs(['--project', 'p']), { opts: { apply: false, project: 'p' } });
  assert.equal(parseArgs(['--project', 'p', '--apply']).opts.apply, true);
  for (const bad of [[], ['--apply'], ['--project'], ['--project', '--apply'], ['--project', 'p', '--apply', '--dry-run'], ['--project', 'p', '--x']]) {
    assert.ok(parseArgs(bad).error, JSON.stringify(bad));
  }
  assert.equal(planRoom({ lenderId: 'a', borrowerId: 'b' }), null); // already migrated / new room
  const plan = planRoom({
    lenderId: 'a', borrowerId: 'b', createdAt: '2026-09-01T09:00:00.000',
    messages: [
      { id: 'msg_1', senderId: 'a', senderName: 'A', text: '貸せます', createdAt: '2026-09-01T10:00:00.000' },
      { senderId: '', text: 'no sender' },
      { senderId: 'b', text: '   ' },
      { senderId: 'x/y', text: 'path sender' },
      { senderId: 'b', text: 'お願いします\u0000', createdAt: 'garbage' },
      { senderId: 'b', text: 'x'.repeat(1200), createdAt: '2026-09-01T09:30:00.000' }, // goes back in time
    ],
  });
  assert.deepEqual(plan.messages.map((m) => [m.id, m.senderId, m.text.length]), [['legacy_0000', 'a', 4], ['legacy_0004', 'b', 6], ['legacy_0005', 'b', 1000]]);
  assert.equal(plan.skipped, 3);
  const t0 = ms('2026-09-01T10:00:00.000');
  assert.equal(t0, Date.UTC(2026, 8, 1, 1)); // no offset = JST
  assert.deepEqual(plan.messages.map((m) => m.createdAtMs), [t0, t0 + 1, t0 + 2]); // order kept, never backwards
  assert.deepEqual(plan.summary, {
    lenderSent: true, borrowerSent: true, lastMessageText: 'x'.repeat(80), lastSenderId: 'b', lastMessageAtMs: t0 + 2,
  });
  const quiet = planRoom({ lenderId: 'a', borrowerId: 'b', messages: [] });
  assert.deepEqual(quiet.summary, { lenderSent: false, borrowerSent: false, lastMessageText: '', lastSenderId: '', lastMessageAtMs: null });
  console.log('migrate_chats pure: OK');
  process.exit(0);
}

if (mode === 'run') {
  const [exit, want, ...args] = process.argv.slice(3);
  const r = spawnSync(process.execPath, ['migrate_chats.mjs', ...args], { encoding: 'utf8', env: process.env });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (String(r.status) !== exit) { console.error(`FAILED: tool exited ${r.status}, expected ${exit}`); process.exit(1); }
  if (!r.stdout.includes(want)) { console.error(`FAILED: output lacks "${want}"`); process.exit(1); }
  process.exit(0);
}

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('refusing to run outside the emulator'); process.exit(1); }
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ projectId: 'demo-chats' });
const db = getFirestore();
const room = async (id) => (await db.doc(`talk_rooms/${id}`).get()).data();
const msgs = async (id) => (await db.collection(`talk_rooms/${id}/messages`).orderBy('createdAt').get()).docs;

if (mode === 'seed') {
  await db.doc('talk_rooms/old1').set({
    id: 'old1', lenderId: 'a', borrowerId: 'b', bookTitle: '本', university_id: 'kyoto_u', createdAt: '2026-09-01T09:00:00.000',
    messages: [
      { id: 'msg_1', senderId: 'a', senderName: 'A', text: '貸せます', createdAt: '2026-09-01T10:00:00.000' },
      { id: 'msg_2', senderId: 'b', senderName: 'B', text: 'ありがとう', createdAt: '2026-09-01T10:05:00.000' },
    ],
  });
  await db.doc('talk_rooms/old_empty').set({ id: 'old_empty', lenderId: 'a', borrowerId: 'c', university_id: 'kyoto_u', messages: [] });
  await db.doc('talk_rooms/big').set({
    id: 'big', lenderId: 'a', borrowerId: 'd', university_id: 'kyoto_u', createdAt: '2026-09-02T09:00:00.000',
    messages: Array.from({ length: 450 }, (_, i) => ({ senderId: i % 2 ? 'a' : 'd', text: `m${i}`, createdAt: `2026-09-02T10:00:${String(i % 60).padStart(2, '0')}.000` })),
  });
  // A room of the new kind (no array) must be left exactly as it is.
  await db.doc('talk_rooms/new1').set({ id: 'new1', listingId: 'L', lenderId: 'a', borrowerId: 'e', lastMessageText: 'keep', university_id: 'kyoto_u' });
  console.log('fixture seeded');
  process.exit(0);
}

const checks = {
  unchanged: async () => {
    assert.equal((await room('old1')).messages.length, 2);
    assert.equal((await msgs('old1')).length, 0);
  },
  partial: async () => {
    // The injected failure hit the FINAL batch of `big`: some messages exist, the array is intact.
    assert.equal((await room('big')).messages.length, 450);
    assert.equal((await msgs('big')).length, 400);
    assert.equal((await room('old1')).messages, undefined); // the other rooms still migrated
  },
  migrated: async () => {
    const r = await room('old1');
    assert.equal(r.messages, undefined);
    const m = await msgs('old1');
    assert.deepEqual(m.map((d) => d.id), ['legacy_0000', 'legacy_0001']);
    assert.deepEqual(Object.keys(m[0].data()).sort(), ['createdAt', 'senderId', 'text', 'university_id']);
    assert.equal(m[0].get('createdAt').toMillis(), Date.UTC(2026, 8, 1, 1));
    assert.deepEqual([r.lastMessageText, r.lastSenderId, r.lenderSent, r.borrowerSent], ['ありがとう', 'b', true, true]);
    assert.equal(r.lastMessageAt.toMillis(), Date.UTC(2026, 8, 1, 1, 5));
    assert.equal(r.lenderReadAt.toMillis(), r.lastMessageAt.toMillis()); // history is not "unread"
    const e = await room('old_empty');
    assert.deepEqual([e.messages, e.lastMessageAt, e.lenderSent], [undefined, null, false]);
    assert.equal((await room('big')).messages, undefined);
    assert.equal((await msgs('big')).length, 450);
    assert.deepEqual(await room('new1'), { id: 'new1', listingId: 'L', lenderId: 'a', borrowerId: 'e', lastMessageText: 'keep', university_id: 'kyoto_u' });
  },
};
if (!checks[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
await checks[mode]();
console.log(`${mode}: assertions passed`);
process.exit(0);
```

Create `tools/test_migrate_chats.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Pure + emulator tests for migrate_chats.mjs (Plan 3). Firestore emulator only
# (project demo-*): never touches production.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")"
node test_migrate_chats_fixture.mjs
# No --project must refuse (exit non-zero, nothing touched).
if node migrate_chats.mjs >/dev/null 2>&1; then echo "expected usage failure"; exit 1; fi
T="node test_migrate_chats_fixture.mjs"
# 1) dry run writes nothing; 2) an injected failure in big's FINAL batch leaves its array (exit 1);
# 3) a re-run finishes it; 4) a third run has nothing left to migrate.
firebase emulators:exec --only firestore --project demo-chats "\
  $T seed \
  && $T run 0 'migrate=3' --project demo-chats \
  && $T unchanged \
  && MIGRATE_CHATS_TEST_FAIL=big $T run 1 'failed=1' --project demo-chats --apply \
  && $T partial \
  && $T run 0 'migrate=1' --project demo-chats --apply \
  && $T migrated \
  && $T run 0 'migrate=0' --project demo-chats --apply \
  && $T migrated"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_migrate_chats.sh`
Expected: FAIL — `./migrate_chats.mjs` not found.

- [ ] **Step 3: Create `tools/migrate_chats.mjs` and document it**

Create `tools/migrate_chats.mjs`:

```js
// Move legacy talk-room chats from the `messages` ARRAY on `talk_rooms/{id}`
// into the `talk_rooms/{id}/messages/{msgId}` subcollection (Plan 3, Task 14;
// spec §4.5.5).
//
// SAFE BY DESIGN (same conventions as migrate_storage.mjs)
//   * Dry-run is the DEFAULT. Nothing is written unless you pass --apply.
//   * --project is mandatory (no fallback to an ambient project).
//   * Idempotent: message ids are deterministic (`legacy_0000`, `legacy_0001`,
//     … by array position), so a re-run rewrites the same documents; rooms that
//     no longer carry an array are skipped.
//   * The array is deleted from a room ONLY in the same batch that writes its
//     last messages: if a run dies half-way, the room still has its array and a
//     re-run finishes the job. One failing room never stops the run; the exit
//     code is 1 if any room failed.
//   * Messages keep only the four fields the new rules allow (senderId, text,
//     createdAt, university_id). The sender NAME is dropped: the app shows the
//     names from the room. Entries without a sender or text are skipped.
//   * The room summary (last message, who has spoken) is written the way the
//     onTalkMessageCreated trigger writes it, and both read markers are set to
//     the last message, so migrated history does not show up as unread. The
//     trigger also fires for every migrated message; it is monotonic, so it
//     agrees with this summary.
//
// Auth: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS in YOUR
// shell, or `gcloud auth application-default login`). FIRESTORE_EMULATOR_HOST
// targets the emulator.
//
// Usage:
//   node migrate_chats.mjs --project kyodai-sns            # dry run (report only)
//   node migrate_chats.mjs --project kyodai-sns --apply    # migrate

import { pathToFileURL } from 'node:url';

const USAGE = `usage: node migrate_chats.mjs --project <id> [--apply]
  default is a DRY RUN (nothing is written). --apply moves each room's messages array into its messages subcollection.
  auth: GOOGLE_APPLICATION_CREDENTIALS (Application Default Credentials).`;

export const MAX_TEXT = 1000; // firestore.rules: messages text <= 1000
const PREVIEW = 80; // functions/src/marketCore.ts MARKET.previewLength
const CHUNK = 400; // writes per batch (Firestore allows 500)

export function parseArgs(argv) {
  const opts = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') opts.project = argv[++i];
    else if (a === '--apply') opts.apply = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else return { error: `unknown argument: ${a}` };
  }
  if (!opts.project || opts.project.startsWith('--')) return { error: 'missing --project' };
  if (opts.apply && opts.dryRun) return { error: '--apply and --dry-run are mutually exclusive' };
  delete opts.dryRun;
  return { opts };
}

const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
// Legacy times are Dart `DateTime.now().toIso8601String()` from browsers in
// Japan: local time WITHOUT an offset. Read them as JST (+09:00) wherever this
// tool runs; an explicit Z / offset is respected.
export const ms = (v) => {
  if (typeof v !== 'string' || v === '') return null;
  const t = Date.parse(/([zZ]|[+-]\d\d:?\d\d)$/.test(v) ? v : `${v}+09:00`);
  return Number.isNaN(t) ? null : t;
};

/**
 * Pure: what migrating one room means. `null` when the room has no legacy
 * array (nothing to do). Otherwise the message docs (createdAt as epoch ms; a
 * missing/garbled time falls back to the previous message's, else the room's,
 * else 0 — order is preserved by +1 ms), the number skipped, and the summary.
 */
export function planRoom(room) {
  if (!Array.isArray(room?.messages)) return null;
  const base = ms(room.createdAt) ?? 0;
  const messages = [];
  let skipped = 0;
  let prev = base;
  room.messages.forEach((m, i) => {
    const senderId = typeof m?.senderId === 'string' ? m.senderId : '';
    const text = typeof m?.text === 'string' ? m.text.replace(CONTROLS, '').trim().slice(0, MAX_TEXT) : '';
    if (!senderId || senderId.includes('/') || !text) { skipped++; return; }
    const at = Math.max(ms(m.createdAt) ?? prev, prev);
    prev = at + 1;
    messages.push({ id: `legacy_${String(i).padStart(4, '0')}`, senderId, text, createdAtMs: at });
  });
  const last = messages[messages.length - 1];
  const summary = {
    lenderSent: messages.some((m) => m.senderId === room.lenderId),
    borrowerSent: messages.some((m) => m.senderId === room.borrowerId),
    lastMessageText: last ? last.text.replace(/\s+/g, ' ').slice(0, PREVIEW) : '',
    lastSenderId: last ? last.senderId : '',
    lastMessageAtMs: last ? last.createdAtMs : null,
  };
  return { messages, skipped, summary };
}

async function main() {
  const { opts, error } = parseArgs(process.argv.slice(2));
  if (error) {
    console.error(`${error}\n${USAGE}`);
    process.exit(2);
  }
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  console.log(`project: ${opts.project}  target: ${emulator ? 'EMULATOR' : 'LIVE'}`);
  console.log(`mode: ${opts.apply ? 'APPLY' : 'DRY RUN (no changes; pass --apply to write)'}`);
  initializeApp({ projectId: opts.project, credential: applicationDefault() });
  const db = getFirestore();

  const tot = { rooms: 0, migrate: 0, skip: 0, messages: 0, skippedMessages: 0, failed: 0 };
  for (const doc of (await db.collection('talk_rooms').get()).docs) {
    tot.rooms++;
    const plan = planRoom(doc.data());
    if (!plan) { tot.skip++; continue; }
    tot.migrate++;
    tot.messages += plan.messages.length;
    tot.skippedMessages += plan.skipped;
    console.log(`${opts.apply ? 'MIGRATE' : 'WOULD MIGRATE'} talk_rooms/${doc.id}: ${plan.messages.length} message(s), ${plan.skipped} skipped`);
    if (!opts.apply) continue;
    try {
      const writes = plan.messages.map((m) => (b) => b.set(doc.ref.collection('messages').doc(m.id), {
        senderId: m.senderId, text: m.text, createdAt: Timestamp.fromMillis(m.createdAtMs), university_id: 'kyoto_u',
      }));
      const at = plan.summary.lastMessageAtMs === null ? null : Timestamp.fromMillis(plan.summary.lastMessageAtMs);
      writes.push((b) => b.update(doc.ref, {
        messages: FieldValue.delete(),
        lenderSent: plan.summary.lenderSent,
        borrowerSent: plan.summary.borrowerSent,
        lastMessageText: plan.summary.lastMessageText,
        lastSenderId: plan.summary.lastSenderId,
        lastMessageAt: at,
        lenderReadAt: at,
        borrowerReadAt: at,
      }));
      for (let i = 0; i < writes.length; i += CHUNK) {
        const batch = db.batch();
        for (const w of writes.slice(i, i + CHUNK)) w(batch);
        if (process.env.MIGRATE_CHATS_TEST_FAIL === doc.id && i + CHUNK >= writes.length && emulator) {
          throw new Error('injected failure before the final batch'); // test hook, emulator only
        }
        await batch.commit();
      }
    } catch (e) {
      tot.failed++;
      console.log(`FAIL talk_rooms/${doc.id}: ${e.message}`);
    }
  }
  console.log(`totals: rooms=${tot.rooms} migrate=${tot.migrate} skip=${tot.skip} messages=${tot.messages} skipped-messages=${tot.skippedMessages} failed=${tot.failed}`);
  console.log(opts.apply ? 'done' : 'done (dry run: nothing written)');
  if (tot.failed > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

Append to `tools/README.md`:

```markdown

## chat migration (Plan 3)

Talk rooms used to keep every message in one `messages` array on the room
document. `migrate_chats.mjs` moves each array into the
`talk_rooms/{id}/messages` subcollection (deterministic ids `legacy_NNNN`, only
the four fields the new rules allow), writes the room summary the
`onTalkMessageCreated` trigger maintains, marks the history read, and deletes
the array in the same batch as the last messages. Dry run by default; `--apply`
writes; `--project` is required; idempotent (a re-run skips migrated rooms).
Legacy times without an offset are read as JST. Emulator test:
`bash test_migrate_chats.sh`.
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tools/test_migrate_chats.sh`
Expected: PASS — `migrate_chats pure: OK`; then `migrate=3` (dry run) + `unchanged`; the injected failure exits 1 with `failed=1` and `partial` proves `big` kept its array; the re-run reports `migrate=1` and `migrated` passes; the third run reports `migrate=0`.

- [ ] **Step 5: Commit (now — before the next task)**

```bash
git add tools/migrate_chats.mjs tools/test_migrate_chats_fixture.mjs tools/test_migrate_chats.sh tools/README.md
git commit -m "feat(tools): migrate_chats — legacy message arrays into the subcollection, dry-run default, crash-safe, emulator-tested (Plan 3)"
```

---

### Task 15: `tools/moderate.mjs` — market commands (minimal extension)

**Files:**
- Create: `tools/test_moderate_market_fixture.mjs`
- Modify: `tools/moderate.mjs`, `tools/test_moderate.sh`, `tools/README.md`

**Interfaces:**
New commands (same rules as 2B: dry run unless `--apply --operator <name>`, `--project` required, attacker text through `safeText`, every action audited in `moderation_log` by the shared code): `market-list` (read-only), `listing-hide | listing-restore | listing-remove <listingId>`, `case-close <caseId>`. Loads `functions/lib/marketModeration.js` with the Functions' own `firebase-admin` (2B M-17).

- [ ] **Step 1: Write the failing market fixture and extend the test script**

Create `tools/test_moderate_market_fixture.mjs`:

```js
// Pure asserts + emulator fixture for the market commands of moderate.mjs (Plan 3, Task 15).
//
//   node test_moderate_market_fixture.mjs                 # pure asserts
//   node test_moderate_market_fixture.mjs seed|listcheck|dry-clean|hidden|restored|removed|closed
//
// The emulator modes refuse to run unless FIRESTORE_EMULATOR_HOST is set.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseArgs } from './moderate.mjs';

const mode = process.argv[2];

if (!mode) {
  assert.deepEqual(parseArgs(['market-list', '--project', 'p']).opts, { command: 'market-list', apply: false, project: 'p' });
  const r = parseArgs(['listing-restore', 'L1', '--project', 'p', '--apply', '--operator', 'me']).opts;
  assert.deepEqual([r.command, r.target, r.apply, r.operator], ['listing-restore', 'L1', true, 'me']);
  for (const bad of [
    ['market-list'], ['market-list', '--project', 'p', '--apply', '--operator', 'x'], ['listing-hide', '--project', 'p'],
    ['case-close', 'c1', '--project', 'p', '--apply'], ['listing-remove', 'a', 'b', '--project', 'p'], ['market-list', 'x', '--project', 'p'],
  ]) {
    assert.ok(parseArgs(bad).error, JSON.stringify(bad));
  }
  console.log('moderate market pure: OK');
  process.exit(0);
}

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('refusing to run outside the emulator'); process.exit(1); }
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: 'demo-mod' });
const db = getFirestore();
const get = (p) => db.doc(p).get();

if (mode === 'seed') {
  const exp = Timestamp.fromMillis(Date.now() + 10 * 86400000);
  await db.doc('textbook_listings/L1').set({ id: 'L1', ownerId: 'own1', title: 'Evil\u001b[2J本', status: 'hidden', type: 'sell', expiresAt: exp, university_id: 'kyoto_u' });
  await db.doc('market_queue/L1').set({
    listingId: 'L1', ownerId: 'own1', title: 'Evil本', status: 'hidden', reportCount: 3, countedReports: 3, hiddenBy: 'reports',
    statusBeforeHide: 'active', autoHide: true, transitions: 1, needsReview: true, university_id: 'kyoto_u',
  });
  for (const k of ['k1', 'k2', 'k3']) await db.doc(`market_queue/L1/reports/${k}`).set({ counted: true, university_id: 'kyoto_u' });
  await db.doc('textbook_listings/L2').set({ id: 'L2', ownerId: 'own2', title: '普通の本', status: 'active', type: 'give', expiresAt: exp, university_id: 'kyoto_u' });
  await db.doc('market_cases/R1_borrower').set({
    roomId: 'R1', category: 'harassment', status: 'open', priority: 'high', reporterUid: 'b1', reportedUid: 'own2',
    detail: 'しつこい\u001b[31m', university_id: 'kyoto_u',
  });
  console.log('fixture seeded');
  process.exit(0);
}

if (mode === 'listcheck') {
  const r = spawnSync(process.execPath, ['moderate.mjs', 'market-list', '--project', 'demo-mod'], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('L1'), 'the hidden listing is listed');
  assert.ok(r.stdout.includes('HIGH'), 'the harassment case is high priority');
  assert.ok(!r.stdout.includes('\u001b'), 'no raw ESC reaches the terminal');
  console.log('listcheck: assertions passed');
  process.exit(0);
}

const checks = {
  'dry-clean': async () => {
    assert.equal((await get('textbook_listings/L1')).get('status'), 'hidden');
    assert.equal((await get('textbook_listings/L2')).get('status'), 'active');
    assert.equal((await get('market_cases/R1_borrower')).get('status'), 'open');
    assert.equal((await db.collection('moderation_log').get()).size, 0);
  },
  hidden: async () => {
    assert.equal((await get('textbook_listings/L2')).get('status'), 'hidden');
    assert.equal((await get('notifications/mkt_L2_1')).get('type'), 'listing_hidden');
  },
  restored: async () => {
    assert.equal((await get('textbook_listings/L1')).get('status'), 'active');
    assert.equal((await get('market_queue/L1')).get('autoHide'), false);
    for (const k of ['k1', 'k2', 'k3']) assert.equal((await get(`moderation_actors/${k}`)).get('restoredReports'), 1);
    assert.equal((await get('notifications/mkt_L1_2')).get('type'), 'listing_restored');
  },
  removed: async () => {
    assert.equal((await get('textbook_listings/L2')).exists, false);
    assert.equal((await get('notifications/mkt_L2_2')).get('type'), 'listing_removed');
  },
  closed: async () => {
    const c = (await get('market_cases/R1_borrower')).data();
    assert.deepEqual([c.status, c.closedBy], ['closed', 'tester']);
    const by = (await db.collection('moderation_log').get()).docs.map((d) => d.get('by'));
    assert.ok(by.length >= 4 && by.every((b) => b === 'operator:tester'), JSON.stringify(by));
  },
};
if (!checks[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
await checks[mode]();
console.log(`${mode}: assertions passed`);
process.exit(0);
```

Append to `tools/test_moderate.sh`:

```bash

# Plan 3: the market commands (listings + chat cases), same dry-run / --operator rules.
node test_moderate_market_fixture.mjs
if node moderate.mjs listing-restore L1 --project demo-mod --apply >/dev/null 2>&1; then echo "expected usage failure (no --operator)"; exit 1; fi
MT="node test_moderate_market_fixture.mjs"
firebase emulators:exec --only firestore --project demo-mod "\
  $MT seed \
  && $MT listcheck \
  && $M listing-restore L1 --project demo-mod \
  && $M listing-hide L2 --project demo-mod \
  && $M case-close R1_borrower --project demo-mod \
  && $MT dry-clean \
  && $M listing-hide L2 --project demo-mod --apply --operator tester \
  && $MT hidden \
  && $M listing-restore L1 --project demo-mod --apply --operator tester \
  && $MT restored \
  && $M listing-remove L2 --project demo-mod --apply --operator tester \
  && $MT removed \
  && ! $M listing-remove L2 --project demo-mod --apply --operator tester \
  && $M case-close R1_borrower --project demo-mod --apply --operator tester \
  && $MT closed"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_moderate.sh`
Expected: FAIL — the 2B part passes, then `test_moderate_market_fixture.mjs` fails: `parseArgs` rejects `market-list`.

- [ ] **Step 3: Extend `tools/moderate.mjs` and document it**

In `tools/moderate.mjs` replace

```js
//   node moderate.mjs strip-legacy-reports --project <id> [--apply --operator <name>]
//
```

with

```js
//   node moderate.mjs strip-legacy-reports --project <id> [--apply --operator <name>]
//
// Textbook market (Plan 3, T-19/T-20) — same safety rules:
//   node moderate.mjs market-list --project <id>
//   node moderate.mjs listing-hide    <listingId> --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs listing-restore <listingId> --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs listing-remove  <listingId> --project <id> [--apply --operator <name>] [--note <text>]
//   node moderate.mjs case-close      <caseId>    --project <id> [--apply --operator <name>] [--note <text>]
//   A case is a participant's report about a chat (harassment / no_show / fraud);
//   read the room's messages in the console, then act (e.g. disable the account
//   in Firebase Authentication) and close the case.
//
```

In `tools/moderate.mjs` replace

```js
const TARGETED = new Set(['hide', 'restore', 'delete', 'close']);
const COMMANDS = new Set([...TARGETED, 'list', 'strip-legacy-reports']);
const USAGE = `usage: node moderate.mjs <list|hide|restore|delete|close|strip-legacy-reports> [id] --project <id> [--apply --operator <name>] [--note <text>]
```

with

```js
const MARKET_TARGETED = new Set(['listing-hide', 'listing-restore', 'listing-remove', 'case-close']);
const TARGETED = new Set(['hide', 'restore', 'delete', 'close', ...MARKET_TARGETED]);
const COMMANDS = new Set([...TARGETED, 'list', 'strip-legacy-reports', 'market-list']);
const USAGE = `usage: node moderate.mjs <list|hide|restore|delete|close|strip-legacy-reports|market-list|listing-hide|listing-restore|listing-remove|case-close> [id] --project <id> [--apply --operator <name>] [--note <text>]
```

In `tools/moderate.mjs` replace

```js
  if (command === 'list' && opts.apply) return { error: 'list is read-only' };
```

with

```js
  if ((command === 'list' || command === 'market-list') && opts.apply) return { error: `${command} is read-only` };
```

In `tools/moderate.mjs` replace

```js
async function describe(db, cmd, id) {
```

with

```js
async function describeMarket(db, cmd, id) {
  if (cmd === 'case-close') {
    const c = await db.collection('market_cases').doc(id).get();
    if (!c.exists) return `NOT FOUND (${safeText(id, 60)})`;
    return c.get('status') === 'closed' ? 'NOTHING TO DO (already closed)' : `WOULD CLOSE case ${safeText(id, 60)} (${safeText(c.get('category'), 20)})`;
  }
  const l = await db.collection('textbook_listings').doc(id).get();
  if (!l.exists) return `NOT FOUND (${safeText(id, 60)})`;
  const label = `${safeText(id, 60)} "${safeText(l.get('title'))}" by ${safeText(l.get('ownerId'), 40)} (${safeText(l.get('status'), 10)})`;
  switch (cmd) {
    case 'listing-hide': return l.get('status') === 'hidden' ? `NOTHING TO DO (${safeText(id, 60)} is already hidden)` : `WOULD HIDE listing ${label} (owner notified)`;
    case 'listing-restore': return l.get('status') === 'hidden'
      ? `WOULD RESTORE listing ${label} (owner notified, its reporters discredited)`
      : `WOULD ACKNOWLEDGE listing ${label} (stays as is, auto-hide off)`;
    default: return `WOULD DELETE listing ${label} (photos removed by the trigger)`;
  }
}

async function describe(db, cmd, id) {
  if (MARKET_TARGETED.has(cmd)) return describeMarket(db, cmd, id);
```

In `tools/moderate.mjs` replace

```js
  let mod;
  try {
    mod = fnRequire('./lib/moderation.js');
  } catch {
    console.error('functions/lib/moderation.js not found: run `npm --prefix functions run build` first');
    process.exit(2);
  }
```

with

```js
  let mod;
  let market;
  try {
    mod = fnRequire('./lib/moderation.js');
    market = fnRequire('./lib/marketModeration.js');
  } catch {
    console.error('functions/lib/moderation.js / marketModeration.js not found: run `npm --prefix functions run build` first');
    process.exit(2);
  }
```

In `tools/moderate.mjs` replace

```js
  if (opts.command === 'strip-legacy-reports') {
```

with

```js
  if (opts.command === 'market-list') {
    const { listings, cases } = await market.listMarketQueue(db, 200);
    console.log(`LISTINGS (${listings.length})`);
    for (const q of listings) {
      console.log(`  ${q.status.padEnd(8)} ${safeText(q.listingId, 60)} reports=${q.reportCount} counted=${q.countedReports}`
        + ` hiddenBy=${q.hiddenBy ?? '-'} review=${q.needsReview ? 'yes' : 'no'} owner=${safeText(q.ownerId, 40)} "${safeText(q.title)}"`);
    }
    console.log(`OPEN CASES (${cases.length})`);
    for (const c of cases) {
      console.log(`  ${c.priority === 'high' ? 'HIGH  ' : 'normal'} ${safeText(c.id, 80)} ${safeText(c.category, 20)}`
        + ` reporter=${safeText(c.reporterUid, 40)} reported=${safeText(c.reportedUid, 40)} room=${safeText(c.roomId, 80)}`);
      console.log(`    ${safeText(c.detail, 300)}`);
    }
    return;
  }

  if (opts.command === 'strip-legacy-reports') {
```

In `tools/moderate.mjs` replace

```js
  const fn = { hide: mod.hidePost, restore: mod.restorePost, delete: mod.removePost, close: mod.closeTakedown }[opts.command];
```

with

```js
  const fn = {
    hide: mod.hidePost, restore: mod.restorePost, delete: mod.removePost, close: mod.closeTakedown,
    'listing-hide': market.hideListing, 'listing-restore': market.restoreListing,
    'listing-remove': market.removeListing, 'case-close': market.closeCase,
  }[opts.command];
```

Append to `tools/README.md`:

```markdown

## moderation CLI: textbook market (Plan 3)

`moderate.mjs` also handles the textbook market: `market-list` shows
reported / hidden listings and open chat cases (harassment, 受け渡し不履行 =
`no_show`, fraud — high priority first); `listing-hide` / `listing-restore` /
`listing-remove <listingId>` and `case-close <caseId>` follow the same
dry-run / `--apply --operator` rules (`functions/lib/marketModeration.js`).
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tools/test_moderate.sh`
Expected: PASS — every 2B step as before, then `moderate market pure: OK`, `listcheck`, `dry-clean`, `hidden`, `restored`, `removed`, `closed` print `assertions passed`; the second `listing-remove L2` exits non-zero (`FAILED: not-found …`), which the `!` expects.

- [ ] **Step 5: Commit (now — before the next task)**

```bash
git add tools/moderate.mjs tools/test_moderate.sh tools/test_moderate_market_fixture.mjs tools/README.md
git commit -m "feat(tools): moderate.mjs market-list, listing-hide/restore/remove, case-close (Plan 3)"
```

---

## Deploy (2A + 2B + 3 together — order-dependent, do NOT improvise)

**This section supersedes the Deploy sections of the 2A and 2B plans.** None of 2A, 2B or 3 has been deployed; all three ship in this one sequence. Every 2A and 2B command below is the 2B runbook's command, unchanged and in the same order; Phase 3 extends steps PRE (suites and counts), 1 (two more indexes), 3 (nine more functions — same command) and 6 (the reason it must follow at once), inserts **step 5b** (chat migration), and extends the day-to-day and rollback notes. **Nothing here is run from the implementation environment.** The USER runs every step on their own machine (PowerShell 5.1: every command is one line, no `&&`, no `\` continuations; `;` chains). `gcloud` steps need the user's owner login (`gcloud auth login`); the migrations, the backfill and the moderation CLI need Application Default Credentials — a freshly created service-account key in `$env:GOOGLE_APPLICATION_CREDENTIALS` (delete it afterwards), or `gcloud auth application-default login` with the owner account (then `gcloud auth application-default set-quota-project kyodai-sns`).

**Requirements:** the **Blaze plan**. The first functions deploy may ask about an **Artifact Registry cleanup policy** — accept (e.g. delete images older than 1 day). Phase 3 needs **no** Cloud Scheduler API (T-8) and **no** bucket CORS change (T-5).

```
PRE. From the repo root (PowerShell): npm --prefix functions ci; npm --prefix functions run build; flutter build web --release
     (the web build happens NOW so the old-client window in steps 3-6 is as short as possible), then run every suite (Git Bash):
     bash tools/test_functions.sh ; bash tools/test_rules.sh ; bash tools/test_storage_rules.sh ;
     bash tools/test_migrate_storage.sh ; bash tools/test_backfill_course_stats.sh ; bash tools/test_moderate.sh ;
     bash tools/test_migrate_chats.sh ; flutter analyze ; flutter test
     # expected: functions 220, rules 138, storage rules 9, flutter test 181, flutter analyze 21 issues,
     # the other four tool suites exit 0.
     # PRE-RELEASE CHECKLIST (before the `flutter build web --release` above): set kOperatorContactEmail in
     # lib/config/contact.dart to the operator's real address (it ships EMPTY; empty = the takedown form's
     # "daily limit reached" error points to the お問い合わせ screen instead of showing an e-mail).

PRE-2. Review the 5 existing production past-exam posts BEFORE migrating anything (read-only until you decide):
     list them (Firebase console -> Firestore -> posts, or `node moderate.mjs list --project kyodai-sns` for anything
     already queued), open each file, and for any that is copyright-problematic delete it with
       node moderate.mjs delete <postId> --project kyodai-sns --apply --operator <you>
     (dry run first without --apply). Do this BEFORE step 5 (storage migration): a post deleted now is never copied
     into the private bucket and never shown in the new app.

0. (2A) Read-only audit before anything is deployed: in the Firebase console (Firestore -> requests) note docs
   with isFulfilled == true or fulfilledPostId set that no real fulfilment produced; clear the bogus ones
   (isFulfilled false, fulfilledPostId null) after step 3.

1. Indexes first (2A credits_ledger + 2B notifications + 3 textbook_listings x3):
   firebase deploy --only firestore:indexes --project kyodai-sns
   # WAIT until the FIVE NEW composite indexes (credits_ledger, notifications, and textbook_listings x3:
   # status+expiresAt, courseId+status+expiresAt, and the 買いたい match index type+status+expiresAt) read
   # "Enabled" in the console: the マイページ ledger, the お知らせ list and the 教科書 list / course filter fail
   # FAILED_PRECONDITION until then, and until the match index is Enabled the 買いたい match notices of every
   # new offer are LOST (the onListingCreated query fails and is not retried).

2. USER (PowerShell), signed URLs without a key file (2A):
   gcloud services enable iamcredentials.googleapis.com --project kyodai-sns

3. ONE command for ALL functions and rules (2A + 2B + 3):
   firebase deploy --only functions,firestore:rules,firestore:indexes,storage --project kyodai-sns
   # Deploys claimWelcomeCredits, downloadResource, reportPost, submitTakedown, createListing, updateListing,
   # openListingChat, blockRoom, rateDeal, reportMarket (callables) and onPostCreated, onPostDeleted,
   # onHiddenPostDeleted, onPostWritten, onReviewCreated, onReviewWritten, onListingCreated, onListingDeleted,
   # onTalkMessageCreated (triggers).
   # Why one command: the new rules deny the client's course_stats writes and posts.reports writes at the same
   # moment onReviewWritten/onPostWritten and reportPost take over; (2A) onPostCreated must never run against
   # the old requests rule; (3) the new rules freeze the talk_rooms message arrays, room creation and
   # textbook_requests writes at the same moment the market callables and the message trigger exist.
   # First functions deploy: accept the API prompts (Cloud Functions, Cloud Build, Artifact Registry, Eventarc,
   # Cloud Run, Pub/Sub). A Firestore trigger can fail the first time with an Eventarc permission-propagation
   # error: wait ~3 minutes and re-run the same command (idempotent).

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

5b. (3) USER (PowerShell, same session, still in tools) — chat migration, BEFORE the hosting deploy:
   node migrate_chats.mjs --project kyodai-sns
   node migrate_chats.mjs --project kyodai-sns --apply
   # Dry run first: one "WOULD MIGRATE talk_rooms/<id>: N message(s)" line per legacy room with an array and one
   # "WOULD RESET talk_rooms/<id>" line per array-less room that existed before the deploy (its summary, rating
   # flags and listing link are untrusted and get cleared), then a totals line (foreign-senders = legacy entries
   # from someone who is not one of the room's two parties; they are not migrated).
   # --apply moves each room's messages array into talk_rooms/<id>/messages, deletes the array and resets every
   # pre-deploy room; it exits 1 if any room failed — re-run the same command (idempotent: handled rooms are
   # recorded under admin_migrations/chats and skipped). The onTalkMessageCreated trigger fires once per migrated
   # message and sets lenderSent/borrowerSent again; that is harmless because the migration clears listingId, so
   # the room stays a legacy-room that rateDeal refuses. An old client still open shows empty chats from now on —
   # step 6 follows immediately.
   # WARNING: run the FIRST --apply BEFORE the hosting deploy (step 6). "Pre-deploy" is measured from the moment
   # of the first --apply (admin_migrations/chats.startedAt): a room that openListingChat created before the first
   # --apply would be reset like a legacy room. Later re-runs never touch rooms created after the first --apply.

6. Deploy hosting IMMEDIATELY after step 5b (the 2A migration removed fileUrls and the chat migration removed the
   message arrays, which breaks the OLD client; the old client also cannot report, write stats, list everyone's
   talk rooms, send chat messages or use the 参考書 board under the new rules). The web build was made in PRE;
   if any source changed since, run flutter build web --release first.
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
   # With Plan 4 (docs/superpowers/plans/2026-10-06-first-load-and-public-pages.md, order A) one normal reload is enough, but ONLY if
   # production's current flutter_service_worker.js is the self-unregistering stub (Plan 4 PRE e) — and WITHOUT Plan 4 two reloads
   # do NOT suffice under today's `immutable` headers (measured): testers must then clear the site data.

9. After the smoke test and a day (USER, credentials set again; absolute path):
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\key.json"
   Set-Location C:\path\to\kyoto-hub\tools
   node migrate_storage.mjs --project kyodai-sns --apply --delete-old
   # Removes the redundant public root objects. Delete the key file afterwards.
```

**Day-to-day moderation (USER, PowerShell, credentials set, in `tools`, after `npm --prefix ..\functions run build`):** posts as in 2B (`node moderate.mjs list --project kyodai-sns`, `restore` / `delete` / `hide` / `close`). Market (Plan 3): `node moderate.mjs market-list --project kyodai-sns` shows reported / hidden listings and open chat cases (harassment and fraud first). Inspect (dry run): `node moderate.mjs listing-restore <listingId> --project kyodai-sns`. Act: `node moderate.mjs listing-restore <listingId> --project kyodai-sns --apply --operator <you>` / `listing-hide …` / `listing-remove …`. For a case, read the room's messages in the Firebase console (`talk_rooms/<roomId>/messages`), act if needed — to stop a bad actor, disable the account in Firebase console → Authentication (2B M-16) — then `node moderate.mjs case-close <caseId> --project kyodai-sns --apply --operator <you> --note "<what you did>"`. To lift a block on request, in the Firebase console delete BOTH `market_blocks/<blockerUid>_<blockedUid>` and `market_blocks/mb_<blockerKey>_<blockedKey>` (the mailbox copy; the key is the `emailKey` of the address, see `market_identities/<uid>.key`), AND reopen each room of the pair: clear `closedBy` (and `closedAt`) on every `talk_rooms` document between the two users, or delete those rooms — `openListingChat` returns the same closed room for a listing the pair already talked about, so a deleted block alone does not restore the chat. A block now closes every room of the pair (both lender/borrower orderings), and the message rule refuses on the uid-keyed block doc as well.

**Rollback — if Plan 4 is deployed (order A), read this first.** Every rollback below rebuilds hosting from an older tree (`git checkout <P>` + `flutter build web --release` + `firebase deploy --only hosting`), and a rollback through the console's Release history does the same: both bring back that tree's `firebase.json` (the old `immutable` headers) and the old `web/` files, i.e. they silently remove Plan 4's stale-code protection, the start screen and `/about/`. **Keep Plan 4's hosting layer in every such rollback:** after `git checkout <P>` run `git checkout master-wf96b2 -- firebase.json web/flutter_bootstrap.js web/index.html web/about web/robots.txt web/sitemap.xml web/og-image.png web/manifest.json`, then `flutter build web --release`, `node tools/perf/check_web_cache.mjs` (must print OK), `firebase deploy --only hosting --project kyodai-sns`, and return with `git checkout master-wf96b2`. This applies to the *Phase 3 only* rollback below and to the 2B / 2A rollbacks it points to (hosting from `bc72fb0`). Details: Plan 4's Deploy → Rollback.

**Rollback.** *Phase 3 only* (keep 2A + 2B): the commit that **added this plan file** contains no code change, so its tree is exactly the 2B code. In Git Bash: `git log --diff-filter=A --format=%h -- docs/superpowers/plans/2026-10-05-phase3-textbook-market.md` prints it (call it `<P>`); then `git checkout <P>`, `flutter build web --release`, `firebase deploy --only hosting --project kyodai-sns`, `firebase deploy --only firestore:rules,storage --project kyodai-sns` (the rules files of `<P>` are the 2B ones), and return with `git checkout master-wf96b2`. Consequences: migrated rooms have no array, so the 2B client shows their history empty (the messages are still in the subcollection; nothing is lost; re-deploying Phase 3 shows them again); the 2B rules let participants write room arrays and let any verified user flip any `textbook_requests` doc again; listings and ratings stay in Firestore, invisible to the 2B client. The market Functions can stay deployed (no client calls them) or be removed in one line: `firebase functions:delete createListing updateListing openListingChat blockRoom rateDeal reportMarket onListingCreated onListingDeleted onTalkMessageCreated --region asia-east1 --project kyodai-sns`. *2B or 2A as well:* follow the 2B plan's rollback (hosting and rules from `bc72fb0`) after this one; its warnings (reporter uids, `course_stats` client writes, posts left in `hidden_posts`) apply unchanged.

## Manual E2E (production smoke test, after step 8 of the Deploy section; user + browser)

Run the 2A E2E and the 2B E2E (steps 1–8 there) first. Then, with verified KU accounts **A**, **B** and **C** (three different mailboxes):

1. **Tabs and retirement:** the bottom bar shows さがす / 時間割 / 教科書 / マイページ; マイページ no longer has 「参考書の貸し借り」; onboarding slide 4 talks about 教科書.
2. **Listing (A):** 教科書 → 出品する → 売ります, 『線形代数入門 E2E』, 目立った傷なし, price 1500, 定価 1200 → the 「定価より高い」 warning shows but 出品する works; add a JPEG photo under 2 MB (shows on the detail screen); try a PDF as a photo → 「写真は JPEG / PNG / WebP のみ」. Type `090-1234-5678` into the description → the contact warning shows (remove it before posting). The detail screen shows 「アプリはお金を扱いません」 and 「評価はまだありません」.
3. **Match (B, then A):** B creates 買いたい 『線形代数入門』; A creates a second 譲ります 『線形代数入門 第2版』 → within a few seconds B's マイページ bell shows a badge and お知らせ says 「「買いたい」に合いそうな教科書…」; tapping it opens A's listing.
4. **Search:** さがす → type 買いたい shows B's listing only; すべて + free word `線形` shows A's; a word that matches nothing shows 「該当する出品はありません」.
5. **Chat (B ↔ A):** B opens A's listing → チャットで相談する → the room opens with the red no-money banner; B sends two messages, A's 教科書 tab and トーク tab show a badge; A opens the room (badge clears) and answers. Scroll: the history is in order.
6. **Rating (blind):** before A answered, B's ⋮ menu has no 「取引を評価する」; after both spoke it does. B rates ★2 → A's listing detail still shows 「評価はまだありません」; A rates ★5 → B's summary shows ★5.0（1件） and A's ★2.0（1件）. Rating again says 「すでに評価済み」.
7. **Case and block:** B → ⋮ → 受け渡し不履行・トラブルを報告 → 受け渡し不履行 → 報告する → 「運営に報告しました」. Operator: `node moderate.mjs market-list --project kyodai-sns` lists the case (`normal`, `no_show`); `node moderate.mjs case-close <roomId>_borrower --project kyodai-sns --apply --operator owner`. A → ⋮ → ブロックする → the room shows 「このトークは終了しています」 for both, with no input; B → A's other listing → チャットで相談する → 「この相手とはやりとりできません」.
8. **Listing report:** B, C and a third mailbox report A's 譲ります listing as 教科書ではない → after the third it disappears from さがす; A's お知らせ says it was hidden and 自分の出品 shows 「非表示（運営確認中）」. Operator: `market-list` shows it `hidden reports=3`; `node moderate.mjs listing-restore <listingId> --project kyodai-sns --apply --operator owner` → it is back and A gets 「再び表示」.
9. **Renew / close:** A's 自分の出品 shows 掲載中 and no 「まだ有効?」 (30 days left). 取り下げ on one listing → it leaves さがす and shows 取り下げ済み. (The 7-day window is covered by the widget and Function tests; to see it live, use a test listing created 23+ days earlier.)
10. **Legacy chat:** a room that existed before step 5b shows its old messages in order with the room's names, is not marked unread, and its ⋮ menu has no 「取引を評価する」.
11. **Privacy (C, browser console as in 2A E2E step 8):** reading A–B's `talk_rooms/<roomId>` or its `messages` is permission-denied; a write to `textbook_listings/<any>`, `market_profiles/<C's uid>` or `textbook_requests/<any>` is permission-denied; `market_ratings`, `market_cases` reads are permission-denied.
12. **Share:** the detail screen's share icon → 「紹介文をコピーしました」; pasting shows type, title, price and the app URL — no name.

## Self-Review

**Spec coverage:**
- §4.1 教科書 = 独立タブ → T13 (4-tab nav, badge). ✓
- §4.4 出品タイプ 譲る/売る/買いたい, 貸す見送り → T-1, T2 (`LISTING_TYPES`), T11/T13. ✓
- §4.4 出品フィールド (title / course / condition / price ≤ 定価推奨 / photos / handoff presets) → T-3..T-5, T2 (`parseListingDraft`), T8 (Storage), T13 (form). ✓
- §4.4 一覧・科目フィルタ・フリーワード → T-7, T11 (`streamListings`, `filterListings`), T13. ✓
- §4.4 「買いたい」に合致する出品が出たら通知 → T-9, T3, T13 (お知らせ → listing). ✓
- §4.4 話がついたらチャット → T4, T12. ✓
- §4.4 決済はアプリ外・金銭を扱わない・UI に明示; 20pt 決済廃止 → T-3 (copy on form, list, detail, room warning), T7 grep (no credit code), 2A removed the 20pt settlement. ✓
- §4.4 認証済み京大生のみ → every callable `requireKuVerified`; rules `kuVerified()` for messages. ✓
- §4.4 取引後に相互評価（★＋一言） → T-10, T-11, T5, T12 (menu). ✓
- §4.4 通報 / 「受け渡し不履行」報告 → 運営対応 → T-19, T-20, T6, T15 (`market-list`, `case-close`). ✓
- §4.4 30 日で「まだ有効?」、期限切れ非表示 → T-8, T2 (renew window), T11 (query), T13 (prompt). ✓
- §4.4 教科書以外の出品禁止 → copy + `not_textbook` report → T6/T13. ✓
- §4.5.3 `textbook_listings` / chats: 当事者のみ書込 → T8 (listings Function-only, messages party-only, rooms Function-created). ✓
- §4.5.5 チャットはサブコレクション＋ページネーション、arrayUnion 廃止 → T-14, T-16, T4, T8, T12, T14 (migration). ✓
- §4.5.5 AppStore を機能ごとの repository に分割 → T-23, T9, T10, T12. ✓
- §6 Phase 3 機能的バイラル（時間割シェア、出品シェア） → listing share T-22/T13 ✓; timetable share **deferred** with a ruling (T-22).
- **Not in Phase 3 (deliberate):** push / e-mail notices (2B M-10 still in-app only), an admin UI (2B M-5), per-message rate limiting (accepted residual), reports on reviews (2B owner decision 14), timetable share (T-22), in-app unblock (T-17), edits of listing titles (T-4).

**Invariants a mutation must break (each mutation below was applied to the dry-run copy and failed exactly the named test):**
- Listing cap `>=` → `>` — listings "T-6: the 6th listing …".
- Owner forgery (`ownerId` from the payload) — listings "createListing writes a server-owned listing …".
- Update without the owner check — listings "updateListing: only the owner …".
- Ratings not blind (reveal condition removed) — ratings both T-11 tests.
- Rating with only one side having spoken (`||` → `&&`) — ratings "rating needs a market room where BOTH sides spoke …".
- Rating inflation (no per-rater-mailbox dedupe) — ratings "T-10: one friend trading again and again counts once".
- Room summary not monotonic — chat "T-18: … monotonic summary …".
- Block one-directional — chat "T-17: block closes the room for both …".
- Match notices ignoring blocks — listingMatch "a block in either direction suppresses match notices".
- Photo cleanup without the owner-prefix guard — marketModeration "remove deletes the listing … only the owner prefix".
- Rules: room update with any key, a closed room accepting messages, a client-chosen message time, client listing writes, messages readable by any KU user — each fails its rules test (T8).
- Flutter: unread counting one's own message, `markRead` writing the other party's marker, 譲る sending a price — `talk_room_test` + `app_store_test`, `chat_service_test`, `market_service_test`.
- Boundaries tested on both sides: 5/6 listings, 10/11 rooms, renew with 7 days left / 8 days left (Function) and 7 days / 7 days + 1 s (Dart), 13.9 / 14 days reveal, 3 / 4 title characters, 1000 / 1001 message characters (rules and `ChatService.send`), 2 MiB / 2 MiB + 1 photo bytes, price 100000 / 100001, title 100 / 101, comment 60 / 61, 20 / 22 match recipients, 10 / 12 match notices per day.

**Dry-run of this plan before committing it:** the plan was generated from, and every one of its code blocks / edits was applied in task order to, a fresh `git worktree --detach` copy of `master-wf96b2` at `adc49aa` (not the branch); applying Tasks 1–15 reproduces byte-for-byte the tree on which the suites were run. Per task, the "fails" state and the "passes" state were both run: Tasks 1–6 each failed on the missing module / export and then passed at 153 → 161 → 168 → 174 → 183 → 191 Functions tests (`tsc` clean); Task 7 kept 191 and the export grep printed `9`, the credit grep nothing; Task 8 failed exactly 9 rules tests and both new Storage tests against the old rules, then passed 136/136 and 8/8; Task 9 failed to compile (no `db` parameter), then 121 with 22 analyzer issues; Task 10 failed (files missing), then 126 / 22; Task 11 failed, then 142 / 22; Task 12 failed to compile, then 159 / 21; Task 13 failed, then 167 / 21 and `flutter build web --debug` clean; Task 14 failed (tool missing), then every fixture step passed; Task 15 failed on `parseArgs('market-list')` after the 2B part, then passed. On the final tree every suite was run once more: functions 191/191, rules 136/136, storage rules 8/8, `test_migrate_storage.sh`, `test_backfill_course_stats.sh`, `test_moderate.sh`, `test_migrate_chats.sh` green, `flutter test` 167/167, `flutter analyze` 21 issues (baseline 22 − 1, none new), `flutter build web --debug` clean. The mutations listed above were run on the same copy. Nothing was applied to the real working tree.

**Placeholder scan:** none — every step carries the full file, the full replacement, or an exact `replace … with …` / `insert before …` / `append` edit with both texts; every Run step names the command and the expected count.

**Type / name consistency:** callables `createListing`, `updateListing`, `openListingChat`, `blockRoom`, `rateDeal`, `reportMarket` (T7) = the names in `MarketService` (T11) and the Deploy list; region `asia-east1` in `common.ts` and `MarketService._liveInvoker`. Wire values `LISTING_TYPES` / `BOOK_CONDITIONS` / `HANDOFF_PLACES` (T1) = `ListingType.value` / `BookCondition.value` / `kHandoffPlaces` keys (T11, asserted there); `LISTING_REPORT_CATEGORIES` / `ROOM_REPORT_CATEGORIES` (T6) = `ListingReportCategory.value` / `RoomReportCategory.value` (T11, asserted); report statuses `reported | hidden | duplicate | already_hidden | case_opened` (T6) = `MarketReportOutcome` mapping (T11); `rateDeal` statuses `rated | duplicate` (T5) = `MarketService.rateDeal` (T11). Error messages `listing-limit`, `room-limit`, `blocked`, `listing-closed`, `own-listing`, `no-exchange`, `too-early`, `not-active`, `expired`, `legacy-room` (T2–T6) = `MarketException` getters / `notice` (T11). Notification types `listing_match` (`mkt_match_<offer>_<uid>`, T3) and `listing_hidden/_restored/_removed` (`mkt_<listing>_<n>`, T6) = `AppNotification.message` (T13) and the moderate fixture (T15). Room fields `lenderId/borrowerId/lenderName/borrowerName/listingId/lastMessageText/lastMessageAt/lastSenderId/lenderSent/borrowerSent/lenderReadAt/borrowerReadAt/closedBy` are spelled identically in `chat.ts` (T4), the rules (T8), `TalkRoom` (T12), `ChatService.markRead` (T12) and `migrate_chats.mjs` (T14); message fields `senderId/text/createdAt/university_id` identically in the rules (T8), `ChatService.send` (T12) and the migration (T14). Limits `MARKET.maxMessage` 1000 = rules `text.size() <= 1000` = `kChatMaxMessage` = `MAX_TEXT`; `maxTitle` 100 = `kListingMaxTitle`; `maxPrice` 100000 = `kListingMaxPrice`; `maxPhotos` 3 = `kListingMaxPhotos`; 2 MiB = storage rules = `kListingPhotoMaxBytes`; `maxComment` 60 = `kRatingMaxComment`; `renewWindowDays` 7 / `listingDays` 30 = `TextbookListing.renewWindow` / `lifetime`. Collections `textbook_listings`, `market_identities`, `market_actors`, `market_blocks`, `market_inbox`, `market_ratings`, `market_reputation`, `market_profiles`, `market_queue/{id}/reports/{key}`, `market_cases` are spelled identically in T1–T6, the rules and their tests (T8), `MarketService` (T11) and the CLI (T15). `AppStore`'s constructor keeps its five positional parameters (T9, T12), so `main.dart` is unchanged.

## Owner decisions to confirm

Each is implemented as the ruling says and can be reversed cheaply (the "Cost if wrong" column):

1. **T-1** retire the 参考書リクエスト board without migrating its open requests (vs converting them into 買いたい listings).
2. **T-3** prices are information only: 定価 is a warning, not a cap; 売る 1–100000 yen; no credits in the market.
3. **T-4** listing title / type / course / photos cannot be edited after posting (close and re-post instead).
4. **T-5** listing photos are readable by every KU account (download URLs minted at display time) — vs fully private behind a signed-URL callable.
5. **T-6** caps per mailbox per day: 5 listings, 10 new chats; listing reports share the post-report budget (10/day).
6. **T-7** client-side free-word search over the newest 100 live listings.
7. **T-8** no scheduled Function: expiry by query, 「まだ有効?」 as an in-app prompt in the last 7 days (vs a nightly `listing_expiring` notice).
8. **T-9** matching = same course or title containment of ≥ 4 normalized characters; 20 recipients per offer; 10 match notices per person per day; a new 買いたい notifies nobody.
9. **T-10 / T-11** ratings: both must have sent a message; immutable; blind until both rated or 14 days; one counted rating per rater mailbox; comments shown without rater names.
10. **T-13** operator-looking display names (運営 / 公式 / 管理者 / 事務局 / admin / official / support / InfoHub) become 「京大生」.
11. **T-14** keep the `lenderId` / `borrowerId` field names (meaning owner side / requester side) instead of renaming with a second migration.
12. **T-17** block is permanent in the app (operator can lift it in the console).
13. **T-19** listing threshold 3 reporters; hide = status flip; hidden listings visible to their owner only.
14. **T-20** chat cases never sanction automatically; bans = disabling the Firebase Auth account.
15. **T-22** timetable share deferred; listing share = copy text with the app URL (no deep link).
16. **T-23** AppStore stays a façade over repositories (no view API change); a further auth/session split is left for later.
17. **Accepted residual:** no per-message rate limit in chat (a flood is ended by blocking; rules cannot count). Recommended later if abused: a per-room counter in `onTalkMessageCreated` that closes a room after N messages per minute.
18. **T-24** legacy chat times without an offset are read as JST; migrated history is marked read; legacy rooms cannot be rated.
19. **Block covers all rooms (implemented in the final review):** `blockRoom` closes every room between the two users and the message rule refuses on the uid-keyed block doc, so one block ends the whole relationship, not one listing's chat.
20. **Listing photos (review item 7, left as is):** photos stay readable by `get` to any KU address after a listing is closed (only an operator removal deletes them); uploads are not bounded in count per user and photos that are never attached to a listing (orphans) are never cleaned up. Reversal: a cleanup tool / a per-user upload cap.
21. **Legacy-room mailbox block fallback (review item 9, left as is):** for a room whose other party has no `market_identities` record the block falls back to the `uid:<uid>` key, so a re-signup of such a legacy user is not covered by the mailbox block.
22. **Chats stay open after an operator hides a listing:** hiding or removing a listing does not close its existing rooms (the two parties may still finish the handoff); an operator uses `case-close` / account disabling for abuse.

Owner answers (DECIDED, follow-up round 2):

23. **DECIDED — legacy points discarded**, not converted; everyone gets +3 credits at verification (existing verified users automatically at the first login after the deploy).
24. **DECIDED — existing posts reviewed, then migrated:** the 5 production past exams are reviewed first (Deploy step PRE-2); problematic ones are deleted before the migration.
25. **DECIDED — no uploader reward** for migrated posts (Admin writes do not fire `onPostCreated`).
26. **DECIDED — one-time in-app notice** 「ポイント制がクレジット制に変わりました」 (flag on the user's own doc).
27. **DECIDED — contact e-mail in the takedown "daily limit" error** (`kOperatorContactEmail`, set before the release build; empty = point to お問い合わせ).
28. **DECIDED — the 2B immediate hide stays as is** (a verified KU student's takedown hides at once; capped and discreditable).
29. **DECIDED — listing photos after close and chats after an operator hides a listing stay as they are** (items 20 and 22 above are final).
