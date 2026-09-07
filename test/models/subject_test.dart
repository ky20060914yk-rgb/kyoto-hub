import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/subject.dart';

void main() {
  test('Subject round-trips courseKey through toMap/fromMap', () {
    final s = Subject(
      id: 'c_abc123',
      name: '哲学I',
      faculty: '全学共通',
      dayOfWeek: 'Mon',
      period: 3,
      lecturer: '戸田 剛文',
      courseKey: '哲学i|戸田剛文',
    );
    final back = Subject.fromMap(s.toMap());
    expect(back.courseKey, '哲学i|戸田剛文');
    expect(back.id, 'c_abc123');
    expect(back.period, 3);
  });

  test('Subject.fromMap tolerates a missing courseKey', () {
    final back = Subject.fromMap({
      'id': 'x', 'name': 'n', 'faculty': '全学共通', 'dayOfWeek': 'Tue', 'period': 1, 'lecturer': 'l',
    });
    expect(back.courseKey, '');
  });
}
