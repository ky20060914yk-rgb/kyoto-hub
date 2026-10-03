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
}
