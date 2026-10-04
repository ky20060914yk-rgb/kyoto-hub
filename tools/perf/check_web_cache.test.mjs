// Unit tests for the pure parts of check_web_cache.mjs: node --test tools/perf/check_web_cache.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { headerProblems, returningVerdict } from './check_web_cache.mjs';

const ok = (file, cc = 'no-cache', contentType = 'text/html') => ({ status: 200, cacheControl: cc, contentType, file });
const goodTable = () => new Map([
  ['/', ok('/index.html')],
  ['/no/such/deep/path', ok('/index.html')],
  ['/about/', ok('/about/index.html')],
  ['/about', { status: 301, location: '/about/', cacheControl: 'no-cache' }],
  ['/robots.txt', ok('/robots.txt', 'no-cache', 'text/plain; charset=utf-8')],
  ['/sitemap.xml', ok('/sitemap.xml', 'no-cache', 'application/xml; charset=utf-8')],
]);

test('headerProblems: a correct table has none', () => assert.deepEqual(headerProblems(goodTable()), []));
test('headerProblems: robots.txt must be text/plain', () => {
  const t = goodTable();
  t.set('/robots.txt', ok('/robots.txt', 'no-cache', 'text/html'));
  assert.match(headerProblems(t).join('\n'), /robots\.txt: Content-Type must be text\/plain/);
});
test('headerProblems: sitemap.xml must be xml', () => {
  const t = goodTable();
  t.set('/sitemap.xml', ok('/sitemap.xml', 'no-cache', 'text/plain'));
  assert.match(headerProblems(t).join('\n'), /sitemap\.xml: Content-Type must be an xml type/);
});
test('headerProblems: immutable is flagged', () => {
  const t = goodTable();
  t.set('/main.dart.js', ok('/main.dart.js', 'max-age=31536000, immutable', 'text/javascript'));
  assert.match(headerProblems(t).join('\n'), /main\.dart\.js: immutable/);
});

const files = ['/index.html', '/main.dart.js', '/flutter_bootstrap.js'];
const used = new Map([['/', [200]], ['/main.dart.js', [200]], ['/flutter_bootstrap.js', [200]]]);
test('returningVerdict: identical builds prove nothing', () => {
  const v = returningVerdict(files, used, new Map([['/main.dart.js', [304]]]), () => ['a', 'a']);
  assert.match(v.problems.join(), /v1 and v2 identical/);
});
test('returningVerdict: main.dart.js changed and refetched is fine', () => {
  const v = returningVerdict(files, used, new Map([['/', [200]], ['/main.dart.js', [200]]]), (f) => (f === '/flutter_bootstrap.js' ? ['a', 'a'] : ['a', 'b']));
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.stale, []);
  assert.deepEqual(v.changed, ['/index.html', '/main.dart.js']);
});
test('returningVerdict: "/" counts as index.html; a changed index.html that was not refetched is stale', () => {
  const v = returningVerdict(files, used, new Map([['/main.dart.js', [200]]]), (f) => (f === '/flutter_bootstrap.js' ? ['a', 'a'] : ['a', 'b']));
  assert.deepEqual(v.stale, ['/index.html']);
});
test('returningVerdict: a changed main.dart.js taken from cache is stale', () => {
  const v = returningVerdict(files, used, new Map([['/', [200]]]), () => ['a', 'b']);
  assert.ok(v.stale.includes('/main.dart.js'));
});
