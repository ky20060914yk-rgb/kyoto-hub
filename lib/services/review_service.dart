import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/course_stats.dart';
import '../models/review.dart';

/// Firestore data layer for the review layer.
///
/// Plan 2B (M-11): `course_stats/{slug(courseKey)}` is maintained by the
/// `onReviewWritten` / `onPostWritten` Cloud Functions (a full recount per
/// course) and the rules deny every client write to it. This service writes
/// ONLY reviews; it still reads the aggregate through [getStats] / [streamStats].
///
/// **C1 — document ids are slugged.** A courseKey may contain '/' (17 courses
/// in the deployed catalog do), which is a path separator in a Firestore
/// document id. So every `course_stats` reference here is
/// `_stats.doc(Review.slug(courseKey))` and every review reference is
/// `_reviews.doc(Review.docId(...))`, which slugs too. The `where('courseKey')`
/// queries are FIELD filters, not paths, so they keep the raw courseKey.
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

  /// Every review authored by [uid], newest edit first.
  ///
  /// A single-field `where` needs no composite index, so the `updatedAt`
  /// ordering is done client-side rather than with an `orderBy` (which would
  /// force one). Used by マイページ's contribution card.
  Stream<List<Review>> streamMyReviews(String uid) {
    return _reviews
        .where('authorId', isEqualTo: uid)
        .snapshots()
        .map((snap) => snap.docs.map((d) => Review.fromMap(d.data())).toList()
          ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt)));
  }

  /// `course_stats/{slug(courseKey)}`, or [CourseStats.empty] if the doc is
  /// missing.
  Future<CourseStats> getStats(String courseKey) async {
    final snap = await _stats.doc(Review.slug(courseKey)).get();
    final data = snap.data();
    return snap.exists && data != null
        ? CourseStats.fromMap(data)
        : CourseStats.empty(courseKey);
  }

  Stream<CourseStats> streamStats(String courseKey) {
    return _stats.doc(Review.slug(courseKey)).snapshots().map((snap) {
      final data = snap.data();
      return snap.exists && data != null
          ? CourseStats.fromMap(data)
          : CourseStats.empty(courseKey);
    });
  }

  /// Create or edit the caller's review. On an edit, `helpfulBy` and
  /// `createdAt` are server-owned: the rules hard-deny any author update whose
  /// diff touches `helpfulBy`, so the write carries the stored values.
  Future<void> submitReview(Review review) async {
    await _fs.runTransaction((tx) async {
      final reviewRef = _reviews.doc(review.id);
      final prevSnap = await tx.get(reviewRef);
      final prevData = prevSnap.data();
      final previous = prevSnap.exists && prevData != null ? Review.fromMap(prevData) : null;
      final toWrite = previous != null
          ? review.copyWith(helpfulBy: previous.helpfulBy, createdAt: previous.createdAt)
          : review;
      tx.set(reviewRef, toWrite.toMap());
    });
  }

  /// Remove the caller's review. The aggregate follows via `onReviewWritten`.
  Future<void> deleteReview(Review review) => _reviews.doc(review.id).delete();

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
}
