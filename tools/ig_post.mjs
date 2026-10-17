// Publish a carousel to Instagram through the Graph API (Meta app + Facebook page link).
//
// Credentials come from ../.env.instagram (gitignored): IG_USER_ID, IG_ACCESS_TOKEN.
// Images must be public JPEG URLs; ours are served from site/public/ig/<post>/<n>.jpg.
//
//   node ig_post.mjs --check                      # which account the token posts to
//   node ig_post.mjs --post review                # dry run: prints what would be posted
//   node ig_post.mjs --post review --publish      # actually publishes
//
// Dry run by default, because a published post is public and can only be removed by hand.

import { readFile } from 'node:fs/promises';

const GRAPH = 'https://graph.facebook.com/v21.0';
const SITE = 'https://kyodai-info--kyodai-sns.asia-east1.hosted.app';
const POSTS = { review: 3, exam: 3, qa: 3, timetable: 3, textbook: 3 };

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const env = Object.fromEntries((await readFile(new URL('../.env.instagram', import.meta.url), 'utf-8'))
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const token = env.IG_ACCESS_TOKEN;
if (!token) { console.error('Fill IG_ACCESS_TOKEN in .env.instagram first.'); process.exit(1); }
let user = env.IG_USER_ID;

async function graph(path, params = {}, method = 'GET') {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === 'GET' ? await fetch(`${GRAPH}/${path}?${body}`) : await fetch(`${GRAPH}/${path}`, { method, body });
  const json = await res.json();
  // Never print the token: Graph errors don't echo it, and we only print json.error.
  if (!res.ok || json.error) throw new Error(`${path}: ${json.error?.message ?? res.status}`);
  return json;
}

async function waitReady(id) {
  for (let i = 0; i < 30; i++) {
    const { status_code: s } = await graph(id, { fields: 'status_code' });
    if (s === 'FINISHED') return;
    if (s === 'ERROR' || s === 'EXPIRED') throw new Error(`container ${id}: ${s}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`container ${id}: not ready after 60s`);
}

// IG_USER_ID may be left blank: find the Instagram account linked to the token's Facebook page(s).
if (!user) {
  const { data = [] } = await graph('me/accounts', { fields: 'name,instagram_business_account{id,username}' });
  const linked = data.filter((p) => p.instagram_business_account);
  if (linked.length !== 1) {
    console.error(linked.length ? `Several Instagram accounts found; put the right id in IG_USER_ID:\n${linked.map((p) => `  ${p.instagram_business_account.id}  @${p.instagram_business_account.username}  (page: ${p.name})`).join('\n')}`
      : 'No Instagram account is linked to the Facebook page(s) this token can see.');
    process.exit(1);
  }
  user = linked[0].instagram_business_account.id;
}

if (flag('--check')) {
  const me = await graph(user, { fields: 'username,name,media_count' });
  console.log(`Token posts to @${me.username} (${me.name ?? ''}), ${me.media_count} posts so far.`);
  process.exit(0);
}

const post = value('--post');
if (!post || !(post in POSTS)) { console.error(`--post must be one of: ${Object.keys(POSTS).join(', ')}`); process.exit(1); }
const images = Array.from({ length: POSTS[post] }, (_, i) => `${SITE}/ig/${post}/${i + 1}.jpg`);
const caption = (await readFile(new URL(`../marketing/instagram/posts/captions/${post}.txt`, import.meta.url), 'utf-8')).trim();

for (const url of images) {
  const r = await fetch(url, { method: 'HEAD' });
  if (!r.ok || !String(r.headers.get('content-type')).includes('jpeg')) throw new Error(`image not public as JPEG yet: ${url} (${r.status})`);
}

if (!flag('--publish')) {
  console.log(`DRY RUN — would publish a ${images.length}-image carousel:\n${images.join('\n')}\n\n${caption}\n\nAdd --publish to post it.`);
  process.exit(0);
}

const children = [];
for (const image_url of images) {
  const { id } = await graph(`${user}/media`, { image_url, is_carousel_item: 'true' }, 'POST');
  await waitReady(id);
  children.push(id);
}
const { id: carousel } = await graph(`${user}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption }, 'POST');
await waitReady(carousel);
const { id: mediaId } = await graph(`${user}/media_publish`, { creation_id: carousel }, 'POST');
const { permalink } = await graph(mediaId, { fields: 'permalink' });
console.log(`Published: ${permalink}`);
