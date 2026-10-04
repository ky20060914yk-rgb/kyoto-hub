// Tells the host page (web/index.html) that start-up failed, so it shows its
// failure screen instead of a blank page (Plan 4). No-op off the web.
export 'boot_signal_stub.dart' if (dart.library.js_interop) 'boot_signal_web.dart';
