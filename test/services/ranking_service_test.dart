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
    expect(again.first.courseKey, 'easy|a'); // still 10, not 999 — served from the memoised pool
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
}
