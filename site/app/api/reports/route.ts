import { handle, requireKuUser } from '@/lib/server/auth';
import { reportPost } from '@/lib/server/resources';
import { HttpError } from '@/lib/http-error';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireKuUser(req);
    const body = await req.json().catch(() => ({}));
    if (typeof body?.postId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.postId)) throw new HttpError(400, '投稿の指定が正しくありません。');
    return reportPost(user, body.postId, String(body.reason ?? ''));
  });
}
