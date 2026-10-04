// A local stand-in for Firebase Hosting used only for lab measurements (Plan 4).
// Routing and Cache-Control come from the Hosting emulator's answers (hosting.mjs),
// so firebase.json is interpreted by firebase-tools itself, not re-implemented.
// What this server adds, because the emulator lacks it: brotli q11 / gzip -9
// precompressed bodies (like a CDN edge; the emulator compresses at a low level)
// and ETag + 304 revalidation (the emulator always answers 200).
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { sha1 } from './hosting.mjs';

const COMPRESSIBLE = /\.(html|js|mjs|json|css|wasm|otf|ttf|frag|txt|xml|svg|symbols)$|\/NOTICES$|\/$/;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.png': 'image/png', '.otf': 'font/otf', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.css': 'text/css; charset=utf-8',
};
const GSTATIC_SDK = 'https://www.gstatic.com/firebasejs/';
const SDK_PREFIX = '/__sdk/firebasejs/';

function variants(buf, compressible) {
  const v = { raw: buf, etag: `"${sha1(buf)}"` };
  if (compressible) {
    v.br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    v.gzip = gzipSync(buf, { level: 9 });
  }
  return v;
}

/**
 * startServer({ dir, table, port, sdkDir, onRequest }) -> { origin, swap({dir, table}), close() }.
 * `swap` replaces the served build in place (a "deploy" for check_web_cache.mjs);
 * `onRequest(path, status)` sees every answered request.
 * `sdkDir` (sandbox only): the `firebase` npm package directory. The Firebase JS SDK
 * the app loads from www.gstatic.com is then served same-origin under /__sdk/ and
 * the URL in main.dart.js is rewritten — the sandbox denies www.gstatic.com.
 * Production and the user's machine never need this.
 */
export async function startServer({ dir, table, port = 0, sdkDir = null, onRequest = () => {} }) {
  let cache = new Map();
  let deep = table.get('/no/such/deep/path');
  let origin = '';
  const bodyOf = (file) => {
    if (cache.has(file)) return cache.get(file);
    let buf = readFileSync(join(dir, file));
    if (sdkDir && /\/main\.dart\.(js|mjs)$/.test(file)) buf = Buffer.from(buf.toString('utf8').split(GSTATIC_SDK).join(origin + SDK_PREFIX));
    const v = variants(buf, COMPRESSIBLE.test(file));
    cache.set(file, v);
    return v;
  };
  const server = createServer((req, res) => {
    res.on('finish', () => onRequest(decodeURIComponent(new URL(req.url, 'http://x').pathname), res.statusCode));
    const url = new URL(req.url, 'http://x');
    let pathname = decodeURIComponent(url.pathname);
    let entry;
    let file;
    let cacheControl;
    if (sdkDir && pathname.startsWith(SDK_PREFIX)) {
      const name = pathname.split('/').pop();
      const p = join(sdkDir, name);
      if (!/^[\w.-]+\.js$/.test(name) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
      if (!cache.has(pathname)) {
        const src = readFileSync(p, 'utf8').split(GSTATIC_SDK).join(origin + SDK_PREFIX);
        cache.set(pathname, variants(Buffer.from(src), true));
      }
      file = pathname;
      cacheControl = 'public, max-age=31536000'; // what gstatic sends for a versioned SDK file
    } else {
      entry = table.get(pathname + url.search) ?? table.get(pathname) ?? deep;
      if (entry.status >= 300 && entry.status < 400) { res.writeHead(entry.status, { location: entry.location }); res.end(); return; }
      if (entry.status !== 200 || !entry.file) { res.writeHead(entry.status); res.end(); return; }
      file = entry.file;
      cacheControl = entry.cacheControl;
    }
    const v = file.startsWith(SDK_PREFIX) ? cache.get(file) : bodyOf(file);
    const ext = (file.match(/\.[a-z0-9]+$/) ?? [''])[0];
    const headers = { 'content-type': TYPES[ext] ?? 'application/octet-stream', etag: v.etag, vary: 'Accept-Encoding' };
    if (cacheControl) headers['cache-control'] = cacheControl;
    if (req.headers['if-none-match'] === v.etag) { res.writeHead(304, headers); res.end(); return; }
    const ae = String(req.headers['accept-encoding'] ?? '');
    let body = v.raw;
    if (v.br && /\bbr\b/.test(ae)) { body = v.br; headers['content-encoding'] = 'br'; }
    else if (v.gzip && /\bgzip\b/.test(ae)) { body = v.gzip; headers['content-encoding'] = 'gzip'; }
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  // Bodies are compressed on first request and kept: measure_web.mjs makes one
  // discarded warm-up load first, so compression time never lands in a measurement.
  const swap = (next) => { dir = next.dir; table = next.table; deep = table.get('/no/such/deep/path'); cache = new Map(); };
  return { origin, swap, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}
