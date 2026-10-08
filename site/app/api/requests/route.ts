import { revalidateTag } from 'next/cache';
import { handle, requireKuUser } from '@/lib/server/auth';
import { createRequest } from '@/lib/server/resources';
import { parseRequestInput } from '@/lib/domain/resource';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireKuUser(req);
    const r = await createRequest(user, parseRequestInput(await req.json().catch(() => null)));
    revalidateTag(`course:${r.courseId}`, 'max');
    return r;
  });
}
