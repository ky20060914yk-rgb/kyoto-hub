# Review Layer — Plan B: さがすタブ + 楽単ランキング + ナビ再編

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app a discovery front door — a "さがす" tab with course search plus four rankings (楽単 / レビューが多い / 過去問が多い / 新着レビュー) computed from `course_stats`, and collapse the bottom nav from four items to three (さがす / 時間割 / マイページ; 参考書 and お問い合わせ leave the tab bar).

**Architecture:** Rankings run off `course_stats` (built in Plan A). `CourseStats` gains a stored integer `score` (the previously-getter-only `rakutanScore`, rounded) so it can be ordered/filtered without reading every doc. A `RankingService` fetches a bounded pool (`course_stats` ordered by `reviewCount desc`, `limit ~200`) and ranks that pool client-side four ways — no pile of composite indexes, correct at Phase-1 volume (hundreds of reviewed courses, not thousands). The さがす screen joins each ranked `courseKey` against the in-memory `CourseRepository` catalog (new `byCourseKey` lookup) for the display name + faculty, and filters by faculty client-side. `navigation_root_screen.dart`'s `IndexedStack` drops to three screens; `TextbookLendingScreen` and `ContactScreen` stay in the codebase but are reached from elsewhere (お問い合わせ moves into マイページ; 参考書 is unlinked for Phase 1).

**Tech Stack:** Flutter 3.41.9 / Dart ^3.11.5, Firebase (Auth, Firestore) project `kyodai-sns`. Tests: `flutter test` (+ `fake_cloud_firestore`), `bash tools/test_rules.sh`.

**Spec:** `docs/specs/2026-09-07-kyodai-info-redesign-design.md` §4.1 (下タブ再編), §4.2 (「さがす」タブ + 楽単ランキング).

## Global Constraints

