import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/services/ranking_service.dart';

Future<FakeFirebaseFirestore> _db() async {
  final db = FakeFirebaseFirestore();
  Future<void> put(String ck,
          {required int reviews,
          required int score,
          int pastExams = 0,
          DateTime? last}) =>
      db.collection('course_stats').doc(ck).set({
        'courseKey': ck,
        'university_id': 'kyoto_u',
        'reviewCount': reviews,
        'ratingSum': reviews * 3,
        'score': score,
        'pastExamPostCount': pastExams,
        'resourcePostCount': 0,
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
    expect(list.map((s) => s.courseKey),
        containsAllInOrder(['easy|a', 'hard|b', 'thin|c', 'quiet|d']));
  });

  test('mostPastExams excludes zero and sorts desc', () async {
    final r = RankingService(await _db());
    final list = await r.ranking(RankingKind.mostPastExams);
    expect(list.map((s) => s.courseKey), ['hard|b', 'easy|a']);
  });

  test('recentlyReviewed sorts by lastReviewAt desc, nulls excluded', () async {
    final r = RankingService(await _db());
    final list = await r.ranking(RankingKind.recentlyReviewed);
    expect(list.map((s) => s.courseKey),
        ['hard|b', 'easy|a', 'thin|c']); // quiet|d has no lastReviewAt
  });

  test('pool is read once and memoised', () async {
    final db = await _db();
    final r = RankingService(db);
    await r.ranking(RankingKind.rakutan);
    await db
        .collection('course_stats')
        .doc('easy|a')
        .set({'reviewCount': 999}, SetOptions(merge: true));
    final again = await r.ranking(RankingKind.mostReviewed);
    // Assert the stale value (10, not 999) to prove the pool was not re-read
    expect(again.firstWhere((s) => s.courseKey == 'easy|a').reviewCount, 10);
  });

  // RULING P-B4: a course with past exams but ZERO reviews must still surface in
  // 「過去問が多い科目」. The pool is a merge of two bounded reads (reviewCount>=1
  // and pastExamPostCount>=1), so the zero-review course arrives via the second.
  test('P-B4: a zero-review course with past exams appears in mostPastExams', () async {
    final db = FakeFirebaseFirestore();
    Future<void> put(String ck,
            {required int reviews, required int score, required int pastExams}) =>
        db.collection('course_stats').doc(ck).set({
          'courseKey': ck,
          'university_id': 'kyoto_u',
          'reviewCount': reviews,
          'ratingSum': reviews * 3,
          'score': score,
          'pastExamPostCount': pastExams,
          'resourcePostCount': 0,
        });
    await put('easy|a', reviews: 10, score: 90, pastExams: 2);
    await put('hard|b', reviews: 8, score: 20, pastExams: 5);
    await put('exam|z', reviews: 0, score: 50, pastExams: 3); // zero reviews, has past exams

    final r = RankingService(db);
    final list = await r.ranking(RankingKind.mostPastExams);
    expect(list.map((s) => s.courseKey), contains('exam|z'));
    expect(list.map((s) => s.courseKey), ['hard|b', 'exam|z', 'easy|a']);

    // ...and it is NOT in the rakutan ranking (reviewCount 0 < 3 floor).
    final rakutan = await r.ranking(RankingKind.rakutan);
    expect(rakutan.map((s) => s.courseKey), isNot(contains('exam|z')));
  });

  test('M1: zero-review course does NOT appear in mostReviewed', () async {
    final db = FakeFirebaseFirestore();
    Future<void> put(String ck,
            {required int reviews, required int score, int pastExams = 0}) =>
        db.collection('course_stats').doc(ck).set({
          'courseKey': ck,
          'university_id': 'kyoto_u',
          'reviewCount': reviews,
          'ratingSum': reviews * 3,
          'score': score,
          'pastExamPostCount': pastExams,
          'resourcePostCount': 0,
        });
    await put('a', reviews: 10, score: 90);
    await put('zero', reviews: 0, score: 50, pastExams: 5);

    final r = RankingService(db);
    final mostReviewed = await r.ranking(RankingKind.mostReviewed);
    expect(mostReviewed.map((s) => s.courseKey), isNot(contains('zero')));

    final mostPastExams = await r.ranking(RankingKind.mostPastExams);
    expect(mostPastExams.map((s) => s.courseKey), contains('zero'));
  });

  // I2: opening the さがす tab fires four ranking() calls synchronously, each
  // calling pool(). Without an in-flight guard all four see `_pool == null` and
  // each issues the two bounded reads — ~4x the Firestore reads. The guard means
  // a second pool() call while the first is in flight returns the SAME future.
  test('I2: 4 concurrent ranking() calls trigger a single pool fetch', () async {
    final r = RankingService(await _db());
    await Future.wait([
      for (final k in RankingKind.values) r.ranking(k),
    ]);
    expect(r.poolFetchCount, 1);

    // Memoised: a later pool() call inside the TTL does not refetch.
    await r.pool();
    await r.pool();
    expect(r.poolFetchCount, 1);

    // invalidate() clears the in-flight guard too, so the next call refetches.
    r.invalidate();
    await Future.wait([
      for (final k in RankingKind.values) r.ranking(k),
    ]);
    expect(r.poolFetchCount, 2);
  });

  // I1: invalidate() during an in-flight fetch must not corrupt the memo — the
  // orphaned fetch neither publishes stale data nor nulls the new fetch's guard.
  test('I1: invalidate() mid-flight — exactly one extra fetch, no stale publish',
      () async {
    final db = await _db();
    final r = RankingService(db);

    // First wave: N concurrent pool() calls => a single fetch.
    await Future.wait([for (var i = 0; i < 5; i++) r.pool()]);
    expect(r.poolFetchCount, 1);

    // Mutate the backing data, then invalidate and re-fetch.
    await db
        .collection('course_stats')
        .doc('quiet|d')
        .set({'reviewCount': 42}, SetOptions(merge: true));
    r.invalidate();

    final results = await Future.wait([for (var i = 0; i < 5; i++) r.pool()]);
    // Exactly one more fetch — the guard held across the concurrent calls.
    expect(r.poolFetchCount, 2);
    // The new pool reflects the mutation (no stale publish from the orphan).
    for (final pool in results) {
      expect(pool.firstWhere((s) => s.courseKey == 'quiet|d').reviewCount, 42);
    }
    expect(
        (await r.pool()).firstWhere((s) => s.courseKey == 'quiet|d').reviewCount,
        42);
  });

  test('M2: pool() hands out a copy on both the cache-hit and fetch paths',
      () async {
    final r = RankingService(await _db());
    final first = await r.pool(); // fetch path
    first.clear();
    final second = await r.pool(); // cache-hit path
    expect(second, isNotEmpty, reason: 'mutating the returned list must not '
        'touch the internal pool');
    second.removeWhere((_) => true);
    expect(await r.pool(), isNotEmpty);
    expect(r.poolFetchCount, 1);
  });

  test('M2: ranking() operates on a copy, not the shared pool', () async {
    final r = RankingService(await _db());

    // First call rakutan, which filters out reviewCount < 3 (removes 'quiet|d' with 1)
    await r.ranking(RankingKind.rakutan);

    // Then call mostReviewed - should still include 'quiet|d' (reviewCount: 1 >= 1)
    final mostReviewed = await r.ranking(RankingKind.mostReviewed);
    expect(mostReviewed.map((s) => s.courseKey), contains('quiet|d'),
        reason: 'quiet|d should still be in mostReviewed even after rakutan filtered it');
  });
}
