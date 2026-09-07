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
    'category': '全学共通科目', 'university_id': 'kyoto_u',
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

  test('category is read from the doc, falling back to the default', () async {
    final repo = CourseRepository(await _seeded());
    expect((await repo.byId('c_2'))!.category, '全学共通科目');
    // c_1 carries no category field.
    expect((await repo.byId('c_1'))!.category, '専門/教養');
  });

  test('addCustomCourse writes to Firestore and appears in later lookups', () async {
    final db = await _seeded();
    final repo = CourseRepository(db);
    await repo.warmUp();
    final s = await repo.addCustomCourse(
      name: '新規ゼミ', faculty: '全学共通', dayOfWeek: 'Fri', period: 4,
      lecturer: '担当教員不明', category: '全学共通科目');
    // The Firestore write is fire-and-forget (C4) — the local entry is what the
    // UI renders, and it must be there immediately.
    expect(s.category, '全学共通科目');
    expect((await repo.forSlot('Fri', 4)).single.id, s.id);
    expect(await repo.search('新規ゼミ'), isNotEmpty);
    // ...and the write still lands.
    await Future<void>.delayed(Duration.zero);
    final doc = await db.collection('courses').doc(s.id).get();
    expect(doc.exists, isTrue);
    expect(doc.data()!['category'], '全学共通科目');
    expect(doc.data()!['id'], s.id);
  });

  // --- C1: one malformed document must not take the catalog down -------------

  test('a doc with no id and no period does not throw and keeps the catalog usable', () async {
    final db = await _seeded();
    await db.collection('courses').doc('c_bare').set({
      'name': 'x', 'university_id': 'kyoto_u',
    });
    final repo = CourseRepository(db);
    await repo.warmUp();
    // The bare doc is still usable: `id` falls back to the document id and
    // `period` to 1.
    final bare = await repo.byId('c_bare');
    expect(bare, isNotNull);
    expect(bare!.id, 'c_bare');
    expect(bare.period, 1);
    // ...and the good documents are still there alongside it.
    expect((await repo.byId('c_1'))!.name, '微分積分学A');
    expect((await repo.byId('c_2'))!.name, '哲学I');
  });

  test('wrongly-typed fields fall back instead of throwing', () async {
    final db = await _seeded();
    await db.collection('courses').doc('c_typed').set({
      'id': 42, 'name': '型違い', 'period': '3', 'faculty': 7,
      'dayOfWeek': null, 'lecturer': false, 'university_id': 'kyoto_u',
    });
    final repo = CourseRepository(db);
    await repo.warmUp();
    final s = await repo.byId('c_typed');
    expect(s, isNotNull);
    expect(s!.id, 'c_typed');
    expect(s.period, 1);
    expect(s.faculty, '全学共通');
    expect(s.dayOfWeek, 'Mon');
    expect(s.lecturer, '');
  });

  test('a num period is coerced to int', () async {
    final db = await _seeded();
    await db.collection('courses').doc('c_num').set({
      'id': 'c_num', 'name': '小数コマ', 'period': 3.0, 'university_id': 'kyoto_u',
    });
    final repo = CourseRepository(db);
    await repo.warmUp();
    expect((await repo.byId('c_num'))!.period, 3);
  });

  test('a doc with no usable name is skipped, the rest still load', () async {
    final db = await _seeded();
    await db.collection('courses').doc('c_noname').set({
      'id': 'c_noname', 'name': '', 'university_id': 'kyoto_u',
    });
    await db.collection('courses').doc('c_badname').set({
      'id': 'c_badname', 'name': 123, 'university_id': 'kyoto_u',
    });
    final repo = CourseRepository(db);
    await repo.warmUp();
    expect(await repo.byId('c_noname'), isNull);
    expect(await repo.byId('c_badname'), isNull);
    expect((await repo.forSlot('Mon', 2)).map((s) => s.id).toSet(), {'c_1', 'c_2'});
  });

  // --- M5: the university filter and the retry path --------------------------

  test('_load excludes courses from another university', () async {
    final db = await _seeded();
    await db.collection('courses').doc('c_osaka').set({
      'id': 'c_osaka', 'name': '阪大の講義', 'faculty': '工学部', 'lecturer': '誰か',
      'dayOfWeek': 'Mon', 'period': 2, 'university_id': 'osaka_u',
    });
    final repo = CourseRepository(db);
    await repo.warmUp();
    expect((await repo.forSlot('Mon', 2)).map((s) => s.id).toSet(), {'c_1', 'c_2'});
    expect(await repo.search('阪大'), isEmpty);
  });

  test('a failed warm-up is retryable: the next warmUp starts a fresh attempt', () async {
    final db = FakeFirebaseFirestore();
    final repo = CourseRepository(db);
    // Nothing to load yet -> the cold load fails and must NOT latch.
    await expectLater(repo.warmUp(), throwsA(isA<StateError>()));
    // Same failure again, i.e. the rejected future was not replayed/swallowed.
    await expectLater(repo.warmUp(), throwsA(isA<StateError>()));
    // The catalog appears; the very next warm-up succeeds.
    await db.collection('courses').doc('c_late').set({
      'id': 'c_late', 'name': '遅れて来た講義', 'faculty': '全学共通', 'lecturer': '教員',
      'dayOfWeek': 'Tue', 'period': 1, 'university_id': 'kyoto_u',
    });
    await repo.warmUp();
    expect((await repo.byId('c_late'))!.name, '遅れて来た講義');
  });

  // --- I6: an empty catalog is an error, not a silently-latched empty state --

  test('an empty catalog throws and does not latch as loaded', () async {
    final repo = CourseRepository(FakeFirebaseFirestore());
    await expectLater(repo.warmUp(), throwsA(isA<StateError>()));
    // search() awaits warmUp(), so the failure surfaces there too rather than
    // quietly returning "no results".
    await expectLater(repo.search('何か'), throwsA(isA<StateError>()));
  });

  test('a catalog holding only unusable docs is treated as loaded, not as an error', () async {
    // The collection is non-empty, so this is not the "catalog never arrived"
    // condition; the malformed docs are simply skipped.
    final db = FakeFirebaseFirestore();
    await db.collection('courses').doc('c_junk').set({
      'id': 'c_junk', 'name': '', 'university_id': 'kyoto_u',
    });
    final repo = CourseRepository(db);
    await repo.warmUp();
    expect(await repo.search('何か'), isEmpty);
  });

  // --- I1: sort the full match set, THEN truncate ----------------------------

  test('search sorts before truncating and caps at the limit', () async {
    final db = FakeFirebaseFirestore();
    for (final n in ['E', 'D', 'C', 'B', 'A']) {
      await db.collection('courses').doc('c_$n').set({
        'id': 'c_$n', 'name': 'テスト$n', 'faculty': '全学共通', 'lecturer': '教員',
        'dayOfWeek': 'Mon', 'period': 1, 'university_id': 'kyoto_u',
      });
    }
    final repo = CourseRepository(db);
    final r = await repo.search('テスト', limit: 2);
    // Alphabetically first two of ALL five matches, not two arbitrary ones.
    expect(r.map((s) => s.name), ['テストA', 'テストB']);
    // `length == limit` is the caller's "capped" signal.
    expect(r.length, 2);
    expect((await repo.search('テスト')).length, 5);
  });

  // --- M2: a dangling id is only looked up once ------------------------------

  test('byId negatively caches a miss instead of refetching it', () async {
    final db = await _seeded();
    final repo = CourseRepository(db);
    expect(await repo.byId('dangling'), isNull);
    // The document appears afterwards; the negative cache means we do NOT go
    // back to Firestore for it on every subsequent timetable refresh.
    await db.collection('courses').doc('dangling').set({
      'id': 'dangling', 'name': '後から出来た講義', 'university_id': 'kyoto_u',
    });
    expect(await repo.byId('dangling'), isNull);
  });

  // --- C3: the cached snapshot's size vs. meta/catalog.courseCount -----------
  //
  // `fake_cloud_firestore` serves the same documents for Source.cache and
  // Source.server, so the "did we hit the server?" decision cannot be observed
  // through `_load()`. The decision itself is the pure `cacheIsFresh` helper,
  // unit-tested directly here; the integration tests below only confirm the
  // meta read is non-fatal and does not perturb the load.

  test('cacheIsFresh: cache serves only when it is non-empty and matches the count', () {
    // N cached docs, meta says N -> serve the cache, no server read.
    expect(CourseRepository.cacheIsFresh(10071, 10071), isTrue);
    // N cached docs, meta says N+1 (a re-seed grew the catalog) -> go to server.
    expect(CourseRepository.cacheIsFresh(10071, 10072), isFalse);
    // N cached docs, meta says N-1 -> go to server.
    expect(CourseRepository.cacheIsFresh(10071, 10070), isFalse);
    // Empty cache is never fresh, even if meta also (nonsensically) says 0.
    expect(CourseRepository.cacheIsFresh(0, 0), isFalse);
    // No authoritative count (meta/catalog missing/unreadable) -> go to server.
    expect(CourseRepository.cacheIsFresh(10071, null), isFalse);
  });

  test('a meta/catalog with a courseCount is read and does not disturb the load', () async {
    final db = await _seeded();
    await db.collection('meta').doc('catalog').set({'version': 7, 'courseCount': 2});
    final repo = CourseRepository(db);
    await repo.warmUp();
    expect((await repo.forSlot('Mon', 2)).length, 2);
  });

  test('a missing meta/catalog is not fatal', () async {
    final repo = CourseRepository(await _seeded());
    await repo.warmUp();
    expect((await repo.forSlot('Mon', 2)).length, 2);
  });
}