- Flutter `3.41.9`; Dart `^3.11.5`. No new pub dependencies. No Cloud Functions / no Blaze.
- Every Firestore doc carries `university_id: 'kyoto_u'`.
- **Rankings are read-only over `course_stats`** — this plan adds no new write path and no rules change for `course_stats`/`reviews` (Plan A's rules stand). The only rules touch is optional (Task 7, notifications) and that task may be cut.
- **全学共通「系列」ranking is out of scope** — the course catalog has no series field (Phase 1a data limitation). Rankings filter by `faculty` only; a "系列別" view is a Phase 2 item once the syllabus scrape adds series.
- `course_stats` docs only exist for courses with ≥ 1 review or ≥ 1 post-count bump. A course with no activity simply isn't in any ranking — that's correct.
- Plan A is merged to `master` but **not deployed**, so there are zero `course_stats` docs in production: the new `score` field needs no backfill (every doc is created fresh by Plan A's transaction once it ships).
- Match existing style: `ChangeNotifier` `AppStore`, `setState` screens, brand colour `Color(0xFF0F4C81)`, `IndexedStack` nav.
- Commit after every task. TDD: failing test first.

---

## File Structure

**Created:**
- `lib/services/ranking_service.dart` — the bounded-pool fetch + the four client-side rankings.
- `lib/views/search/search_screen.dart` — the さがす tab: search field + faculty filter + ranking sections.
- `test/services/ranking_service_test.dart`

**Modified:**
- `lib/models/course_stats.dart` — `score` becomes a stored `final int` field (was the `rakutanScore` getter); `toMap` writes it, `fromMap` reads it, `_apply` recomputes it. `rakutanScore` getter kept as an alias for callers that want the live value.
- `lib/repositories/course_repository.dart` — add `Subject? byCourseKey(String courseKey)` + a `_byCourseKey` index populated in `_load`/`_remember`/`addCustomCourse`.
- `lib/views/navigation_root_screen.dart` — `IndexedStack` → `[SearchScreen, HomeScreen, MyPageScreen]`; bottom nav → 3 items (さがす / 時間割 / マイページ).
- `lib/views/mypage/my_page_screen.dart` — an "お問い合わせ" list row that pushes `ContactScreen`.
- `lib/views/home/home_screen.dart` — the tab label context changes to 時間割; the in-page search bar may stay (harmless) — leave it unless it fights the layout.
- `firestore.indexes.json` — the `course_stats (reviewCount DESC)` ordering is single-field (auto-indexed both directions); confirm no composite is needed (Task 3 verifies).

---

## Task 1: `CourseStats.score` — store the 楽単スコア

**Files:**
- Modify: `lib/models/course_stats.dart`
- Modify: `test/models/course_stats_test.dart`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CourseStats` gains `final int score;` — the `rakutanScore.round()` at the time of the last `applyReview`, stored so a query can `orderBy('score')`. `toMap()` emits `'score': score`; `fromMap()` reads `score: _nonNeg(map['score'])` (finite-guarded, ≥ 0); `applyReview` sets `score` on the returned instance to the new `rakutanScore.round()`. `CourseStats.empty()` → `score: 50`. The `double get rakutanScore` getter stays (live recompute; `score` is its rounded snapshot).

- [ ] **Step 1: Write the failing test**

Add to `test/models/course_stats_test.dart`:

```dart
test('score is stored, equals rakutanScore.round(), and survives toMap/fromMap', () {
  var s = CourseStats.empty('ck');
  expect(s.score, 50);
  s = s.applyReview(_r('u1', rating: 5, rakutan: Rakutan.raku), delta: 1);
  expect(s.score, s.rakutanScore.round());
  expect(s.score, greaterThan(50));
  final back = CourseStats.fromMap(s.toMap());
  expect(back.score, s.score);
});

test('score recomputes when a review is removed', () {
  var s = CourseStats.empty('ck')
      .applyReview(_r('u1', rating: 5, rakutan: Rakutan.raku), delta: 1)
      .applyReview(_r('u2', rating: 1, rakutan: Rakutan.muzu), delta: 1);
  final twoReviewScore = s.score;
  s = s.applyReview(_r('u2', rating: 1, rakutan: Rakutan.muzu), delta: -1);
  expect(s.score, isNot(twoReviewScore));
  expect(s.score, s.rakutanScore.round());
});

test('fromMap clamps a negative/NaN score to a sane value', () {
  expect(CourseStats.fromMap({'score': -5}).score, 0);
  expect(CourseStats.fromMap({'score': double.nan}).score, 0);
  expect(CourseStats.fromMap({}).score, anyOf(0, 50)); // default when absent — pick one and assert it
});
```

- [ ] **Step 2: Run, watch fail**

Run: `flutter test test/models/course_stats_test.dart`
Expected: FAIL — no `score` field.

- [ ] **Step 3: Implement**

- Add `final int score;` to the constructor (default `50` is fine for the `empty` path; make it a required or defaulted param).
- `empty(courseKey)` → pass `score: 50`.
- `_apply(...)` (the internal method that returns a new `CourseStats` after add/remove): after building the new instance, its `score` must be the new `rakutanScore.round()`. Simplest: compute the new stats object first, then `return newStats.copyWith(score: newStats.rakutanScore.round())` — or thread `score` through the constructor call using a temporary. Ensure `_apply` with `delta: 0`-ish edge (edit swap) also lands the right score.
- `toMap()` — add `'score': score`. (This is written on every review transaction; `bumpPostCount` still doesn't touch it, which is correct — `rakutanScore` doesn't depend on post counts.)
- `fromMap()` — `score: _nonNeg(map['score'] ?? 50)` (reuse the existing `_nonNeg` finite-guard; decide the absent default — recommend `50`, the neutral score, and assert that in Step 1's third test).
- If `CourseStats` has no `copyWith`, add a minimal one or thread `score` through the existing constructor calls in `_apply`/`empty`.

- [ ] **Step 4: Run to green**

Run: `flutter test test/models/course_stats_test.dart` — all pass.
Run: `flutter test` — the full suite still green (Plan A's `course_stats` tests must not regress; `toMap` gains a key, `fromMap` tolerates its absence).

- [ ] **Step 5: Commit**

```bash
git add lib/models/course_stats.dart test/models/course_stats_test.dart
git commit -m "feat: store rakutanScore as course_stats.score for ranking queries"
```

---

## Task 2: `CourseRepository.byCourseKey`

**Files:**
- Modify: `lib/repositories/course_repository.dart`
- Modify: `test/repositories/course_repository_test.dart`

**Interfaces:**
- Consumes: the existing `_byId` cache + `Subject.courseKey`.
- Produces: `Subject? byCourseKey(String courseKey)` — **synchronous**, returns any one cached `Subject` whose `courseKey` matches (the catalog has several `Subject`s per courseKey, one per slot; any is fine for a ranking row's name/faculty), or `null` if the catalog isn't warm / no match. A `_byCourseKey` `Map<String, Subject>` built alongside `_byId` wherever the cache is populated (`_load`, `_remember` if that's the single insertion point, `addCustomCourse`).

- [ ] **Step 1: Write the failing test**

Add to `test/repositories/course_repository_test.dart` (the fixture seeds `courses` docs — reuse it):

```dart
test('byCourseKey returns a Subject for a known courseKey after warmUp', () async {
  final repo = CourseRepository(await _seededDb()); // whatever the file's helper is
  await repo.warmUp();
  final s = repo.byCourseKey('微分積分学a|山田太郎'); // a courseKey present in the fixture
  expect(s, isNotNull);
  expect(s!.courseKey, '微分積分学a|山田太郎');
});

test('byCourseKey returns null for an unknown courseKey and before warmUp', () async {
  final repo = CourseRepository(await _seededDb());
  expect(repo.byCourseKey('nope|nobody'), isNull); // not warm yet
  await repo.warmUp();
  expect(repo.byCourseKey('nope|nobody'), isNull);
});
```

(Adjust the courseKey strings + helper names to whatever `course_repository_test.dart` already uses.)

- [ ] **Step 2: Run, watch fail**

Run: `flutter test test/repositories/course_repository_test.dart`
Expected: FAIL — no `byCourseKey`.

- [ ] **Step 3: Implement**

- Add `final Map<String, Subject> _byCourseKey = {};`.
- Wherever a `Subject` enters `_byId` (find every `_byId[...] =` / `_byId.addAll` site), also do `_byCourseKey.putIfAbsent(subject.courseKey, () => subject)` (skip empty courseKeys). If there's a single `_remember(Subject)` helper, that's the one place.
- `Subject? byCourseKey(String courseKey) => _byCourseKey[courseKey];`
- Clear `_byCourseKey` wherever `_byId` is cleared (the `_load` refresh path).

- [ ] **Step 4: Run to green**

Run: `flutter test test/repositories/course_repository_test.dart` — pass.
Run: `flutter test` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/course_repository.dart test/repositories/course_repository_test.dart
git commit -m "feat: CourseRepository.byCourseKey lookup"
```

---

## Task 3: `RankingService`

**Files:**
- Create: `lib/services/ranking_service.dart`
- Create: `test/services/ranking_service_test.dart`
- Modify: `firestore.indexes.json` (only if Task verifies a composite is required — likely not)

**Interfaces:**
- Consumes: `CourseStats` (Task 1), a `FirebaseFirestore`.
- Produces:
  ```dart
  enum RankingKind { rakutan, mostReviewed, mostPastExams, recentlyReviewed }
  class RankingService {
    RankingService(FirebaseFirestore firestore);
    /// One bounded read. Pool = course_stats with reviewCount >= 1, ordered by
    /// reviewCount desc, capped at [poolLimit] (default 200). Cached for [ttl].
    Future<List<CourseStats>> pool({int poolLimit = 200});
    /// Ranks the pool for [kind]; returns the top [limit] CourseStats.
    Future<List<CourseStats>> ranking(RankingKind kind, {int limit = 30, int poolLimit = 200});
  }
  ```
  Ranking rules over the pool:
  - `rakutan`: courses with `reviewCount >= 3`, sorted by `score` desc, tie-break `reviewCount` desc.
  - `mostReviewed`: sorted by `reviewCount` desc.
  - `mostPastExams`: `pastExamPostCount > 0`, sorted by `pastExamPostCount` desc.
  - `recentlyReviewed`: `lastReviewAt != null`, sorted by `lastReviewAt` desc.
  `pool()` memoises its result for ~2 minutes (a `DateTime` + cached list) so opening the さがす tab and switching ranking tabs is one Firestore read, not four.

- [ ] **Step 1: Write failing tests**

`test/services/ranking_service_test.dart` (uses `fake_cloud_firestore`; seed `course_stats` docs directly):

```dart
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/course_stats.dart';
import 'package:kyoto_exam_hub/services/ranking_service.dart';

Future<FakeFirebaseFirestore> _db() async {
  final db = FakeFirebaseFirestore();
  Future<void> put(String ck, {required int reviews, required int score, int pastExams = 0, DateTime? last}) =>
      db.collection('course_stats').doc(ck).set({
        'courseKey': ck, 'university_id': 'kyoto_u',
        'reviewCount': reviews, 'ratingSum': reviews * 3, 'score': score,
        'pastExamPostCount': pastExams, 'resourcePostCount': 0,
        if (last != null) 'lastReviewAt': last.toIso8601String(),
      });
  await put('easy|a', reviews: 10, score: 90, pastExams: 2, last: DateTime(2024, 5, 1));
  await put('hard|b', reviews: 8, score: 20, pastExams: 5, last: DateTime(2024, 6, 1));
  await put('thin|c', reviews: 2, score: 99, last: DateTime(2024, 4, 1)); // below the reviewCount>=3 floor
  await put('quiet|d', reviews: 1, score: 55);
  return db;
}

void main() {
  test('rakutan ranking respects the reviewCount>=3 floor and sorts by score', () async {
    final r = RankingService(await _db());
    final list = await r.ranking(RankingKind.rakutan);
    expect(list.map((s) => s.courseKey), ['easy|a', 'hard|b']); // thin|c excluded, quiet|d excluded
  });
  test('mostReviewed sorts by reviewCount desc', () async {
    final r = RankingService(await _db());
    final list = await r.ranking(RankingKind.mostReviewed);
    expect(list.first.courseKey, 'easy|a');
    expect(list.map((s) => s.courseKey), containsAllInOrder(['easy|a', 'hard|b', 'thin|c', 'quiet|d']));
  });
  test('mostPastExams excludes zero and sorts desc', () async {
    final r = RankingService(await _db());
    final list = await r.ranking(RankingKind.mostPastExams);
    expect(list.map((s) => s.courseKey), ['hard|b', 'easy|a']);
  });
  test('recentlyReviewed sorts by lastReviewAt desc, nulls excluded', () async {
    final r = RankingService(await _db());
    final list = await r.ranking(RankingKind.recentlyReviewed);
    expect(list.map((s) => s.courseKey), ['hard|b', 'easy|a', 'thin|c']); // quiet|d has no lastReviewAt
  });
  test('pool is read once and memoised', () async {
    final db = await _db();
    final r = RankingService(db);
    await r.ranking(RankingKind.rakutan);
    await db.collection('course_stats').doc('easy|a').set({'reviewCount': 999}, SetOptions(merge: true));
    final again = await r.ranking(RankingKind.mostReviewed);
    expect(again.first.courseKey, 'easy|a'); // still 10, not 999 — served from the memoised pool
  });
}
```

- [ ] **Step 2: Run, watch fail**

Run: `flutter test test/services/ranking_service_test.dart`
Expected: FAIL — no `ranking_service.dart`.

- [ ] **Step 3: Implement `lib/services/ranking_service.dart`**

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/course_stats.dart';

enum RankingKind { rakutan, mostReviewed, mostPastExams, recentlyReviewed }

class RankingService {
  RankingService(this._db);
  final FirebaseFirestore _db;

  List<CourseStats>? _pool;
  DateTime? _pooledAt;
  static const _ttl = Duration(minutes: 2);

  Future<List<CourseStats>> pool({int poolLimit = 200}) async {
    final now = DateTime.now();
    if (_pool != null && _pooledAt != null && now.difference(_pooledAt!) < _ttl) {
      return _pool!;
    }
    final snap = await _db
        .collection('course_stats')
        .where('reviewCount', isGreaterThanOrEqualTo: 1)
        .orderBy('reviewCount', descending: true)
        .limit(poolLimit)
        .get();
    _pool = snap.docs.map((d) => CourseStats.fromMap(d.data())).toList();
    _pooledAt = now;
    return _pool!;
  }

  Future<List<CourseStats>> ranking(RankingKind kind,
      {int limit = 30, int poolLimit = 200}) async {
    final p = List<CourseStats>.from(await pool(poolLimit: poolLimit));
    switch (kind) {
      case RankingKind.rakutan:
        p.removeWhere((s) => s.reviewCount < 3);
        p.sort((a, b) => b.score != a.score
            ? b.score.compareTo(a.score)
            : b.reviewCount.compareTo(a.reviewCount));
      case RankingKind.mostReviewed:
        p.sort((a, b) => b.reviewCount.compareTo(a.reviewCount));
      case RankingKind.mostPastExams:
        p.removeWhere((s) => s.pastExamPostCount <= 0);
        p.sort((a, b) => b.pastExamPostCount.compareTo(a.pastExamPostCount));
      case RankingKind.recentlyReviewed:
        p.removeWhere((s) => s.lastReviewAt == null);
        p.sort((a, b) => b.lastReviewAt!.compareTo(a.lastReviewAt!));
    }
    return p.take(limit).toList();
  }
}
```

- [ ] **Step 4: Index check**

`where('reviewCount', >=, 1).orderBy('reviewCount', desc)` is an inequality + orderBy on the **same single field** → Firestore serves it from the automatic single-field index, no composite needed. Confirm `firestore.indexes.json` needs no change; note it in the report. (If a later ranking ever adds a second `orderBy` on a different field, that one needs a composite — not this plan.)

- [ ] **Step 5: Run to green**

Run: `flutter test test/services/ranking_service_test.dart` — 5 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/services/ranking_service.dart test/services/ranking_service_test.dart
git commit -m "feat: RankingService — bounded pool + four client-side rankings"
```

---

## Task 4: wire `RankingService` into `AppStore`

**Files:**
- Modify: `lib/services/app_store.dart`
- Modify: `lib/main.dart`

**Interfaces:**
- Consumes: `RankingService` (Task 3).
- Produces: `AppStore` gains `final RankingService ranking;` (constructor-injected, public), constructed in `main.dart` as the third service arg. No methods — screens call `store.ranking.ranking(...)` directly.

- [ ] **Step 1: `main.dart`**

`AppStore(CourseRepository(FirebaseFirestore.instance), ReviewService(FirebaseFirestore.instance), RankingService(FirebaseFirestore.instance))` + import.

- [ ] **Step 2: `AppStore`**

Constructor → `AppStore(this.courses, this.reviews, this.ranking) { _initFirebaseSync(); }`; add `final RankingService ranking;` + import.

- [ ] **Step 3: analyze + test**

Run: `flutter analyze` — 0 errors. `flutter test` — green. `flutter build web --debug` — clean.

- [ ] **Step 4: Commit**

```bash
git add lib/services/app_store.dart lib/main.dart
git commit -m "feat: inject RankingService into AppStore"
```

---

## Task 5: `SearchScreen` — the さがす tab

**Files:**
- Create: `lib/views/search/search_screen.dart`

**Interfaces:**
- Consumes: `AppStore` (`.courses.search`, `.courses.byCourseKey`, `.ranking`), `Subject`, `CourseStats`, `CourseDetailScreen` (`lib/views/course/course_detail_screen.dart` — `CourseDetailScreen({required store, required subject})`).
- Produces: `class SearchScreen extends StatefulWidget { const SearchScreen({super.key, required this.store}); }` — the new front-door tab.

- [ ] **Step 1: Build the screen**

A `Scaffold` (no app bar of its own — the nav shell provides the unverified banner; give it a simple title row) with a `ListView`:

1. **Search field** at the top (`TextField`, `Icons.search`, brand colour) — debounced ~250 ms; on non-empty query, `await store.courses.search(query)` into a `List<Subject> _results` and render them as `ListTile`s (name + `faculty • timeSlotLabel • lecturer`) → tap pushes `CourseDetailScreen(store: store, subject: sub)`. On empty query, show the rankings (below).

2. **Faculty filter** — a horizontal scrolling `Wrap`/`Row` of `ChoiceChip`s: `すべて` + the faculties present in the catalog. Selection filters BOTH the search results and the ranking rows (client-side, via `store.courses.byCourseKey(cs.courseKey)?.faculty`). Store the faculty list as a `const` (`['すべて','全学共通','工学部','法学部','経済学部','文学部','理学部','農学部','医学部/薬学部','総合人間学部','教育学部']`) — the catalog is ~99% 全学共通 today so most chips will be sparse, but the list is stable.

3. **Ranking sections** (shown when the search field is empty) — for each `RankingKind` a section:
   - a header (`楽単ランキング` / `レビューが多い科目` / `過去問が多い科目` / `新着レビュー`)
   - a `FutureBuilder<List<CourseStats>>(future: <held per-kind, created once in initState or lazily-memoised>, ...)` — **do not create the future in `build()`**. Hold a `Map<RankingKind, Future<List<CourseStats>>>` populated in `initState` (or on first section build) so a rebuild doesn't refetch. `RankingService.pool` memoises anyway, but the `Future` objects themselves must be stable.
   - each row: rank number + `store.courses.byCourseKey(cs.courseKey)` for the name (skip a row whose courseKey doesn't resolve to a catalog Subject — a stale `course_stats` doc) + the metric badge (楽単スコア / `${cs.reviewCount}件` / `過去問${cs.pastExamPostCount}` / relative date). Apply the faculty filter. Tap → `CourseDetailScreen`.
   - empty ranking → "まだ十分なデータがありません".
   - a 「もっと見る」 affordance is optional; `limit: 30` per section is plenty for Phase 1.

4. Pull-to-refresh (`RefreshIndicator`) that clears `RankingService`'s memoised pool (add a `RankingService.invalidate()` — one line) and rebuilds.

- [ ] **Step 2: analyze**

Run: `flutter analyze` — 0 errors, no `use_build_context_synchronously` (the `Navigator.push` calls are sync inside `onTap`).

- [ ] **Step 3: Commit**

```bash
git add lib/views/search/search_screen.dart lib/services/ranking_service.dart
git commit -m "feat: さがす tab — course search + four rankings + faculty filter"
```

---

## Task 6: bottom-nav reorg — 4 tabs → 3

**Files:**
- Modify: `lib/views/navigation_root_screen.dart`
- Modify: `lib/views/mypage/my_page_screen.dart`
- Modify: `lib/views/home/home_screen.dart` (label/context only)

**Interfaces:**
- Consumes: `SearchScreen` (Task 5), the existing `HomeScreen` / `MyPageScreen` / `ContactScreen` / `TextbookLendingScreen`.
- Produces: a 3-item bottom nav (`さがす` / `時間割` / `マイページ`); `ContactScreen` reachable from マイページ; `TextbookLendingScreen` kept in the tree but unlinked.

- [ ] **Step 1: `navigation_root_screen.dart`**

- `screens` → `[SearchScreen(store: widget.store), HomeScreen(key: _homeKey, store: widget.store), MyPageScreen(store: widget.store)]`.
- `BottomNavigationBar.items` → 3: `さがす` (`Icons.search` / `Icons.search_rounded`), `時間割` (`Icons.calendar_today_outlined` / `Icons.calendar_today_rounded`), `マイページ` (`Icons.person_outline` / `Icons.person_rounded`).
- `_currentIndex` default: `1` (時間割) — a returning user lands on their timetable; a first-time user with an empty timetable still sees the register prompt. (Or default `0` = さがす as the discovery front door — pick `0`, it matches the spec's "集客の玄関" framing. Decide and note it.)
- The `onTap` double-tap-home `resetSearch()` special-case: `HomeScreen` is now index 1 — update the index check, or drop the special-case (the search bar may be leaving HomeScreen).
- Remove the `TextbookLendingScreen` / `ContactScreen` imports if now unused here.

- [ ] **Step 2: `my_page_screen.dart`**

Add, near the bottom (after the contribution card / before or after 取引履歴), a simple section:
- an「お問い合わせ・不具合報告」`ListTile` (`Icons.help_outline_rounded`, brand colour, `Icons.chevron_right`) → `Navigator.push(context, MaterialPageRoute(builder: (_) => ContactScreen(store: widget.store)))`.
- optionally a「参考書の貸し借り」`ListTile` → `TextbookLendingScreen` (keeps the feature reachable during Phase 1 without a tab; **or** omit it entirely if the spec's "非表示" means fully hidden — recommend keeping a link so existing textbook threads aren't orphaned).

- [ ] **Step 3: `home_screen.dart`**

No structural change required. If the in-page search bar now feels redundant with the さがす tab, you may remove it, but only if that doesn't disturb the timetable grid layout — otherwise leave it. Note the decision in the report.

- [ ] **Step 4: analyze + test + build**

Run: `flutter analyze` — 0 errors. `flutter test` — green (the `test/widget_test.dart` placeholder and all model/service tests). `flutter build web --debug` — clean.

- [ ] **Step 5: Manual pass**

`flutter run -d chrome`: 3 tabs; さがす shows rankings (empty on a fresh DB → "まだ十分なデータがありません"), search works, faculty chips filter; 時間割 is the old home; マイページ has the お問い合わせ link that opens ContactScreen; the 参考書 and お問い合わせ tabs are gone.

- [ ] **Step 6: Commit**

```bash
git add lib/views/navigation_root_screen.dart lib/views/mypage/my_page_screen.dart lib/views/home/home_screen.dart
git commit -m "refactor: 3-tab bottom nav (さがす / 時間割 / マイページ); お問い合わせ into マイページ"
```

---

## Task 7 (OPTIONAL — may be cut): bell icon + minimal notifications

**Scope note:** proper notifications need a cross-user write (the person clicking 役に立った writes to the review author's inbox), which — like the points economy — wants a Cloud Function to be safe, and Phase 1 has none. This task ships a **trust-based** minimal version or is deferred to a Phase-2 Function. **Confirm with the plan owner before implementing.** If cut, the app bar simply has no bell for Phase 1.

**Files (if kept):**
- Create: `lib/models/app_notification.dart`, `lib/views/notifications/notifications_sheet.dart`
- Modify: `lib/services/review_service.dart` (write a notification in `markHelpful`), `firestore.rules` (`notifications/{uid}/items/{id}`), `firestore-tests/rules.test.mjs`, `navigation_root_screen.dart` (bell in the shell app bar).

**Design (if kept):**
- `notifications/{uid}/items/{id}` doc: `{ type: 'helpful', reviewId, courseKey, courseName, actorId, createdAt, read: false }`.
- Rules: `match /notifications/{uid}/items/{id} { allow read: if owns(uid); allow create: if kuVerified() && request.resource.data.actorId == request.auth.uid && request.resource.data.read == false; allow update: if owns(uid) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['read']); allow delete: if owns(uid); }` — trust-based create (any verified KU user can drop a `helpful` notification in anyone's inbox, but only as themselves and only unread), Phase 2 replaces with a Function.
- `markHelpful` — after the vote transaction commits, best-effort `notifications/{authorId}/items/{auto}` create (`.catchError((_) {})`); needs the review's `authorId` (already read in the transaction).
- Shell app bar (the `navigation_root_screen` Scaffold) — a bell `IconButton` with a `StreamBuilder` unread count badge (`notifications/{myUid}/items where read == false`), opens `notifications_sheet.dart` (a bottom sheet list; tapping a row marks it read + pushes the course).

- [ ] **Step 1: confirm keep/cut with the plan owner, then implement or skip.**

---

## Self-Review

**1. Spec coverage (§4.1, §4.2):**
- さがすタブ (search + rankings) → Tasks 3, 5. ✅
- 楽単ランキング / レビューが多い / 過去問が多い / 新着 → Task 3 `RankingKind`. ✅
- 学部フィルタ → Task 5. ✅ (系列フィルタ explicitly out of scope — no data; noted in Global Constraints.)
- 下タブ再編 (さがす / 時間割 / マイページ, 教科書非表示, お問い合わせ→マイページ) → Task 6. ✅
- ベルアイコン＋最小通知 → Task 7, **flagged optional / needs owner decision** (cross-user write, no Function). ✅ (surfaced, not silently dropped)

**2. Placeholder scan:** Task 5 describes the screen structure rather than full widget code — consistent with Plan A's approach (services + models get full code; screens get concrete widget/field/call-site lists). No "TBD". Task 1 Step 1's third test says "pick one and assert it" — that's a real decision handed to the implementer with the recommendation (`50`) stated; acceptable.

**3. Type consistency:** `RankingKind` enum defined Task 3, used Tasks 3/5. `RankingService.ranking(kind, {limit, poolLimit})` / `pool({poolLimit})` / `invalidate()` — consistent Task 3 ↔ Task 5. `CourseStats.score` (int) defined Task 1, ordered/read in Task 3. `CourseRepository.byCourseKey` (sync, `Subject?`) defined Task 2, used Task 5. `AppStore.ranking` field defined Task 4, used Task 5. `AppStore` constructor arg order (`courses, reviews, ranking`) — Task 4 `main.dart` + constructor match.

No issues found.

---

## After Plan B

Deploy A + B together (Plan A is not yet in prod). Order: `firestore:indexes` (Plan A's `reviews` composite — Plan B adds none) → `firestore:rules` (Plan A's; Plan B adds none unless Task 7 ships) → `hosting` → `tools/backfill_post_counts.mjs`. Then seed reviews (founder + friends, ~100 全学共通 courses) so the rankings aren't empty at launch.

Phase 2 backlog this plan defers: 全学共通 系列 (needs the syllabus scrape), notifications via a Function, 「もっと見る」 pagination on rankings, `course_stats` as a Function-authored aggregate.
