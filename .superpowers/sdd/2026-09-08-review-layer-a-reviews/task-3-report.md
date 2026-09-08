# Task 3 report — Firestore rules for `reviews` + `course_stats`

Branch: `review-layer-a`
Files changed: `firestore.rules`, `firestore-tests/rules.test.mjs`

## Test count

| | tests |
|---|---|
| before | 92 pass / 0 fail |
| after Step 1 (tests only, no rules) | 108 total, 101 pass, **7 fail** — exactly the seven cases containing an `assertSucceeds`; every `assertFails` case passed vacuously under the catch-all |
| after Step 3 (rules added) | **108 pass / 0 fail** |

16 new tests (the brief's ~11 grouped cases, the two added rating cases, plus three
analogues of the existing `posts` coverage: `university_id` pinning, author cannot
reassign `authorId`/`courseKey`, author cannot stuff `helpfulBy`).

## Rules added

Inserted immediately before `match /{document=**}` (verified: catch-all is still the
last block, now at line 227).

- `match /reviews/{reviewId}`
  - `read: kuDomain()` — KU address, verified or not, matching every other stream.
  - `create: kuVerified()` and: `reviewId == courseKey + '_' + request.auth.uid`,
    `authorId == request.auth.uid`, `university_id == 'kyoto_u'`,
    `rating is int` in `[1, 5]`.
  - `update: signedIn()` and one of two branches (below).
  - `delete: signedIn() && resource.data.authorId == request.auth.uid` — no
    moderation carve-out, unlike `posts`.
- `match /course_stats/{courseKey}` — `read: kuDomain()`, `write: kuVerified()`.
  Trust-based, same tier as `transactions`; the comment marks it for replacement by
  a Cloud Function in Phase 2.

## Test fixtures

`reviewDoc(overrides)` returns the full `Review.toMap()` shape with the real Dart
enum `.value` strings (`rakutan: 'raku'`, `attendance: 'light'`,
`grading: 'exam_report'`, `pastExam: 'similar'`, `bringIn: 'yes'`), so no fixture can
express a document the client could not produce. Tokens reuse the file's existing
constants and `asKu()` / `asKu2()` / `asKuUnverified()` / `asOutsider()` / `asAnon()`
helpers — no new token objects were introduced.

Seeds added to `beforeEach`: `reviews/ck_u1` (author `u1`, `helpfulBy: []`),
`reviews/ck2_u1` (`helpfulBy: ['u2']`, the "already voted" fixture), and
`course_stats/ck`.

## Self-review — the `update` OR-logic

**Can a non-author reach the author branch?** No. The branch opens on
`resource.data.authorId == request.auth.uid`, read from the *stored* document, which
a caller cannot influence within the same evaluation. `authorId` is pinned at create
(`== request.auth.uid`) and re-pinned on every author edit
(`request.resource.data.authorId == resource.data.authorId`), so it can never drift
to a different uid. `courseKey` is pinned the same way, so a review cannot be moved
onto another course after the fact — which matters because the doc-id ↔ courseKey
binding is only checked at create. Tested by
"an author cannot reassign their review or move its courseKey".

If a review document were somehow written without `authorId` (only possible via the
Admin SDK, which bypasses rules), `resource.data.authorId` raises an evaluation
error, which Firestore resolves as **deny** — the failure direction is safe.

**Can the helpful-append be abused?** The branch is the exact shape of the
`posts.reports` carve-out and inherits its reasoning:

- `hasOnly(['helpfulBy'])` — nothing else in the document may change in the same
  write, so a vote cannot smuggle in a body edit ("non-author cannot edit its body"
  covers `{helpfulBy, comment}` together).
- `size() == old.size() + 1` — exactly one entry per write; no bulk stuffing.
- `hasAll(old)` — append-only; existing votes cannot be dropped or swapped out.
- `hasAny([uid])` — combined with the two above, the single new element is forced to
  be the caller's own uid: the array grew by one, every old element survives, and the
  caller's uid is present but (next clause) was absent before, so the caller's uid
  *is* the new element.
- `!old.hasAny([uid])` — one vote per account. Without it, an account already in the
  array would still satisfy `hasAny([uid])` while appending someone *else's* uid, and
  could walk the counter up alone.
