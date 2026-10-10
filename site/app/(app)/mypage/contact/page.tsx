'use client';

import { useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { AppBar } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { TextArea, TextField } from '@/components/ui/TextField';
import { Icon } from '@/components/ui/Icon';

// Same category keys as the Flutter app (lib/models/inquiry.dart).
const CATEGORIES = { other: 'ご意見・ご質問', report: '不具合・不適切な投稿の報告', circle_ad: 'サークル・団体の広告掲載' } as const;
type Category = keyof typeof CATEGORIES;

export default function ContactPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState<Category>('other');
  const [content, setContent] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || content.trim().length < 5) return;
    setBusy(true);
    setError(null);
    try {
      await addDoc(collection(db, 'inquiries'), {
        university_id: 'kyoto_u', userId: user.uid, category, content: content.trim().slice(0, 4000),
        contactInfo: contactInfo.trim() || user.email, targetPostId: null, createdAt: new Date().toISOString(),
      });
      setSent(true);
    } catch {
      setError('送信できませんでした。時間をおいてもう一度お試しください。');
    }
    setBusy(false);
  }

  return (
    <>
      <AppBar title="お問い合わせ" back="/mypage" />
      <main className="mx-auto max-w-content px-4 py-6">
        {sent ? (
          <div className="rounded-l border border-line bg-surface p-6 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-success-bg text-success"><Icon name="check" /></div>
            <p className="mt-3 text-heading">送信しました</p>
            <p className="mt-1 text-caption text-ink-2">内容を確認し、必要に応じてご連絡します。</p>
          </div>
        ) : (
          <>
          <div className="mb-4 rounded-l border border-line bg-brand-subtle p-4">
            <p className="text-heading">サークル・団体の広告を掲載できます</p>
            <p className="mt-1 text-caption text-ink-2">新歓やイベントの告知を京大生に届けたい方は、種類で「{CATEGORIES.circle_ad}」を選んで、団体名と告知したい内容を送ってください。掲載場所・期間・料金をご案内します。</p>
            <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => setCategory('circle_ad')}>広告掲載について問い合わせる</Button>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-5 rounded-l border border-line bg-surface p-5">
            <fieldset>
              <legend className="mb-1.5 text-label">種類</legend>
              <div className="flex flex-col gap-2">
                {(Object.keys(CATEGORIES) as Category[]).map((k) => (
                  <label key={k} className={`flex h-11 cursor-pointer items-center gap-3 rounded-m border px-3 text-body transition-colors duration-fast ${
                    category === k ? 'border-brand bg-brand-subtle' : 'border-line-strong'}`}>
                    <input type="radio" name="category" value={k} checked={category === k} onChange={() => setCategory(k)} className="accent-brand" />
                    {CATEGORIES[k]}
                  </label>
                ))}
              </div>
            </fieldset>
            <TextArea label="内容" value={content} onChange={(e) => setContent(e.target.value)} maxLength={4000} required
              placeholder="できるだけ具体的に書いてください。不適切な投稿の報告は、科目名と投稿の内容を添えてください。" />
            <TextField label="連絡先（任意）" value={contactInfo} onChange={(e) => setContactInfo(e.target.value)} hint="空欄なら登録メールアドレスに返信します" />
            <p className="text-caption text-ink-2">
              教員・権利者の方からの削除依頼は <a className="text-brand underline" href="/legal/takedown">専用フォーム</a> からお願いします。
            </p>
            {error ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
            <Button type="submit" loading={busy} disabled={content.trim().length < 5}>送信する</Button>
          </form>
          </>
        )}
      </main>
    </>
  );
}
