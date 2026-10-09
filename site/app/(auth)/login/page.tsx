'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { signIn, authErrorMessage } from '@/lib/firebase/auth-actions';
import { offerToSavePassword } from '@/lib/firebase/save-password';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await signIn(email, password);
      await offerToSavePassword(email, password);
      // Only same-origin paths, never "//evil.com".
      const target = next?.startsWith('/') && !next.startsWith('//') ? next : '/search';
      router.replace(user.emailVerified ? target : '/verify');
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <TextField label="京大メールアドレス" type="email" name="username" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <TextField label="パスワード" type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error ? <p role="alert" className="rounded-m bg-danger-bg px-3 py-2 text-caption text-danger">{error}</p> : null}
      <Button type="submit" loading={busy} disabled={!email || !password}>ログイン</Button>
      <Link href="/reset" className="text-center text-caption text-brand hover:underline">パスワードを忘れた</Link>
    </form>
  );
}

export default function LoginPage() {
  return (
    <>
      <h1 className="text-title">ログイン</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="mt-4 rounded-m bg-surface-muted px-3 py-2 text-caption text-ink-2">
        以前メールのリンクで登録した方は「パスワードを忘れた」からパスワードを設定してください。
      </p>
      <p className="mt-6 text-center text-caption text-ink-2">
        はじめての方は <Link href="/signup" className="text-brand hover:underline">無料登録</Link>
      </p>
    </>
  );
}
