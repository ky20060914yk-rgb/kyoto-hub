# M2 — Search, Course Pages, Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public search + rankings, public course summary pages (SEO), signed-in review reading/writing, with reviews and `course_stats` written only by the server, and the review credit bonuses from the 2A plan.

**Architecture:** Domain logic (enums, slug, stats aggregation, rakutan score) is a pure TS port of `lib/models/review.dart` + `course_stats.dart` in `site/lib/domain/`. Server modules: `catalog.ts` (cached course catalog + search), `public.ts` (public-only projections), `credits.ts` (2A ledger core), `reviews.ts` (upsert/delete/helpful in one transaction with `course_stats` + bonuses). Route Handlers call them; pages: `/search` (server-rendered rankings + client search box), `/courses/[id]` (cached public summary + client review section).

**Tech Stack:** as M1. Cache Components (`'use cache'` + `cacheLife`) for public reads.

**Spec:** `docs/specs/2026-10-08-nextjs-migration-design.md` §3.1, §4, §4.1, §6.2; `design.md` §6.3–6.8; 2A plan P2-12/13/14 and `CREDITS`.

## Global Constraints
- Everything in M1's Global Constraints.
- Review doc id = `slug(courseKey) + '_' + uid`; `slug` = `'%'→'%25'` then `'/'→'%2F'`. `course_stats` doc id = `slug(courseKey)`.
- Enum wire values (verbatim): rakutan `raku|futsu|muzu`; attendance `none|light|heavy`; grading `exam_only|exam_report|report_mainly|attendance_heavy`; pastExam `as_is|similar|trend_only|not_useful`; bringIn `no|yes|na`. Dates are ISO strings (Flutter compatible).
- rakutanScore (verbatim from Dart): 50 at 0 reviews; else `clamp(50 + 35*(rakuFrac-muzuFrac) + 10*(avg-3)/2 + 10*(lightFrac-0.5), 0, 100)`, `lightFrac = none/n + 0.5*light/n`; stored `score = round(rakutanScore)`.
- CREDITS (verbatim from 2A): welcome 3, upload 3, firstReviews 2, firstReviewCount 3, scarceReview 1, scarceThreshold 5, reviewDailyCap 5, referral 3, referralCap 10, requestFulfilled 3, downloadCost 1, dailyGrantCap 3.
- Public projections never include review `comment`, `authorId`, `authorName`, `helpfulBy`, or any user data.
- `firestore.rules`: `reviews` and `course_stats` become client-read-only (`create, update, delete: if false`). Not deployed until cutover (spec §8.3).

## Tasks

### Task 1: Domain port (`lib/domain/review.ts`)
- Produces: `RAKUTAN|ATTENDANCE|GRADING|PAST_EXAM|BRING_IN` label maps; `type ReviewInput`; `type Review`; `type CourseStats`; `slug(courseKey)`, `reviewDocId(courseKey, uid)`, `emptyStats(courseKey)`, `applyReview(stats, review, delta, previous?)`, `rakutanScore(stats)`, `avgRating(stats)`, `parseReviewInput(unknown): ReviewInput` (throws `HttpError(400)`).
- Tests (`tests/domain.test.ts`): slug injectivity (`a/b` vs `a%2Fb`); easy course scores > hard + 30; add then remove returns counts to zero and score 50; edit (previous) does not double count; parse rejects rating 0/6, unknown enum, comment > 2000 chars, non-string term.

### Task 2: Credits core (`lib/server/credits.ts`)
- Produces: `CREDITS`, `jstDay(now?)`, `type Balance`, `readBalance(tx, uid)`, `writeCredit(tx, ev, cur, patch?)` (throws `HttpError(409,'クレジットが足りません')` when negative), `grantReviewBonuses(tx, {reviewId, authorId}, total, now)` returning `{first, scarce, granted, capped}`.
- Tests (`tests/credits.test.ts`, emulator): writeCredit appends ledger + balance; negative throws; ledger id reuse throws (tx.create); review bonuses: first 3 reviews +2 each, 4th none; scarce +1 when total ≤ 5, none at 6; daily cap 5.

### Task 3: Review service (`lib/server/reviews.ts`) + API
- Produces: `upsertReview(user, courseId, input, now?) → {review, bonus}`; `deleteReview(user, courseKey)`; `toggleHelpful(user, reviewId) → {helpful: boolean, count}`. Routes: `POST /api/reviews` `{courseId, ...input}`, `DELETE /api/reviews?courseKey=`, `POST /api/reviews/helpful` `{reviewId}`.
- Rules: author cannot vote own review (403); course must exist (404); stats updated in the same transaction (edit uses previous); total for scarce = count query of `reviews` by courseKey after write; `revalidateTag('course:'+id)` after writes.
- Tests (`tests/reviews.test.ts`, emulator): create → stats count 1 + bonus 3 (first+scarce); edit → count stays 1, rating sum updated, no new bonus; delete → count 0; helpful toggle on/off; self-vote 403; unknown course 404.

### Task 4: Catalog + public projections (`lib/server/catalog.ts`, `lib/server/public.ts`)
- Produces: `getCatalog(): Promise<CatalogCourse[]>` (`'use cache'`, `cacheLife('days')`; fields `id,courseKey,name,lecturer,faculty,category,dayOfWeek,period`); `searchCourses(q, {day?, period?}, limit=30)` (NFKC + lower-case, matches name or lecturer, all whitespace-separated terms must match); `getPublicCourse(id): Promise<PublicCourse|null>` (`'use cache'`, `cacheLife('hours')`, `cacheTag('course:'+id)`; includes other slots of the same courseKey and `PublicStats` = counts/avg/score/pastExamPostCount/resourcePostCount); `getRankings(): Promise<Record<RankingKind, PublicRankRow[]>>` (`'use cache'`, `cacheLife('hours')`; kinds `rakutan|mostReviewed|mostPastExams|recent`, ≤ 20 each, rakutan requires ≥ 2 reviews); `getIndexableCourseIds()` for the sitemap.
- Route: `GET /api/courses?q=&day=&period=` → `searchCourses`.
- Tests (`tests/public.test.ts`, emulator): seed a course + review with comment "SECRET" → `JSON.stringify(getPublicCourse)` has no "SECRET"/authorId; search matches 全角/半角 and lecturer; rankings order.

### Task 5: UI — components
- `components/course/{Stars,RatingSummary,DistributionBars,CourseRow,Chip,ReviewCard,ReviewForm,ReviewSection}.tsx` per design.md §6.3–6.7. `components/ui/Sheet.tsx` (bottom sheet, `animate-sheet-up`, focus trap via `<dialog>`).

### Task 6: Pages + SEO
- `/search` (AppShell `requireAuth={false}`): search box (debounced 250ms → `/api/courses`), day/period filter chips, ranking segmented tabs (server data as props).
- `/courses/[id]`: server summary (title, slots, lecturer, RatingSummary, DistributionBars, counts) + `ReviewSection` (client): signed-out CTA; signed-in list (`onSnapshot` where courseKey, orderBy updatedAt desc, limit 50), own review edit/delete, form sheet, helpful.
- `generateMetadata` (title/description/OGP, `robots: noindex` when reviewCount = 0), JSON-LD `Course` + `AggregateRating` when reviewCount ≥ 3, `app/sitemap.ts` (courses with ≥ 1 review + static pages), `app/robots.ts`.
- Verify in browser on emulators with seeded data (`tests/seed-dev.ts`).
