import 'review.dart';

/// Per-course roll-up stored at `course_stats/{Review.slug(courseKey)}`.
///
/// C1: the document id is the SLUGGED key — a courseKey may contain '/', which
/// is a path separator in a document id. The raw [courseKey] stays in the
/// document as a field (and is what [applyReview] and every reader key on).
///
/// Phase 1 has no Cloud Functions, so this is maintained client-side:
/// `ReviewService` reads the doc inside a Firestore transaction, calls
/// [applyReview], and writes it back with `set(merge: true)` of [toMap].
///
/// **Merge safety (ruling P2):** [toMap] deliberately OMITS `pastExamPostCount`
/// and `resourcePostCount`. Those are maintained on the same doc by
/// `bumpPostCount` via `FieldValue.increment`, so if a review write emitted
/// them it would clobber a concurrent increment. [fromMap] still READS them
/// (they live in the doc from `bumpPostCount`) and [applyReview] never touches
/// them (Task 8 owns them).
class CourseStats {
  final String courseKey;
  final String universityId;
  final int reviewCount;
  final int ratingSum; // Σ rating over all reviews
  final Map<String, int> rakutanCounts; // {'raku': n, 'futsu': n, 'muzu': n}
  final Map<String, int> attendanceCounts; // keyed by Attendance.value
  final Map<String, int> gradingCounts; // keyed by GradingStyle.value
  final Map<String, int> pastExamCounts; // keyed by PastExamUsefulness.value
  final Map<String, int> bringInCounts; // keyed by BringIn.value
  final int pastExamPostCount; // # of PostCategory.pastExam posts
  final int resourcePostCount; // # of testPrep + other posts
  final DateTime? lastReviewAt;

  const CourseStats({
    required this.courseKey,
    this.universityId = 'kyoto_u',
    this.reviewCount = 0,
    this.ratingSum = 0,
    this.rakutanCounts = const {},
    this.attendanceCounts = const {},
    this.gradingCounts = const {},
    this.pastExamCounts = const {},
    this.bringInCounts = const {},
    this.pastExamPostCount = 0,
    this.resourcePostCount = 0,
    this.lastReviewAt,
  });

  double get avgRating => reviewCount == 0 ? 0 : ratingSum / reviewCount;

  /// 0..100. Higher = easier credit. Blend of rakutan mix, avg rating,
  /// attendance lightness. Pure function of the counts.
  double get rakutanScore {
    if (reviewCount == 0) return 50;
    final rakuFrac = (rakutanCounts['raku'] ?? 0) / reviewCount;
    final muzuFrac = (rakutanCounts['muzu'] ?? 0) / reviewCount;
    final lightFrac = (attendanceCounts['none'] ?? 0) / reviewCount +
        0.5 * ((attendanceCounts['light'] ?? 0) / reviewCount);
    final base = 50 +
        35 * (rakuFrac - muzuFrac) + // -35..+35
        // M3: -15..+10, not -10..+10. `avgRating` is 0 when every stored review
        // degraded to `rating: 0` (Review._rating), which is 2 points below the
        // 1..5 floor this term was sized for. The final `.clamp(0, 100)` below
        // is what keeps the score in range regardless.
        10 * (avgRating - 3) / 2 + // -15..+10
        10 * (lightFrac - 0.5); // -5..+5
    return base.clamp(0, 100).toDouble();
  }

  static CourseStats empty(String courseKey) => CourseStats(
        courseKey: courseKey,
        universityId: 'kyoto_u',
        rakutanCounts: const {'raku': 0, 'futsu': 0, 'muzu': 0},
        attendanceCounts: const {'none': 0, 'light': 0, 'heavy': 0},
        gradingCounts: const {
          'exam_only': 0,
          'exam_report': 0,
          'report_mainly': 0,
          'attendance_heavy': 0,
        },
        pastExamCounts: const {
          'as_is': 0,
          'similar': 0,
          'trend_only': 0,
          'not_useful': 0,
        },
        bringInCounts: const {'no': 0, 'yes': 0, 'na': 0},
      );

  /// Returns a new [CourseStats] with [review] added (`delta = 1`) or removed
  /// (`delta = -1`). When [previous] is supplied (an edit), its contribution is
  /// first subtracted, then [review] is added, so the review is never
  /// double-counted.
  ///
  /// Bucket maps and [reviewCount] are clamped at `>= 0`.
  /// `pastExamPostCount` / `resourcePostCount` are left untouched (Task 8).
  /// `lastReviewAt` is set to `review.updatedAt` whenever a review is added.
  CourseStats applyReview(Review review, {required int delta, Review? previous}) {
    if (previous != null) {
      return _apply(previous, -1)._apply(review, 1);
    }
    return _apply(review, delta);
  }