- `kuVerified()` — an outsider or unverified Firebase account cannot vote at all, so
  the cost of inflating a count is one verified `@st.kyoto-u.ac.jp` mailbox per vote.

Type confusion is closed by the same clauses: a `helpfulBy` that is a string or a map
makes `hasAll(list)` raise, and an error is a deny.

**Known, bounded gap (matches `posts`):** the author *can* cast the single
own-uid vote on their own review — the author branch refuses to touch `helpfulBy`, so
they fall through to the append-only branch, where they are capped at one entry like
everyone else. Self-inflation is therefore exactly +1, the same as `posts.reports`
allows an author to file the first report against themselves. Documented in the rule
comment and asserted by "an author cannot stuff helpfulBy on their own review".

**Is the `courseKey + '_' + request.auth.uid` doc-id check sound?** Yes, for the
property it is asked to provide: one review per (course, author).

- CEL `+` on strings is concatenation; if `courseKey` is not a string the expression
  raises and the create is denied, so the check doubles as a `courseKey is string`
  guard.
- The id is compared to the caller's *own* uid, so a caller can only ever write a doc
  whose id ends in `_<their uid>`; they cannot occupy another user's slot
  ("cannot create a review whose doc id is not `<courseKey>_<own uid>`").
- The prefix must equal the `courseKey` the document carries, so one author cannot
  hold two ids for the same course (tested with a mismatched prefix).
- Separator ambiguity (`courseKey` itself containing `_`) is not exploitable: whatever
  the split, the id must still equal *this caller's* `courseKey + '_' + uid`, so no id
  reachable by user A is also reachable by user B; and Firebase uids are 28-char
  alphanumerics that contain no `_`. Queries filter on the `courseKey` *field*, not on
  the id, so a padded id cannot misattribute a review to another course.

**Catch-all still last?** Yes — `match /{document=**}` at line 227, after both new
blocks (`reviews` at 196, `course_stats` at 222). The existing "unlisted collections
are denied to everyone" test still passes.

## Concerns / follow-ups

1. `course_stats` is trust-based (`write: kuVerified()`): any verified KU account can
   set any course's `reviewCount` / `avgRating` to anything. This is the brief's
   deliberate Phase-1 choice, flagged in the rule comment for a Cloud Function in
   Phase 2. It is the same tier as `transactions`.
2. `reviews` create validates identity, `university_id` and `rating` only. The enum
   fields, `comment`, `helpfulBy` and the timestamps are unvalidated, so a
   hand-crafted document can carry an out-of-vocabulary `rakutan` or a non-list
   `helpfulBy`. The reader must stay defensive (as `CourseRepository._fromDoc` is);
   a malformed `helpfulBy` only freezes voting on that one document (every append
   raises and denies) — it cannot widen anyone's write access.
3. There is no `reviews` query test in this task (the client's course-scoped
   `where('courseKey', '==', ...)` listen); it is gated by `read: kuDomain()`, which
   is document-shape-independent, so no query can be denied that a get would allow.
   Worth adding alongside the repository task that introduces the actual query.

## Fix round 1

Four Important review findings, plus the two doc/comment corrections. Two commits:
`8536815` (rules + rules tests), `66f0872` (models + model tests).

### I1 — `reviews` create pins `helpfulBy` to `[]`

`firestore.rules` — added `&& request.resource.data.helpfulBy == []` to the create
rule.

The append-only update branch alone was never enough. `helpfulBy` is a *benefit* to
the review's author, which is where the analogy to `posts.reports` breaks: an author
could ship a review already carrying `helpfulBy: ['x', 'y', ...]`, and — worse —
could reset a review that had accumulated real votes by deleting it (allowed, they
own it) and re-creating it with a fresh array. Neither path touches the update rule.

The rule comment above the block claimed the author was capped at +1 via the
append-only branch. That was true only of *updates*; with this pin it is now true
outright, and the comment says so and says why `helpfulBy` is unlike `reports`.

`firestore-tests/rules.test.mjs` — new test `review create must pin helpfulBy to the
empty list`: `['x']`, `['u1','a','b']` and the non-list `'nope'` all `assertFails`;
`helpfulBy: []` `assertSucceeds`.

