'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { signUp, authErrorMessage, MIN_PASSWORD } from '@/lib/firebase/auth-actions';
import { isKuEmail } from '@/lib/ku';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const emailError = touched && email && !isKuEmail(email.trim()) ? '@st.kyoto-u.ac.jp のアドレスを入力してください' : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signUp(email, password, code);
      router.replace('/verify');
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-title">京大メールで無料登録</h1>
      <p className="mt-1 text-caption text-ink-2">京大生だけが使えるサービスです。確認メールをお送りします。</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <TextField label="京大メールアドレス" type="email" autoComplete="email" placeholder="example@st.kyoto-u.ac.jp"
          value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched(true)} error={emailError} required />
        <TextField label="パスワード" type="password" autoComplete="new-password" hint={`${MIN_PASSWORD}文字以上`}
          value={password} onChange={(e) => setPassword(e.target.value)} required minLength={MIN_PASSWORD} />
        <TextField label="招待コード（任意）" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)}
          hint="友達の招待コードを入れると、2人ともクレジットがもらえます" />
        {error ? <p role="alert" className="rounded-m bg-danger-bg px-3 py-2 text-caption text-danger">{error}</p> : null}
        <Button type="submit" loading={busy} disabled={!isKuEmail(email.trim()) || password.length < MIN_PASSWORD}>登録する</Button>
      </form>
      <p className="mt-6 text-center text-caption text-ink-2">
        登録済みの方は <Link href="/login" className="text-brand hover:underline">ログイン</Link>
      </p>
      <p className="mt-3 text-center text-label text-ink-2">
        登録すると<Link href="/legal/terms" className="underline">利用規約</Link>と
        <Link href="/legal/privacy" className="underline">プライバシーポリシー</Link>に同意したものとみなします。
      </p>
    </>
  );
}