  CourseStats _apply(Review review, int delta) {
    return CourseStats(
      courseKey: courseKey,
      universityId: universityId.isEmpty ? review.universityId : universityId,
      reviewCount: _clamp(reviewCount + delta),
      ratingSum: _clamp(ratingSum + delta * review.rating),
      rakutanCounts: _bump(rakutanCounts, review.rakutan.value, delta),
      attendanceCounts: _bump(attendanceCounts, review.attendance.value, delta),
      gradingCounts: _bump(gradingCounts, review.grading.value, delta),
      pastExamCounts: _bump(pastExamCounts, review.pastExam.value, delta),
      bringInCounts: _bump(bringInCounts, review.bringIn.value, delta),
      pastExamPostCount: pastExamPostCount,
      resourcePostCount: resourcePostCount,
      lastReviewAt: delta == 1 ? review.updatedAt : lastReviewAt,
    );
  }

  static int _clamp(int v) => v < 0 ? 0 : v;

  static Map<String, int> _bump(Map<String, int> src, String key, int delta) {
    final next = Map<String, int>.from(src);
    next[key] = _clamp((next[key] ?? 0) + delta);
    return next;
  }

  /// P2: post-count fields are intentionally omitted so a review write
  /// (`set(merge: true)`) cannot clobber a concurrent `bumpPostCount`
  /// `FieldValue.increment`.
  Map<String, dynamic> toMap() {
    return {
      'courseKey': courseKey,
      'university_id': universityId,
      'reviewCount': reviewCount,
      'ratingSum': ratingSum,
      'rakutanCounts': rakutanCounts,
      'attendanceCounts': attendanceCounts,
      'gradingCounts': gradingCounts,
      'pastExamCounts': pastExamCounts,
      'bringInCounts': bringInCounts,
      // Same merge-safety rule as the post counts: under `set(merge: true)` an
      // explicit `null` is a WRITE that erases the stored value, so a stats
      // write that happens to carry no timestamp must omit the key rather than
      // clobber a `lastReviewAt` another write already recorded.
      if (lastReviewAt != null) 'lastReviewAt': lastReviewAt!.toIso8601String(),
    };
  }

  /// Total: never throws. A `course_stats` document is trust-written by any
  /// verified KU client (the rules shape-guard only `university_id` and the two
  /// scalar counters), and the ranking screen reads every course's aggregate in
  /// one pass — so one crafted or legacy document must not be able to crash it.
  factory CourseStats.fromMap(Map<String, dynamic> map) {
    return CourseStats(
      courseKey: map['courseKey']?.toString() ?? '',
      universityId: map['university_id']?.toString() ?? 'kyoto_u',
      reviewCount: _int(map['reviewCount']),
      ratingSum: _int(map['ratingSum']),
      rakutanCounts: _intMap(map['rakutanCounts']),
      attendanceCounts: _intMap(map['attendanceCounts']),
      gradingCounts: _intMap(map['gradingCounts']),
      pastExamCounts: _intMap(map['pastExamCounts']),
      bringInCounts: _intMap(map['bringInCounts']),
      // P2: written by bumpPostCount, not by the review path — but always read.
      // Clamped at >= 0: every post that predates the counters never issued a
      // `+1`, so deleting one lands an `increment(-1)` on a doc that is at 0
      // and the UI would render 「過去問 -1件」. A negative stored value is
      // read as 0 until `tools/backfill_post_counts.mjs` recounts the doc.
      pastExamPostCount: _nonNeg(map['pastExamPostCount']),
      resourcePostCount: _nonNeg(map['resourcePostCount']),
      // M5: this parses an ISO-8601 STRING, which is what `toMap` writes. A
      // Firestore `Timestamp` would `toString()` to `Timestamp(seconds=…)` and
      // `tryParse` to null — i.e. silently "no last review", not a crash.
      // Nothing writes a Timestamp today; a Phase-2 Cloud Function that reaches
      // for `FieldValue.serverTimestamp()` here must convert on read (or keep
      // writing ISO strings) or this field will read as null forever.
      lastReviewAt: DateTime.tryParse((map['lastReviewAt'] ?? '').toString()),
    );
  }

  /// A stored counter that is not a number at all (a string, a map, absent)
  /// reads as 0 rather than raising. `as num?` alone would still throw on a
  /// `'3'`, which is exactly the shape a hand-crafted document can carry.
  ///
  /// The `isFinite` guard matters too: Firestore accepts `NaN` / `Infinity` as
  /// valid double values, and `double.nan.toInt()` throws `UnsupportedError`.
  /// The `course_stats` rules shape-guard only the two scalar counters, so a
  /// crafted bucket map or post-count field could otherwise crash every reader.
  static int _int(dynamic raw) => (raw is num && raw.isFinite) ? raw.toInt() : 0;

  /// [_int] floored at 0 — for the two counters that can legitimately be driven
  /// negative by an `increment(-1)` against a doc that never recorded the `+1`.
  static int _nonNeg(dynamic raw) => _clamp(_int(raw));

  static Map<String, int> _intMap(dynamic raw) {
    if (raw is! Map) return {};
    return raw.map((key, value) => MapEntry('$key', _int(value)));
  }
}
