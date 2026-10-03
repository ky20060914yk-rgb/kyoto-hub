import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/app_notification.dart';

void main() {
  test('parses a Function-written notification', () {
    final n = AppNotification.fromMap('mod_p1_1', {
      'uid': 'u1', 'type': 'post_hidden', 'postId': 'p1', 'postTitle': '2024 期末', 'read': false,
      'createdAt': Timestamp.fromDate(DateTime.utc(2027, 1, 20, 3)),
    });
    expect(n.id, 'mod_p1_1');
    expect(n.type, 'post_hidden');
    expect(n.postId, 'p1');
    expect(n.read, isFalse);
    expect(n.createdAt.toUtc(), DateTime.utc(2027, 1, 20, 3));
    expect(n.message, contains('「2024 期末」'));
    expect(n.message, contains('非表示'));
    expect(n.message, contains('クレジットはそのまま'));
  });

  test('each type has its own copy; an unknown type falls back', () {
    String m(String t) => AppNotification.fromMap('x', {'type': t, 'postTitle': 'T'}).message;
    expect(m('post_restored'), contains('再び表示'));
    expect(m('post_removed'), contains('削除'));
    expect(m('post_removed'), contains('クレジットはそのまま'));
    expect(m('mystery'), contains('お知らせ'));
  });

  test('is total: garbage degrades instead of throwing; read is true only for true', () {
    final n = AppNotification.fromMap('x', {
      'type': 7, 'postId': ['p'], 'postTitle': null, 'read': 'yes', 'createdAt': {'a': 1},
    });
    expect(n.type, '');
    expect(n.postId, '');
    expect(n.postTitle, '');
    expect(n.read, isFalse);
    expect(n.createdAt, DateTime.fromMillisecondsSinceEpoch(0));
    expect(n.message, contains('あなたの投稿'));
  });
}
