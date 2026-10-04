// Runs INSIDE `firebase emulators:exec --only hosting` (copied next to the
// temporary firebase.json by hosting.mjs): GETs every path in paths.json
// uncompressed and records what the emulator answered into table.json.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const origin = process.env.PROBE_ORIGIN;
const paths = JSON.parse(readFileSync('paths.json', 'utf8'));
const table = {};
for (const p of paths) {
  const [path, query] = p.split('?');
  const url = origin + path.split('/').map((s) => encodeURIComponent(s)).join('/') + (query ? `?${query}` : '');
  const res = await fetch(url, { headers: { 'accept-encoding': 'identity' }, redirect: 'manual' });
  const body = Buffer.from(await res.arrayBuffer());
  table[p] = {
    status: res.status,
    location: res.headers.get('location'),
    cacheControl: res.headers.get('cache-control'),
    contentType: res.headers.get('content-type'),
    sha1: createHash('sha1').update(body).digest('hex'),
  };
}
writeFileSync('table.json', JSON.stringify(table));
console.log(`probed ${paths.length} paths`);
