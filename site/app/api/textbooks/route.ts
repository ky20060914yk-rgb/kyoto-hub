import { handle, requireKuUser } from '@/lib/server/auth';
import { createListing, updateListing } from '@/lib/server/textbooks';
import { parseListingInput } from '@/lib/domain/textbook';
import { HttpError } from '@/lib/http-error';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireKuUser(req);
    return createListing(user, parseListingInput(await req.json().catch(() => null), user.uid));
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const user = await requireKuUser(req);
    const b = await req.json().catch(() => ({}));
    if (typeof b?.id !== 'string' || !['close', 'extend'].includes(b?.action)) throw new HttpError(400, '操作が正しくありません。');
    return updateListing(user, b.id, b.action);
  });
}
