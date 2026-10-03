import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/course_stats.dart';
import 'package:kyoto_exam_hub/models/review.dart';

void main() {
  test('CourseStats.applyReview and functions/src/courseStats.ts agree on the shared fixture (M-14)', () {
    final fx = jsonDecode(File('test/fixtures/course_stats_parity.json').readAsStringSync()) as Map<String, dynamic>;
    final reviews = (fx['reviews'] as List)
        .map((m) => Review.fromMap(Map<String, dynamic>.from(m as Map)))
        .toList()
      // The server's lastReviewAt is the newest updatedAt (M-13): fold oldest -> newest.
      ..sort((a, b) => a.updatedAt.compareTo(b.updatedAt));
    var s = CourseStats.empty(fx['courseKey'] as String);
    for (final r in reviews) {
      s = s.applyReview(r, delta: 1);
    }
    expect(s.toMap(), equals(fx['expected']));
  });
}
