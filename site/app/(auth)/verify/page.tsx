'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { refreshVerified, resendVerification, signOutUser, authErrorMessage } from '@/lib/firebase/auth-actions';

const COOLDOWN = 60;

export default function VerifyPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [left, setLeft] = useState(COOLDOWN);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // Poll until the link in the mail has been clicked.
  useEffect(() => {
    if (!user) return;
    const t = setInterval(async () => {
      if (await refreshVerified()) router.replace('/search?welcome=1');
    }, 5000);
    return () => clearInterval(t);
  }, [user, router]);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  async function resend() {
    try {
      await resendVerification();
      setMsg('確認メールを再送しました。');
      setLeft(COOLDOWN);
    } catch (e) {
      setMsg(authErrorMessage(e));
    }
  }

  return (
    <div className="text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-full bg-brand-subtle text-brand">
        <Icon name="mail" className="size-7" />
      </div>
      <h1 className="mt-4 text-title">メールを確認してください</h1>
      <p className="mt-2 text-body text-ink-2">
        <span className="font-medium text-ink">{user?.email}</span> に確認メールを送りました。メール内のリンクを開くと、自動で次に進みます。
      </p>
      <p className="mt-2 text-caption text-ink-2">届かないときは迷惑メールフォルダも確認してください。</p>
      {msg ? <p role="status" className="mt-4 text-caption text-ink">{msg}</p> : null}
      <div className="mt-6 flex flex-col gap-2">
        <Button variant="secondary" onClick={resend} disabled={left > 0}>
          {left > 0 ? `再送できるまで ${left} 秒` : '確認メールを再送'}
        </Button>
        <Button variant="text" onClick={() => signOutUser().then(() => router.replace('/login'))}>
          別のアドレスでやり直す
        </Button>
      </div>
    </div>
  );
}
