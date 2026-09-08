# Review Layer — Plan A: Reviews + Course Detail 2-Tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a verified KU student write one structured review per course (editable), read every course's reviews with an aggregated summary, mark reviews helpful, and see all of it on a course page whose old 3-way post split is collapsed to a clean 2 tabs (レビュー / 過去問・資料).

**Architecture:** A `reviews/{courseKey}_{uid}` document per (course, author) enforces one-per-user by construction. Each write also transactionally maintains a `course_stats/{courseKey}` roll-up doc (counts + rating sum + distribution buckets + a derived 楽単スコア input), because Phase 1 has no Cloud Functions to aggregate on write. The course page reads `course_stats` for the summary (1 doc) and streams `reviews` for the list. `course_detail_screen.dart` (1119 lines) is split into a thin tab shell plus `course_review_tab.dart` and `course_resource_tab.dart`; the existing `PostCategory.testPrep`/`.other` posts are folded into the single resource tab, `pastExam` unchanged.

**Tech Stack:** Flutter 3.41.9 / Dart ^3.11.5, Firebase (Auth, Firestore) project `kyodai-sns`. Tests: `flutter test` (+ `fake_cloud_firestore ^4.2.0`, already a dev dep), `bash tools/test_rules.sh` (emulator, JDK 21).

**Spec:** `docs/specs/2026-09-07-kyodai-info-redesign-design.md` §4.1 (科目詳細を2タブに再編), §4.2 (授業情報層).

## Global Constraints

- Flutter `3.41.9`; Dart SDK `^3.11.5`. No new pub dependencies.
- **No Cloud Functions / no Blaze plan.** Aggregation is client-side (Firestore transaction on write, read of one roll-up doc).
- Firestore project `kyodai-sns`; every document carries `university_id: 'kyoto_u'`.
- Reviews: **투고も閲覧も無料** — no credit/points interaction at all. The `transactions`/points system is untouched by this plan.
- One review per (course, author): the review doc id is exactly `'${courseKey}_${uid}'`. Editable in place; deletable by the author.
- Reviews attach to `courseKey` (the slot-independent `normalize(name)|normalize(lecturer)` string on every `Subject`), **not** to a `Subject.id` / timetable slot.
- Rules: `reviews` read = `kuDomain()`; create/update/delete = author only, verified, and the doc-id-matches-uid invariant. `course_stats` read = `kuDomain()`, write = `kuVerified()` (trust-based, same tier as `transactions`; Phase 2 hardens with a Function). The `match /{document=**}` catch-all stays LAST.
- Past-exam / resource posting/download behaviour is otherwise **unchanged** ("据え置き" per the spec).
- Commit after every task. TDD: failing test first.
- Match existing code style: `AppStore` is a `ChangeNotifier` god-object with `.catchError((_) {})` on fire-and-forget Firestore writes; screens use `setState`, brand colour `Color(0xFF0F4C81)`, modal bottom sheets for forms. Follow those patterns, don't refactor around them.

---

## File Structure

**Created:**
- `lib/models/review.dart` — `Review` data class + the field enums (`Rakutan`, `Attendance`, `GradingStyle`, `PastExamUsefulness`, `BringIn`) with `.value`/`.label`/`fromString`.
- `lib/models/course_stats.dart` — `CourseStats` roll-up data class + the `rakutanScore` derivation.
- `lib/services/review_service.dart` — all Firestore reads/writes for `reviews` + `course_stats` (kept out of the 21-method `firestore_service.dart` so the review data layer is one focused file).
- `lib/views/course/course_review_tab.dart` — the レビュー tab: summary card (distribution bars, 楽単スコア, counts) + review list + "役に立った" + "自分のレビューを書く/編集".
- `lib/views/course/course_resource_tab.dart` — the 過去問・資料 tab: the current `_buildTabContent` logic, generalised to show `pastExam` + `testPrep` + `other` posts together.
- `lib/views/course/review_form_sheet.dart` — the structured-field modal bottom sheet for writing/editing a review.
- `test/models/review_test.dart`, `test/models/course_stats_test.dart`
- `test/services/review_service_test.dart`

**Modified:**
- `firestore.rules` — add `reviews` + `course_stats` blocks before the catch-all.
- `firestore-tests/rules.test.mjs` — review/stats rule tests.
- `lib/models/post.dart` — `PostCategoryX.label` for `testPrep`/`other` stays, but a new `PostCategoryX.groupLabel` or the resource tab just shows all three; no enum change.
- `lib/services/app_store.dart` — hold `CourseStats?` for the open course + the viewer's own `Review?`; `submitReview`, `deleteReview`, `markReviewHelpful`; expose `reviewService`.
- `lib/services/firestore_service.dart` — add `pastExamCount`/`resourceCount` bumps to `createPost`/`deletePost` (transaction on `course_stats/{courseKey}`) — or do it in `AppStore.addPost`/`deletePost`; see Task 8.
- `lib/views/course/course_detail_screen.dart` — reduced to a 2-tab `TabBar`/`TabBarView` shell delegating to the two new tab widgets; the ~1000 lines of modal/list code move into the two tab files.
- `lib/views/mypage/my_page_screen.dart` — show the viewer's contribution score + a "自分のレビュー" section.

---

## Task 1: `Review` model + field enums

**Files:**
- Create: `lib/models/review.dart`
- Create: `test/models/review_test.dart`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```dart
  enum Rakutan { raku, futsu, muzu }          // 楽 / 普通 / 難
  enum Attendance { none, light, heavy }      // 取らない / 取る(ゆるい) / 毎回(重い)
  enum GradingStyle { examOnly, examReport, reportMainly, attendanceHeavy }
  enum PastExamUsefulness { asIs, similar, trendOnly, notUseful }
  enum BringIn { no, yes, na }                // 不可 / 可 / 該当なし
  // each enum has: String get value; String get label; static X fromString(String)
  class Review {
    final String id;              // '${courseKey}_${authorId}'
    final String courseKey;
    final String courseName;      // denormalised at write time (for マイページ / lists)
    final String universityId;    // 'kyoto_u'
    final String authorId;
    final String authorName;
    final int rating;             // おすすめ度 1..5
    final Rakutan rakutan;
    final Attendance attendance;
    final GradingStyle grading;
    final PastExamUsefulness pastExam;
    final BringIn bringIn;
    final String comment;         // free text, may be ''
    final String? termTaken;      // '2024前期' etc, optional
    final String? gradeTaken;     // 'S'..'F' etc, optional
    final List<String> helpfulBy; // uids who marked 役に立った
    final DateTime createdAt;
    final DateTime updatedAt;
    int get helpfulCount => helpfulBy.length;
    Map<String, dynamic> toMap();
    factory Review.fromMap(Map<String, dynamic>);
    Review copyWith({...});
    static String docId(String courseKey, String uid) => '${courseKey}_$uid';
  }
  ```

