import { handle, requireKuUser } from '@/lib/server/auth';
import { downloadResource } from '@/lib/server/resources';
import { HttpError } from '@/lib/http-error';

const TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };

// Returns the file itself (the bucket is private). Credit state comes back in headers.
export async function POST(req: Request) {
  let result: Awaited<ReturnType<typeof downloadResource>> | null = null;
  const failure = await handle(async () => {
    const user = await requireKuUser(req);
    const body = await req.json().catch(() => ({}));
    if (typeof body?.postId !== 'string') throw new HttpError(400, '資料の指定が正しくありません。');
    result = await downloadResource(user, body.postId, Number(body.fileIndex ?? 0));
    return null;
  });
  if (!result) return failure;
  const r = result as Awaited<ReturnType<typeof downloadResource>>;
  const ext = r.filename.split('.').pop()?.toLowerCase() ?? '';
  return new Response(new Uint8Array(r.bytes), {
    headers: {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Credit-Charged': r.charged ? '1' : '0',
      'X-Credit-Balance': String(r.balance),
    },
  });
}
