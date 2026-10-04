// Static, crawler-facing web files (Plan 4). These run on the VM with dart:io:
// they read files in web/ and firebase.json; they never build or serve anything.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

String read(String path) => File(path).readAsStringSync();

void main() {
  final index = read('web/index.html');

  test('index.html: language, viewport, canonical, share tags, start screen hooks', () {
    expect(index, contains('<html lang="ja">'));
    expect(index, contains('<meta name="viewport" content="width=device-width, initial-scale=1">'));
    expect(index, contains('<link rel="canonical" href="https://kyodai-info.web.app/">'));
    expect(index, contains('<meta property="og:image" content="https://kyodai-info.web.app/og-image.png">'));
    expect(index, contains('<meta name="twitter:card" content="summary_large_image">'));
    expect(index, contains('<meta name="theme-color" content="#0F4C81">'));
    expect(index.contains('content="https://kyodai-info.web.app/favicon.png"'), isFalse);
    expect(index.contains('貸借'), isFalse, reason: 'lending is not offered (spec §3)');
    expect(index, contains('id="start" data-state="loading"'));
    expect(index, contains("addEventListener('flutter-first-frame'"));
    expect(index, contains('window.kyotoHubBootFailed = function'));
    expect(index, contains('<script src="flutter_bootstrap.js" async onerror="window.kyotoHubBootFailed(\'bootstrap\')"></script>'));
  });

  test('flutter_bootstrap.js template keeps the stock tokens and reports failures', () {
    final boot = read('web/flutter_bootstrap.js');
    expect(boot, startsWith('{{flutter_js}}\n{{flutter_build_config}}\n'));
    expect(boot, contains('serviceWorkerVersion: {{flutter_service_worker_version}}'));
    expect(boot, contains("window.kyotoHubBootFailed('engine')"));
    expect(boot, contains("window.kyotoHubBootFailed('loader')"));
  });
}
