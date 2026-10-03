import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/textbook_request.dart';
import '../models/talk_room.dart';
import 'talk_room_queries.dart';

class FirestoreService {
  /// Plan 3 (Task 9): the database is injectable so AppStore's behaviour can be
  /// pinned against `fake_cloud_firestore`; production passes the default.
  FirestoreService([FirebaseFirestore? db]) : _db = db ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;
  static const String universityId = 'kyoto_u';

  // Profiles, timetables, posts, requests and inquiries moved to
  // lib/repositories/ (Plan 3, Task 10). What is left here is the legacy
  // textbook-request / talk-room code that Task 12 removes.

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
}
