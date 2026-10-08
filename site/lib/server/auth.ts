import 'server-only';
import { adminAuth } from './admin';
import { isKuEmail } from '@/lib/ku';
import { HttpError } from '@/lib/http-error';

export { HttpError };

export type KuUser = { uid: string; email: string };

/** Verifies `Authorization: Bearer <Firebase ID token>` belongs to a verified KU student. */
export async function requireKuUser(req: Request): Promise<KuUser> {
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, 'ログインが必要です。');
  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch {
    throw new HttpError(401, 'ログインの有効期限が切れました。もう一度ログインしてください。');
  }
  const email = decoded.email?.toLowerCase() ?? '';
  if (!isKuEmail(email) || decoded.email_verified !== true) {
    throw new HttpError(403, '京大メールの確認が済んだアカウントだけが利用できます。');
  }
  return { uid: decoded.uid, email };
}

/** Wraps a Route Handler body: HttpError -> its status, anything else -> 500. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: 'サーバーでエラーが発生しました。' }, { status: 500 });
  }
}
