import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/views/market/market_screen.dart';

import '../support/store_harness.dart';

Future<void> _listing(Harness h, String id, {String type = 'sell', String title = '線形代数入門', String owner = 'u9', int days = 10, String status = 'active'}) =>
    h.db.collection('textbook_listings').doc(id).set({
      'id': id, 'type': type, 'title': title, 'ownerId': owner, 'ownerName': '出品者', 'status': status, 'condition': 'good',
      'price': type == 'give' ? null : 1000, 'place': 'clock_tower', 'courseId': '', 'courseName': '',
      'createdAt': Timestamp.fromDate(DateTime.now().subtract(const Duration(days: 1))),
      'expiresAt': Timestamp.fromDate(DateTime.now().add(Duration(days: days))),
    });

Future<Harness> _open(WidgetTester tester, Future<void> Function(Harness) seed) async {
  tester.view.physicalSize = const Size(1000, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final h = Harness()..signIn();
  await seed(h);
  await tester.pumpWidget(MaterialApp(home: MarketScreen(store: h.store)));
  await tester.pumpAndSettle();
  return h;
}

void main() {
  testWidgets('さがす lists live listings only, filtered by type chip and free words', (tester) async {
    await _open(tester, (h) async {
      await _listing(h, 'a', title: '線形代数入門');
      await _listing(h, 'b', type: 'give', title: 'Campbell Biology');
      await _listing(h, 'c', type: 'want', title: '微分積分学');
      await _listing(h, 'gone', title: '期限切れの本', days: -1);
      await _listing(h, 'hid', title: '非表示の本', status: 'hidden');
    });
    expect(find.text('『線形代数入門』'), findsOneWidget);
    expect(find.text('『Campbell Biology』'), findsOneWidget);
    expect(find.text('『期限切れの本』'), findsNothing);
    expect(find.text('『非表示の本』'), findsNothing);
    await tester.tap(find.text('買いたい'));
    await tester.pumpAndSettle();
    expect(find.text('『微分積分学』'), findsOneWidget);
    expect(find.text('『線形代数入門』'), findsNothing);
    await tester.tap(find.text('すべて'));
    await tester.enterText(find.byType(TextField), 'campbell');
    await tester.pumpAndSettle();
    expect(find.text('『Campbell Biology』'), findsOneWidget);
    expect(find.text('『線形代数入門』'), findsNothing);
  });

  testWidgets('a listing opens its detail; asking calls openListingChat', (tester) async {
    final h = await _open(tester, (h) => _listing(h, 'a'));
    h.reply = (_, _) => {'roomId': 'l_a_u1'};
    await tester.tap(find.text('『線形代数入門』'));
    await tester.pumpAndSettle();
    expect(find.textContaining('アプリはお金を扱いません'), findsOneWidget);
    expect(find.text('評価はまだありません'), findsOneWidget);
    await tester.tap(find.text('チャットで相談する'));
    await tester.pumpAndSettle();
    expect(h.calls.last.$1, 'openListingChat');
    expect(h.calls.last.$2, {'listingId': 'a'});
  });

  testWidgets('my own listing has no chat or report button', (tester) async {
    await _open(tester, (h) => _listing(h, 'mine', owner: 'u1', title: '自分の本'));
    await tester.tap(find.text('『自分の本』'));
    await tester.pumpAndSettle();
    expect(find.text('チャットで相談する'), findsNothing);
    expect(find.byTooltip('通報'), findsNothing);
  });

  testWidgets('自分の出品 asks 「まだ有効?」 in the last 7 days and renews through updateListing', (tester) async {
    final h = await _open(tester, (h) async {
      await _listing(h, 'soon', owner: 'u1', title: 'もうすぐ期限', days: 3);
      await _listing(h, 'fresh', owner: 'u1', title: 'まだ先', days: 20);
    });
    await tester.tap(find.text('自分の出品'));
    await tester.pumpAndSettle();
    expect(find.textContaining('『もうすぐ期限』はまだ有効ですか？'), findsOneWidget);
    expect(find.textContaining('『まだ先』はまだ有効ですか？'), findsNothing);
    await tester.tap(find.text('延長する'));
    await tester.pumpAndSettle();
    expect(h.calls.last.$1, 'updateListing');
    expect(h.calls.last.$2, {'listingId': 'soon', 'action': 'renew'});
  });
}
