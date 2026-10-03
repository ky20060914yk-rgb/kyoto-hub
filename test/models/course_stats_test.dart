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

  // Firestore accepts NaN / Infinity as valid doubles and `double.nan.toInt()`
  // throws `UnsupportedError`. The `course_stats` rules do not shape-guard the
  // bucket maps or the post-count fields, so a crafted doc must not crash
  // `fromMap` for every reader of the tab.
  test('fromMap does not throw on NaN / Infinity numeric fields', () {
    late CourseStats s;
    expect(
      () => s = CourseStats.fromMap({
        'courseKey': 'ck',
        'reviewCount': double.infinity,
        'ratingSum': double.nan,
        'rakutanCounts': {'raku': double.nan, 'muzu': 2},
        'pastExamPostCount': double.infinity,
      }),
      returnsNormally,
    );
    expect(s.reviewCount, 0);
    expect(s.ratingSum, 0);
    expect(s.rakutanCounts['raku'], 0);
    expect(s.rakutanCounts['muzu'], 2);
    expect(s.pastExamPostCount, 0);
  });

  // Older docs maintained by increments could hold -1. The UI must never
  // render 「過去問 -1件」; a negative reads as 0 until
  // `tools/backfill_course_stats.mjs` recounts the doc.
  test('fromMap clamps negative post counters at 0', () {
    final s = CourseStats.fromMap({
      'courseKey': 'ck',
      'pastExamPostCount': -3,
      'resourcePostCount': -1,
    });
    expect(s.pastExamPostCount, 0);
    expect(s.resourcePostCount, 0);

    // A positive value is still read through unchanged.
    final ok = CourseStats.fromMap({
      'courseKey': 'ck',
      'pastExamPostCount': 4,
      'resourcePostCount': 2,
    });
    expect(ok.pastExamPostCount, 4);
    expect(ok.resourcePostCount, 2);
  });

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

  // I3 + M9: `score` is a 0..100 snapshot of `rakutanScore`. The `course_stats`
  // rules do NOT shape-guard `score`, so a crafted write must be clamped on
  // read (an unbounded value pins a course to #1 in 楽単ランキング). Non-numeric
  // and non-finite values fall back to the neutral 50, not 0.
  test('fromMap clamps score into 0..100 and falls back to 50', () {
    expect(CourseStats.fromMap({'score': 999999}).score, 100); // upper clamp
    expect(CourseStats.fromMap({'score': -5}).score, 0); // lower clamp
    expect(CourseStats.fromMap({'score': 'abc'}).score, 50); // non-numeric
    expect(CourseStats.fromMap({'score': double.nan}).score, 50); // non-finite
    expect(CourseStats.fromMap({}).score, 50); // absent -> neutral (P-B2)
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