- [ ] **Step 1: Write the failing test**

`test/models/review_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/review.dart';

void main() {
  test('Review round-trips through toMap/fromMap including enums and helpfulBy', () {
    final r = Review(
      id: 'k|y_u1',
      courseKey: 'k|y',
      courseName: '微分積分学A',
      authorId: 'u1',
      authorName: '京大生_1234',
      rating: 4,
      rakutan: Rakutan.raku,
      attendance: Attendance.light,
      grading: GradingStyle.examOnly,
      pastExam: PastExamUsefulness.asIs,
      bringIn: BringIn.yes,
      comment: '楽単。過去問そのまま。',
      termTaken: '2024前期',
      gradeTaken: 'A',
      helpfulBy: const ['u2', 'u3'],
      createdAt: DateTime.parse('2024-04-01T00:00:00.000'),
      updatedAt: DateTime.parse('2024-04-02T00:00:00.000'),
    );
    final back = Review.fromMap(r.toMap());
    expect(back.rating, 4);
    expect(back.rakutan, Rakutan.raku);
    expect(back.grading, GradingStyle.examOnly);
    expect(back.pastExam, PastExamUsefulness.asIs);
    expect(back.bringIn, BringIn.yes);
    expect(back.helpfulBy, ['u2', 'u3']);
    expect(back.helpfulCount, 2);
    expect(back.termTaken, '2024前期');
  });

  test('fromMap tolerates missing optional + unknown enum strings', () {
    final back = Review.fromMap({
      'id': 'a_b', 'courseKey': 'a', 'authorId': 'b', 'authorName': 'x',
      'rating': 3, 'rakutan': 'bogus', 'attendance': 'bogus', 'grading': 'bogus',
      'pastExam': 'bogus', 'bringIn': 'bogus', 'comment': '',
      'createdAt': '2024-04-01T00:00:00.000', 'updatedAt': '2024-04-01T00:00:00.000',
    });
    expect(back.rakutan, Rakutan.futsu);       // default for unknown
    expect(back.attendance, Attendance.light); // default for unknown
    expect(back.termTaken, isNull);
    expect(back.helpfulBy, isEmpty);
  });

  test('docId is deterministic', () {
    expect(Review.docId('微積a|山田', 'u9'), '微積a|山田_u9');
  });
}
```

- [ ] **Step 2: Run it, watch it fail**

Run: `flutter test test/models/review_test.dart`
Expected: FAIL — `review.dart` does not exist.

- [ ] **Step 3: Implement `lib/models/review.dart`**

Write the five enums each with `value` (snake/kebab string), `label` (Japanese), and a `fromString` that returns a sensible default for unknown input (`Rakutan.futsu`, `Attendance.light`, `GradingStyle.examReport`, `PastExamUsefulness.trendOnly`, `BringIn.na`). Then the `Review` class exactly as the Interfaces block specifies. `toMap` emits every enum as its `.value`, dates as `toIso8601String()`, `helpfulBy` as a plain `List<String>`, and includes `'university_id': universityId`. `fromMap` reads `map['university_id'] ?? 'kyoto_u'`, `List<String>.from(map['helpfulBy'] ?? const [])`, `DateTime.parse` with a `DateTime.now()` fallback, and `map['termTaken']` / `map['gradeTaken']` as nullable. Constructor defaults: `universityId = 'kyoto_u'`, `helpfulBy = const []`, `comment = ''`.

- [ ] **Step 4: Run tests to green**

Run: `flutter test test/models/review_test.dart`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/models/review.dart test/models/review_test.dart
git commit -m "feat: Review model + structured-field enums"
```

---

## Task 2: `CourseStats` roll-up model

**Files:**
- Create: `lib/models/course_stats.dart`
- Create: `test/models/course_stats_test.dart`

**Interfaces:**
- Consumes: the enums from Task 1.
- Produces:
  ```dart
  class CourseStats {
    final String courseKey;
    final String universityId;
    final int reviewCount;
    final int ratingSum;                       // Σ rating over all reviews
    final Map<String, int> rakutanCounts;      // {'raku': n, 'futsu': n, 'muzu': n}
    final Map<String, int> attendanceCounts;   // keyed by Attendance.value
    final Map<String, int> gradingCounts;
    final Map<String, int> pastExamCounts;
    final Map<String, int> bringInCounts;
    final int pastExamPostCount;               // # of PostCategory.pastExam posts
    final int resourcePostCount;               // # of testPrep + other posts
    final DateTime? lastReviewAt;
    double get avgRating => reviewCount == 0 ? 0 : ratingSum / reviewCount;
    /// 0..100. Higher = easier credit. Blend of rakutan mix, avg rating,
    /// attendance lightness. Pure function of the counts.
    double get rakutanScore;
    Map<String, dynamic> toMap();
    factory CourseStats.fromMap(Map<String, dynamic>);
    static CourseStats empty(String courseKey);
    /// Returns a new CourseStats with `review` added (delta = +1) or removed (delta = -1).
    CourseStats applyReview(Review review, {required int delta, Review? previous});
  }
  ```

- [ ] **Step 1: Write the failing test**

`test/models/course_stats_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/review.dart';
import 'package:kyoto_exam_hub/models/course_stats.dart';

Review _r(String uid, {int rating = 3, Rakutan rakutan = Rakutan.futsu}) => Review(
      id: 'ck_$uid', courseKey: 'ck', authorId: uid, authorName: uid,
      rating: rating, rakutan: rakutan, attendance: Attendance.light,
      grading: GradingStyle.examOnly, pastExam: PastExamUsefulness.similar,
      bringIn: BringIn.na, comment: '',
      createdAt: DateTime(2024), updatedAt: DateTime(2024),
    );

