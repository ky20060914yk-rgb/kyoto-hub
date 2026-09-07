import 'dart:html' as html;

void openUrlInNewTab(String url) {
  html.window.open(url, '_blank');
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
