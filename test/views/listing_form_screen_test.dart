import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/views/market/listing_form_screen.dart';

import '../support/store_harness.dart';

Future<Harness> _open(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1000, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final h = Harness()..signIn();
  h.reply = (_, _) => {'listingId': 'L1'};
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: Builder(builder: (context) => TextButton(
    onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ListingFormScreen(store: h.store))),
    child: const Text('open'),
  )))));
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return h;
}

void main() {
  testWidgets('a 売る listing sends createListing with the chosen fields and closes the form', (tester) async {
    final h = await _open(tester);
    await tester.enterText(find.widgetWithText(TextField, '例: 線形代数入門 第2版（東京大学出版会）'), '線形代数入門');
    await tester.tap(find.text('目立った傷なし'));
    await tester.enterText(find.widgetWithText(TextField, '例: 1500'), '1200');
    await tester.enterText(find.widgetWithText(TextField, '定価以下の価格をおすすめします'), '3000');
    await tester.tap(find.text('附属図書館前'));
    await tester.tap(find.text('出品する'));
    await tester.pumpAndSettle();
    expect(h.calls.single.$1, 'createListing');
    expect(h.calls.single.$2, {
      'type': 'sell', 'title': '線形代数入門', 'description': '', 'courseId': '', 'condition': 'good', 'price': 1200,
      'listPrice': 3000, 'place': 'library', 'photoPaths': <String>[],
    });
    expect(find.text('open'), findsOneWidget); // popped
  });

  testWidgets('an invalid form is not sent and says why; a price above 定価 is warned about, not blocked', (tester) async {
    final h = await _open(tester);
    await tester.tap(find.text('出品する'));
    await tester.pump();
    expect(h.calls, isEmpty);
    expect(find.text('本のタイトルを入力してください（100文字まで）'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, '例: 1500'), '5000');
    await tester.enterText(find.widgetWithText(TextField, '定価以下の価格をおすすめします'), '3000');
    await tester.pump();
    expect(find.text('定価より高い価格になっています。'), findsOneWidget);
  });

  testWidgets('譲る hides the price; contact info in the text is warned about', (tester) async {
    await _open(tester);
    await tester.tap(find.text('譲ります'));
    await tester.pump();
    expect(find.widgetWithText(TextField, '例: 1500'), findsNothing);
    await tester.enterText(find.widgetWithText(TextField, '書き込みの有無、版、受け渡し可能な曜日など'), 'LINE ID: abc');
    await tester.pump();
    expect(find.textContaining('LINE IDなどは書かないでください'), findsOneWidget);
  });
}