void main() {
  test('applyReview add/remove is symmetric', () {
    var s = CourseStats.empty('ck');
    s = s.applyReview(_r('u1', rating: 5, rakutan: Rakutan.raku), delta: 1);
    s = s.applyReview(_r('u2', rating: 3, rakutan: Rakutan.muzu), delta: 1);
    expect(s.reviewCount, 2);
    expect(s.ratingSum, 8);
    expect(s.avgRating, 4.0);
    expect(s.rakutanCounts['raku'], 1);
    expect(s.rakutanCounts['muzu'], 1);
    s = s.applyReview(_r('u2', rating: 3, rakutan: Rakutan.muzu), delta: -1);
    expect(s.reviewCount, 1);
    expect(s.ratingSum, 5);
    expect(s.rakutanCounts['muzu'], 0);
  });

  test('applyReview with previous swaps an edited review cleanly', () {
    var s = CourseStats.empty('ck')
        .applyReview(_r('u1', rating: 2, rakutan: Rakutan.muzu), delta: 1);
    // u1 edits: 2->5, muzu->raku
    s = s.applyReview(_r('u1', rating: 5, rakutan: Rakutan.raku),
        delta: 1, previous: _r('u1', rating: 2, rakutan: Rakutan.muzu));
    expect(s.reviewCount, 1);           // not double-counted
    expect(s.ratingSum, 5);
    expect(s.rakutanCounts['muzu'], 0);
    expect(s.rakutanCounts['raku'], 1);
  });

  test('rakutanScore: all-raku high-rating course scores far above all-muzu', () {
    final easy = CourseStats.empty('e')
        .applyReview(_r('a', rating: 5, rakutan: Rakutan.raku), delta: 1)
        .applyReview(_r('b', rating: 5, rakutan: Rakutan.raku), delta: 1);
    final hard = CourseStats.empty('h')
        .applyReview(_r('a', rating: 2, rakutan: Rakutan.muzu), delta: 1)
        .applyReview(_r('b', rating: 2, rakutan: Rakutan.muzu), delta: 1);
    expect(easy.rakutanScore, greaterThan(hard.rakutanScore + 30));
  });

  test('roundtrip toMap/fromMap', () {
    final s = CourseStats.empty('ck')
        .applyReview(_r('u1', rating: 4, rakutan: Rakutan.raku), delta: 1);
    final back = CourseStats.fromMap(s.toMap());
    expect(back.reviewCount, 1);
    expect(back.ratingSum, 4);
    expect(back.rakutanCounts['raku'], 1);
  });
}
```

- [ ] **Step 2: Run it, watch it fail**

Run: `flutter test test/models/course_stats_test.dart`
Expected: FAIL — `course_stats.dart` missing.

- [ ] **Step 3: Implement `lib/models/course_stats.dart`**

`applyReview(review, {delta, previous})`: if `previous != null`, first apply `previous` with `delta: -1` internally (subtract its buckets, `reviewCount` and `ratingSum`), then apply `review` with `+1`; if `previous == null`, apply `review` with the given `delta`. Bucket maps: increment/decrement `map[enum.value]` clamped at `>= 0`. `reviewCount` clamped `>= 0`. `pastExamPostCount`/`resourcePostCount` are NOT touched by `applyReview` (Task 8 owns those). `lastReviewAt` = `review.updatedAt` when `delta == 1`.

`rakutanScore` formula (pure function; tune later, but it must satisfy the test — all-raku/5★ ≥ all-muzu/2★ + 30):
```dart
double get rakutanScore {
  if (reviewCount == 0) return 50;
  final rakuFrac = (rakutanCounts['raku'] ?? 0) / reviewCount;
  final muzuFrac = (rakutanCounts['muzu'] ?? 0) / reviewCount;
  final lightFrac = (attendanceCounts['none'] ?? 0) / reviewCount
      + 0.5 * ((attendanceCounts['light'] ?? 0) / reviewCount);
  final base = 50
      + 35 * (rakuFrac - muzuFrac)      // -35..+35
      + 10 * (avgRating - 3) / 2        // -10..+10
      + 10 * (lightFrac - 0.5);         // -5..+5
  return base.clamp(0, 100);
}
```

`toMap`/`fromMap`: maps stored as plain `Map<String, dynamic>` → coerce values to `int`; `lastReviewAt` as nullable ISO string.

- [ ] **Step 4: Run tests to green**

Run: `flutter test test/models/course_stats_test.dart`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/models/course_stats.dart test/models/course_stats_test.dart
git commit -m "feat: CourseStats roll-up model + rakutanScore"
```

---

## Task 3: Firestore rules for `reviews` + `course_stats`

**Files:**
- Modify: `firestore.rules` (add two `match` blocks immediately before `match /{document=**}`)
- Modify: `firestore-tests/rules.test.mjs`

**Interfaces:**
- Consumes: the existing `kuDomain()`, `kuVerified()`, `owns()` helpers.
- Produces: deployed rules where a review's doc id must be `<something>_<caller uid>`, a caller writes only their own review, everyone KU-domain reads; `course_stats` is KU-domain read / KU-verified write; the `helpfulBy`-only carve-out lets a non-author append exactly their own uid once.

- [ ] **Step 1: Write the failing rules tests**

