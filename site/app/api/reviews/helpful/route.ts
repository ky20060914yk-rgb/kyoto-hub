import { handle, requireKuUser } from '@/lib/server/auth';
import { toggleHelpful } from '@/lib/server/reviews';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireKuUser(req);
    const body = await req.json().catch(() => ({}));
    const { helpful, count } = await toggleHelpful(user, String(body?.reviewId ?? ''));
    return { helpful, count };
  });
}
