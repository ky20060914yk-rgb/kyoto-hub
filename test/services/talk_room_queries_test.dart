import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/talk_room.dart';
import 'package:kyoto_exam_hub/services/talk_room_queries.dart';

TalkRoom room(String id, String lender, String borrower, int day) => TalkRoom(
      id: id, requestId: 'r', bookTitle: 'b', subjectName: 's',
      borrowerId: borrower, borrowerName: 'B', lenderId: lender, lenderName: 'L',
      messages: const [], createdAt: DateTime(2027, 1, day),
    );

void main() {
  test('merges the rooms I lend in and borrow in, newest first, and never shows anyone else’s', () async {
    final db = FakeFirebaseFirestore();
    for (final r in [room('lent', 'u1', 'u2', 1), room('borrowed', 'u3', 'u1', 2), room('foreign', 'u2', 'u3', 3)]) {
      await db.collection('talk_rooms').doc(r.id).set(r.toMap());
    }
    await expectLater(
      participantTalkRooms(db, 'u1'),
      emitsThrough(predicate<List<TalkRoom>>(
          (l) => l.map((r) => r.id).join(',') == 'borrowed,lent', 'both of u1’s rooms, newest first')),
    );
  });

  test('a room created later is picked up by the live stream', () async {
    final db = FakeFirebaseFirestore();
    final done = expectLater(
      participantTalkRooms(db, 'u1'),
      emitsThrough(predicate<List<TalkRoom>>((l) => l.any((r) => r.id == 'new'), 'the new room')),
    );
    await db.collection('talk_rooms').doc('new').set(room('new', 'u2', 'u1', 5).toMap());
    await done;
  });
}
