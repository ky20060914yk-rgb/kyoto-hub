import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/talk_room.dart';
import 'package:kyoto_exam_hub/services/chat_service.dart';

Future<void> _seed(FakeFirebaseFirestore db, String room, int n) async {
  for (var i = 0; i < n; i++) {
    await db.collection('talk_rooms').doc(room).collection('messages').doc('m${i.toString().padLeft(3, '0')}').set({
      'senderId': i.isEven ? 'u1' : 'u2', 'text': 'msg $i',
      'createdAt': Timestamp.fromDate(DateTime.utc(2027, 4, 1).add(Duration(minutes: i))), 'university_id': 'kyoto_u',
    });
  }
}

void main() {
  test('send writes exactly the four fields the rules allow, trimmed; empty or too long writes nothing', () async {
    final db = FakeFirebaseFirestore();
    final chat = ChatService(db);
    expect(await chat.send('r1', 'u1', '  こんにちは  '), isTrue);
    expect(await chat.send('r1', 'u1', '   '), isFalse);
    expect(await chat.send('r1', 'u1', 'x' * 1001), isFalse);
    expect(await chat.send('r1', 'u1', 'x' * 1000), isTrue); // boundary
    final docs = (await db.collection('talk_rooms/r1/messages').get()).docs.map((d) => d.data()).toList();
    expect(docs.length, 2);
    final first = docs.firstWhere((d) => d['text'] == 'こんにちは');
    expect(first.keys.toSet(), {'senderId', 'text', 'createdAt', 'university_id'});
    expect([first['senderId'], first['university_id']], ['u1', 'kyoto_u']);
    expect(first['createdAt'], isA<Timestamp>());
  });

  test('streamLatest gives the newest page oldest-first; loadOlder pages back until empty', () async {
    final db = FakeFirebaseFirestore();
    await _seed(db, 'r1', 70);
    final chat = ChatService(db);
    final latest = await chat.streamLatest('r1').first;
    expect(latest.length, 30);
    expect([latest.first.text, latest.last.text], ['msg 40', 'msg 69']);
    final p2 = await chat.loadOlder('r1', latest.first.createdAt);
    expect([p2.length, p2.first.text, p2.last.text], [30, 'msg 10', 'msg 39']);
    final p3 = await chat.loadOlder('r1', p2.first.createdAt);
    expect([p3.length, p3.first.text, p3.last.text], [10, 'msg 0', 'msg 9']);
    expect(await chat.loadOlder('r1', p3.first.createdAt), isEmpty);
  });

  test('markRead moves only the caller’s own marker; a non-party writes nothing', () async {
    final db = FakeFirebaseFirestore();
    final room = TalkRoom(id: 'r1', listingId: 'l', bookTitle: 'b', subjectName: 's', lenderId: 'u1', lenderName: 'A',
        borrowerId: 'u2', borrowerName: 'B', createdAt: DateTime.utc(2027));
    await db.collection('talk_rooms').doc('r1').set(room.toMap());
    final chat = ChatService(db);
    await chat.markRead(room, 'u2');
    var d = (await db.doc('talk_rooms/r1').get()).data()!;
    expect([d['borrowerReadAt'] is Timestamp, d['lenderReadAt']], [true, null]);
    await chat.markRead(room, 'stranger');
    d = (await db.doc('talk_rooms/r1').get()).data()!;
    expect(d['lenderReadAt'], isNull);
  });
}
