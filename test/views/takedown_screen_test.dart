import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/services/moderation_service.dart';
import 'package:kyoto_exam_hub/views/moderation/takedown_screen.dart';

void main() {
  testWidgets('submits the prefilled post id and shows the receipt', (tester) async {
    Map<String, dynamic>? sent;
    final svc = ModerationService(FakeFirebaseFirestore(), (name, data) async {
      expect(name, 'submitTakedown');
      sent = data;
      return {'requestId': 'td42', 'hidden': <Object?>[]};
    });
    await tester.pumpWidget(MaterialApp(
      home: TakedownScreen(moderation: svc, initialPostId: 'post_1', signedInEmail: 'a@st.kyoto-u.ac.jp'),
    ));
    await tester.enterText(find.widgetWithText(TextField, 'お名前・ご所属'), '山田 太郎');
    await tester.enterText(find.widgetWithText(TextField, '対象の資料と削除を求める理由'), '2024年度 線形代数A 期末試験の問題です');
    await tester.ensureVisible(find.text('送信する'));
    await tester.tap(find.text('送信する'));
    await tester.pumpAndSettle();
    expect(sent!['postIds'], ['post_1']);
    expect(sent!['contactEmail'], 'a@st.kyoto-u.ac.jp');
    expect(sent!['role'], 'instructor');
    expect(find.text('削除依頼を受け付けました。'), findsOneWidget);
    expect(find.textContaining('td42'), findsOneWidget);
  });

  testWidgets('an invalid form is not sent and says why', (tester) async {
    var calls = 0;
    final svc = ModerationService(FakeFirebaseFirestore(), (_, _) async {
      calls++;
      return <String, dynamic>{};
    });
    await tester.pumpWidget(MaterialApp(home: TakedownScreen(moderation: svc)));
    await tester.ensureVisible(find.text('送信する'));
    await tester.tap(find.text('送信する'));
    await tester.pump();
    expect(calls, 0);
    expect(find.text('お名前（ご所属）を入力してください（100文字まで）'), findsOneWidget);
  });
}
