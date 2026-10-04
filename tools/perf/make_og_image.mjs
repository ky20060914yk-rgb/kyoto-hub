#!/usr/bin/env node
// Renders the link-preview image web/og-image.png (1200x630) from the HTML
// below with headless Chromium (Plan 4, Task 5). Deterministic for a given
// Chromium build and font version: the only font is Noto Sans JP from Google
// Fonts, subset to exactly the characters used (no local font is involved), and
// the script refuses to write unless the font loaded. Re-run only to change the
// image; commit the PNG. Static marketing text only, no user content.
//   node make_og_image.mjs [--out ../../web/og-image.png]
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO } from './lib/hosting.mjs';
import { launch } from './lib/browser.mjs';

const { values: a } = parseArgs({ options: { out: { type: 'string', default: join(REPO, 'web', 'og-image.png') } } });

const TITLE = '京大InfoHub';
const LEAD = '京大生専用の授業レビュー・過去問共有・教科書マーケット';
const BADGE = '@st.kyoto-u.ac.jp で認証した京大生だけが使えます';
const HOST = 'kyodai-info.web.app';
const text = [...new Set([...(TITLE + LEAD + BADGE + HOST)])].join('');
const css = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@500;800&text=${encodeURIComponent(text)}&display=block`;

const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><link rel="stylesheet" href="${css}">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body { background: #0F4C81; color: #FFFFFF; font-family: 'Noto Sans JP'; position: relative; }
  .band { position: absolute; right: -160px; top: -120px; width: 620px; height: 900px; background: #135A97; transform: rotate(18deg); }
  .box { position: absolute; left: 88px; top: 96px; right: 88px; }
  .logo { width: 112px; height: 112px; }
  h1 { margin: 28px 0 0; font-size: 104px; font-weight: 800; line-height: 1.1; letter-spacing: 1px; }
  p { margin: 20px 0 0; font-size: 34px; font-weight: 500; line-height: 1.4; white-space: nowrap; }
  .badge { position: absolute; left: 88px; bottom: 72px; padding: 12px 24px; border-radius: 999px; background: #FFFFFF; color: #0F4C81; font-size: 28px; font-weight: 800; }
  .host { position: absolute; right: 88px; bottom: 82px; font-size: 28px; font-weight: 500; color: #CFE0F1; }
</style></head><body>
<div class="band"></div>
<div class="box">
  <svg class="logo" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#FFFFFF"/>
    <path d="M32 19 50 28 32 37 14 28Z" fill="#0F4C81"/><path d="M22 33v7c0 3 4.5 6 10 6s10-3 10-6v-7l-10 5Z" fill="#0F4C81" opacity=".85"/></svg>
  <h1>${TITLE}</h1>
  <p>${LEAD}</p>
</div>
<div class="badge">${BADGE}</div>
<div class="host">${HOST}</div>
</body></html>`;

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  const ok = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check("800 104px 'Noto Sans JP'", '京大') && document.fonts.check("500 34px 'Noto Sans JP'", '授業');
  });
  if (!ok) throw new Error('Noto Sans JP did not load (network?) — refusing to write an image with a fallback font');
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
  if (png.length > 100 * 1024) throw new Error(`og image is ${png.length} B (> 100 KB)`);
  writeFileSync(a.out, png);
  console.log(`wrote ${a.out}: ${png.length} B, sha256 ${createHash('sha256').update(png).digest('hex')}`);
} finally {
  await browser.close();
}
