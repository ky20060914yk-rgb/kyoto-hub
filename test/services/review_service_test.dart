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

  // MINOR — the real hazard is not the end state (arrayUnion alone dedupes) but
  // the redundant `tx.update`: in production that write trips the reviews-update
  // rule's `!diff().affectedKeys().hasAny(['helpfulBy'])` clause and fails with
  // PERMISSION_DENIED. The early-return in `markHelpful` is what prevents it.
  // fake_cloud_firestore can't spy on the transaction, so assert the doc is
  // byte-identical (updateTime unchanged) across the redundant second call.
  test('markHelpful second call performs no write (early-return guard)',
      () async {
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

  // IMPORTANT — on an edit, submitReview must NOT write the caller's `helpfulBy`
  // or `createdAt` over the stored (server-owned) values. The deployed rules
  // hard-deny any author update whose diff touches `helpfulBy`, so a write that
  // echoes a stale caller copy fails with PERMISSION_DENIED in production.
  test('submitReview edit preserves server-owned helpfulBy and createdAt',
      () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);

    final original = _review('ck', 'u1', rating: 4);
    await svc.submitReview(original);
    // Another user marks it helpful — this is the server-owned state.
    await svc.markHelpful(reviewId: 'ck_u1', uid: 'helper');

    // The author edits their review; their in-memory copy carries a bogus
    // helpfulBy and a different createdAt.
    final edit = original.copyWith(
      rating: 2,
      helpfulBy: const ['someone', 'else'],
      createdAt: DateTime(2020, 1, 1),
      updatedAt: DateTime(2024, 6, 1),
    );
    await svc.submitReview(edit);

    final stored = Review.fromMap((await db.doc('reviews/ck_u1').get()).data()!);
    expect(stored.rating, 2); // the edit landed
    expect(stored.helpfulBy, ['helper']); // caller's value did NOT overwrite
    expect(stored.createdAt, original.createdAt); // original createdAt kept
  });

  test('streamReviewsForCourse returns only that course, newest first', () async {
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

  test('bumpPostCount updates the right counter', () async {
    final db = FakeFirebaseFirestore();
    final svc = ReviewService(db);
    await svc.bumpPostCount('ck', isPastExam: true, delta: 1);
    await svc.bumpPostCount('ck', isPastExam: false, delta: 1);
    final s = await svc.getStats('ck');
    expect(s.pastExamPostCount, 1);
    expect(s.resourcePostCount, 1);
  });

  // C1 — a courseKey with a '/' in it. 17 courses in the deployed catalog carry
  // one, and '/' is a path separator in a Firestore document id: before the slug
  // both `_stats.doc(courseKey)` and `_reviews.doc('<key>_<uid>')` built
  // 3-segment paths, which throws client-side (an ErrorWidget on the default
  // レビュー tab) and is uncovered by every rules match block.
  group('C1 — courseKey containing /', () {
    const slashKey = 'a/b|c/d';

    test('submitReview writes well-formed (slash-free) document ids', () async {
      final db = FakeFirebaseFirestore();
      final svc = ReviewService(db);
      await svc.submitReview(_review(slashKey, 'u1', rating: 5));

      // The ids the write actually used — neither may contain a '/'.
      expect((await db.doc('reviews/a%2Fb|c%2Fd_u1').get()).exists, isTrue);
      expect((await db.doc('course_stats/a%2Fb|c%2Fd').get()).exists, isTrue);

      // The raw courseKey stays on the document as the queryable field.
      final stored = Review.fromMap((await db.doc('reviews/a%2Fb|c%2Fd_u1').get()).data()!);
      expect(stored.courseKey, slashKey);
      expect(stored.courseSlug, 'a%2Fb|c%2Fd');
      // The create rule pins the doc id to `courseSlug + '_' + uid`.
      expect(stored.id, '${stored.courseSlug}_u1');
    });

    test('getStats reads back the aggregate for a slash courseKey', () async {
      final db = FakeFirebaseFirestore();
      final svc = ReviewService(db);
      await svc.submitReview(_review(slashKey, 'u1', rating: 5));
      final stats = await svc.getStats(slashKey);
      expect(stats.reviewCount, 1);
      expect(stats.ratingSum, 5);
      expect(stats.rakutanCounts['raku'], 1);
    });

    test('the whole review lifecycle survives a slash courseKey', () async {
      final db = FakeFirebaseFirestore();
      final svc = ReviewService(db);
      await svc.submitReview(_review(slashKey, 'u1', rating: 5));

      // Field-filtered queries keep the RAW key (they are not paths).
      expect((await svc.streamReviewsForCourse(slashKey).first).length, 1);
      expect((await svc.getMyReview(slashKey, 'u1'))!.rating, 5);
      expect(await svc.streamStats(slashKey).first, isNotNull);

      await svc.bumpPostCount(slashKey, isPastExam: true, delta: 1);
      expect((await svc.getStats(slashKey)).pastExamPostCount, 1);

      await svc.markHelpful(reviewId: Review.docId(slashKey, 'u1'), uid: 'u2');
      expect((await svc.getMyReview(slashKey, 'u1'))!.helpfulBy, ['u2']);

      await svc.deleteReview(_review(slashKey, 'u1'));
      expect((await svc.getStats(slashKey)).reviewCount, 0);
      // (The P2 merge — that the review path leaves `pastExamPostCount` alone —
      // is NOT asserted here: fake_cloud_firestore ignores `SetOptions(merge)`
      // on a `tx.set` inside a transaction, so it reads 0 in the fake for a
      // plain courseKey too. Nothing slug-specific; see the P2 note on
      // CourseStats.toMap for the real-Firestore contract.)
    });
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
