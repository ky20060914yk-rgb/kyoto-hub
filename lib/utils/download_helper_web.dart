import 'dart:html' as html;

/// Downloads a signed URL. The URL carries `Content-Disposition: attachment`, so
/// navigating the current tab to it saves the file without leaving the app —
/// unlike `window.open`, which popup blockers kill once we have awaited the
/// callable (the user gesture is gone by then).
void startDownload(String url) {
  final a = html.AnchorElement(href: url)
    ..target = '_self'
    ..style.display = 'none';
  html.document.body?.append(a);
  a.click();
  a.remove();
}

String getUriOrigin() {
  return html.window.location.origin;
}

String getUriHref() {
  return html.window.location.href;
}

void saveEmailForSignIn(String email) {
  html.window.localStorage['emailForSignIn'] = email;
}

String? getEmailForSignIn() {
  return html.window.localStorage['emailForSignIn'];
}