### I2 — author-edit branch re-validates `rating`, pins `university_id`

`firestore.rules` — the author branch of `allow update` gained
`request.resource.data.university_id == resource.data.university_id`,
`rating is int`, and `rating >= 1 && rating <= 5`.

`rating` was validated at create and never again, so an honest 1..5 review could be
walked to `rating: 99` (absurd stars), `rating: 'x'` (a non-int assigned to a
non-nullable Dart field) or `rating: 4.5` one edit later. `university_id` was pinned
on `posts` (M5) but not here, so an author could move their review to `osaka_u` and
out of the university-scoped read scope.

`firestore-tests/rules.test.mjs` — new test `an author edit re-validates rating and
cannot change university_id`: `99`, `0`, `'x'`, `4.5` and `university_id: 'osaka_u'`
all `assertFails`; `rating: 5` `assertSucceeds`.

### I3 — `Review.fromMap` is total

`lib/models/review.dart` — every fallback was `map['x'] ?? default`, which covers an
*absent* field only. A field present with the wrong type still threw, and Task 4
reads a course's reviews as one `where('courseKey', ...)` stream mapped client-side:
one malformed document did not hide one row, it threw out of the map and blanked the
entire list for every reader.

- `rating` → `is num` check, `.toInt()`, clamped to 0..5 (`_rating`). Never assigns a
  non-int to the non-nullable field; `'x'` becomes 0 ("unrated") rather than a
  `TypeError`.
- `helpfulBy` → `is Iterable` guard + `.whereType<String>()`, else `const <String>[]`.
- `createdAt` / `updatedAt` → `DateTime.tryParse(raw?.toString() ?? '') ?? now`
  (`_date`).
- enum fields → `map['x']?.toString() ?? ''` before `fromString`, so a non-string
  cannot raise on the way into the already-defaulting switch. Same for the string
  fields (`id`, `courseKey`, `courseName`, `comment`, `termTaken`, `gradeTaken`).

`test/models/review_test.dart` — `fromMap is total: wrong TYPES degrade instead of
throwing` (`rating: 'x'`, `helpfulBy: 'nope'`, `createdAt: 12345`, `rakutan: 7`,
`updatedAt: null` → `returnsNormally`, usable Review) and `fromMap coerces
out-of-range and non-int ratings into 0..5` (99→5, -3→0, 4.7→4, null→0; a mixed
`helpfulBy` keeps only the uids).

### I4 — `course_stats`: no delete, shape guard, total reader, merge-safe writer

`firestore.rules` — `allow write: if kuVerified()` replaced by:

```
allow create, update: if kuVerified()
  && request.resource.data.university_id == 'kyoto_u'
  && request.resource.data.reviewCount is int && request.resource.data.reviewCount >= 0
  && request.resource.data.ratingSum is int && request.resource.data.ratingSum >= 0;
allow delete: if false;
```

The *values* stay trust-based (Phase 1, no Cloud Functions) but the *shape* no longer
is, so a crafted write cannot hand Task 7's ranking read a negative or non-numeric
counter. Delete is refused outright: unlike a review, an aggregate has no owner who
could legitimately remove it, and dropping it silently zeroes a course's history.

The comment said "same tier as `transactions`". It is not — `transactions` forbids
update as well as delete, whereas update is the whole point of this collection. The
comment now states what the rule actually does and what it deliberately does not.

`lib/models/course_stats.dart`:

- `fromMap` scalars go through a new `_int(raw) => raw is num ? raw.toInt() : 0`.
  **`as num?` alone is not sufficient** — `'3' as num?` throws, and a string counter
  is exactly the shape a hand-crafted document carries. For the same reason `_intMap`
  was switched to the helper too (its `(value as num?)` had the identical hole),
  which is a deliberate deviation from the brief's "leave it".
- `lastReviewAt` → `DateTime.tryParse((map['lastReviewAt'] ?? '').toString())`.
- `courseKey` / `university_id` → `?.toString() ?? default`.
- `toMap()` no longer emits `'lastReviewAt': null`. Under `set(merge: true)` an
  explicit null is a *write* that erases the stored value, so a stats write carrying
  no timestamp could clobber a `lastReviewAt` a concurrent write had recorded — the
  same merge hazard `pastExamPostCount` / `resourcePostCount` are already omitted for
  (P2). The key is now included only when it has a value.

