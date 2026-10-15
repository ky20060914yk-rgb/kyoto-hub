import { handle, requireKuUser } from '@/lib/server/auth';
import { createQuestion, deleteOwn } from '@/lib/server/board';
import { parseQuestion, parseTarget } from '@/lib/domain/board';

export async function POST(req: Request) {
  return handle(async () => createQuestion(await requireKuUser(req), parseQuestion(await req.json().catch(() => ({})))));
}

/** The author removes their own question or answer ({ questionId, answerId? }). */
export async function DELETE(req: Request) {
  return handle(async () => deleteOwn(await requireKuUser(req), parseTarget(await req.json().catch(() => ({})))));
}
