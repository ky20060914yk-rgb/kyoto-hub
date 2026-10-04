import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/user_profile.dart';

/// The caller's own `users/{uid}` profile and `user_timetables/{uid}` (Plan 3,
/// Task 10: moved verbatim out of FirestoreService). Rules: own documents only.
class UserRepository {
  UserRepository(this._db);
  final FirebaseFirestore _db;
  static const String universityId = 'kyoto_u';

  Future<void> saveUserProfile(UserProfile profile) async {
    final map = profile.toMap();
    map['university_id'] = universityId;
    await _db.collection('users').doc(profile.uid).set(map, SetOptions(merge: true));
  }

  /// Marks the one-time policy notice as seen on the user's OWN document (the users rule lets the owner
  /// write it; `notifications` are Function-owned, so a notice cannot live there).
  Future<void> markPolicyNoticeSeen(String uid) => _db
      .collection('users')
      .doc(uid)
      .set({'policyNoticeV2SeenAt': FieldValue.serverTimestamp(), 'university_id': universityId}, SetOptions(merge: true));

  Future<UserProfile?> getUserProfile(String uid) async {
    final doc = await _db.collection('users').doc(uid).get();
    if (doc.exists && doc.data() != null) {
      return UserProfile.fromMap(doc.data()!);
    }
    return null;
  }

  Future<void> saveUserTimetable(String uid, Map<String, String> timetable) async {
    await _db.collection('user_timetables').doc(uid).set({
      'university_id': universityId,
      'user_id': uid,
      'timetable': timetable,
      'updated_at': FieldValue.serverTimestamp(),
    });
  }

  Future<Map<String, String>> getUserTimetable(String uid) async {
    final doc = await _db.collection('user_timetables').doc(uid).get();
    if (doc.exists && doc.data() != null && doc.data()!['timetable'] != null) {
      final map = doc.data()!['timetable'] as Map<String, dynamic>;
      return map.map((key, value) => MapEntry(key, value.toString()));
    }
    return {};
  }
}
