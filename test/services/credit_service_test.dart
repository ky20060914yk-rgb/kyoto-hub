import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/services/credit_service.dart';

void main() {
  test('streamBalance emits 0 for a missing doc, then the stored balance', () async {
    final db = FakeFirebaseFirestore();
    final svc = CreditService(db, (_, _) async => {});
    final seen = <int>[];
    final sub = svc.streamBalance('u1').listen(seen.add);
    await Future<void>.delayed(Duration.zero);
    await db.collection('credit_balances').doc('u1').set({'balance': 3});
    await Future<void>.delayed(Duration.zero);
    await sub.cancel();
    expect(seen.first, 0);
    expect(seen.last, 3);
  });

  test('streamBalance tolerates a malformed balance', () async {
    final db = FakeFirebaseFirestore();
    await db.collection('credit_balances').doc('u1').set({'balance': 'lots'});
    expect(await CreditService(db, (_, _) async => {}).streamBalance('u1').first, 0);
  });

  test('streamInvitationCode is null until the server issues one, then the code', () async {
    final db = FakeFirebaseFirestore();
    final svc = CreditService(db, (_, _) async => {});
    expect(await svc.streamInvitationCode('u1').first, isNull);
    await db.collection('credit_balances').doc('u1').set({'balance': 3, 'invitationCode': 'ABC234'});
    expect(await svc.streamInvitationCode('u1').first, 'ABC234');
  });

  test('streamLedger returns only the caller’s rows, newest first', () async {
    final db = FakeFirebaseFirestore();
    Future<void> row(String id, String uid, int delta, int day) => db.collection('credits_ledger').doc(id).set({
          'uid': uid, 'delta': delta, 'reason': 'upload', 'balanceAfter': delta,
          'createdAt': Timestamp.fromDate(DateTime.utc(2026, 10, day)),
        });
    await row('a', 'u1', 3, 1);
    await row('b', 'u1', -1, 2);
    await row('c', 'u2', 9, 3);
    final list = await CreditService(db, (_, _) async => {}).streamLedger('u1').first;
    expect(list.map((e) => e.id), ['b', 'a']);
  });

  test('claimWelcome calls the callable and returns the balance', () async {
    final calls = <String>[];
    final svc = CreditService(FakeFirebaseFirestore(), (name, data) async {
      calls.add(name);
      return {'granted': true, 'balance': 3};
    });
    expect(await svc.claimWelcome(), 3);
    expect(calls, ['claimWelcomeCredits']);
  });

  test('downloadResource sends postId + fileIndex and parses the result', () async {
    late Map<String, dynamic> sent;
    final svc = CreditService(FakeFirebaseFirestore(), (name, data) async {
      expect(name, 'downloadResource');
      sent = data;
      return {'url': 'https://signed/x', 'charged': true, 'balance': 2};
    });
    final r = await svc.downloadResource('p1', fileIndex: 1);
    expect(sent, {'postId': 'p1', 'fileIndex': 1});
    expect(r.url, 'https://signed/x');
    expect(r.charged, isTrue);
    expect(r.balance, 2);
  });

  test('CreditException.fromCode maps server codes', () {
    expect(CreditException.fromCode('failed-precondition', 'insufficient-credits').kind, CreditErrorKind.insufficient);
    expect(CreditException.fromCode('not-found', null).kind, CreditErrorKind.notFound);
    expect(CreditException.fromCode('unauthenticated', null).kind, CreditErrorKind.unauthenticated);
    expect(CreditException.fromCode('permission-denied', null).kind, CreditErrorKind.unauthenticated);
    expect(CreditException.fromCode('internal', 'boom').kind, CreditErrorKind.other);
    // a failed-precondition that is NOT about credits is not "insufficient"
    expect(CreditException.fromCode('failed-precondition', 'something else').kind, CreditErrorKind.other);
  });
}
