import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/course_stats.dart';
import '../models/review.dart';

/// Firestore data layer for the review layer (Plan A).
///
/// Phase 1 has no Cloud Functions, so `course_stats/{courseKey}` is maintained
/// client-side: [submitReview] / [deleteReview] read the stats doc and any
/// existing review inside a transaction, recompute via [CourseStats.applyReview],
/// then write both docs. The post counters on the same doc are owned by
/// [bumpPostCount] via `FieldValue.increment` and are never emitted by the
/// review path (see [CourseStats.toMap] — ruling P2).
class ReviewService {
  ReviewService(FirebaseFirestore firestore) : _fs = firestore;

  final FirebaseFirestore _fs;

  CollectionReference<Map<String, dynamic>> get _reviews =>
      _fs.collection('reviews');
  CollectionReference<Map<String, dynamic>> get _stats =>
      _fs.collection('course_stats');

  /// All reviews for [courseKey], newest edit first.
  ///
  /// Needs the `courseKey ASC, updatedAt DESC` composite index
  /// (`firestore.indexes.json`).
  Stream<List<Review>> streamReviewsForCourse(String courseKey) {
    return _reviews
        .where('courseKey', isEqualTo: courseKey)
        .orderBy('updatedAt', descending: true)
        .snapshots()
        .map((snap) => snap.docs.map((d) => Review.fromMap(d.data())).toList());
  }

  /// The viewer's own review for [courseKey], or null.
  Future<Review?> getMyReview(String courseKey, String uid) async {
    final snap = await _reviews.doc(Review.docId(courseKey, uid)).get();
    final data = snap.data();
    return snap.exists && data != null ? Review.fromMap(data) : null;
  }

  /// Ruling P5: a stream of the viewer's own review so Tasks 6/7 can watch it
  /// instead of re-fetching on every rebuild (the Phase-1a
  /// create-future-in-build anti-pattern).
  Stream<Review?> streamMyReview(String courseKey, String uid) {
    return _reviews.doc(Review.docId(courseKey, uid)).snapshots().map((snap) {
      final data = snap.data();
      return snap.exists && data != null ? Review.fromMap(data) : null;
    });
  }

  /// `course_stats/{courseKey}`, or [CourseStats.empty] if the doc is missing.
  Future<CourseStats> getStats(String courseKey) async {
    final snap = await _stats.doc(courseKey).get();
    final data = snap.data();
    return snap.exists && data != null
        ? CourseStats.fromMap(data)
        : CourseStats.empty(courseKey);
  }

  Stream<CourseStats> streamStats(String courseKey) {
    return _stats.doc(courseKey).snapshots().map((snap) {
      final data = snap.data();
      return snap.exists && data != null
          ? CourseStats.fromMap(data)
          : CourseStats.empty(courseKey);
    });
  }

  /// Create or edit the caller's review AND re-aggregate `course_stats`
  /// atomically.
  Future<void> submitReview(Review review) async {
    await _fs.runTransaction((tx) async {
      final statsRef = _stats.doc(review.courseKey);
      final reviewRef = _reviews.doc(review.id);
      final statsSnap = await tx.get(statsRef);
      final prevSnap = await tx.get(reviewRef);
      final statsData = statsSnap.data();
      var stats = statsSnap.exists && statsData != null
          ? CourseStats.fromMap(statsData)
          : CourseStats.empty(review.courseKey);
      final prevData = prevSnap.data();
      final previous = prevSnap.exists && prevData != null
          ? Review.fromMap(prevData)
          : null;
      stats = stats.applyReview(review, delta: 1, previous: previous);
      tx.set(reviewRef, review.toMap());
      tx.set(statsRef, stats.toMap(), SetOptions(merge: true));
    });
  }

  /// Remove the caller's review AND decrement `course_stats` atomically.
  Future<void> deleteReview(Review review) async {
    await _fs.runTransaction((tx) async {
      final statsRef = _stats.doc(review.courseKey);
      final reviewRef = _reviews.doc(review.id);
      final statsSnap = await tx.get(statsRef);
      final prevSnap = await tx.get(reviewRef);
      final statsData = statsSnap.data();
      var stats = statsSnap.exists && statsData != null
          ? CourseStats.fromMap(statsData)
          : CourseStats.empty(review.courseKey);
      // Aggregate against the stored review when present so a stale caller-side
      // copy can't skew the counts.
      final prevData = prevSnap.data();
      final target = prevSnap.exists && prevData != null
          ? Review.fromMap(prevData)
          : review;
      stats = stats.applyReview(target, delta: -1);
      tx.delete(reviewRef);
      tx.set(statsRef, stats.toMap(), SetOptions(merge: true));
    });
  }

  /// Append [uid] to a review's `helpfulBy` exactly once. Idempotent
  /// client-side; the rules also require a single-uid append of the caller.
  Future<void> markHelpful({
    required String reviewId,
    required String uid,
  }) async {
    final ref = _reviews.doc(reviewId);
    await _fs.runTransaction((tx) async {
      final snap = await tx.get(ref);
      final data = snap.data();
      if (!snap.exists || data == null) return;
      final helpfulBy = data['helpfulBy'];
      if (helpfulBy is Iterable && helpfulBy.contains(uid)) return;
      tx.update(ref, {
        'helpfulBy': FieldValue.arrayUnion([uid]),
      });
    });
  }

  /// Bump a post counter on `course_stats` (called from AppStore.addPost /
  /// deletePost). `FieldValue.increment` + `merge: true` so it never clobbers
  /// the review-aggregate fields on the same doc.
  Future<void> bumpPostCount(
    String courseKey, {
    required bool isPastExam,
    required int delta,
  }) async {
    await _stats.doc(courseKey).set({
      'courseKey': courseKey,
      'university_id': 'kyoto_u',
      if (isPastExam)
        'pastExamPostCount': FieldValue.increment(delta)
      else
        'resourcePostCount': FieldValue.increment(delta),
    }, SetOptions(merge: true));
  }
}
