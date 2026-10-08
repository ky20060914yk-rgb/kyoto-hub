import { handle, requireKuUser } from '@/lib/server/auth';
import { openChat, completeChat, rateTrade } from '@/lib/server/textbooks';
import { HttpError } from '@/lib/http-error';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireKuUser(req);
    const b = await req.json().catch(() => ({}));
    if (typeof b?.listingId !== 'string') throw new HttpError(400, '出品の指定が正しくありません。');
    return openChat(user, b.listingId);
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const user = await requireKuUser(req);
    const b = await req.json().catch(() => ({}));
    if (typeof b?.chatId !== 'string') throw new HttpError(400, '取引の指定が正しくありません。');
    if (b.action === 'complete') return completeChat(user, b.chatId);
    if (b.action === 'rate') return rateTrade(user, b.chatId, Number(b.stars), String(b.comment ?? ''));
    throw new HttpError(400, '操作が正しくありません。');
  });
}
