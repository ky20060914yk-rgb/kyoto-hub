# tools/

## courses pipeline

- `source/syllabus_data.json` — scraped from the Kyoto U open-syllabus site
  (`https://www.k.kyoto-u.ac.jp/external/open_syllabus/...`), ~11.6k rows, ~99%
  全学共通科目. Committed as-is for reproducibility.
- `build_courses.py` — normalizes it into `courses.json`: NFKC, drops rows with
  no name or a non-weekday slot, replaces missing/known-fabricated lecturer names
  with `担当教員不明`, computes a slot-independent `courseKey`, dedups exact
  (courseKey, day, period) collisions.
- `courses.json` — build output; input to the seed script. Regenerate with
  `python build_courses.py`.

Each `courses.json` entry:
`{ "id": str, "courseKey": str, "name": str, "faculty": str, "lecturer": str,
"dayOfWeek": "Mon".."Fri", "period": 1..5, "category": str,
"university_id": "kyoto_u" }`

### Known limitations (Phase 1)
- Professional-faculty courses are almost entirely absent from the source.
- `faculty` is whatever the scrape recorded (mostly `全学共通`); no enrichment.
- No credits / term / evaluation method / syllabus text (needs a per-URL scrape,
  deferred to a later phase).
- The current source yields ~10.1k course docs — within the 2000–12000 sanity
  guard in `main()`. Dedup only collapses exact (courseKey, day, period) matches, so
  multi-section courses stay distinct.

## seeding

`node seed_courses.mjs --project kyodai-sns` (see seed_courses.mjs header).

The seed also bumps `meta/catalog.version`. `CourseRepository` loads the
catalog from the on-device Firestore cache and only goes back to the server
when that version changes, so **any re-seed must go through this script** — a
hand-written batch that skips the version bump leaves every existing client on
the stale cached catalog.

Emulator check: `bash test_seed.sh`.

## legacy id migration (one-off, C2)

`migrate_ids.mjs` rewrites the pre-Phase-1 `ku_official_*` course ids that are
still stored in `user_timetables.timetable`, `posts.subjectId`,
`requests.subjectId` and `textbook_requests.subjectId` to the hashed catalog
ids. It rebuilds the old id table straight out of git, verifies its
courseKey/hash reproduction against `courses.json` before writing anything, is
idempotent, and supports `--dry-run` and `--verify-only`.

```
node migrate_ids.mjs --verify-only                     # id table sanity
node migrate_ids.mjs --project kyodai-sns --dry-run    # counts, no writes
node migrate_ids.mjs --project kyodai-sns              # apply
```

`ku_custom_*` ids never existed in the catalog and are left untouched (the run
reports how many it saw). Emulator test: `bash test_migrate.sh`.

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

## chat migration (Plan 3)

Talk rooms used to keep every message in one `messages` array on the room
document, and a room was client-writable. `migrate_chats.mjs` moves each array
into the `talk_rooms/{id}/messages` subcollection (deterministic ids
`legacy_NNNN`, only the four fields the new rules allow), keeps a preview of the
last message with both read markers on it, and deletes the array in the same
batch as the last messages. It also **resets every room that existed before the
deploy** (summary, `lenderSent`/`borrowerSent`, `listingId`/`listingType`),
because those fields could have been forged by a client: a migrated room is a
legacy room and can never unlock a rating. "Before the deploy" is decided by
the room's Firestore `createTime` against the moment of the first `--apply`
(`admin_migrations/chats`; handled rooms are listed under
`admin_migrations/chats/rooms`, Admin-only), so a re-run never touches a room
created after it. Run it before the hosting deploy. Dry run by default;
`--apply` writes; `--project` is required; idempotent and safe to re-run after a
crash. Legacy times without an offset are read as JST. Credentials: Application
Default Credentials only. Emulator test: `bash test_migrate_chats.sh`.
