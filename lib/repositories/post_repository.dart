import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/post.dart';

/// Past-exam / resource posts (Plan 3, Task 10: moved verbatim out of
/// FirestoreService and AppStore). Credits, downloads and moderation stay with
/// CreditService / ModerationService; this is only the `posts` collection and
/// the storage-path rules the upload must follow.
class PostRepository {
  PostRepository(this._db);
  final FirebaseFirestore _db;
  static const String universityId = 'kyoto_u';

  /// Same sanitisation as tools/migrate_storage.mjs `sanitizeName`: every char
  /// outside [\w.-] / kana / CJK becomes '_', and only the last 100 are kept
  /// (so the extension survives).
  static String safeFileName(String fileName) {
    var safe = fileName.replaceAll(RegExp(r'[^\w.\-぀-ヿ一-鿿]'), '_');
    if (safe.length > 100) safe = safe.substring(safe.length - 100);
    return safe;
  }

  /// `resources/<uid>/<millis>_<safe name>` — the only shape storage.rules accept.
  static String resourcePath(String uid, String fileName, int millis) =>
      'resources/$uid/${millis}_${safeFileName(fileName)}';

  /// The content type the private bucket accepts for a resource upload.
  static String contentTypeFor(String fileName) {
    final lower = fileName.toLowerCase();
    return lower.endsWith('.pdf')
        ? 'application/pdf'
        : lower.endsWith('.png')
            ? 'image/png'
            : lower.endsWith('.webp')
                ? 'image/webp'
                : 'image/jpeg';
  }

  Future<void> createPost(Post post) async {
    final data = post.toMap();
    data['university_id'] = universityId;
    data['created_at_ts'] = FieldValue.serverTimestamp();
    await _db.collection('posts').doc(post.id).set(data);
  }

  Stream<List<Post>> streamPosts() {
    return _db
        .collection('posts')
        .where('university_id', isEqualTo: universityId)
        .snapshots()
        .map((snapshot) => snapshot.docs.map((d) => Post.fromMap(d.data())).toList());
  }

  Future<void> deletePost(String postId) async {
    await _db.collection('posts').doc(postId).delete();
  }
}
