import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/review.dart';
import 'package:kyoto_exam_hub/services/review_service.dart';

Review _review(String courseKey, String uid, {int rating = 4, Rakutan rakutan = Rakutan.raku}) {
  final now = DateTime(2024, 4, 1);
  return Review(
    id: Review.docId(courseKey, uid),
    courseKey: courseKey,
    courseName: '科目$courseKey',
    authorId: uid,
    authorName: '京大生_$uid',
    rating: rating,
    rakutan: rakutan,
    attendance: Attendance.light,
    grading: GradingStyle.examOnly,
    pastExam: PastExamUsefulness.asIs,
    bringIn: BringIn.na,
    comment: 'c',
    helpfulBy: const [],
    createdAt: now,
    updatedAt: now,
  );
}

// Plan 2B (M-11): course_stats is written only by the onReviewWritten Function.
Future<int> _statsDocs(FakeFirebaseFirestore db) async => (await db.collection('course_stats').get()).docs.length;

void main() {
  test('submitReview writes the review and NEVER writes course_stats', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1', rating: 5));
    expect((await db.doc('reviews/ck_u1').get()).exists, isTrue);
    expect(await _statsDocs(db), 0);
  });

  test('editing a review overwrites the one document in place', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1', rating: 2, rakutan: Rakutan.muzu));
    await svc.submitReview(_review('ck', 'u1', rating: 5, rakutan: Rakutan.raku));
    final stored = Review.fromMap((await db.doc('reviews/ck_u1').get()).data()!);
    expect(stored.rating, 5);
    expect(stored.rakutan, Rakutan.raku);
    expect((await db.collection('reviews').where('courseKey', isEqualTo: 'ck').get()).docs.length, 1);
    expect(await _statsDocs(db), 0);
  });

  test('deleteReview removes only the caller’s review and writes no aggregate', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1'));
    await svc.submitReview(_review('ck', 'u2'));
    await svc.deleteReview(_review('ck', 'u2'));
    expect((await db.doc('reviews/ck_u2').get()).exists, isFalse);
    expect((await db.doc('reviews/ck_u1').get()).exists, isTrue);
    expect(await _statsDocs(db), 0);
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

  // The redundant `tx.update` would trip the reviews-update rule's helpfulBy
  // clause in production; the early return in markHelpful prevents it.
  test('markHelpful second call performs no write (early-return guard)', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1'));
    await svc.markHelpful(reviewId: 'ck_u1', uid: 'u2');
    final before = await db.doc('reviews/ck_u1').get();
    await svc.markHelpful(reviewId: 'ck_u1', uid: 'u2');
    final after = await db.doc('reviews/ck_u1').get();
    expect(after.data(), equals(before.data()));
    expect((await svc.getMyReview('ck', 'u1'))!.helpfulBy, ['u2']);
  });

  // On an edit the stored helpfulBy / createdAt must win over the caller's copy:
  // the rules deny any author update whose diff touches helpfulBy.
  test('submitReview edit preserves server-owned helpfulBy and createdAt', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    final original = _review('ck', 'u1', rating: 4);
    await svc.submitReview(original);
    await svc.markHelpful(reviewId: 'ck_u1', uid: 'helper');
    final edit = original.copyWith(
      rating: 2,
      helpfulBy: const ['someone', 'else'],
      createdAt: DateTime(2020, 1, 1),
      updatedAt: DateTime(2024, 6, 1),
    );
    await svc.submitReview(edit);
    final stored = Review.fromMap((await db.doc('reviews/ck_u1').get()).data()!);
    expect(stored.rating, 2);
    expect(stored.helpfulBy, ['helper']);
    expect(stored.createdAt, original.createdAt);
  });

  test('streamReviewsForCourse returns only that course', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck', 'u1'));
    await svc.submitReview(_review('other', 'u1'));
    final list = await svc.streamReviewsForCourse('ck').first;
    expect(list.map((r) => r.courseKey).toSet(), {'ck'});
  });

  test('streamMyReviews returns exactly the caller\'s reviews', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.submitReview(_review('ck1', 'u1'));
    await svc.submitReview(_review('ck2', 'u1'));
    await svc.submitReview(_review('ck3', 'u2'));
    final list = await svc.streamMyReviews('u1').first;
    expect(list.length, 2);
    expect(list.map((r) => r.courseKey).toSet(), {'ck1', 'ck2'});
    expect(list.every((r) => r.authorId == 'u1'), isTrue);
  });

  test('getStats / streamStats read the Function-written aggregate; extra server fields are ignored', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    expect((await svc.getStats('ck')).reviewCount, 0); // missing doc -> empty
    await db.collection('course_stats').doc('ck').set({
      'courseKey': 'ck', 'university_id': 'kyoto_u', 'reviewCount': 2, 'ratingSum': 8,
      'pastExamPostCount': 1, 'score': 55, 'aggregatedAt': Timestamp.fromDate(DateTime.utc(2027)),
    });
    final s = await svc.getStats('ck');
    expect(s.reviewCount, 2);
    expect(s.ratingSum, 8);
    expect(s.pastExamPostCount, 1);
    expect(s.score, 55);
    expect((await svc.streamStats('ck').first).reviewCount, 2);
  });

  // C1 — a courseKey with '/' (17 catalog courses carry one) must never produce
  // a '/' in a document id.
  group('C1 — courseKey containing /', () {
    const slashKey = 'a/b|c/d';

    test('submitReview writes a well-formed (slash-free) review id and no aggregate', () async {
      final db = FakeFirebaseFirestore();
      final svc = ReviewService(db);
      await svc.submitReview(_review(slashKey, 'u1', rating: 5));
      expect((await db.doc('reviews/a%2Fb|c%2Fd_u1').get()).exists, isTrue);
      final stored = Review.fromMap((await db.doc('reviews/a%2Fb|c%2Fd_u1').get()).data()!);
      expect(stored.courseKey, slashKey);
      expect(stored.courseSlug, 'a%2Fb|c%2Fd');
      expect(stored.id, '${stored.courseSlug}_u1');
      expect(await _statsDocs(db), 0);
    });

    test('getStats reads the aggregate for a slash courseKey from its slugged id', () async {
      final db = FakeFirebaseFirestore();
      final svc = ReviewService(db);
      await db.collection('course_stats').doc('a%2Fb|c%2Fd').set({'courseKey': slashKey, 'reviewCount': 1, 'ratingSum': 5});
      final stats = await svc.getStats(slashKey);
      expect(stats.reviewCount, 1);
      expect(stats.ratingSum, 5);
    });

    test('the whole review lifecycle survives a slash courseKey', () async {
      final db = FakeFirebaseFirestore();
      final svc = ReviewService(db);
      await svc.submitReview(_review(slashKey, 'u1', rating: 5));
      expect((await svc.streamReviewsForCourse(slashKey).first).length, 1);
      expect((await svc.getMyReview(slashKey, 'u1'))!.rating, 5);
      await svc.markHelpful(reviewId: Review.docId(slashKey, 'u1'), uid: 'u2');
      expect((await svc.getMyReview(slashKey, 'u1'))!.helpfulBy, ['u2']);
      await svc.deleteReview(_review(slashKey, 'u1'));
      expect(await svc.getMyReview(slashKey, 'u1'), isNull);
    });
  });

  test('streamMyReview emits null when there is none, then the review', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    expect(await svc.streamMyReview('ck', 'u1').first, isNull);
    final done = expectLater(
      svc.streamMyReview('ck', 'u1'),
      emitsThrough(predicate<Review?>((r) => r != null && r.rating == 3 && r.courseKey == 'ck', 'the submitted review')),
    );
    await svc.submitReview(_review('ck', 'u1', rating: 3));
    await done;
  });
}
