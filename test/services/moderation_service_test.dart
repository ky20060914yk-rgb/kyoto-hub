import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/services/moderation_service.dart';

void main() {
  test('reportPost sends postId / category / trimmed detail and maps every server status', () async {
    final sent = <Map<String, dynamic>>[];
    var reply = 'reported';
    final svc = ModerationService(FakeFirebaseFirestore(), (name, data) async {
      expect(name, 'reportPost');
      sent.add(data);
      return {'status': reply};
    });
    expect(await svc.reportPost('p1', ReportCategory.copyright, '  無断転載  '), ReportOutcome.reported);
    expect(sent.single, {'postId': 'p1', 'category': 'copyright', 'detail': '無断転載'});
    reply = 'hidden';
    expect(await svc.reportPost('p1', ReportCategory.other, ''), ReportOutcome.hidden);
    reply = 'duplicate';
    expect(await svc.reportPost('p1', ReportCategory.other, ''), ReportOutcome.duplicate);
    reply = 'already_hidden';
    expect(await svc.reportPost('p1', ReportCategory.other, ''), ReportOutcome.alreadyHidden);
  });

  test('enum wire values match functions/src/report.ts and takedown.ts', () {
    expect(ReportCategory.values.map((c) => c.value), ['copyright', 'unrelated', 'inappropriate', 'other']);
    expect(TakedownRole.values.map((r) => r.value), ['instructor', 'university', 'publisher', 'other']);
  });

  test('submitTakedown sends the trimmed form and parses requestId + hidden ids', () async {
    late Map<String, dynamic> sent;
    final svc = ModerationService(FakeFirebaseFirestore(), (name, data) async {
      expect(name, 'submitTakedown');
      sent = data;
      return {'requestId': 'td1', 'hidden': ['p1', 7]};
    });
    final r = await svc.submitTakedown(
      postIds: ['p1'], requesterName: ' 山田 ', role: TakedownRole.instructor,
      contactEmail: ' y@kyoto-u.ac.jp ', description: ' 2024年度の期末試験です ',
    );
    expect(sent, {
      'postIds': ['p1'], 'requesterName': '山田', 'role': 'instructor',
      'contactEmail': 'y@kyoto-u.ac.jp', 'description': '2024年度の期末試験です',
    });
    expect(r.requestId, 'td1');
    expect(r.hidden, ['p1']);
  });

  test('streamNotifications returns only the caller’s rows, newest first; markNotificationRead flips read', () async {
    final db = FakeFirebaseFirestore();
    Future<void> row(String id, String uid, int day) => db.collection('notifications').doc(id).set({
          'uid': uid, 'type': 'post_hidden', 'postId': id, 'postTitle': 't', 'read': false,
          'createdAt': Timestamp.fromDate(DateTime.utc(2027, 1, day)),
        });
    await row('a', 'u1', 1);
    await row('b', 'u1', 2);
    await row('c', 'u2', 3);
    final svc = ModerationService(db, (_, _) async => {});
    expect((await svc.streamNotifications('u1').first).map((n) => n.id), ['b', 'a']);
    await svc.markNotificationRead('a');
    expect((await db.collection('notifications').doc('a').get()).data()!['read'], isTrue);
  });

  test('ModerationException classifies the server codes the UI cares about', () {
    expect(ModerationException('resource-exhausted', 'report-limit').isLimit, isTrue);
    expect(ModerationException('failed-precondition', 'own-post').isOwnPost, isTrue);
    expect(ModerationException('failed-precondition', 'other').isOwnPost, isFalse);
    expect(ModerationException('not-found', 'x').isNotFound, isTrue);
    expect(ModerationException('internal', 'x').isLimit, isFalse);
  });

  test('validateTakedown mirrors the server limits', () {
    const ok = '2024年度 線形代数A 期末試験が無断掲載されています';
    expect(validateTakedown(name: '山田', email: 'y@kyoto-u.ac.jp', description: ok), isNull);
    expect(validateTakedown(name: '', email: 'y@kyoto-u.ac.jp', description: ok), isNotNull);
    expect(validateTakedown(name: 'x' * 101, email: 'y@kyoto-u.ac.jp', description: ok), isNotNull);
    expect(validateTakedown(name: '山田', email: 'not-an-email', description: ok), isNotNull);
    expect(validateTakedown(name: '山田', email: '${'a' * 196}@x.jp', description: ok), isNotNull);
    expect(validateTakedown(name: '山田', email: 'y@kyoto-u.ac.jp', description: '短い'), isNotNull);
    expect(validateTakedown(name: '山田', email: 'y@kyoto-u.ac.jp', description: 'x' * 2001), isNotNull);
  });
}
