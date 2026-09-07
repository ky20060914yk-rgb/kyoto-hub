import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/main.dart';

void main() {
  testWidgets('KyotoExamHubApp smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const KyotoExamHubApp());
    expect(find.byType(KyotoExamHubApp), findsOneWidget);
  });
}