Add to `firestore-tests/rules.test.mjs` (follow the file's existing `initializeTestEnvironment` / `withSecurityRulesDisabled` fixture pattern; `KU` = verified `a@st.kyoto-u.ac.jp` uid `u1`, `KU2` = verified uid `u2`, `KU_UNVERIFIED`, `OUTSIDER` = `c@gmail.com`):

```javascript
// --- reviews ---
test('KU-domain unverified user can READ a review', async () => {
  const db = env.authenticatedContext('u9', KU_UNVERIFIED_TOKEN).firestore();
  await assertSucceeds(getDoc(doc(db, 'reviews/ck_u1')));
});
test('outsider cannot read reviews', async () => {
  const db = env.authenticatedContext('u3', OUTSIDER_TOKEN).firestore();
  await assertFails(getDoc(doc(db, 'reviews/ck_u1')));
});
test('verified KU user creates their own review (doc id ends _<uid>)', async () => {
  const db = env.authenticatedContext('u1', KU_TOKEN).firestore();
  await assertSucceeds(setDoc(doc(db, 'reviews/ck_u1'), reviewDoc({ authorId: 'u1', courseKey: 'ck' })));
});
test('cannot create a review whose doc id is not _<own uid>', async () => {
  const db = env.authenticatedContext('u1', KU_TOKEN).firestore();
  await assertFails(setDoc(doc(db, 'reviews/ck_u2'), reviewDoc({ authorId: 'u1', courseKey: 'ck' })));
});
test('cannot create a review with authorId != uid', async () => {
  const db = env.authenticatedContext('u1', KU_TOKEN).firestore();
  await assertFails(setDoc(doc(db, 'reviews/ck_u1'), reviewDoc({ authorId: 'u2', courseKey: 'ck' })));
});
test('unverified KU user cannot create a review', async () => {
  const db = env.authenticatedContext('u1', KU_UNVERIFIED_TOKEN).firestore();
  await assertFails(setDoc(doc(db, 'reviews/ck_u1'), reviewDoc({ authorId: 'u1', courseKey: 'ck' })));
});
test('author edits their own review; non-author cannot edit its body', async () => {
  // seed reviews/ck_u1 (authorId u1) with rules disabled
  const mine = env.authenticatedContext('u1', KU_TOKEN).firestore();
  await assertSucceeds(updateDoc(doc(mine, 'reviews/ck_u1'), { rating: 5, comment: 'edit' }));
  const other = env.authenticatedContext('u2', KU_TOKEN).firestore();
  await assertFails(updateDoc(doc(other, 'reviews/ck_u1'), { comment: 'hax' }));
});
test('non-author appends exactly their own uid to helpfulBy, once', async () => {
  // seed reviews/ck_u1 helpfulBy: []
  const u2 = env.authenticatedContext('u2', KU_TOKEN).firestore();
  await assertSucceeds(updateDoc(doc(u2, 'reviews/ck_u1'), { helpfulBy: ['u2'] }));
  // seed helpfulBy: ['u2'] then:
  await assertFails(updateDoc(doc(u2, 'reviews/ck_u1'), { helpfulBy: ['u2', 'u9'] })); // not own uid
  await assertFails(updateDoc(doc(u2, 'reviews/ck_u1'), { helpfulBy: ['u2', 'u3'], comment: 'x' })); // extra field
});
test('author deletes own review; non-author cannot', async () => {
  const other = env.authenticatedContext('u2', KU_TOKEN).firestore();
  await assertFails(deleteDoc(doc(other, 'reviews/ck_u1')));
  const mine = env.authenticatedContext('u1', KU_TOKEN).firestore();
  await assertSucceeds(deleteDoc(doc(mine, 'reviews/ck_u1')));
});
// --- course_stats ---
test('course_stats: KU-domain reads, KU-verified writes, outsider denied both', async () => {
  const ku = env.authenticatedContext('u1', KU_TOKEN).firestore();
  await assertSucceeds(getDoc(doc(ku, 'course_stats/ck')));
  await assertSucceeds(setDoc(doc(ku, 'course_stats/ck'), { courseKey: 'ck', university_id: 'kyoto_u', reviewCount: 1 }, { merge: true }));
  const out = env.authenticatedContext('u3', OUTSIDER_TOKEN).firestore();
  await assertFails(getDoc(doc(out, 'course_stats/ck')));
  await assertFails(setDoc(doc(out, 'course_stats/ck'), { reviewCount: 999 }, { merge: true }));
});
```

Add a `reviewDoc(overrides)` helper near the file's other fixture builders: returns a full valid review map (`courseKey`, `university_id: 'kyoto_u'`, `authorId`, `authorName`, `rating: 3`, all five enum strings, `comment: ''`, `helpfulBy: []`, `createdAt`/`updatedAt` ISO strings) merged with `overrides`.

- [ ] **Step 2: Run, watch fail**

Run: `bash tools/test_rules.sh`
Expected: the new tests fail (no `reviews`/`course_stats` rules → catch-all denies everything, so the `assertSucceeds` cases fail).

- [ ] **Step 3: Add the rules**

In `firestore.rules`, immediately before `match /{document=**}`:

```
// One structured review per (course, author). The document id is
// '<courseKey>_<authorId>', so a user physically cannot hold two reviews for
// the same course, and the id encodes the author. Read by any KU address;
// written only by its author, verified. A non-author may append exactly their
// own uid to `helpfulBy` and nothing else (the same append-only shape as
// posts.reports).
match /reviews/{reviewId} {
  allow read: if kuDomain();
  allow create: if kuVerified()
    && reviewId == request.resource.data.courseKey + '_' + request.auth.uid
    && request.resource.data.authorId == request.auth.uid
    && request.resource.data.university_id == 'kyoto_u'
    && request.resource.data.rating is int
    && request.resource.data.rating >= 1 && request.resource.data.rating <= 5;
  allow update: if signedIn()
    && ((resource.data.authorId == request.auth.uid
         && request.resource.data.authorId == resource.data.authorId
         && request.resource.data.courseKey == resource.data.courseKey
         && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['helpfulBy']))
        || (kuVerified()
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['helpfulBy'])
            && request.resource.data.helpfulBy.size()
                 == resource.data.get('helpfulBy', []).size() + 1
            && request.resource.data.helpfulBy.hasAll(resource.data.get('helpfulBy', []))
            && request.resource.data.helpfulBy.hasAny([request.auth.uid])
            && !resource.data.get('helpfulBy', []).hasAny([request.auth.uid])));
  allow delete: if signedIn() && resource.data.authorId == request.auth.uid;
}

// Per-course roll-up maintained client-side in the same transaction as a
// review write (Phase 1 has no Cloud Functions). Trust-based write, same tier
// as `transactions`; Phase 2 replaces it with a Function-authored aggregate.
match /course_stats/{courseKey} {
  allow read: if kuDomain();
  allow write: if kuVerified();
}
```

- [ ] **Step 4: Run to green**

Run: `bash tools/test_rules.sh`
Expected: all pass (was ~92, now ~104).

- [ ] **Step 5: Commit**

```bash
git add firestore.rules firestore-tests/rules.test.mjs
git commit -m "feat: Firestore rules for reviews + course_stats"
```

---

## Task 4: `ReviewService` — Firestore data layer

**Files:**
- Create: `lib/services/review_service.dart`
- Create: `test/services/review_service_test.dart`

**Interfaces:**
- Consumes: `Review` (Task 1), `CourseStats` (Task 2), a `FirebaseFirestore`.
- Produces:
  ```dart
  class ReviewService {
    ReviewService(FirebaseFirestore firestore);
    Stream<List<Review>> streamReviewsForCourse(String courseKey);      // ordered updatedAt desc
    Future<Review?> getMyReview(String courseKey, String uid);
    Future<CourseStats> getStats(String courseKey);                      // empty() if missing
    Stream<CourseStats> streamStats(String courseKey);
    /// Create or edit the caller's review AND update course_stats atomically.
    Future<void> submitReview(Review review);
    Future<void> deleteReview(Review review);
    /// Append `uid` to a review's helpfulBy (idempotent client-side).
    Future<void> markHelpful({required String reviewId, required String uid});
    /// Bump the post counters on course_stats (called from AppStore.addPost/deletePost).
    Future<void> bumpPostCount(String courseKey, {required bool isPastExam, required int delta});
  }
  ```
  `submitReview`/`deleteReview` run a `firestore.runTransaction`: read `course_stats/{courseKey}` and the existing `reviews/{review.id}` (for the `previous` on an edit), compute the new `CourseStats` via `applyReview`, then in the transaction `set` the review doc and `set` (merge) the stats doc.

- [ ] **Step 1: Write failing tests**

`test/services/review_service_test.dart` (uses `fake_cloud_firestore`):

```dart
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/review.dart';
import 'package:kyoto_exam_hub/models/course_stats.dart';
import 'package:kyoto_exam_hub/services/review_service.dart';

Review _review(String courseKey, String uid, {int rating = 4, Rakutan rakutan = Rakutan.raku}) {
  final now = DateTime(2024, 4, 1);
  return Review(
    id: Review.docId(courseKey, uid), courseKey: courseKey, courseName: '科目$courseKey',
    authorId: uid, authorName: '京大生_$uid', rating: rating, rakutan: rakutan,
    attendance: Attendance.light, grading: GradingStyle.examOnly,
    pastExam: PastExamUsefulness.asIs, bringIn: BringIn.na, comment: 'c',
    helpfulBy: const [], createdAt: now, updatedAt: now,
  );
}

void main() {
  test('submitReview writes the review and initialises course_stats', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1', rating: 5));
    expect((await db.doc('reviews/ck_u1').get()).exists, isTrue);
    final stats = await svc.getStats('ck');
    expect(stats.reviewCount, 1);
    expect(stats.ratingSum, 5);
    expect(stats.rakutanCounts['raku'], 1);
  });

  test('editing a review re-aggregates without double counting', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1', rating: 2, rakutan: Rakutan.muzu));
    await svc.submitReview(_review('ck', 'u1', rating: 5, rakutan: Rakutan.raku));
    final stats = await svc.getStats('ck');
    expect(stats.reviewCount, 1);
    expect(stats.ratingSum, 5);
    expect(stats.rakutanCounts['muzu'], 0);
    expect(stats.rakutanCounts['raku'], 1);
  });

  test('deleteReview decrements course_stats', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1'));
    await svc.submitReview(_review('ck', 'u2'));
    await svc.deleteReview(_review('ck', 'u2'));
    expect((await svc.getStats('ck')).reviewCount, 1);
    expect((await db.doc('reviews/ck_u2').get()).exists, isFalse);
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

  test('streamReviewsForCourse returns only that course, newest first', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1'));
    await svc.submitReview(_review('other', 'u1'));
    final list = await svc.streamReviewsForCourse('ck').first;
    expect(list.map((r) => r.courseKey).toSet(), {'ck'});
  });

  test('bumpPostCount updates the right counter', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.bumpPostCount('ck', isPastExam: true, delta: 1);
    await svc.bumpPostCount('ck', isPastExam: false, delta: 1);
    final s = await svc.getStats('ck');
    expect(s.pastExamPostCount, 1);
    expect(s.resourcePostCount, 1);
  });
}
```

- [ ] **Step 2: Run, watch fail**

Run: `flutter test test/services/review_service_test.dart`
Expected: FAIL — `review_service.dart` missing.

- [ ] **Step 3: Implement `lib/services/review_service.dart`**

- `_reviews` = `firestore.collection('reviews')`, `_stats` = `firestore.collection('course_stats')`.
- `streamReviewsForCourse`: `.where('courseKey', isEqualTo: courseKey).orderBy('updatedAt', descending: true).snapshots()` → map to `Review.fromMap`. (Add the composite index in Step 4.)
- `getMyReview`: `.doc(Review.docId(courseKey, uid)).get()` → `fromMap` or null.
- `getStats`: `.doc(courseKey).get()` → `CourseStats.fromMap` or `CourseStats.empty(courseKey)`.
- `submitReview(review)`:
  ```dart
  await _fs.runTransaction((tx) async {
    final statsRef = _stats.doc(review.courseKey);
    final reviewRef = _reviews.doc(review.id);
    final statsSnap = await tx.get(statsRef);
    final prevSnap = await tx.get(reviewRef);
    var stats = statsSnap.exists
        ? CourseStats.fromMap(statsSnap.data()!)
        : CourseStats.empty(review.courseKey);
    final previous = prevSnap.exists ? Review.fromMap(prevSnap.data()!) : null;
    stats = stats.applyReview(review, delta: 1, previous: previous);
    tx.set(reviewRef, review.toMap());
    tx.set(statsRef, stats.toMap(), SetOptions(merge: true));
  });
  ```
- `deleteReview`: same shape, `stats.applyReview(review, delta: -1)`, `tx.delete(reviewRef)`, `tx.set(statsRef, ...)`.
- `markHelpful`: a transaction that reads the review, returns early if `helpfulBy` already contains `uid`, else `tx.update(reviewRef, {'helpfulBy': FieldValue.arrayUnion([uid])})`. (Rules require an exact +1 append of the caller's own uid; `arrayUnion` of a single new uid produces exactly that.)
- `bumpPostCount`: `_stats.doc(courseKey).set({ 'courseKey': courseKey, 'university_id': 'kyoto_u', isPastExam ? 'pastExamPostCount' : 'resourcePostCount': FieldValue.increment(delta) }, SetOptions(merge: true))`.

- [ ] **Step 4: Add the composite index**

`firestore.indexes.json` — add to `indexes`:
```json
{ "collectionGroup": "reviews", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "courseKey", "order": "ASCENDING" },
              { "fieldPath": "updatedAt", "order": "DESCENDING" } ] }
```
(`fake_cloud_firestore` ignores indexes, so tests pass without it; the deploy needs it. Note in the report: `firebase deploy --only firestore:indexes` is part of the deploy.)

- [ ] **Step 5: Run to green**

Run: `flutter test test/services/review_service_test.dart`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/services/review_service.dart test/services/review_service_test.dart firestore.indexes.json
git commit -m "feat: ReviewService — transactional review + course_stats writes"
```

---

## Task 5: `AppStore` wiring

**Files:**
- Modify: `lib/services/app_store.dart`
- Modify: `lib/main.dart` (construct `ReviewService`, pass to `AppStore`)
- Test: none new — `AppStore` has no unit tests; verified via `flutter analyze` + the widget wiring in later tasks.

**Interfaces:**
- Consumes: `ReviewService` (Task 4).
- Produces on `AppStore`:
  ```dart
  final ReviewService reviews;                 // constructor-injected, public
  Future<bool> submitReview({ required String courseKey, required String courseName,
      required int rating, required Rakutan rakutan, required Attendance attendance,
      required GradingStyle grading, required PastExamUsefulness pastExam,
      required BringIn bringIn, required String comment,
      String? termTaken, String? gradeTaken });
  Future<void> deleteMyReview(String courseKey);
  Future<void> markReviewHelpful(String reviewId);
  ```
  `submitReview` builds a `Review` (id via `Review.docId`, `authorId`/`authorName` from `currentUser`, `createdAt` preserved from an existing review if editing else now, `updatedAt` now), calls `reviews.submitReview(...)`, sets `lastNoticeMessage`, `notifyListeners()`, returns `false` with a message if `currentUser == null` or `!currentUser.isVerified`.

- [ ] **Step 1: `main.dart`**

Change `AppStore(CourseRepository(FirebaseFirestore.instance))` → `AppStore(CourseRepository(FirebaseFirestore.instance), ReviewService(FirebaseFirestore.instance))`. Add the import.

- [ ] **Step 2: `AppStore` constructor + fields**

`AppStore(this.courses, this.reviews) { _initFirebaseSync(); }`, add `final ReviewService reviews;`.

- [ ] **Step 3: Add the three methods**

```dart
Future<bool> submitReview({required String courseKey, required String courseName,
    required int rating, required Rakutan rakutan, required Attendance attendance,
    required GradingStyle grading, required PastExamUsefulness pastExam,
    required BringIn bringIn, required String comment,
    String? termTaken, String? gradeTaken}) async {
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
    courseKey: courseKey, courseName: courseName,
    authorId: user.uid, authorName: user.displayName,
    rating: rating, rakutan: rakutan, attendance: attendance, grading: grading,
    pastExam: pastExam, bringIn: bringIn, comment: comment.trim(),
    termTaken: termTaken, gradeTaken: gradeTaken,
    helpfulBy: existing?.helpfulBy ?? const [],
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  );
  try {
    await reviews.submitReview(review);
    lastNoticeMessage = existing == null ? 'レビューを投稿しました！' : 'レビューを更新しました。';
    notifyListeners();
    return true;
  } catch (e) {
    lastNoticeMessage = 'レビューの保存に失敗しました。通信環境を確認してください。';
    notifyListeners();
    return false;
  }
}

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

Future<void> markReviewHelpful(String reviewId) async {
  final user = currentUser;
  if (user == null || !user.isVerified) return;
  try {
    await reviews.markHelpful(reviewId: reviewId, uid: user.uid);
  } catch (_) {/* best-effort */}
  notifyListeners();
}
```

- [ ] **Step 4: analyze + full test**

Run: `flutter analyze` — 0 errors.
Run: `flutter test` — all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/app_store.dart lib/main.dart
git commit -m "feat: AppStore review actions (submit/delete/markHelpful)"
```

---

## Task 6: `ReviewFormSheet` — the structured-field modal

**Files:**
- Create: `lib/views/course/review_form_sheet.dart`

**Interfaces:**
- Consumes: `AppStore.submitReview` (Task 5), the Task 1 enums, an optional existing `Review` to prefill.
- Produces:
  ```dart
  Future<bool?> showReviewFormSheet(BuildContext context, {
    required AppStore store, required String courseKey, required String courseName,
    Review? existing });   // returns true if a review was saved
  ```

- [ ] **Step 1: Build the sheet**

A `showModalBottomSheet(isScrollControlled: true, ...)` matching the style of the existing `_showAddPostModal` in the course screen (rounded top, `StatefulBuilder`, `MediaQuery.viewInsets.bottom` padding). Fields, top to bottom:
- **おすすめ度**: a 5-star row (`Icons.star` / `star_border`), tap to set `rating` 1..5. Required (default null → submit disabled).
- **楽単度 / 出席 / 成績のつけ方 / 過去問の効き / 持ち込み**: each a horizontal `Wrap` of `ChoiceChip`s, one per enum value, `label` = the enum's `.label`. Each required (default to the enum's middle value is acceptable — pre-select `Rakutan.futsu`, `Attendance.light`, `GradingStyle.examReport`, `PastExamUsefulness.trendOnly`, `BringIn.na`).
- **コメント**: multiline `TextField`, `maxLength: 500`, hint "任意。授業の雰囲気、テストの傾向、注意点など".
- **履修時期・成績（任意）**: two small side-by-side `TextField`s (`termTaken` free text hint "2024前期", `gradeTaken` free text hint "A"). Both optional.
- Buttons: キャンセル / 「投稿する」(or 「更新する」if `existing != null`). Submit disabled while `rating == null`.

