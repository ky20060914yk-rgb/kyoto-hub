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
"dayOfWeek": "Mon".."Fri", "period": 1..5, "university_id": "kyoto_u" }`

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
