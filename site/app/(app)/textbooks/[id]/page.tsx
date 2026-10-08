'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api';
import { AppBar } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, Skeleton } from '@/components/ui/Skeleton';
import { Stars } from '@/components/course/bits';
import { PriceLabel, TypeChip, type Listing } from '@/components/textbook/shared';
import { CONDITION } from '@/lib/domain/textbook';
import { timeAgo } from '@/lib/format';

type ChatRow = { id: string; buyerName: string; lastMessage: string; lastAt: string; status: string };

export default function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [l, setL] = useState<Listing | null | undefined>(undefined);
  const [rating, setRating] = useState<{ sum: number; count: number } | null>(null);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [photo, setPhoto] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onSnapshot(doc(db, 'textbook_listings', id), (s) => setL(s.exists() ? (s.data() as Listing) : null), () => setL(null)), [id]);

  useEffect(() => {
    if (!l) return;
    getDoc(doc(db, 'user_stats', l.sellerId)).then((s) => {
      const d = s.data();
      if (d?.tradeRatingCount) setRating({ sum: d.tradeRatingSum, count: d.tradeRatingCount });
    }).catch(() => {});
  }, [l]);

  const mine = !!user && l?.sellerId === user.uid;
  useEffect(() => {
    if (!mine || !user) return;
    const q = query(collection(db, 'chats'), where('members', 'array-contains', user.uid), where('listingId', '==', id));
    return onSnapshot(q, (s) => setChats(s.docs.map((d) => d.data() as ChatRow)), () => setChats([]));
  }, [mine, user, id]);

  async function contact() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ chatId: string }>('/api/textbooks/chats', { method: 'POST', json: { listingId: id } });
      router.push(`/textbooks/chats/${r.chatId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '申し込めませんでした。');
      setBusy(false);
    }
  }

  async function act(action: 'close' | 'extend') {
    if (action === 'close' && !confirm('この出品を締め切りますか？')) return;
    await api('/api/textbooks', { method: 'PATCH', json: { id, action } }).catch((e) => setError(e.message));
  }

  if (l === undefined) return (<><AppBar title="教科書" back="/textbooks" /><main className="p-4"><Skeleton className="h-80" /></main></>);
  if (l === null) return (<><AppBar title="教科書" back="/textbooks" /><EmptyState icon={<Icon name="book" className="size-10" />} title="出品が見つかりません" /></>);

  const expired = l.expiresAt < new Date().toISOString();
  const closed = l.status !== 'open' || expired;

  return (
    <>
      <AppBar title={l.title} back="/textbooks" />
      <main className="mx-auto grid max-w-page gap-6 px-4 py-6 md:grid-cols-2 md:px-8">
        <div>
          <div className="grid aspect-4/3 place-items-center overflow-hidden rounded-l bg-surface-muted text-ink-disabled">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {l.photos[photo] ? <img src={l.photos[photo]} alt={`${l.title}の写真`} className="size-full object-contain" /> : <Icon name="book" className="size-14" />}
          </div>
          {l.photos.length > 1 ? (
            <div className="mt-2 flex gap-2">
              {l.photos.map((p, i) => (
                <button key={p} onClick={() => setPhoto(i)} aria-label={`写真${i + 1}`}
                  className={`size-16 overflow-hidden rounded-m border-2 ${i === photo ? 'border-brand' : 'border-transparent'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <div className="flex items-center gap-2"><TypeChip type={l.type} />{closed ? <span className="text-caption text-ink-2">受付終了</span> : null}</div>
            <h1 className="mt-2 text-title">{l.title}</h1>
            <div className="mt-2"><PriceLabel l={l} /></div>
          </div>
          <dl className="grid grid-cols-dl gap-y-2 rounded-l border border-line bg-surface p-4 text-caption">
            {l.condition ? (<><dt className="text-ink-2">状態</dt><dd>{CONDITION[l.condition]}</dd></>) : null}
            <dt className="text-ink-2">受け渡し</dt><dd>{l.place}</dd>
            {l.courseName ? (<><dt className="text-ink-2">関連科目</dt><dd>{l.courseId ? <Link className="text-brand hover:underline" href={`/courses/${l.courseId}`}>{l.courseName}</Link> : l.courseName}</dd></>) : null}
            <dt className="text-ink-2">出品者</dt>
            <dd className="flex flex-wrap items-center gap-2">{l.sellerName}{rating ? <Stars value={rating.sum / rating.count} count={rating.count} /> : <span className="text-ink-2">評価なし</span>}</dd>
            <dt className="text-ink-2">出品日</dt><dd>{timeAgo(l.createdAt)}</dd>
          </dl>
          {l.note ? <p className="whitespace-pre-wrap text-body">{l.note}</p> : null}
          <p className="rounded-m bg-warning-bg px-3 py-2 text-caption text-warning">代金は受け渡しのときに直接やり取りしてください。先払いの要求には応じないでください。</p>
          {error ? <p role="alert" className="text-caption text-danger">{error}</p> : null}

          {mine ? (
            <div className="flex flex-col gap-3">
              <h2 className="text-heading">申し込み（{chats.length}）</h2>
              {chats.length === 0 ? <p className="text-caption text-ink-2">まだ申し込みはありません。</p> : (
                <ul className="overflow-hidden rounded-l border border-line bg-surface">
                  {chats.map((c) => (
                    <li key={c.id}>
                      <Link href={`/textbooks/chats/${c.id}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-surface-muted">
                        <span className="min-w-0 flex-1"><span className="block text-body">{c.buyerName}</span><span className="block truncate text-caption text-ink-2">{c.lastMessage || 'メッセージはまだありません'}</span></span>
                        <span className="text-label text-ink-disabled">{timeAgo(c.lastAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                {!closed ? <Button variant="secondary" onClick={() => act('close')}>締め切る</Button> : null}
                {expired || l.status !== 'open' ? <Button variant="secondary" onClick={() => act('extend')}>30日間 再公開</Button> : null}
              </div>
            </div>
          ) : (
            <Button onClick={contact} loading={busy} disabled={closed}>
              <Icon name="chat" className="size-5" />{l.type === 'want' ? '譲れます・売れますと連絡する' : '取引を申し込む'}
            </Button>
          )}
        </div>
      </main>
    </>
  );
}
