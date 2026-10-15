import { handle, requireKuUser } from '@/lib/server/auth';
import { createAnswer } from '@/lib/server/board';
import { parseAnswer } from '@/lib/domain/board';

export async function POST(req: Request) {
  return handle(async () => createAnswer(await requireKuUser(req), parseAnswer(await req.json().catch(() => ({})))));
}
