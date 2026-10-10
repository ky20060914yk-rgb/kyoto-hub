import { handle, requireKuUser } from '@/lib/server/auth';
import { previewResource } from '@/lib/server/resources';
import { connection } from 'next/server';
import { HttpError } from '@/lib/http-error';

// Blurred first-page preview (free). Private bucket, so it streams through here.
export async function GET(req: Request) {
  await connection(); // per-user response; never prerender
  let bytes: Buffer | null = null;
  const failure = await handle(async () => {
    await requireKuUser(req);
    const postId = new URL(req.url).searchParams.get('postId');
    if (!postId) throw new HttpError(400, '資料の指定が正しくありません。');
    bytes = await previewResource(postId);
    return null;
  });
  if (!bytes) return failure;
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
}
