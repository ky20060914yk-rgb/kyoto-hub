import { handle } from '@/lib/server/auth';
import { requestTakedown } from '@/lib/server/resources';
import { HttpError } from '@/lib/http-error';

// Public form for teachers / rights holders (no sign-in). Hides the post at once.
export async function POST(req: Request) {
  return handle(async () => {
    const b = await req.json().catch(() => ({}));
    if (b?.website) return { ok: true }; // honeypot: bots fill every field
    const postId = String(b?.postId ?? '').trim().split('/').pop() ?? '';
    const s = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
    const input = { postId, name: s(b?.name, 100), email: s(b?.email, 200), affiliation: s(b?.affiliation, 200), detail: s(b?.detail, 4000) };
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(postId)) throw new HttpError(400, '対象の資料IDを入力してください。');
    if (!input.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email) || !input.detail) throw new HttpError(400, 'お名前・メールアドレス・内容を入力してください。');
    return requestTakedown(input);
  });
}
