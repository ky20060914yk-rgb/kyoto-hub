import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/user_profile.dart';
import 'package:kyoto_exam_hub/widgets/credit_rules_dialog.dart';
import 'package:kyoto_exam_hub/widgets/policy_notice_gate.dart';

import '../support/store_harness.dart';

const _title = 'ポイント制がクレジット制に変わりました';

Future<Harness> _pump(WidgetTester tester, {bool verified = true, bool seen = false}) async {
  final h = Harness()..signIn(verified: verified);
  if (seen) h.store.currentUser = h.store.currentUser!.copyWith(policyNoticeSeen: true);
  await tester.pumpWidget(MaterialApp(home: PolicyNoticeGate(store: h.store, child: const Scaffold(body: Text('home')))));
  await tester.pumpAndSettle();
  return h;
}

void main() {
  testWidgets('shows once, accurately; dismissing writes the flag on the user doc and it never comes back', (tester) async {
    final h = await _pump(tester);
    expect(find.text(_title), findsOneWidget);
    expect(find.textContaining('旧ポイントは引き継がれず'), findsOneWidget);
    expect(find.textContaining('3クレジット'), findsOneWidget);
    expect(find.textContaining('1クレジット'), findsOneWidget);
    await tester.tap(find.text('閉じる'));
    await tester.pumpAndSettle();
    expect(find.text(_title), findsNothing);
    final doc = (await h.db.doc('users/u1').get()).data()!;
    expect(doc['policyNoticeV2SeenAt'], isNotNull);
    // later store updates (a notifyListeners from anywhere) never reopen it
    h.store.notifyListeners();
    await tester.pumpAndSettle();
    expect(find.text(_title), findsNothing);
  });

  testWidgets('a user whose doc already has the flag is not shown the notice', (tester) async {
    await _pump(tester, seen: true);
    expect(find.text(_title), findsNothing);
    expect(find.text('home'), findsOneWidget);
  });

  testWidgets('an unverified user does not see it (and it is not marked seen)', (tester) async {
    final h = await _pump(tester, verified: false);
    expect(find.text(_title), findsNothing);
    expect((await h.db.doc('users/u1').get()).exists, isFalse);
  });

  testWidgets('the credit-rules dialog can be opened from the notice, which stays until dismissed', (tester) async {
    await _pump(tester);
    await tester.tap(find.text('クレジット制度のルールを見る'));
    await tester.pumpAndSettle();
    expect(find.text(kCreditRulesTitle), findsOneWidget);
    await tester.tap(find.text('閉じる').last);
    await tester.pumpAndSettle();
    expect(find.text(_title), findsOneWidget);
  });

  testWidgets('a failed flag write never loops and never blocks: the notice stays closed for the session', (tester) async {
    final h = Harness()..signIn();
    h.store.failPolicyNoticeWriteForTest = true;
    await tester.pumpWidget(MaterialApp(home: PolicyNoticeGate(store: h.store, child: const Scaffold(body: Text('home')))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('閉じる'));
    await tester.pumpAndSettle();
    h.store.notifyListeners();
    await tester.pumpAndSettle();
    expect(find.text(_title), findsNothing);
    expect(find.text('home'), findsOneWidget);
  });

  test('UserProfile reads the flag from the user doc and never writes it back with the profile', () {
    final u = UserProfile.fromMap({'uid': 'u', 'email': 'e', 'displayName': 'd', 'policyNoticeV2SeenAt': 'x'});
    expect(u.policyNoticeSeen, isTrue);
    expect(UserProfile.fromMap({'uid': 'u'}).policyNoticeSeen, isFalse);
    expect(u.toMap().containsKey('policyNoticeV2SeenAt'), isFalse);
  });
}
