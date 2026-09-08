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

  test('docId is deterministic', () {
    expect(Review.docId('微積a|山田', 'u9'), '微積a|山田_u9');
  });
}
