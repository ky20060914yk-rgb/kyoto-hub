# M4 — Past exams, materials, credits, request board, reports

**Spec:** `docs/specs/2026-10-08-nextjs-migration-design.md` §6.2; redesign spec §4.3; 2A plan P2-3/P2-4/P2-9/P2-10.

## Done
1. `lib/domain/resource.ts`: categories (`past_exam` = 過去問, `test_prep` = 資料; Flutter wire values), exam types, limits (5 files, 20MB, PDF/images), input parsing, `dedupKey`, `safeFileName`.
2. `lib/server/resources.ts` (tests: `tests/resources.test.ts`, storage injected as `Files`):
   - `createResource`: validates `uploads/{uid}/pending/{uploadId}/*`, moves to `resources/{postId}/{i}_{name}`, writes `posts` (+ `courseKey`, `filePaths`, `dedupKey`, `hidden`), bumps `course_stats` counters, +3 upload (not for duplicates), +3 request fulfilment, 3 grants / JST day, notifies the requester.
   - `downloadResource`: −1 once per user/post (`dl_<uid>_<postId>`), free for the author and the fulfilled requester, **returns the bytes** (see deviation).
   - `createRequest` (max 10 open per user), `reportPost` (one per account, hide at 3, `moderation_queue`), `requestTakedown` (hide now, priority queue, author notified, credits kept).
3. Routes: `POST /api/resources`, `POST /api/resources/download`, `POST /api/requests`, `POST /api/reports`, `POST /api/takedown` (public, honeypot).
4. Rules: `posts` / `requests` client-read-only; `storage.rules`: owner-only pending uploads (KU verified, ≤20MB, PDF/images), `textbook_photos` (public read, owner write, ≤5MB), everything else server-only. Rules tests updated (87 pass).
5. UI: course page 過去問・資料 tab (過去問 / 資料 / リクエスト), upload sheet with progress, download, report, request form; `?tab=resources` deep link.

## Deviation from the spec
- **Downloads stream through `/api/resources/download` instead of a 10-minute signed URL.** Same guarantee (every download is authenticated and charged server-side), and it avoids granting the App Hosting service account `iam.serviceAccounts.signBlob`. Files are ≤20MB, under the response limit.

## Cutover work (M6)
- Backfill `courseKey` / `filePaths` on legacy `posts` (they only have `subjectId` + public `fileUrls`) and move their files into `resources/` (2A plan `migrate_storage.mjs`, run by the owner with the service-account key).
