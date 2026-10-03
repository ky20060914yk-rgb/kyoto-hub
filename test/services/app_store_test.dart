import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/app_notification.dart';
import 'package:kyoto_exam_hub/models/post.dart';
import 'package:kyoto_exam_hub/models/review.dart';
import 'package:kyoto_exam_hub/models/talk_room.dart';
import 'package:kyoto_exam_hub/services/credit_service.dart';
import 'package:kyoto_exam_hub/services/moderation_service.dart';

import '../support/store_harness.dart';

// Characterization tests (Plan 3, Task 9): they pin what AppStore does TODAY,
// so the repository split (Task 10) and the market wiring (Task 12) are
// provably behaviour-preserving.

Future<Map<String, dynamic>?> _doc(FakeFirebaseFirestore db, String path) async => (await db.doc(path).get()).data();

void main() {
  test('a store builds without a Firebase app and starts signed out', () {
    final h = Harness();
    expect(h.store.currentUser, isNull);
    expect(h.store.posts, isEmpty);
  });

  test('addPost: signed out does nothing; signed in writes the post (tenant + server stamp), inserts it first, says so', () async {
    final h = Harness();
    expect(await h.store.addPost(subjectId: 'c1', category: PostCategory.pastExam, title: 't', description: '', fileNames: ['a.pdf'], filePaths: ['resources/u1/1_a.pdf']), isFalse);
    expect((await h.db.collection('posts').get()).docs, isEmpty);
    h.signIn();
    await h.seedCourse('c1', '線形代数A');
    final ok = await h.store.addPost(
      subjectId: 'c1', category: PostCategory.pastExam, year: 2025, title: '2025 期末', description: 'd',
      fileNames: ['a.pdf'], filePaths: ['resources/u1/1_a.pdf'], requestId: 'req_1',
    );
    expect(ok, isTrue);
    final p = h.store.posts.first;
    expect(p.id, startsWith('post_'));
    final stored = (await _doc(h.db, 'posts/${p.id}'))!;
    expect(stored['university_id'], 'kyoto_u');
    expect(stored.containsKey('created_at_ts'), isTrue);
    expect([stored['authorId'], stored['authorName'], stored['subjectName'], stored['requestId']],
        ['u1', '京大生_1234', '線形代数A', 'req_1']);
    expect(h.store.lastNoticeMessage, '資料をアップロードしました！確認後、クレジットが付与されます。');
  });

  test('getPostsForSubject: that subject and category only, newest first', () {
    final h = Harness();
    Post post(String id, String subject, PostCategory c, int day) => Post(
          id: id, subjectId: subject, subjectName: 's', authorId: 'a', authorName: 'a', category: c, title: id,
          description: '', filePaths: const [], fileNames: const [], createdAt: DateTime(2026, 1, day),
        );
    h.store.posts = [post('old', 'c1', PostCategory.pastExam, 1), post('new', 'c1', PostCategory.pastExam, 9),
      post('other', 'c2', PostCategory.pastExam, 5), post('cat', 'c1', PostCategory.other, 7)];
    expect(h.store.getPostsForSubject('c1', PostCategory.pastExam).map((p) => p.id), ['new', 'old']);
  });

  test('deletePost removes the post locally and in Firestore', () async {
    final h = Harness();
    h.signIn();
    await h.seedCourse('c1', '線形代数A');
    await h.store.addPost(subjectId: 'c1', category: PostCategory.other, title: 't', description: '', fileNames: ['a.pdf'], filePaths: ['resources/u1/1_a.pdf']);
    final id = h.store.posts.first.id;
    await h.store.deletePost(id);
    expect(h.store.posts, isEmpty);
    expect(await _doc(h.db, 'posts/$id'), isNull);
  });

  test('addMaterialRequest writes an unfulfilled, cost-free request and says so', () async {
    final h = Harness();
    h.signIn();
    await h.seedCourse('c1', '線形代数A');
    expect(await h.store.addMaterialRequest(subjectId: 'c1', category: PostCategory.pastExam, year: 2024, title: 'ほしい', description: ''), isTrue);
    final r = h.store.requests.first;
    final stored = (await _doc(h.db, 'requests/${r.id}'))!;
    expect([stored['university_id'], stored['costSpent'], stored['rewardPoints'], stored['isFulfilled'], stored['subjectName']],
        ['kyoto_u', 0, 0, false, '線形代数A']);
    expect(h.store.lastNoticeMessage, 'Cloud Firestoreへリクエストを投稿しました！');
  });

  test('timetable: register and remove write the whole map to user_timetables/{uid}', () async {
    final h = Harness();
    h.signIn();
    h.store.registerTimetableSubject('Mon', 1, 'c1');
    h.store.registerTimetableSubject('Tue', 2, 'c2');
    h.store.removeTimetableSubject('Mon', 1);
    await Future<void>.delayed(Duration.zero);
    final stored = (await _doc(h.db, 'user_timetables/u1'))!;
    expect(stored['timetable'], {'Tue_2': 'c2'});
    expect([stored['user_id'], stored['university_id']], ['u1', 'kyoto_u']);
    expect(h.store.userTimetable, {'Tue_2': 'c2'});
  });

  test('getRegisteredSubjects resolves the timetable to courses, once each', () async {
    final h = Harness();
    await h.seedCourse('c1', '線形代数A');
    h.store.userTimetable = {'Mon_1': 'c1', 'Thu_3': 'c1', 'Fri_5': 'missing'};
    expect((await h.store.getRegisteredSubjects()).map((s) => s.id), ['c1']);
  });

  test('submitInquiry files a tenant-stamped inquiry', () async {
    final h = Harness();
    h.signIn();
    h.store.submitInquiry(category: 'other', content: '質問', contactInfo: 'x@example.com');
    await Future<void>.delayed(Duration.zero);
    final docs = (await h.db.collection('inquiries').get()).docs;
    expect(docs.single.data()['university_id'], 'kyoto_u');
    expect(docs.single.data()['userId'], 'u1');
    expect(h.store.lastNoticeMessage, 'お問い合わせを送信しました。運営からの連絡をお待ちください。');
  });

  test('updateDisplayName: empty is refused; a name is trimmed and saved with the tenant', () async {
    final h = Harness();
    h.signIn();
    expect(await h.store.updateDisplayName('  '), isFalse);
    expect(h.store.lastNoticeMessage, 'エラー: ユーザー名を入力してください');
    expect(await h.store.updateDisplayName('  新しい名前 '), isTrue);
    final u = (await _doc(h.db, 'users/u1'))!;
    expect([u['displayName'], u['university_id']], ['新しい名前', 'kyoto_u']);
  });

  test('reportPost maps every callable outcome and error to its notice, and drops a hidden post', () async {
    final h = Harness();
    h.signIn();
    h.store.posts = [Post(id: 'p1', subjectId: 'c', subjectName: 's', authorId: 'a', authorName: 'a', category: PostCategory.other,
        title: 't', description: '', filePaths: const [], fileNames: const [], createdAt: DateTime(2026))];
    h.reply = (_, _) => {'status': 'reported'};
    await h.store.reportPost('p1', category: ReportCategory.copyright, detail: ' x ');
    expect(h.calls.last.$1, 'reportPost');
    expect(h.calls.last.$2, {'postId': 'p1', 'category': 'copyright', 'detail': 'x'});
    expect(h.store.lastNoticeMessage, '通報を受け付けました。ご協力ありがとうございます。');
    h.reply = (_, _) => {'status': 'duplicate'};
    await h.store.reportPost('p1', category: ReportCategory.other);
    expect(h.store.lastNoticeMessage, '既にこの投稿を通報済みです。');
    h.reply = (_, _) => throw ModerationException('resource-exhausted', 'report-limit');
    await h.store.reportPost('p1', category: ReportCategory.other);
    expect(h.store.lastNoticeMessage, '本日の通報の上限に達しました。明日以降にもう一度お試しください。');
    h.reply = (_, _) => {'status': 'hidden'};
    await h.store.reportPost('p1', category: ReportCategory.other);
    expect(h.store.posts, isEmpty);
    expect(h.store.lastNoticeMessage, '通報が一定数に達したため、この投稿は非表示になりました。運営が内容を確認します。');
  });

  test('downloadPost: charged / free / insufficient credits each have their notice', () async {
    final h = Harness();
    h.signIn();
    final post = Post(id: 'p1', subjectId: 'c', subjectName: 's', authorId: 'a', authorName: 'a', category: PostCategory.other,
        title: 't', description: '', filePaths: const [], fileNames: const [], createdAt: DateTime(2026));
    h.reply = (_, _) => {'url': 'https://signed.test/x', 'charged': true, 'balance': 2};
    expect(await h.store.downloadPost(post), isTrue);
    expect(h.store.lastNoticeMessage, '資料のダウンロードを開始しました（1クレジット消費）');
    h.reply = (_, _) => {'url': 'https://signed.test/x', 'charged': false, 'balance': 2};
    await h.store.downloadPost(post);
    expect(h.store.lastNoticeMessage, '資料のダウンロードを開始しました');
    h.reply = (_, _) => throw CreditException(CreditErrorKind.insufficient, 'insufficient-credits');
    expect(await h.store.downloadPost(post), isFalse);
    expect(h.store.lastNoticeMessage, 'クレジットが足りません。資料をアップロードするとクレジットを獲得できます。');
  });

  test('submitReview: unverified is refused; verified creates, then a second submit is an edit', () async {
    final h = Harness();
    h.signIn(verified: false);
    Future<bool> submit(int rating) => h.store.submitReview(
          courseKey: '線形代数a|山田', courseName: '線形代数A', rating: rating, rakutan: Rakutan.raku,
          attendance: Attendance.none, grading: GradingStyle.examOnly, pastExam: PastExamUsefulness.asIs,
          bringIn: BringIn.no, comment: '  よい  ',
        );
    expect(await submit(5), isFalse);
    expect(h.store.lastNoticeMessage, 'メール認証の完了後にレビューを投稿できます。');
    h.signIn();
    expect(await submit(5), isTrue);
    expect(h.store.lastNoticeMessage, 'レビューを投稿しました！');
    expect(await submit(3), isTrue);
    expect(h.store.lastNoticeMessage, 'レビューを更新しました。');
    final stored = (await _doc(h.db, 'reviews/${Review.docId('線形代数a|山田', 'u1')}'))!;
    expect([stored['rating'], stored['comment'], stored['authorId']], [3, 'よい', 'u1']);
  });

  test('markNotificationsRead flips only the unread ones', () async {
    final h = Harness();
    h.signIn();
    for (final (id, read) in [('n1', false), ('n2', true)]) {
      await h.db.collection('notifications').doc(id).set({'uid': 'u1', 'type': 'post_hidden', 'read': read, 'createdAt': Timestamp.now()});
    }
    h.store.notifications = [
      AppNotification(id: 'n1', type: 'post_hidden', postId: '', postTitle: '', read: false, createdAt: DateTime(2026)),
      AppNotification(id: 'n2', type: 'post_hidden', postId: '', postTitle: '', read: true, createdAt: DateTime(2026)),
    ];
    expect(h.store.unreadNotificationCount, 1);
    await h.store.markNotificationsRead();
    expect((await _doc(h.db, 'notifications/n1'))!['read'], isTrue);
  });

  test('logout clears the session state', () {
    final h = Harness();
    h.signIn();
    h.store.userTimetable = {'Mon_1': 'c1'};
    h.store.creditBalance = 5;
    h.store.logout();
    expect([h.store.currentUser, h.store.userTimetable, h.store.creditBalance, h.store.talkRooms], [null, <String, String>{}, 0, []]);
  });

  test('Plan 3: unreadRoomCount counts rooms with a newer message from the other party', () {
    final h = Harness();
    h.signIn();
    TalkRoom room(String id, {required String last, DateTime? read}) => TalkRoom(
          id: id, listingId: 'l', bookTitle: 'b', subjectName: 's', lenderId: 'u1', lenderName: 'A', borrowerId: 'u2',
          borrowerName: 'B', createdAt: DateTime.utc(2027), lastMessageAt: DateTime.utc(2027, 2), lastSenderId: last, lenderReadAt: read,
        );
    h.store.talkRooms = [room('a', last: 'u2'), room('b', last: 'u1'), room('c', last: 'u2', read: DateTime.utc(2027, 3))];
    expect(h.store.unreadRoomCount, 1);
  });

  test('Plan 3: uploadListingPhoto refuses non-images and photos over 2 MiB before touching Storage', () async {
    final h = Harness();
    h.signIn();
    expect(await h.store.uploadListingPhoto('a.pdf', Uint8List(10)), isNull);
    expect(h.store.lastNoticeMessage, '写真は JPEG / PNG / WebP のみアップロードできます。');
    expect(await h.store.uploadListingPhoto('a.jpg', Uint8List(2 * 1024 * 1024 + 1)), isNull);
    expect(h.store.lastNoticeMessage, '写真は1枚2MBまでです。');
  });
}