On submit: `final ok = await store.submitReview(courseKey: courseKey, rating: rating!, rakutan: ..., ...);` then if `mounted` show `SnackBar(store.lastNoticeMessage)` and `Navigator.pop(context, ok)`.

If `existing != null`: prefill every field from it; also show a テキストボタン「レビューを削除」that calls `store.deleteMyReview(courseKey)` behind an `AlertDialog` confirm, then `Navigator.pop(context, true)`.

- [ ] **Step 2: analyze**

Run: `flutter analyze` — 0 errors. (No unit test — this is a stateful widget with no isolatable logic; it's exercised by the manual pass in Task 9.)

- [ ] **Step 3: Commit**

```bash
git add lib/views/course/review_form_sheet.dart
git commit -m "feat: review form modal (structured fields)"
```

---

## Task 7: `CourseReviewTab`

**Files:**
- Create: `lib/views/course/course_review_tab.dart`

**Interfaces:**
- Consumes: `AppStore` (`reviews.streamReviewsForCourse`, `reviews.streamStats`, `submitReview`, `markReviewHelpful`), `showReviewFormSheet` (Task 6), `Subject` (for `courseKey` + `name`), the models.
- Produces: `class CourseReviewTab extends StatelessWidget { const CourseReviewTab({required this.store, required this.subject}); }`

- [ ] **Step 1: Build the tab**

A `Column` / `ListView` with:
1. **Summary card** — `StreamBuilder<CourseStats>(stream: store.reviews.streamStats(subject.courseKey))`:
   - big `avgRating` number + a 5-star display + `'(${stats.reviewCount}件)'`
   - a **楽単スコア** chip: `stats.rakutanScore.round()` /100, colour-graded (green ≥ 66, amber 33–65, red < 33)
   - **distribution bars** for 楽単度 / 出席 / 成績のつけ方 / 過去問の効き / 持ち込み: for each enum, a stacked horizontal bar or a row of `label: ▓▓▓░░ n` from the matching `*Counts` map (helper `_distRow(String title, Map<String,int> counts, List<(String label, String key)> order)`).
   - when `reviewCount == 0`: "まだレビューがありません。最初のレビューを書きましょう！"
2. **"自分のレビューを書く / 編集する" button** — `StreamBuilder` or a `FutureBuilder<Review?>(store.reviews.getMyReview(courseKey, uid))`: if the viewer has no review → primary button 「レビューを書く」; if they have one → outline button 「自分のレビューを編集」. Tapping opens `showReviewFormSheet(context, store: store, courseKey: ..., courseName: ..., existing: myReview)`. If `!store.currentUser!.isVerified`, show the button disabled with hint 「メール認証後に投稿できます」.
3. **Review list** — `StreamBuilder<List<Review>>(stream: store.reviews.streamReviewsForCourse(subject.courseKey))`:
   - each review a `Card`: star row + `rating`, then the five enum labels as small grey chips, then `comment` (if non-empty), then a footer row: `review.authorName`・`termTaken`(if set)・relative date, and a **役に立った** `TextButton.icon(Icons.thumb_up_outlined, '${review.helpfulCount}')`. The button is filled/active when `review.helpfulBy.contains(uid)`; tapping when not already helpful calls `store.markReviewHelpful(review.id)`. The viewer's own review is pinned to the top with an "あなたのレビュー" badge and an edit affordance.
   - empty list → the same "まだレビューがありません" message.

- [ ] **Step 2: analyze**

Run: `flutter analyze` — 0 errors.

- [ ] **Step 3: Commit**

```bash
git add lib/views/course/course_review_tab.dart
git commit -m "feat: course review tab (summary + list + helpful)"
```

---

## Task 8: `CourseResourceTab` + post-count bumps

**Files:**
- Create: `lib/views/course/course_resource_tab.dart`
- Modify: `lib/services/app_store.dart` (`addPost`/`deletePost` → also `reviews.bumpPostCount`)

**Interfaces:**
- Consumes: everything `course_detail_screen.dart`'s current `_buildTabContent`, `_showAddPostModal`, `_showAddRequestModal`, `_showDownloadConfirmDialog`, `_showReportDialog`, `_buildDocumentPreviewThumbnail` use.
- Produces: `class CourseResourceTab extends StatefulWidget { const CourseResourceTab({required this.store, required this.subject}); }` — renders **all** posts for the course (`pastExam` + `testPrep` + `other`) in one list with a category chip on each, plus the "投稿" / "リクエスト" actions.

- [ ] **Step 1: Move the resource UI**

Cut `_buildTabContent`, `_showAddPostModal`, `_showAddRequestModal`, `_showDownloadConfirmDialog`, `_showReportDialog`, `_buildDocumentPreviewThumbnail` (and their helpers) out of `course_detail_screen.dart` into `course_resource_tab.dart` as methods of `_CourseResourceTabState`. Generalise the list: instead of one `PostCategory`, show `store.getPostsForSubject(subject.id, cat)` for all three categories merged and sorted by `createdAt desc`, each card carrying a small chip with `post.category.label`. Keep the post modal's category picker (a segmented control: 過去問 / テスト対策 / その他) so uploads still choose a category — the model and the `pastExam`-year/dedup/cost logic are unchanged.
- Requests area: keep as-is but merged across categories the same way.

- [ ] **Step 2: post-count bumps**

In `AppStore.addPost(...)`, after the successful `_firestore.createPost(newPost)`:
```dart
reviews.bumpPostCount(
  Kulasis-free: use the course's courseKey — resolve it:
  (await courses.byId(subjectId))?.courseKey ?? '',
  isPastExam: category == PostCategory.pastExam, delta: 1,
).catchError((_) {});
```
Skip the bump when `courseKey` resolves to `''`. Do the mirror `delta: -1` in `deletePost`. (These feed the "過去問が多い科目" ranking in Plan B; a missed bump only skews a ranking, never breaks a flow — hence fire-and-forget.)

- [ ] **Step 3: analyze + test**

Run: `flutter analyze` — 0 errors. `flutter test` — all pass.

- [ ] **Step 4: Commit**

```bash
git add lib/views/course/course_resource_tab.dart lib/services/app_store.dart
git commit -m "feat: single resource tab (all post categories) + course_stats post counts"
```

---

## Task 9: `CourseDetailScreen` → 2-tab shell

**Files:**
- Modify: `lib/views/course/course_detail_screen.dart`

**Interfaces:**
- Consumes: `CourseReviewTab` (Task 7), `CourseResourceTab` (Task 8).
- Produces: the same public `CourseDetailScreen({required store, required subject})`, now a thin shell.

- [ ] **Step 1: Reduce the screen**

`_tabController = TabController(length: 2, ...)`. `AppBar.bottom` = `TabBar(tabs: const [Tab(text: 'レビュー'), Tab(text: '過去問・資料')])`. Body = `TabBarView(children: [CourseReviewTab(store: widget.store, subject: widget.subject), CourseResourceTab(store: widget.store, subject: widget.subject)])`. Default to the **レビュー** tab (index 0). Delete everything now living in the two tab files. The app-bar title (name + faculty・slot・lecturer) stays.

- [ ] **Step 2: analyze + build**

Run: `flutter analyze` — 0 errors.
Run: `flutter build web --debug` — clean compile.
Run: `flutter test` — all pass.

- [ ] **Step 3: Manual pass**

Run: `flutter run -d chrome`, sign in (verified account), open a course: レビュー tab shows the empty state → write a review (all fields) → it appears, summary updates, 楽単スコア renders → edit it → delete it. 過去問・資料 tab: upload a テスト対策 post → it shows with a chip alongside any 過去問. With an unverified account: レビュー button is disabled with the hint.

- [ ] **Step 4: Commit**

```bash
git add lib/views/course/course_detail_screen.dart
git commit -m "refactor: course detail is a 2-tab shell (レビュー / 過去問・資料)"
```

---

## Task 10: Contribution score on マイページ

**Files:**
- Modify: `lib/views/mypage/my_page_screen.dart`
- Modify: `lib/services/review_service.dart` (add `streamMyReviews(uid)` + `myHelpfulTotal(uid)`)

**Interfaces:**
- Consumes: `ReviewService`.
- Produces: `Stream<List<Review>> streamMyReviews(String uid)` (`where('authorId', ==, uid)`); the マイページ shows レビュー数 + received 役に立った total + a simple badge (`貢献者` at ≥ 5 reviews or ≥ 10 helpful, `トップ貢献者` at ≥ 20 / ≥ 50).

- [ ] **Step 1: Service method + index**

`streamMyReviews`: `_reviews.where('authorId', isEqualTo: uid).snapshots()` → list. Add the single-field index note (Firestore auto-creates single-field; no `firestore.indexes.json` change).

- [ ] **Step 2: マイページ section**

Under the points card, a "あなたの貢献" card: `StreamBuilder<List<Review>>(streamMyReviews(uid))` → `'レビュー ${list.length}件'`, `'受け取った「役に立った」 ${list.fold(0, (a, r) => a + r.helpfulCount)}'`, and a badge chip computed from those two numbers. Below it, a collapsible list of the viewer's own reviews (course name via `store.courses.byId(...courseKey...)` — note `byId` takes a Subject id, not courseKey; instead show `review.courseKey.split('|').first` as a readable-ish label, or store a `courseName` on the Review at write time — **decision: add `courseName` to the `Review` model in Task 1** … see Self-Review note).

- [ ] **Step 3: analyze + test + commit**

Run: `flutter analyze` / `flutter test` — green.

```bash
git add lib/views/mypage/my_page_screen.dart lib/services/review_service.dart
git commit -m "feat: contribution score + my-reviews on マイページ"
```

---

## Self-Review

**1. Spec coverage (§4.2 授業情報層):**
- Structured fields (おすすめ度/楽単度/出席/成績/過去問の効き/持ち込み/コメント/履修時期) → Task 1 enums + Task 6 form. ✅
- 1 review per user per course, editable → doc id `courseKey_uid` (Task 1, Task 3 rule). ✅
- Aggregated display (distribution bars + averages + 楽単スコア) → Task 2 `CourseStats` + Task 7 summary card. ✅
- 「役に立った」+ contribution score → Task 7 button + Task 3 helpfulBy rule + Task 10. ✅
- Attach to courseKey not slot → every task keys on `courseKey`. ✅
- 投稿・閲覧無料 → no points/credit code touched; Global Constraints. ✅
- 科目詳細を2タブに再編, drop testPrep/other split → Tasks 8–9. ✅
- Moderation (通報→非表示) — reviews are opinions; §4.2 says "軽め". **Gap:** this plan adds no review report/hide. Deferred to Plan B or Phase 2 (the `posts` report machinery exists; a `reviews` equivalent is a small follow-on). Noted, not in scope.
- Seeding 100–150 主要科目 reviews → **not a code task.** The founder writes them through the app after this ships. A `tools/seed_reviews.mjs` (admin, from a hand-filled JSON) would speed it — deferred, flag for the user.

**2. Placeholder scan:** Tasks 7–10 describe widget structure rather than full widget code — acceptable per the plan's stated approach (data layer gets full code; widgets get concrete field lists + exact store/service call names + the existing pattern to follow). No "TBD"/"handle errors appropriately". Task 10 Step 2 surfaces a real decision (courseName on Review) rather than hand-waving it → **fix inline: add `final String courseName;` to the `Review` model in Task 1** (write-time denormalisation; `submitReview` in Task 5 passes `courseName` from the `Subject`; `CourseReviewTab`/form already have the `Subject`). Update Task 1's Interfaces, test, and `toMap`/`fromMap`; update Task 5's `submitReview` signature to take `courseName` and AppStore's callers (Task 7) to pass `subject.name`.

**3. Type consistency:** `courseKey` (String) used identically across all tasks. `Review.docId(courseKey, uid)` defined Task 1, used Tasks 3/4/5. `CourseStats.applyReview(review, {delta, previous})` — Task 2 signature matches Task 4 usage. `ReviewService` method names identical in the Task 4 Interfaces block and Tasks 5/7/8/10. Enum value strings: Task 1 defines them, Task 2's `CourseStats` maps key on `enum.value`, Task 3's `reviewDoc` fixture must use the same strings — **note in Task 3: the fixture's enum strings must match `Rakutan.raku.value` etc. exactly.**

Fixes applied inline above: `courseName` added to `Review` (Task 1/5/10); Task 3 fixture-string note.

---

## After Plan A

Plan B (`docs/superpowers/plans/2026-09-08-review-layer-b-discovery.md`, written after Plan A lands so it can consume the real `CourseStats` shape): the **さがす tab** + 楽単/レビュー数/過去問数/新着 rankings querying `course_stats`, **bottom-nav reorg** (さがす / 時間割 / マイページ; 参考書 hidden; お問い合わせ → マイページ), the **bell icon + minimal notifications**, and the 全学共通 **系列** question (the course data has no series field — Plan B either does a lightweight keyword classification or ships faculty-only rankings).

Deploy note: this plan adds `firestore:indexes` (Task 4) and `firestore:rules` (Task 3) changes — the production deploy for the review layer is `firebase deploy --only firestore:rules,firestore:indexes,hosting`.

---

## Deploy

The four artefacts of this branch (indexes, rules, the web build, the one-off
backfill) are **order-dependent**. Run them in exactly this order:

```
1. firebase deploy --only firestore:indexes --project kyodai-sns
   # then WAIT: the reviews composite index (courseKey ASC, updatedAt DESC)
   # must read READY in the Firebase console before step 3.

2. firebase deploy --only firestore:rules --project kyodai-sns
   # purely additive: two new match blocks (reviews, course_stats) inserted
   # before the unchanged catch-all deny. No existing collection's rule changes,
   # so this is safe to land ahead of the client.

3. flutter build web --release && firebase deploy --only hosting --project kyodai-sns

4. cd tools && node backfill_post_counts.mjs --project kyodai-sns --dry-run
   # inspect the reported per-course totals, THEN:
   cd tools && node backfill_post_counts.mjs --project kyodai-sns
   # run once. It is an authoritative recount (plain ints, not increments), so a
   # re-run recomputes the same totals — but it will lose any bump that lands
   # between its read and its write, so do not leave it running on a schedule.
```

**Never ship hosting (3) before 1 and 2 have finished.**

- New build against the OLD rules → every review operation fails with
  `PERMISSION_DENIED`: the `reviews` and `course_stats` collections fall through
  to the catch-all deny, so the レビュー tab is dead for every user until the
  rules land.
- New build against a still-BUILDING index → `streamReviewsForCourse` fails with
  `FAILED_PRECONDITION` (the `where('courseKey') + orderBy('updatedAt')` query
  needs the composite index), so the review list errors on every course while the
  summary card still works — a confusing half-broken state.

Step 4 is last because it recounts from `posts`, and a recount taken before the
client that maintains the counters is live would be overwritten by nothing —
harmless, but it would have to be re-run anyway.

**Rollback:** re-deploy the previous hosting release. The rules and indexes can
stay: they are additive, and nothing outside the review layer reads them.
