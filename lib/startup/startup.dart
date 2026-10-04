import 'dart:async';

/// What `main()` must finish before `runApp` (Plan 4, Ruling S-1).
///
/// Firebase has to be initialised before the first `AppStore` / Firestore /
/// Auth call, so the app is never started without it. Before Plan 4 a Firebase
/// JS SDK that could not load (school or company filters on gstatic.com, an
/// outage) left `main()` awaiting forever and the page blank. Now a failure or
/// a hang longer than [timeout] calls [onFailure] (index.html then shows its
/// failure screen with a retry button) and returns false; the caller must then
/// NOT start the app, so no auth code ever runs against a half-initialised
/// Firebase. A late success after the timeout is ignored (the page offers a
/// reload instead).
Future<bool> initializeBeforeRunApp({
  required Future<void> Function() initFirebase,
  required void Function(String reason) onFailure,
  Duration timeout = kFirebaseInitTimeout,
}) async {
  try {
    await initFirebase().timeout(timeout);
    return true;
  } on TimeoutException {
    onFailure('firebase-timeout');
  } catch (_) {
    onFailure('firebase-error');
  }
  return false;
}

/// Lab cold mobile (Plan 4 dry run): Firebase finishes a few seconds after
/// `main()` starts; 30 s leaves a wide margin for a slow phone line, and the
/// page's own 60 s watchdog stays the outer bound.
const Duration kFirebaseInitTimeout = Duration(seconds: 30);
