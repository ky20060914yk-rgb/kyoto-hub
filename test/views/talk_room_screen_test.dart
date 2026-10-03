import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/talk_room.dart';
import 'package:kyoto_exam_hub/views/textbook/talk_room_screen.dart';

import '../support/store_harness.dart';

TalkRoom _room({String? closedBy, String listingId = 'l1', bool spoke = true}) => TalkRoom(
      id: 'room1', listingId: listingId, bookTitle: '線形代数入門', subjectName: '', lenderId: 'u1', lenderName: 'オーナー',
      borrowerId: 'u2', borrowerName: '買う人', createdAt: DateTime.utc(2027, 4, 1), closedBy: closedBy,
      lenderSent: spoke, borrowerSent: spoke,
    );

Future<Harness> _open(WidgetTester tester, TalkRoom room) async {
  final h = Harness()..signIn(uid: 'u2', name: 'ここの名前は使われない');
  await h.db.collection('talk_rooms').doc(room.id).set(room.toMap());
  await h.db.collection('talk_rooms/${room.id}/messages').doc('m1').set({
    'senderId': 'u1', 'text': '時計台前でどうですか', 'createdAt': Timestamp.fromDate(DateTime.utc(2027, 4, 2)), 'university_id': 'kyoto_u',
  });
  h.store.talkRooms = [room];
  await tester.pumpWidget(MaterialApp(home: TalkRoomScreen(store: h.store, roomId: room.id)));
  await tester.pumpAndSettle();
  return h;
}

void main() {
  testWidgets('shows the messages with the ROOM’s names and the no-money warning; sending writes a message', (tester) async {
    final h = await _open(tester, _room());
    expect(find.text('時計台前でどうですか'), findsOneWidget);
    expect(find.text('オーナー'), findsOneWidget);
    expect(find.textContaining('お金を扱いません'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '12時に行きます');
    await tester.tap(find.byTooltip('送信'));
    await tester.pumpAndSettle();
    final sent = (await h.db.collection('talk_rooms/room1/messages').where('text', isEqualTo: '12時に行きます').get()).docs;
    expect(sent.single.data()['senderId'], 'u2');
    expect(find.text('12時に行きます'), findsOneWidget);
  });

  testWidgets('typing a phone number shows the contact-info warning', (tester) async {
    await _open(tester, _room());
    await tester.enterText(find.byType(TextField), '090-1234-5678');
    await tester.pump();
    expect(find.textContaining('連絡先は、なるべく送らないでください'), findsOneWidget);
  });

  testWidgets('a blocked room shows that it is closed and has no input', (tester) async {
    await _open(tester, _room(closedBy: 'u1'));
    expect(find.textContaining('このトークは終了しています'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
  });

  testWidgets('the menu offers rating only for a market room where both sides spoke', (tester) async {
    await _open(tester, _room(spoke: false));
    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    expect(find.text('取引を評価する'), findsNothing);
    expect(find.text('受け渡し不履行・トラブルを報告'), findsOneWidget);
    expect(find.text('ブロックする'), findsOneWidget);
  });

  testWidgets('rating sends rateDeal with the chosen stars', (tester) async {
    final h = await _open(tester, _room());
    h.reply = (_, _) => {'status': 'rated', 'revealed': false};
    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('取引を評価する'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('★4'));
    await tester.tap(find.text('送信'));
    await tester.pumpAndSettle();
    expect(h.calls.last.$1, 'rateDeal');
    expect(h.calls.last.$2, {'roomId': 'room1', 'stars': 4, 'comment': ''});
    expect(find.text('評価を送信しました。'), findsOneWidget);
  });

  testWidgets('IMPORTANT 2: after older history is loaded, new messages arriving never make any message vanish', (tester) async {
    tester.view.physicalSize = const Size(800, 30000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final h = Harness()..signIn(uid: 'u2', name: 'x');
    final room = _room();
    await h.db.collection('talk_rooms').doc(room.id).set(room.toMap());
    Future<void> add(int i) => h.db.collection('talk_rooms/room1/messages').doc('m${i.toString().padLeft(3, '0')}').set({
          'senderId': i.isEven ? 'u1' : 'u2', 'text': 'msg $i',
          'createdAt': Timestamp.fromDate(DateTime.utc(2027, 4, 1).add(Duration(minutes: i))), 'university_id': 'kyoto_u',
        });
    for (var i = 0; i < 70; i++) {
      await add(i);
    }
    h.store.talkRooms = [room];
    await tester.pumpWidget(MaterialApp(home: TalkRoomScreen(store: h.store, roomId: room.id)));
    await tester.pumpAndSettle();
    expect(find.text('msg 40'), findsOneWidget);
    expect(find.text('msg 39'), findsNothing);
    await tester.tap(find.text('以前のメッセージを読み込む'));
    await tester.pumpAndSettle();
    expect(find.text('msg 10'), findsOneWidget);
    for (var i = 70; i < 77; i++) {
      await add(i);
      await tester.pumpAndSettle();
    }
    for (var i = 10; i < 77; i++) {
      expect(find.text('msg $i'), findsOneWidget, reason: 'msg $i vanished');
    }
  });

  testWidgets('a send that returns false (over the limit) shows a notice instead of failing silently', (tester) async {
    final h = await _open(tester, _room());
    await tester.enterText(find.byType(TextField), '   ');
    await tester.tap(find.byTooltip('送信'));
    await tester.pumpAndSettle();
    expect((await h.db.collection('talk_rooms/room1/messages').get()).size, 1); // nothing written
    // emoji count as ONE character for the limit: 1000 of them are accepted, 1001 are refused with a notice
    // (typing is capped by the input formatter; a pasted/programmatic value bypasses it, and send must still refuse it)
    tester.widget<TextField>(find.byType(TextField)).controller!.text = '😀' * 1001;
    await tester.pump();
    await tester.tap(find.byTooltip('送信'));
    await tester.pumpAndSettle();
    expect(find.textContaining('1000文字'), findsOneWidget);
    expect((await h.db.collection('talk_rooms/room1/messages').get()).size, 1);
  });

  testWidgets('the read marker is written once per last message, not once per rebuild', (tester) async {
    final h = Harness()..signIn(uid: 'u2', name: 'x');
    final room = TalkRoom(
      id: 'room1', listingId: 'l1', bookTitle: 'b', subjectName: '', lenderId: 'u1', lenderName: 'A', borrowerId: 'u2', borrowerName: 'B',
      createdAt: DateTime.utc(2027, 4, 1), lastMessageAt: DateTime.utc(2027, 4, 2), lastSenderId: 'u1', lenderSent: true, borrowerSent: true,
    );
    await h.db.collection('talk_rooms').doc('room1').set(room.toMap());
    h.store.talkRooms = [room];
    await tester.pumpWidget(MaterialApp(home: TalkRoomScreen(store: h.store, roomId: 'room1')));
    await tester.pumpAndSettle();
    final first = (await h.db.doc('talk_rooms/room1').get()).data()!['borrowerReadAt'];
    expect(first, isA<Timestamp>());
    // a rebuild (here: typing) with the same last message must not write the marker again
    await h.db.doc('talk_rooms/room1').update({'borrowerReadAt': Timestamp.fromDate(DateTime.utc(2000))});
    await tester.enterText(find.byType(TextField), 'abc');
    await tester.pumpAndSettle();
    expect((await h.db.doc('talk_rooms/room1').get()).data()!['borrowerReadAt'], Timestamp.fromDate(DateTime.utc(2000)));
  });
}
