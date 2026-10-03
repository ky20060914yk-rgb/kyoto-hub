import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/talk_room.dart';
import 'market_service.dart' show kChatMaxMessage;
import 'talk_room_queries.dart';

/// Chat on `talk_rooms/{roomId}/messages` (Plan 3, spec §4.5.5): one document
/// per message, read a page at a time — no array, no `arrayUnion`, no 1 MiB
/// ceiling. Rooms are created by the `openListingChat` Function; the client
/// only sends messages and moves its own read marker (firestore.rules).
class ChatService {
  ChatService(this._db);
  final FirebaseFirestore _db;

  static const int pageSize = 30;

  CollectionReference<Map<String, dynamic>> _messages(String roomId) =>
      _db.collection('talk_rooms').doc(roomId).collection('messages');

  List<ChatMessage> _oldestFirst(QuerySnapshot<Map<String, dynamic>> q) =>
      q.docs.map((d) => ChatMessage.fromMap(d.id, d.data())).toList().reversed.toList();

  /// The rooms [uid] takes part in, most recent activity first (2B M-15 query).
  Stream<List<TalkRoom>> streamRooms(String uid) => participantTalkRooms(_db, uid);

  /// The newest [limit] messages, oldest first, live.
  Stream<List<ChatMessage>> streamLatest(String roomId, {int limit = pageSize}) =>
      _messages(roomId).orderBy('createdAt', descending: true).limit(limit).snapshots().map(_oldestFirst);

  /// The [limit] messages before [before], oldest first (one page of history).
  Future<List<ChatMessage>> loadOlder(String roomId, DateTime before, {int limit = pageSize}) async => _oldestFirst(
        await _messages(roomId)
            .where('createdAt', isLessThan: Timestamp.fromDate(before))
            .orderBy('createdAt', descending: true)
            .limit(limit)
            .get(),
      );

  /// Sends [text] as [uid]; returns false (nothing written) when it is empty or too long.
  Future<bool> send(String roomId, String uid, String text) async {
    final t = text.trim();
    if (t.isEmpty || t.length > kChatMaxMessage) return false;
    await _messages(roomId).add({
      'senderId': uid,
      'text': t,
      'createdAt': FieldValue.serverTimestamp(),
      'university_id': 'kyoto_u',
    });
    return true;
  }

  /// Moves the caller's own read marker to the server time (the only room write the rules allow).
  Future<void> markRead(TalkRoom room, String uid) async {
    if (!room.isParty(uid)) return;
    await _db.collection('talk_rooms').doc(room.id).update({
      uid == room.lenderId ? 'lenderReadAt' : 'borrowerReadAt': FieldValue.serverTimestamp(),
    });
  }
}
