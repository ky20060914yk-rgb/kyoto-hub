'use client';

import { useEffect, useState } from 'react';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from '@/lib/firebase/client';
import { authedFetch, useAuth } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { EmptyState, Skeleton } from '@/components/ui/Skeleton';
import { TextArea, TextField } from '@/components/ui/TextField';
import { Chip } from './bits';
import { timeAgo } from '@/lib/format';
import {
  ALLOWED_TYPES, EXAM_TYPE, MAX_FILES, MAX_FILE_BYTES, RESOURCE_CATEGORY, isPastExam, type ExamType, type ResourceCategory,
} from '@/lib/domain/resource';

type Post = {
  id: string; category: string; year: number | null; examType: ExamType | null; title: string; description: string;
  fileNames: string[]; filePaths?: string[]; downloadCount: number; authorId: string; authorName: string;
  createdAt: string; hidden?: boolean; requestId?: string | null;
};
type Req = { id: string; category: string; year: number | null; title: string; description: string; authorId: string; isFulfilled: boolean; createdAt: string };
type View = 'past_exam' | 'test_prep' | 'requests';

export function ResourceSection({ courseId, courseKey }: { courseId: string; courseKey: string }) {
  const { user, verified, loading } = useAuth();
  const [view, setView] = useState<View>('past_exam');
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [upload, setUpload] = useState<{ open: boolean; requestId?: string; category?: ResourceCategory; year?: number | null }>({ open: false });
  const [askOpen, setAskOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !verified) return;
    const subs = [
      onSnapshot(query(collection(db, 'posts'), where('courseKey', '==', courseKey), orderBy('createdAt', 'desc'), limit(60)),
        (s) => setPosts(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Post, 'id'>) })).filter((p) => !p.hidden)), () => setPosts([])),
      onSnapshot(query(collection(db, 'requests'), where('courseKey', '==', courseKey), orderBy('createdAt', 'desc'), limit(30)),
        (s) => setReqs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Req, 'id'>) }))), () => setReqs([])),
      onSnapshot(doc(db, 'credit_balances', user.uid), (s) => setBalance((s.data()?.balance as number) ?? 0), () => setBalance(0)),
    ];
    return () => subs.forEach((u) => u());
  }, [user, verified, courseKey]);

  // Which posts this user has already paid for (re-download is free).
  useEffect(() => {
    if (!user || !posts) return;
    const unknown = posts.filter((p) => !unlocked.has(p.id) && p.authorId !== user.uid);
    if (!unknown.length) return;
    Promise.all(unknown.map((p) => getDoc(doc(db, 'credits_ledger', `dl_${user.uid}_${p.id}`)).then((s) => (s.exists() ? p.id : null)).catch(() => null)))
      .then((ids) => {
        const got = ids.filter(Boolean) as string[];
        if (got.length) setUnlocked((u) => new Set([...u, ...got]));
      });
  }, [user, posts, unlocked]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (loading) return <Skeleton className="h-40" />;
  if (!user || !verified) {
    return (
      <div className="rounded-l border border-line bg-surface p-6 text-center">
        <p className="text-heading">過去問・資料は京大生だけが見られます</p>
        <p className="mt-1 text-caption text-ink-2">登録すると3クレジットもらえます。1クレジットで1つの資料をダウンロードできます。</p>
        <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
          <ButtonLink href="/signup">京大メールで無料登録</ButtonLink>
          <ButtonLink href={`/login?next=/courses/${courseId}`} variant="secondary">ログイン</ButtonLink>
        </div>
      </div>
    );
  }

  const shown = (posts ?? []).filter((p) => (view === 'past_exam' ? isPastExam(p.category) : !isPastExam(p.category)));
  const openReqs = reqs.filter((r) => !r.isFulfilled);
  const tabs: { key: View; label: string; n: number }[] = [
    { key: 'past_exam', label: '過去問', n: (posts ?? []).filter((p) => isPastExam(p.category)).length },
    { key: 'test_prep', label: '資料', n: (posts ?? []).filter((p) => !isPastExam(p.category)).length },
    { key: 'requests', label: 'リクエスト', n: openReqs.length },
  ];

  async function download(p: Post, i: number) {
    const res = await authedFetch('/api/resources/download', { method: 'POST', body: JSON.stringify({ postId: p.id, fileIndex: i }) });
    if (!res.ok) {
      setToast(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'ダウンロードできませんでした。');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = p.fileNames[i] ?? 'download';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    setUnlocked((u) => new Set([...u, p.id]));
    if (res.headers.get('X-Credit-Charged') === '1') setToast(`1クレジット使いました（残り${res.headers.get('X-Credit-Balance')}）`);
  }

  async function report(p: Post) {
    const reason = prompt('通報の理由を書いてください（例：別の科目の資料、個人情報が写っている など）');
    if (reason === null) return;
    try {
      await api('/api/reports', { method: 'POST', json: { postId: p.id, reason } });
      setToast('通報しました。確認します。');
    } catch (e) {
      setToast(e instanceof Error ? e.message : '通報できませんでした。');
    }
  }

  return (
    <section aria-label="過去問・資料">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="inline-flex gap-1 rounded-m bg-surface-muted p-1">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={view === t.key} onClick={() => setView(t.key)}
              className={`h-8 rounded-s px-3 text-caption transition-colors duration-fast ${view === t.key ? 'bg-surface font-medium text-ink shadow-float' : 'text-ink-2 hover:text-ink'}`}>
              {t.label}{t.n ? <span className="ml-1 tabular">{t.n}</span> : null}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 text-caption text-ink-2">
          <Icon name="coin" className="size-4" />残り <span className="font-medium tabular text-ink">{balance ?? '–'}</span> クレジット
        </span>
      </div>

      {view === 'requests' ? (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-caption text-ink-2">欲しい過去問をリクエストできます。応えてくれた人には3クレジット、あなたは無料でダウンロードできます。</p>
            <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setAskOpen(true)}>リクエストする</Button>
          </div>
          {openReqs.length === 0 ? (
            <EmptyState icon={<Icon name="flag" className="size-10" />} title="受付中のリクエストはありません" />
          ) : (
            <ul className="mt-3 overflow-hidden rounded-l border border-line bg-surface">
              {openReqs.map((r) => (
                <li key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-heading">{r.title}</p>
                    <p className="text-caption text-ink-2">{RESOURCE_CATEGORY[r.category as ResourceCategory] ?? '資料'}{r.year ? `・${r.year}年度` : ''}・{timeAgo(r.createdAt)}</p>
                  </div>
                  {r.authorId === user.uid ? <Chip>自分のリクエスト</Chip> : (
                    <Button size="sm" onClick={() => setUpload({ open: true, requestId: r.id, category: r.category as ResourceCategory, year: r.year })}>応える</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-caption text-ink-2">アップロードすると3クレジットもらえます（同じ年度・種類の重複は対象外）。</p>
            <Button size="sm" className="shrink-0" onClick={() => setUpload({ open: true, category: view })}>
              <Icon name="upload" className="size-4" />アップロード
            </Button>
          </div>
          {posts === null ? (
            <div className="mt-3 flex flex-col gap-2"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
          ) : shown.length === 0 ? (
            <EmptyState icon={<Icon name="file" className="size-10" />} title={view === 'past_exam' ? 'まだ過去問がありません' : 'まだ資料がありません'}
              body="持っている人はアップロードしてみませんか？ 見つからないときは「リクエスト」から募集できます。" />
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {shown.map((p) => {
                const own = p.authorId === user.uid;
                const paid = own || unlocked.has(p.id);
                return (
                  <li key={p.id} className="rounded-l border border-line bg-surface p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-m bg-danger-bg text-danger"><Icon name="file" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-heading">{p.title}</p>
                        <p className="mt-0.5 text-caption text-ink-2">
                          {[p.year && `${p.year}年度`, p.examType && EXAM_TYPE[p.examType], `${p.authorName}`, timeAgo(p.createdAt)].filter(Boolean).join('・')}
                        </p>
                        {p.description ? <p className="mt-2 whitespace-pre-wrap text-body">{p.description}</p> : null}
                      </div>
                      {!own ? (
                        <button onClick={() => report(p)} className="grid size-tap shrink-0 place-items-center rounded-full text-ink-2 hover:bg-surface-muted" aria-label="通報">
                          <Icon name="more" />
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {p.fileNames.map((name, i) => (
                        <Button key={i} size="sm" variant={paid ? 'secondary' : 'primary'} onClick={() => download(p, i)}>
                          <Icon name="download" className="size-4" />
                          <span className="max-w-40 truncate">{p.fileNames.length > 1 ? name : paid ? 'ダウンロード' : 'ダウンロード（1クレジット）'}</span>
                        </Button>
                      ))}
                      <span className="ml-auto text-caption text-ink-2 tabular">{p.downloadCount}回ダウンロード</span>
                      <span className="w-full text-label text-ink-disabled">資料ID: {p.id}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <Sheet open={upload.open} onClose={() => setUpload({ open: false })} title={upload.requestId ? 'リクエストに応える' : '過去問・資料をアップロード'}>
        {upload.open ? (
          <UploadForm courseId={courseId} uid={user.uid} requestId={upload.requestId} initialCategory={upload.category ?? 'past_exam'} initialYear={upload.year ?? null}
            onDone={(granted) => { setUpload({ open: false }); setToast(granted ? `アップロードしました。${granted}クレジットもらえました！` : 'アップロードしました。'); }} />
        ) : null}
      </Sheet>
      <Sheet open={askOpen} onClose={() => setAskOpen(false)} title="過去問・資料をリクエスト">
        {askOpen ? <RequestForm courseId={courseId} onDone={() => { setAskOpen(false); setView('requests'); setToast('リクエストしました。届いたら通知します。'); }} /> : null}
      </Sheet>
      {toast ? (
        <div role="status" className="fixed inset-x-4 bottom-20 z-30 mx-auto max-w-sm animate-rise rounded-m bg-ink px-4 py-3 text-center text-caption text-on-brand shadow-float md:bottom-8">{toast}</div>
      ) : null}
    </section>
  );
}

const years = () => Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - i);

function Select<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}
        className="h-12 w-full rounded-m bg-surface-muted px-3 text-body text-ink outline-none ring-brand focus:ring-2">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function UploadForm({ courseId, uid, requestId, initialCategory, initialYear, onDone }: {
  courseId: string; uid: string; requestId?: string; initialCategory: ResourceCategory | 'requests'; initialYear: number | null; onDone: (granted: number) => void;
}) {
  const [category, setCategory] = useState<ResourceCategory>(initialCategory === 'requests' ? 'past_exam' : initialCategory);
  const [year, setYear] = useState(String(initialYear ?? new Date().getFullYear() - 1));
  const [examType, setExamType] = useState<ExamType | ''>('final');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const autoTitle = `${year ? `${year}年度 ` : ''}${category === 'past_exam' && examType ? EXAM_TYPE[examType] : RESOURCE_CATEGORY[category]}`;

  function pick(list: FileList | null) {
    const arr = [...(list ?? [])];
    const bad = arr.find((f) => f.size > MAX_FILE_BYTES || !ALLOWED_TYPES.includes(f.type));
    if (bad) return setError(`「${bad.name}」は使えません（PDFか画像、1つ20MBまで）。`);
    if (arr.length > MAX_FILES) return setError(`ファイルは${MAX_FILES}個までです。`);
    setError(null);
    setFiles(arr);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) return setError('ファイルを選んでください。');
    setError(null);
    const uploadId = crypto.randomUUID().replaceAll('-', '');
    const total = files.reduce((n, f) => n + f.size, 0);
    const done = new Map<number, number>();
    try {
      setProgress(0);
      await Promise.all(files.map((f, i) => new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef(storage, `uploads/${uid}/pending/${uploadId}/${f.name.replaceAll('/', '_')}`), f, { contentType: f.type });
        task.on('state_changed', (s) => { done.set(i, s.bytesTransferred); setProgress(Math.round(([...done.values()].reduce((a, b) => a + b, 0) / total) * 100)); }, reject, () => resolve());
      })));
      const r = await api<{ granted: number }>('/api/resources', {
        method: 'POST',
        json: { courseId, category, year: year || null, examType: category === 'past_exam' ? examType || null : null, title: title.trim() || autoTitle, description, uploadId, requestId: requestId ?? null },
      });
      onDone(r.granted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アップロードできませんでした。');
      setProgress(null);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Select label="種類" value={category} onChange={setCategory} options={Object.entries(RESOURCE_CATEGORY) as [ResourceCategory, string][]} />
        <Select label="年度" value={year} onChange={setYear} options={[['', '不明'], ...years().map((y) => [String(y), `${y}年度`] as [string, string])]} />
      </div>
      {category === 'past_exam' ? (
        <Select label="試験" value={examType} onChange={setExamType} options={[...(Object.entries(EXAM_TYPE) as [ExamType, string][]), ['', '不明']]} />
      ) : null}
      <TextField label="タイトル" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle} maxLength={80} />
      <TextArea label="説明（任意）" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="解答の有無、範囲など" />
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-l border border-dashed border-line-strong bg-surface-muted px-4 py-6 text-center hover:bg-canvas">
        <Icon name="upload" className="size-6 text-ink-2" />
        <span className="text-body">{files.length ? files.map((f) => f.name).join('、') : 'ファイルを選ぶ（PDF・画像、5つまで）'}</span>
        <input type="file" multiple accept={ALLOWED_TYPES.join(',')} className="sr-only" onChange={(e) => pick(e.target.files)} />
      </label>
      <p className="text-caption text-ink-2">個人情報（氏名・学籍番号）が写っていないか確認してください。教員・権利者から削除依頼があった資料は非公開になります。</p>
      {error ? <p role="alert" className="rounded-m bg-danger-bg px-3 py-2 text-caption text-danger">{error}</p> : null}
      {progress !== null ? (
        <div className="h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-brand transition-all duration-fast" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      <Button type="submit" loading={progress !== null} disabled={!files.length}>アップロードする</Button>
    </form>
  );
}

function RequestForm({ courseId, onDone }: { courseId: string; onDone: () => void }) {
  const [category, setCategory] = useState<ResourceCategory>('past_exam');
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/requests', { method: 'POST', json: { courseId, category, year: year || null, title, description } });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'リクエストできませんでした。');
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Select label="種類" value={category} onChange={setCategory} options={Object.entries(RESOURCE_CATEGORY) as [ResourceCategory, string][]} />
        <Select label="年度" value={year} onChange={setYear} options={[['', '問わない'], ...years().map((y) => [String(y), `${y}年度`] as [string, string])]} />
      </div>
      <TextField label="欲しいもの" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：2024年度 期末試験" maxLength={80} required />
      <TextArea label="補足（任意）" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
      {error ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
      <Button type="submit" loading={busy} disabled={!title.trim()}>リクエストする</Button>
    </form>
  );
}
