import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/inquiry.dart';
import 'package:kyoto_exam_hub/models/post.dart';
import 'package:kyoto_exam_hub/models/request.dart';
import 'package:kyoto_exam_hub/models/user_profile.dart';
import 'package:kyoto_exam_hub/repositories/inquiry_repository.dart';
import 'package:kyoto_exam_hub/repositories/post_repository.dart';
import 'package:kyoto_exam_hub/repositories/request_repository.dart';
import 'package:kyoto_exam_hub/repositories/user_repository.dart';

Post _post(String id, {String uni = 'kyoto_u'}) => Post(
      id: id, universityId: uni, subjectId: 'c1', subjectName: 's', authorId: 'u1', authorName: 'a',
      category: PostCategory.other, title: 't', description: '', filePaths: const ['resources/u1/1_a.pdf'],
      fileNames: const ['a.pdf'], createdAt: DateTime(2026, 4, 1),
    );

void main() {
  test('PostRepository.resourcePath: own prefix, millis, sanitised flat name that keeps its extension', () {
    expect(PostRepository.resourcePath('u1', '期末 2025(1).pdf', 1700), 'resources/u1/1700_期末_2025_1_.pdf');
    expect(PostRepository.resourcePath('u1', '../../evil.pdf', 1), 'resources/u1/1_.._.._evil.pdf');
    final long = PostRepository.resourcePath('u1', '${'a' * 150}.pdf', 1);
    expect(long.endsWith('.pdf'), isTrue);
    expect(long.split('/').last.length, '1_'.length + 100);
  });

  test('PostRepository.contentTypeFor: pdf / png / webp, everything else jpeg (as before)', () {
    expect(PostRepository.contentTypeFor('A.PDF'), 'application/pdf');
    expect(PostRepository.contentTypeFor('x.png'), 'image/png');
    expect(PostRepository.contentTypeFor('x.webp'), 'image/webp');
    expect(PostRepository.contentTypeFor('x.jpeg'), 'image/jpeg');
  });

  test('PostRepository: create stamps tenant + server time; the stream is tenant-scoped; delete removes', () async {
    final db = FakeFirebaseFirestore();
    final repo = PostRepository(db);
    await repo.createPost(_post('p1'));
    await db.collection('posts').doc('foreign').set(_post('foreign', uni: 'other_u').toMap());
    final stored = (await db.doc('posts/p1').get()).data()!;
    expect(stored['university_id'], 'kyoto_u');
    expect(stored.containsKey('created_at_ts'), isTrue);
    expect((await repo.streamPosts().first).map((p) => p.id), ['p1']);
    await repo.deletePost('p1');
    expect((await db.doc('posts/p1').get()).exists, isFalse);
  });

  test('UserRepository: profile merge-save with tenant; timetable round-trips as strings', () async {
    final db = FakeFirebaseFirestore();
    final repo = UserRepository(db);
    await db.doc('users/u1').set({'invitationNote': 'kept by merge'});
    await repo.saveUserProfile(UserProfile(uid: 'u1', email: 'a@st.kyoto-u.ac.jp', displayName: 'me', createdAt: DateTime(2026)));
    final u = (await db.doc('users/u1').get()).data()!;
    expect([u['displayName'], u['university_id'], u['invitationNote']], ['me', 'kyoto_u', 'kept by merge']);
    expect((await repo.getUserProfile('u1'))!.displayName, 'me');
    expect(await repo.getUserProfile('nobody'), isNull);
    await repo.saveUserTimetable('u1', {'Mon_1': 'c1'});
    expect(await repo.getUserTimetable('u1'), {'Mon_1': 'c1'});
    expect(await repo.getUserTimetable('nobody'), <String, String>{});
  });

  test('RequestRepository and InquiryRepository stamp the tenant', () async {
    final db = FakeFirebaseFirestore();
    await RequestRepository(db).createMaterialRequest(MaterialRequest(
      id: 'r1', subjectId: 'c1', subjectName: 's', authorId: 'u1', authorName: 'a', category: PostCategory.pastExam,
      title: 't', description: '', costSpent: 0, rewardPoints: 0, createdAt: DateTime(2026),
    ));
    expect((await db.doc('requests/r1').get()).data()!['university_id'], 'kyoto_u');
    expect((await RequestRepository(db).streamMaterialRequests().first).map((r) => r.id), ['r1']);
    await InquiryRepository(db).submitInquiry(Inquiry(id: 'i1', userId: 'u1', category: 'other', content: 'c', contactInfo: '', createdAt: DateTime(2026)));
    expect((await db.doc('inquiries/i1').get()).data()!['university_id'], 'kyoto_u');
  });
}
