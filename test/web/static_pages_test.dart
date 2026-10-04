// Static, crawler-facing web files (Plan 4). These run on the VM with dart:io:
// they read files in web/ and firebase.json; they never build or serve anything.
import 'dart:io';
import 'dart:typed_data';

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

  test('about/: static page with its own canonical, a link to the app and no app code', () {
    final about = read('web/about/index.html');
    expect(about, contains('<html lang="ja">'));
    expect(about, contains('<link rel="canonical" href="https://kyodai-info.web.app/about/">'));
    expect(about, contains('<a class="cta" href="/">'));
    expect(about.contains('<script src='), isFalse, reason: 'the landing must not start the app');
    expect(about, contains('c.saveData'), reason: 'P-1: no prefetch with Data Saver');
  });

  test('robots.txt and sitemap.xml list only public pages', () {
    expect(read('web/robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: https://kyodai-info.web.app/sitemap.xml\n');
    final locs = RegExp(r'<loc>([^<]+)</loc>').allMatches(read('web/sitemap.xml')).map((m) => m.group(1)).toList();
    expect(locs, ['https://kyodai-info.web.app/', 'https://kyodai-info.web.app/about/']);
  });

  test('og-image.png is a 1200x630 PNG under 100 KB', () {
    final bytes = File('web/og-image.png').readAsBytesSync();
    expect(bytes.length, lessThan(100 * 1024));
    expect(bytes.sublist(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
    final ihdr = ByteData.sublistView(Uint8List.fromList(bytes), 16, 24);
    expect([ihdr.getUint32(0), ihdr.getUint32(4)], [1200, 630]);
  });
}