`firestore-tests/rules.test.mjs` — new test `course_stats writes are shape-guarded
and deletion is forbidden`: `reviewCount: -1`, `ratingSum: -5`, `reviewCount: 'many'`,
`ratingSum: 3.5`, `university_id: 'osaka_u'` and a create omitting the counters all
`assertFails`; a well-shaped create `assertSucceeds`; delete by `asKu()` and `asKu2()`
both `assertFails`. The `course_stats/ck` seed gained `ratingSum` so it carries the
real `CourseStats.toMap()` shape that a merge write must leave intact (in rules,
`request.resource.data` on a merge is the *merged* document).

`test/models/course_stats_test.dart` — `fromMap is total` (`reviewCount: '3'`,
`ratingSum: 1.0`, `lastReviewAt: 7`, a non-numeric bucket, `courseKey: 42` →
`returnsNormally`) and `toMap omits lastReviewAt entirely when it is null`.

### Comment corrections

1. The `reviews` rule comment (I1, above).
2. The `course_stats` rule comment (I4, above).
3. `rules.test.mjs` in `a non-author appends exactly their own uid to helpfulBy,
   once`: the comment read "Someone else's uid, several at a time, or a shrink are all
   refused", but the first three assertions are all u2 writing to `ck2_u1`, which
   *already carries u2's vote* — they are denied by `!old.hasAny([uid])`, not by any
   foreign-uid clause. Only the fourth assertion (u1, who has not voted, appending
   `u9`) is the someone-else's-uid case. The comment now splits the two.

### Verify

| command | result |
|---|---|
| `bash tools/test_rules.sh` | `tests 111 / pass 111 / fail 0` (was 108) |
| `flutter test` | `+33: All tests passed!` (was 29) |
| `flutter analyze` | `25 issues found`, **0 errors, 0 warnings** — all 25 are pre-existing `info`s, none in `review.dart` / `course_stats.dart` |

### Follow-up left open

`course_stats` create now *requires* `reviewCount` and `ratingSum` to be present in
the merged document. Task 8's `bumpPostCount`, if it uses `FieldValue.increment` with
`set(merge: true)` against a course that has no stats doc yet, would produce a merged
document without those keys and be denied. Nothing calls it today (no `ReviewService`
or `bumpPostCount` exists yet), but Task 8 must either seed the aggregate first or the
rule must relax to `.get('reviewCount', 0)`. Related: `CourseStats.empty()` carries
`universityId: ''`, which the new `university_id == 'kyoto_u'` clause would reject —
`_apply` fills it from the first review, so only a *zero-review* stats write is
affected, but a writer must not persist `empty()` verbatim.

## Fix round 2

Addressed the follow-up gap: split `course_stats` create/update rules to allow
counter-only merge writes. One commit: `a483686`.

### Course_stats create/update split

`firestore.rules` — separated `allow create` and `allow update` for `course_stats`:

- **create**: requires full shape — `reviewCount is int`, `ratingSum is int`.
- **update**: uses `.get(key, 0)` defaults — permits writes omitting these keys.

This allows `bumpPostCount` merge updates (which write only counter fields) to
succeed after an initial full create (from the review transaction path). The rule
still rejects creates without counters and negative/non-int values when present.

### CourseStats.empty() fix

`lib/models/course_stats.dart` — changed `empty(courseKey)` to set
`universityId: 'kyoto_u'` (was `''`). Aligns with the hard `university_id == 'kyoto_u'`
requirement in both write paths.

### New test

`firestore-tests/rules.test.mjs` — added `course_stats: counter-only merge writes
succeed without reviewCount/ratingSum`: create a doc with full shape, then verify
update-path merge writes with only `{ courseKey, university_id, counter: value }`
succeed.

### Verify

| command | result |
|---|---|
| `bash tools/test_rules.sh` | `tests 112 / pass 112 / fail 0` (was 111, +1) |
| `flutter test` | `All tests passed!` (unchanged) |
| `flutter analyze` | `25 issues found`, **0 errors** (pre-existing `info`s only) |
