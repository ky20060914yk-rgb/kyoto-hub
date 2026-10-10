'use client';

import { MAX_PREVIEW_BYTES } from '@/lib/domain/resource';

const WIDTH = 900;
const CLEAR = 0.3; // top share left readable (course name, year); the rest is mosaicked
const CELL = 18; // mosaic block size in px

async function firstPage(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (file.type !== 'application/pdf') return createImageBitmap(file);
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: WIDTH / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
  void pdf.destroy();
  return canvas;
}

/**
 * JPEG of the first page with everything below the top 30% mosaicked, made in
 * the browser so the server never has to render PDFs. Null when the browser
 * can't decode the file (e.g. HEIC) — the post then just has no preview.
 * ponytail: the uploader could send an unblurred preview; that only gives away
 * their own upload, and reports cover a misleading one.
 */
export async function makePreview(file: File): Promise<Blob | null> {
  try {
    const src = await firstPage(file);
    const w = WIDTH;
    const h = Math.round((src.height / src.width) * w);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);

    const top = Math.round(h * CLEAR);
    const small = document.createElement('canvas');
    small.width = Math.ceil(w / CELL);
    small.height = Math.ceil((h - top) / CELL);
    small.getContext('2d')!.drawImage(out, 0, top, w, h - top, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, small.width, small.height, 0, top, w, h - top);

    for (const q of [0.7, 0.5, 0.3]) {
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= MAX_PREVIEW_BYTES) return blob;
    }
    return null;
  } catch {
    return null;
  }
}
