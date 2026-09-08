import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/review.dart';

void main() {
  test('Review round-trips through toMap/fromMap including enums and helpfulBy', () {
    final r = Review(
      id: 'k|y_u1',
      courseKey: 'k|y',
      courseName: '微分積分学A',
      authorId: 'u1',
      authorName: '京大生_1234',
      rating: 4,
      rakutan: Rakutan.raku,
      attendance: Attendance.light,
      grading: GradingStyle.examOnly,
      pastExam: PastExamUsefulness.asIs,
      bringIn: BringIn.yes,
      comment: '楽単。過去問そのまま。',
      termTaken: '2024前期',
      gradeTaken: 'A',
      helpfulBy: const ['u2', 'u3'],
      createdAt: DateTime.parse('2024-04-01T00:00:00.000'),
      updatedAt: DateTime.parse('2024-04-02T00:00:00.000'),
    );
    final back = Review.fromMap(r.toMap());
    expect(back.rating, 4);
    expect(back.rakutan, Rakutan.raku);
    expect(back.grading, GradingStyle.examOnly);
    expect(back.pastExam, PastExamUsefulness.asIs);
    expect(back.bringIn, BringIn.yes);
    expect(back.helpfulBy, ['u2', 'u3']);
    expect(back.helpfulCount, 2);
    expect(back.termTaken, '2024前期');
  });

  test('fromMap tolerates missing optional + unknown enum strings', () {
    final back = Review.fromMap({
      'id': 'a_b', 'courseKey': 'a', 'authorId': 'b', 'authorName': 'x',
      'rating': 3, 'rakutan': 'bogus', 'attendance': 'bogus', 'grading': 'bogus',
      'pastExam': 'bogus', 'bringIn': 'bogus', 'comment': '',
      'createdAt': '2024-04-01T00:00:00.000', 'updatedAt': '2024-04-01T00:00:00.000',
    });
    expect(back.rakutan, Rakutan.futsu);       // default for unknown
    expect(back.attendance, Attendance.light); // default for unknown
    expect(back.termTaken, isNull);
    expect(back.helpfulBy, isEmpty);
  });

  // A course's reviews arrive as one `where('courseKey', ...)` stream mapped
  // client-side, so a single malformed document must not throw — that would
  // blank the entire list for every reader, not just hide the bad row.
  test('fromMap is total: wrong TYPES degrade instead of throwing', () {
    late Review back;
    expect(
      () => back = Review.fromMap({
        'id': 'a_b',
        'courseKey': 'a',
        'authorId': 'b',
        'rating': 'x', // not a number at all
        'helpfulBy': 'nope', // not a list
        'createdAt': 12345, // not a date string
        'updatedAt': null,
        'rakutan': 7, // not a string
        'termTaken': 99,
      }),
      returnsNormally,
    );
    expect(back.rating, 0);
    expect(back.helpfulBy, isEmpty);
    expect(back.helpfulCount, 0);
    expect(back.rakutan, Rakutan.futsu); // default, not a crash
    expect(back.termTaken, '99');
    expect(back.courseKey, 'a');
    expect(back.createdAt, isNotNull);
  });

  test('fromMap coerces out-of-range and non-int ratings into 0..5', () {
    Review r(dynamic rating) => Review.fromMap({'rating': rating});
    expect(r(99).rating, 5);
    expect(r(-3).rating, 0);
    expect(r(4.7).rating, 4); // truncated, not thrown
    expect(r(null).rating, 0);
    // A well-formed helpfulBy with junk mixed in keeps only the uids.
    expect(Review.fromMap({'helpfulBy': ['u1', 7, null, 'u2']}).helpfulBy,
        ['u1', 'u2']);
  });

  // Firestore accepts NaN / Infinity as valid doubles and `double.nan.toInt()`
  // throws `UnsupportedError` — a crafted `rating` must degrade, not crash the
  // whole list.
  test('fromMap does not throw on NaN / Infinity rating', () {
    late Review a;
    late Review b;
    expect(() => a = Review.fromMap({'rating': double.nan}), returnsNormally);
    expect(() => b = Review.fromMap({'rating': double.infinity}), returnsNormally);
    expect(a.rating, 0);
    expect(b.rating, 0);
  });

  test('docId is deterministic', () {
    expect(Review.docId('微積a|山田', 'u9'), '微積a|山田_u9');
  });

  // C1 — 17 courses in the deployed catalog have a '/' in their courseKey
  // (`課題発見型/解決型学習(fbl/pbl)1|…`). '/' is a path separator in a Firestore
  // document id, so an unescaped key produced a 3-segment path: `course_stats`
  // threw client-side (an ErrorWidget on the default レビュー tab) and `reviews`
  // fell through every match block to the catch-all deny.
  group('C1 slug', () {
    test('escapes / and %, % first so the mapping stays injective', () {
      expect(Review.slug('a/b|c'), 'a%2Fb|c');
      expect(Review.slug('50%off|x'), '50%25off|x');
      // The pair that would collide if '/' were escaped before '%'.
      expect(Review.slug('a/b'), isNot(Review.slug('a%2Fb')));
      expect(Review.slug('a%2Fb'), 'a%252Fb');
    });

    test('leaves a key with neither character untouched', () {
      expect(Review.slug('微積a|山田'), '微積a|山田');
    });

    test('every real deployed shape yields a single-segment doc id', () {
      // Verbatim from tools/courses.json (the deployed catalog): 17 distinct
      // courseKeys contain '/', and none contains '%' — so the escape is a
      // no-op for every other key and round-trips for these.
      const keys = [
        '問題発見型/解決型学習(fbl/pbl)1|伊藤孝行',
        'river/coastalengineering|後藤仁志',
        'advancedtransculturalgamestudies(seg/vmc)|bjorn-olekamm',
      ];
      for (final k in keys) {
        expect(Review.slug(k).contains('/'), isFalse, reason: k);
        expect(Review.docId(k, 'u1').split('/').length, 1, reason: k);
      }
    });

    test('docId slugs the courseKey', () {
      expect(Review.docId('a/b|c/d', 'u1'), 'a%2Fb|c%2Fd_u1');
    });
  });

  test('courseSlug defaults from courseKey and survives toMap/fromMap', () {
    final r = Review(
      id: Review.docId('a/b|c', 'u1'),
      courseKey: 'a/b|c',
      courseName: 'x',
      authorId: 'u1',
      authorName: 'n',
      rating: 3,
      rakutan: Rakutan.futsu,
      attendance: Attendance.light,
      grading: GradingStyle.examOnly,
      pastExam: PastExamUsefulness.asIs,
      bringIn: BringIn.na,
      createdAt: DateTime(2024),
      updatedAt: DateTime(2024),
    );
    expect(r.courseSlug, 'a%2Fb|c');
    // The rule pins the doc id to `courseSlug + '_' + uid`, so these must agree.
    expect(r.id, '${r.courseSlug}_u1');
    expect(r.toMap()['courseSlug'], 'a%2Fb|c');
    expect(Review.fromMap(r.toMap()).courseSlug, 'a%2Fb|c');
  });

  test('fromMap derives courseSlug for a document written before C1', () {
    final back = Review.fromMap({'courseKey': 'a/b|c'}); // no courseSlug key
    expect(back.courseSlug, 'a%2Fb|c');
  });
}
