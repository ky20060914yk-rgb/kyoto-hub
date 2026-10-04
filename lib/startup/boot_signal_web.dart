import 'dart:js_interop';

@JS('kyotoHubBootFailed')
external JSFunction? get _kyotoHubBootFailed;

/// Calls `window.kyotoHubBootFailed(reason)` defined by web/index.html, if present.
void reportBootFailure(String reason) {
  _kyotoHubBootFailed?.callAsFunction(null, reason.toJS);
}
