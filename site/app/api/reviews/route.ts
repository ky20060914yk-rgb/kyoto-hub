import { revalidateTag } from 'next/cache';
import { handle, requireKuUser } from '@/lib/server/auth';
import { upsertReview, deleteReview } from '@/lib/server/reviews';
import { parseReviewInput } from '@/lib/domain/review';
import { HttpError } from '@/lib/http-error';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireKuUser(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body.courseId !== 'string') throw new HttpError(400, '科目の指定が正しくありません。');
    const result = await upsertReview(user, body.courseId, parseReviewInput(body));
    revalidateTag(`course:${result.courseId}`, 'max');
    revalidateTag('rankings', 'max');
    return { review: result.review, bonus: result.bonus };
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const user = await requireKuUser(req);
    const courseId = new URL(req.url).searchParams.get('courseId');
    if (!courseId) throw new HttpError(400, '科目の指定が正しくありません。');
    await deleteReview(user, courseId);
    revalidateTag(`course:${courseId}`, 'max');
    revalidateTag('rankings', 'max');
    return { ok: true };
  });
}
