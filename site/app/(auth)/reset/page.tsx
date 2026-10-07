'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { resetPassword, authErrorMessage } from '@/lib/firebase/auth-actions';

export default function ResetPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email);
      setSent(true);
    } catch (err) {
      setError(authErrorMessage(err));
    }
    setBusy(false);
  }

  return (
    <>
      <h1 className="text-title">パスワードの再設定</h1>
      {sent ? (
        <p role="status" className="mt-4 text-body text-ink-2">
          登録済みのアドレスであれば、再設定用のメールを送りました。メール内のリンクから新しいパスワードを設定してください。
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <TextField label="京大メールアドレス" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {error ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
          <Button type="submit" loading={busy} disabled={!email}>再設定メールを送る</Button>
        </form>
      )}
      <p className="mt-6 text-center text-caption">
        <Link href="/login" className="text-brand hover:underline">ログインに戻る</Link>
      </p>
    </>
  );
}
