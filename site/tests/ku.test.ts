import { describe, it, expect } from 'vitest';
import { isKuEmail } from '@/lib/ku';

describe('isKuEmail', () => {
  it.each([
    ['taro.kyodai.12a@st.kyoto-u.ac.jp', true],
    ['A@ST.KYOTO-U.AC.JP', true],
    ['evil@evil.com@st.kyoto-u.ac.jp', false],
    ['a@st.kyoto-u.ac.jp.attacker.com', false],
    ['a@kyoto-u.ac.jp', false],
    ['@st.kyoto-u.ac.jp', false],
    [' a@st.kyoto-u.ac.jp', false],
  ])('%s -> %s', (email, ok) => expect(isKuEmail(email)).toBe(ok));
});
