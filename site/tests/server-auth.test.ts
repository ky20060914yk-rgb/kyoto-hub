import { describe, it, expect, beforeAll } from 'vitest';
import { requireKuUser, HttpError } from '@/lib/server/auth';
import { makeUser, clearEmulators, req } from './emu';

async function status(p: Promise<unknown>) {
  try { await p; return 200; } catch (e) { return e instanceof HttpError ? e.status : 500; }
}

describe('requireKuUser', () => {
  let ok: { uid: string; idToken: string };
  let unverified: { idToken: string };
  let outsider: { idToken: string };
  beforeAll(async () => {
    await clearEmulators();
    ok = await makeUser('taro@st.kyoto-u.ac.jp', true);
    unverified = await makeUser('jiro@st.kyoto-u.ac.jp', false);
    outsider = await makeUser('x@gmail.com', true);
  });

  it('401 without a token', async () => expect(await status(requireKuUser(req()))).toBe(401));
  it('401 with a garbage token', async () => expect(await status(requireKuUser(req('nope')))).toBe(401));
  it('403 when unverified', async () => expect(await status(requireKuUser(req(unverified.idToken)))).toBe(403));
  it('403 for a non-KU address', async () => expect(await status(requireKuUser(req(outsider.idToken)))).toBe(403));
  it('returns the verified KU user', async () => {
    expect(await requireKuUser(req(ok.idToken))).toEqual({ uid: ok.uid, email: 'taro@st.kyoto-u.ac.jp' });
  });
});
