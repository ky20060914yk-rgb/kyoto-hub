'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextArea, TextField } from '@/components/ui/TextField';
import { Icon } from '@/components/ui/Icon';

/** Public form for teachers / rights holders. Posting hides the resource immediately (redesign spec A3). */
export default function TakedownPage() {
  const [f, setF] = useState({ postId: '', name: '', email: '', affiliation: '', detail: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/takedown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    if (res.ok) setDone(true);
    else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? '送信できませんでした。');
    setBusy(false);
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-success-bg text-success"><Icon name="check" /></div>
        <h1 className="mt-4 text-title">受け付けました</h1>
        <p className="mt-2 text-body text-ink-2">内容を確認し、速やかに対応します。対応の結果はご連絡先にお知らせします。</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-title">資料の削除依頼（教員・権利者の方）</h1>
      <p className="mt-3 text-body text-ink-2">
        本サービスに掲載された過去問・資料について、著作権者・出題者の方からの削除依頼を受け付けています。
        いただいた依頼は優先して確認し、権利の侵害が認められた資料は速やかに非公開にします。ログインは不要です。
      </p>
      <p className="mt-2 text-caption text-ink-2">資料IDは、科目ページの各資料の下に表示されています。わからない場合は、科目名と資料の内容を「内容」欄にご記入ください。</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <TextField label="対象の資料ID（わかれば）" value={f.postId} onChange={set('postId')} />
        <TextField label="お名前" value={f.name} onChange={set('name')} required autoComplete="name" />
        <TextField label="メールアドレス" type="email" value={f.email} onChange={set('email')} required autoComplete="email" />
        <TextField label="ご所属（任意）" value={f.affiliation} onChange={set('affiliation')} placeholder="例：理学研究科" />
        <TextArea label="内容" value={f.detail} onChange={set('detail')} required placeholder="権利の内容、削除を希望する理由など" />
        {/* honeypot: hidden from people, filled by bots */}
        <input type="text" name="website" value={f.website} onChange={set('website')} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        {error ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
        <Button type="submit" loading={busy}>削除を依頼する</Button>
      </form>
    </>
  );
}
