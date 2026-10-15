'use client';

import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { EmptyState, Skeleton } from '@/components/ui/Skeleton';
import { TextArea, TextField } from '@/components/ui/TextField';
import { timeAgo } from '@/lib/format';
import { BOARD_LIMITS } from '@/lib/domain/board';

type Question = { id: string; title: string; body: string; authorId: string; authorName: string; answerCount: number; createdAt: string; hidden?: boolean };
type Answer = { id: string; body: string; authorId: string; authorName: string; createdAt: string; hidden?: boolean };

/** Per-course Q&A board (questions/{id}, answers subcollection; writes go through /api/questions*). */
export function QuestionSection({ courseId, courseKey }: { courseId: string; courseKey: string }) {
  const { user, verified, loading } = useAuth();
  const [items, setItems] = useState<Question[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !verified) return;
    return onSnapshot(query(collection(db, 'questions'), where('courseKey', '==', courseKey), orderBy('lastActivityAt', 'desc'), limit(50)),
      (s) => setItems(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Question, 'id'>) })).filter((x) => !x.hidden)), () => setItems([]));
  }, [user, verified, courseKey]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (loading) return <Skeleton className="h-40" />;
  if (!user || !verified) {
    return (
      <div className="rounded-l border border-line bg-surface p-6 text-center">
        <p className="text-heading">質問掲示板は京大生だけが見られます</p>
        <p className="mt-1 text-caption text-ink-2">「教科書は要る？」「去年の課題は？」など、履修した人に聞いてみよう。</p>
        <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
          <ButtonLink href="/signup">京大メールで無料登録</ButtonLink>
          <ButtonLink href={`/login?next=/courses/${courseId}?tab=questions`} variant="secondary">ログイン</ButtonLink>
        </div>
      </div>
    );
  }

  async function report(questionId: string, answerId: string | null) {
    const reason = prompt('通報の理由を書いてください（例：悪口、個人情報、試験中の不正 など）');
    if (reason === null) return;
    try {
      await api('/api/questions/reports', { method: 'POST', json: { questionId, answerId, reason } });
      setToast('通報しました。確認します。');
    } catch (e) {
      setToast(e instanceof Error ? e.message : '通報できませんでした。');
    }
  }

  async function remove(questionId: string, answerId: string | null) {
    if (!confirm(answerId ? 'この回答を削除しますか？' : 'この質問を削除しますか？ 回答も見えなくなります。')) return;
    try {
      await api('/api/questions', { method: 'DELETE', json: { questionId, answerId } });
      if (!answerId) setOpen(null);
    } catch (e) {
      setToast(e instanceof Error ? e.message : '削除できませんでした。');
    }
  }

  return (
    <section aria-label="質問掲示板">
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption text-ink-2">授業のことを、履修した京大生に質問できます。</p>
        <Button size="sm" className="shrink-0" onClick={() => setAsking(true)}><Icon name="plus" className="size-4" />質問する</Button>
      </div>

      {items === null ? (
        <div className="mt-3 flex flex-col gap-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Icon name="chat" className="size-10" />} title="まだ質問はありません"
          body="「教科書は要る？」「小テストはある？」など、気になることを最初に聞いてみませんか？" />
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {items.map((it) => (
            <li key={it.id} className="rounded-l border border-line bg-surface">
              <button onClick={() => setOpen(open === it.id ? null : it.id)} aria-expanded={open === it.id}
                className="flex w-full items-start gap-3 p-4 text-left">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-subtle text-label text-brand">Q</span>
                <div className="min-w-0 flex-1">
                  <p className="text-heading">{it.title}</p>
                  <p className="mt-0.5 text-caption text-ink-2">{it.authorName}・{timeAgo(it.createdAt)}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-label ${it.answerCount ? 'bg-success-bg text-success' : 'bg-surface-muted text-ink-2'}`}>
                  回答 {it.answerCount}
                </span>
              </button>
              {open === it.id ? (
                <Thread question={it} me={user.uid} onReport={report} onRemove={remove} onToast={setToast} />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-caption text-ink-2">先生や特定の人への悪口、個人情報、試験中の不正につながる書き込みは禁止です。3人から通報されると自動で非公開になります。</p>

      <Sheet open={asking} onClose={() => setAsking(false)} title="質問する">
        {asking ? <AskForm courseId={courseId} onDone={(id) => { setAsking(false); setOpen(id); setToast('質問しました。回答がつくと通知でお知らせします。'); }} /> : null}
      </Sheet>
      {toast ? (
        <div role="status" className="fixed inset-x-4 bottom-20 z-30 mx-auto max-w-sm animate-rise rounded-m bg-ink px-4 py-3 text-center text-caption text-on-brand shadow-float md:bottom-8">{toast}</div>
      ) : null}
    </section>
  );
}

function Thread({ question, me, onReport, onRemove, onToast }: {
  question: Question; me: string;
  onReport: (q: string, a: string | null) => void; onRemove: (q: string, a: string | null) => void; onToast: (s: string) => void;
}) {
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => onSnapshot(query(collection(db, 'questions', question.id, 'answers'), orderBy('createdAt', 'asc'), limit(100)),
    (s) => setAnswers(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Answer, 'id'>) })).filter((a) => !a.hidden)), () => setAnswers([])),
  [question.id]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await api('/api/questions/answers', { method: 'POST', json: { questionId: question.id, body: draft } });
      setDraft('');
    } catch (err) {
      onToast(err instanceof Error ? err.message : '送信できませんでした。');
    }
    setBusy(false);
  }

  const actions = (answerId: string | null, authorId: string) => (
    authorId === me
      ? <button onClick={() => onRemove(question.id, answerId)} className="text-label text-ink-2 hover:text-danger">削除</button>
      : <button onClick={() => onReport(question.id, answerId)} className="text-label text-ink-2 hover:text-ink">通報</button>
  );

  return (
    <div className="border-t border-line px-4 pb-4">
      {question.body ? <p className="mt-3 whitespace-pre-wrap text-body">{question.body}</p> : null}
      <div className="mt-2 flex justify-end">{actions(null, question.authorId)}</div>
      {answers === null ? <Skeleton className="mt-3 h-12" /> : (
        <ul className="mt-2 flex flex-col gap-2">
          {answers.map((a) => (
            <li key={a.id} className="rounded-m bg-canvas px-3 py-2.5">
              <p className="whitespace-pre-wrap text-body">{a.body}</p>
              <div className="mt-1 flex items-center gap-2 text-caption text-ink-2">
                <span>{a.authorName}・{timeAgo(a.createdAt)}</span>
                <span className="ml-auto">{actions(a.id, a.authorId)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={send} className="mt-3 flex flex-col gap-2">
        <TextArea label="回答する" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={BOARD_LIMITS.bodyMax}
          placeholder="知っていることを教えてください" />
        <Button type="submit" size="sm" className="self-end" loading={busy} disabled={!draft.trim()}>回答する</Button>
      </form>
    </div>
  );
}

function AskForm({ courseId, onDone }: { courseId: string; onDone: (questionId: string) => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ questionId: string }>('/api/questions', { method: 'POST', json: { courseId, title, body } });
      onDone(r.questionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '質問できませんでした。');
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField label="質問" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={BOARD_LIMITS.titleMax} required
        placeholder="例：教科書は買ったほうがいいですか？" />
      <TextArea label="補足（任意）" value={body} onChange={(e) => setBody(e.target.value)} maxLength={BOARD_LIMITS.bodyMax} />
      <p className="text-caption text-ink-2">ニックネームで表示されます。悪口・個人情報・試験中の不正につながる質問は禁止です。</p>
      {error ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
      <Button type="submit" loading={busy} disabled={!title.trim()}>質問する</Button>
    </form>
  );
}
