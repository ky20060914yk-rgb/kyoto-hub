import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/course_stats.dart';

enum RankingKind { rakutan, mostReviewed, mostPastExams, recentlyReviewed }

/// Client-side rankings over a bounded `course_stats` pool.
///
/// Phase 1 has no Cloud Functions, so the さがす tab can't lean on a
/// server-computed leaderboard. Instead [pool] does a small, bounded set of
/// Firestore reads once, memoises the result for [_ttl], and [ranking] sorts
/// and filters that in-memory list for each [RankingKind]. Opening the tab and
/// flipping between the four ranking sub-tabs is therefore a single Firestore
/// round-trip, not four.
///
/// RULING P-B4: the pool is the UNION of two bounded reads —
///  * `reviewCount >= 1` ordered by `reviewCount` desc (limit 200), and
///  * `pastExamPostCount >= 1` ordered by `pastExamPostCount` desc (limit 100).
/// The second read is what lets a course with past exams but ZERO reviews still
/// appear in 「過去問が多い科目」. Every other ranking's membership implies
/// `reviewCount >= 1`, so this union covers all four kinds. Both reads are an
/// inequality + `orderBy` on the SAME single field, so Firestore serves them
/// from the automatic single-field index — no composite in
/// `firestore.indexes.json`.
class RankingService {
  RankingService(this._db);

  final FirebaseFirestore _db;

  List<CourseStats>? _pool;
  DateTime? _pooledAt;
  static const _ttl = Duration(minutes: 2);

  /// RULING P-B1: drop the memoised pool. Task 5's pull-to-refresh calls this so
  /// the next [pool]/[ranking] hits Firestore again.
  void invalidate() {
    _pool = null;
    _pooledAt = null;
  }

  Future<List<CourseStats>> pool({int poolLimit = 200}) async {
    final now = DateTime.now();
    if (_pool != null &&
        _pooledAt != null &&
        now.difference(_pooledAt!) < _ttl) {
      return _pool!;
    }

    final a = await _db
        .collection('course_stats')
        .where('reviewCount', isGreaterThanOrEqualTo: 1)
        .orderBy('reviewCount', descending: true)
        .limit(poolLimit)
        .get();
    final b = await _db
        .collection('course_stats')
        .where('pastExamPostCount', isGreaterThanOrEqualTo: 1)
        .orderBy('pastExamPostCount', descending: true)
        .limit(100)
        .get();

    final seen = <String>{};
    final merged = <CourseStats>[];
    for (final d in [...a.docs, ...b.docs]) {
      final cs = CourseStats.fromMap(d.data());
      if (seen.add(cs.courseKey)) merged.add(cs);
    }

    _pool = merged;
    _pooledAt = now;
    return _pool!;
  }

  /// Ranks the pool for [kind]; returns the top [limit] [CourseStats].
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
        p.removeWhere((s) => s.reviewCount < 1);
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
