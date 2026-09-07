import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/repositories/course_repository.dart';

Future<FakeFirebaseFirestore> _seeded() async {
  final db = FakeFirebaseFirestore();
  await db.collection('courses').doc('c_1').set({
    'id': 'c_1', 'courseKey': '微分積分学a|山田太郎', 'name': '微分積分学A',
    'faculty': '全学共通', 'lecturer': '山田 太郎', 'dayOfWeek': 'Mon', 'period': 2,
    'university_id': 'kyoto_u',
  });
  await db.collection('courses').doc('c_2').set({
    'id': 'c_2', 'courseKey': '哲学i|戸田剛文', 'name': '哲学I',
    'faculty': '全学共通', 'lecturer': '戸田 剛文', 'dayOfWeek': 'Mon', 'period': 2,
    'university_id': 'kyoto_u',
  });
  return db;
}

void main() {
  test('search matches name substring, NFKC + space insensitive', () async {
    final repo = CourseRepository(await _seeded());
    final r = await repo.search('微分 積分');
    expect(r.map((s) => s.id), ['c_1']);
  });

  test('search matches lecturer', () async {
    final repo = CourseRepository(await _seeded());
    final r = await repo.search('戸田');
    expect(r.single.id, 'c_2');
  });

  test('forSlot returns every course in that day/period', () async {
    final repo = CourseRepository(await _seeded());
    final r = await repo.forSlot('Mon', 2);
    expect(r.map((s) => s.id).toSet(), {'c_1', 'c_2'});
  });

  test('byId returns the course or null', () async {
    final repo = CourseRepository(await _seeded());
    expect((await repo.byId('c_2'))!.name, '哲学I');
    expect(await repo.byId('nope'), isNull);
  });

  test('addCustomCourse writes to Firestore and appears in later lookups', () async {
    final db = await _seeded();
    final repo = CourseRepository(db);
    await repo.warmUp();
    final s = await repo.addCustomCourse(
      name: '新規ゼミ', faculty: '全学共通', dayOfWeek: 'Fri', period: 4, lecturer: '担当教員不明');
    expect((await db.collection('courses').doc(s.id).get()).exists, isTrue);
    expect((await repo.forSlot('Fri', 4)).single.id, s.id);
  });
}
