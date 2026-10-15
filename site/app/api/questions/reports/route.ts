import { handle, requireKuUser } from '@/lib/server/auth';
import { reportBoard } from '@/lib/server/board';
import { parseTarget } from '@/lib/domain/board';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireKuUser(req);
    const body = await req.json().catch(() => ({}));
    return reportBoard(user, parseTarget(body), String((body as { reason?: unknown }).reason ?? ''));
  });
}
