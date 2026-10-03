import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/user_profile.dart';
import '../models/post.dart';
import '../models/request.dart';
import '../models/textbook_request.dart';
import '../models/talk_room.dart';
import 'talk_room_queries.dart';
import '../models/inquiry.dart';

class FirestoreService {
  /// Plan 3 (Task 9): the database is injectable so AppStore's behaviour can be
  /// pinned against `fake_cloud_firestore`; production passes the default.
  FirestoreService([FirebaseFirestore? db]) : _db = db ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;
  static const String universityId = 'kyoto_u';

  // --- 1. USER PROFILE ---

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

  // --- 2. TIMETABLE ---

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

  // --- 3. SUBJECTS MASTER ---
  // Courses now live in the `courses` collection and are served by
  // CourseRepository (lib/repositories/course_repository.dart).

  // --- 4. POSTS ---

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

  // --- 5. MATERIAL REQUESTS ---

  Future<void> createMaterialRequest(MaterialRequest req) async {
    final data = req.toMap();
    data['university_id'] = universityId;
    await _db.collection('requests').doc(req.id).set(data);
  }

  Stream<List<MaterialRequest>> streamMaterialRequests() {
    return _db
        .collection('requests')
        .where('university_id', isEqualTo: universityId)
        .snapshots()
        .map((snapshot) => snapshot.docs.map((d) => MaterialRequest.fromMap(d.data())).toList());
  }

  // --- 6. TEXTBOOK REQUESTS & TALK ROOMS ---

  Future<void> createTextbookRequest(TextbookRequest req) async {
    final data = req.toMap();
    data['university_id'] = universityId;
    await _db.collection('textbook_requests').doc(req.id).set(data);
  }

  Stream<List<TextbookRequest>> streamTextbookRequests() {
    return _db
        .collection('textbook_requests')
        .where('university_id', isEqualTo: universityId)
        .snapshots()
        .map((snapshot) => snapshot.docs.map((d) => TextbookRequest.fromMap(d.data())).toList());
  }

  Future<void> createTalkRoom(TalkRoom room) async {
    final data = room.toMap();
    data['university_id'] = universityId;
    await _db.collection('talk_rooms').doc(room.id).set(data);
  }

  /// Plan 2B (M-15): only the rooms the caller takes part in (rules: participants only).
  Stream<List<TalkRoom>> streamTalkRoomsFor(String uid) => participantTalkRooms(_db, uid);

  Future<void> addChatMessage(String roomId, ChatMessage message) async {
    await _db.collection('talk_rooms').doc(roomId).update({
      'messages': FieldValue.arrayUnion([message.toMap()]),
    });
  }

  // --- 8. INQUIRIES & COMPLIANCE REPORTS ---

  Future<void> submitInquiry(Inquiry inquiry) async {
    final data = inquiry.toMap();
    data['university_id'] = universityId;
    await _db.collection('inquiries').doc(inquiry.id).set(data);
  }
}
