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
}
