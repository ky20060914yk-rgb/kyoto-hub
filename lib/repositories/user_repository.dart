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
