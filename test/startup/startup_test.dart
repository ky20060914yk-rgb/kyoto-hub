import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/startup/boot_signal.dart';
import 'package:kyoto_exam_hub/startup/startup.dart';

void main() {
  test('success: ready, no failure reported', () async {
    final failures = <String>[];
    final ready = await initializeBeforeRunApp(initFirebase: () async {}, onFailure: failures.add);
    expect(ready, isTrue);
    expect(failures, isEmpty);
  });

  test('an init error is reported as firebase-error and the app must not start', () async {
    final failures = <String>[];
    final ready = await initializeBeforeRunApp(
      initFirebase: () async => throw StateError('SDK script blocked'),
      onFailure: failures.add,
    );
    expect(ready, isFalse);
    expect(failures, ['firebase-error']);
  });

  test('a hang is cut at the timeout and reported once as firebase-timeout', () async {
    final failures = <String>[];
    final never = Completer<void>();
    final ready = await initializeBeforeRunApp(
      initFirebase: () => never.future,
      onFailure: failures.add,
      timeout: const Duration(milliseconds: 50),
    );
    expect(ready, isFalse);
    expect(failures, ['firebase-timeout']);
    never.complete(); // a late success changes nothing
    await Future<void>.delayed(Duration.zero);
    expect(failures, ['firebase-timeout']);
  });

  test('just inside the timeout still counts as ready', () async {
    final failures = <String>[];
    final ready = await initializeBeforeRunApp(
      initFirebase: () => Future<void>.delayed(const Duration(milliseconds: 10)),
      onFailure: failures.add,
      timeout: const Duration(milliseconds: 500),
    );
    expect(ready, isTrue);
    expect(failures, isEmpty);
  });

  test('the default timeout is 30 s (S-1) and reportBootFailure is a no-op off the web', () {
    expect(kFirebaseInitTimeout, const Duration(seconds: 30));
    reportBootFailure('firebase-error'); // must not throw on the VM
  });
}
