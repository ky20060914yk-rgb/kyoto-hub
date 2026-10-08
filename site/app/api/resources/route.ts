import { revalidateTag } from 'next/cache';
import { handle, requireKuUser } from '@/lib/server/auth';
import { createResource } from '@/lib/server/resources';
import { parseResourceInput } from '@/lib/domain/resource';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireKuUser(req);
    const r = await createResource(user, parseResourceInput(await req.json().catch(() => null)));
    revalidateTag(`course:${r.courseId}`, 'max');
    revalidateTag('rankings', 'max');
    return r;
  });
}
