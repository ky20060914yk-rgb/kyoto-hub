import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/review.dart';
import 'package:kyoto_exam_hub/models/course_stats.dart';

Review _r(String uid, {int rating = 3, Rakutan rakutan = Rakutan.futsu}) => Review(
      id: 'ck_$uid', courseKey: 'ck', courseName: 'ck', authorId: uid, authorName: uid,
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
    expect(back.lastReviewAt, DateTime(2024));
  });

  // `course_stats` is trust-written by any verified KU client and the ranking
  // screen reads every course in one pass, so one crafted document must not be
  // able to crash the whole read.
  test('fromMap is total: wrong TYPES degrade instead of throwing', () {
    late CourseStats s;
    expect(
      () => s = CourseStats.fromMap({
        'reviewCount': '3', // string, not a number
        'ratingSum': 1.0, // double, not an int
        'lastReviewAt': 7, // not a date string
        'rakutanCounts': {'raku': 'lots'}, // non-numeric bucket
        'courseKey': 42,
      }),
      returnsNormally,
    );
    expect(s.reviewCount, 0);
    expect(s.ratingSum, 1);
    expect(s.lastReviewAt, isNull);
    expect(s.rakutanCounts['raku'], 0);
    expect(s.courseKey, '42');
    expect(s.avgRating, 0); // reviewCount 0 -> no division by zero
  });

  // Merge safety: under `set(merge: true)` an explicit null is a write that
  // erases the stored value, so a stats doc with no timestamp must omit the key
  // rather than clobber a `lastReviewAt` a concurrent write recorded.
  test('toMap omits lastReviewAt entirely when it is null', () {
    expect(CourseStats.empty('ck').toMap().containsKey('lastReviewAt'), isFalse);
    final withDate = CourseStats.empty('ck').applyReview(_r('u1'), delta: 1);
    expect(withDate.toMap()['lastReviewAt'], isNotNull);
  });
}
