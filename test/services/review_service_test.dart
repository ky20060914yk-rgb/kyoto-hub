import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/review.dart';
import 'package:kyoto_exam_hub/services/review_service.dart';

Review _review(String courseKey, String uid,
    {int rating = 4, Rakutan rakutan = Rakutan.raku}) {
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

  // Controller ruling P5 — streamMyReview: Tasks 6/7 watch this instead of
  // re-fetching a Future on every rebuild.
  test('streamMyReview emits null when there is none, then the review', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);

    // No review yet.
    expect(await svc.streamMyReview('ck', 'u1').first, isNull);

    // An open subscription sees the review appear after submitReview.
    // (A fresh `.first` taken right after a fake_cloud_firestore transaction
    // can still report the pre-write snapshot; a live listener — the real
    // Tasks 6/7 usage — does not.)
    final done = expectLater(
      svc.streamMyReview('ck', 'u1'),
      emitsThrough(predicate<Review?>(
          (r) => r != null && r.rating == 3 && r.courseKey == 'ck',
          'the submitted review')),
    );
    await svc.submitReview(_review('ck', 'u1', rating: 3));
    await done;
  });
}
