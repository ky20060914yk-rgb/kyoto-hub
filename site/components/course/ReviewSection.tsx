'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { EmptyState, Skeleton } from '@/components/ui/Skeleton';
import { Chip, StarGlyph } from './bits';
import { ReviewForm } from './ReviewForm';
import {
  RAKUTAN, ATTENDANCE, GRADING, PAST_EXAM, BRING_IN, type Review, type ReviewInput,
} from '@/lib/domain/review';

const COLLAPSE = 220;

export function ReviewSection({ courseId, courseKey, courseName }: { courseId: string; courseKey: string; courseName: string }) {
  const { user, verified, loading } = useAuth();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !verified) return;
    const q = query(collection(db, 'reviews'), where('courseKey', '==', courseKey), orderBy('updatedAt', 'desc'), limit(50));
    return onSnapshot(q, (s) => setReviews(s.docs.map((d) => d.data() as Review)), () => setReviews([]));
  }, [user, verified, courseKey]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  if (loading) return <Skeleton className="h-40" />;

  if (!user || !verified) {
    return (
      <div className="rounded-l border border-line bg-surface p-6 text-center">
        <p className="text-heading">レビュー本文は京大生だけが読めます</p>
        <p className="mt-1 text-caption text-ink-2">京大メールで無料登録すると、すべてのレビューと過去問を見られます。</p>
        <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
          <ButtonLink href="/signup">京大メールで無料登録</ButtonLink>
          <ButtonLink href={`/login?next=/courses/${courseId}`} variant="secondary">ログイン</ButtonLink>
        </div>
      </div>
    );
  }

  const mine = reviews?.find((r) => r.authorId === user.uid);
  const others = reviews?.filter((r) => r.authorId !== user.uid) ?? [];

  async function save(input: ReviewInput) {
    const res = await api<{ bonus: { granted: number } }>('/api/reviews', { method: 'POST', json: { courseId, ...input } });
    setOpen(false);
    setToast(res.bonus.granted > 0 ? `投稿しました。${res.bonus.granted}クレジットもらえました！` : '保存しました。');
  }

  async function remove() {
    await api(`/api/reviews?courseId=${encodeURIComponent(courseId)}`, { method: 'DELETE' });
    setOpen(false);
    setToast('レビューを削除しました。');
  }

  return (
    <section aria-labelledby="reviews-h">
      <div className="flex items-center justify-between gap-3">
        <h2 id="reviews-h" className="text-heading">レビュー{reviews ? `（${reviews.length}件）` : ''}</h2>
        <Button size="sm" variant={mine ? 'secondary' : 'primary'} onClick={() => setOpen(true)}>
          {mine ? '自分のレビューを編集' : 'レビューを書く'}
        </Button>
      </div>

      {reviews === null ? (
        <div className="mt-3 flex flex-col gap-3"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      ) : reviews.length === 0 ? (
        <EmptyState icon={<Icon name="chat" className="size-10" />} title="まだレビューがありません"
          body="最初の1件を書いてみませんか？ 履修を迷っている後輩の助けになります。"
          action={<Button onClick={() => setOpen(true)}>レビューを書く</Button>} />
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {mine ? <ReviewCard review={mine} own onEdit={() => setOpen(true)} /> : null}
          {others.map((r) => <ReviewCard key={r.id} review={r} uid={user.uid} />)}
        </ul>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={`${courseName}のレビュー`}>
        {open ? <ReviewForm initial={mine} onSubmit={save} onDelete={mine ? remove : undefined} /> : null}
      </Sheet>

      {toast ? (
        <div role="status" className="fixed inset-x-4 bottom-20 z-30 mx-auto max-w-sm animate-rise rounded-m bg-ink px-4 py-3 text-center text-caption text-on-brand shadow-float md:bottom-8">
          {toast}
        </div>
      ) : null}
    </section>
  );
}

function ReviewCard({ review, own, uid, onEdit }: { review: Review; own?: boolean; uid?: string; onEdit?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [helpful, setHelpful] = useState(uid ? review.helpfulBy?.includes(uid) : false);
  const [count, setCount] = useState(review.helpfulBy?.length ?? 0);
  const [pop, setPop] = useState(0);
  const long = review.comment.length > COLLAPSE;

  async function toggle() {
    const prev = { helpful, count };
    setHelpful(!helpful);
    setCount(count + (helpful ? -1 : 1));
    setPop((p) => p + 1);
    try {
      const r = await api<{ helpful: boolean; count: number }>('/api/reviews/helpful', { method: 'POST', json: { reviewId: review.id } });
      setHelpful(r.helpful);
      setCount(r.count);
    } catch {
      setHelpful(prev.helpful);
      setCount(prev.count);
    }
  }

  return (
    <li className={`rounded-l border bg-surface p-4 ${own ? 'border-brand' : 'border-line'}`}>
      <div className="flex items-center gap-2">
        <span className="inline-flex" aria-label={`おすすめ度 ${review.rating}`}>
          {[1, 2, 3, 4, 5].map((i) => <StarGlyph key={i} fill={review.rating >= i ? 1 : 0} className="size-4" />)}
        </span>
        <span className="text-caption text-ink-2">
          {[review.termTaken, review.gradeTaken && `評価 ${review.gradeTaken}`].filter(Boolean).join('・') || review.authorName}
        </span>
        {own ? <span className="ml-auto"><Chip tone="brand">あなたのレビュー</Chip></span> : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip tone={review.rakutan === 'raku' ? 'success' : review.rakutan === 'muzu' ? 'danger' : 'neutral'}>楽単度 {RAKUTAN[review.rakutan]}</Chip>
        <Chip>出席 {ATTENDANCE[review.attendance]}</Chip>
        <Chip>{GRADING[review.grading]}</Chip>
        <Chip>過去問 {PAST_EXAM[review.pastExam]}</Chip>
        <Chip>持ち込み {BRING_IN[review.bringIn]}</Chip>
      </div>
      {review.comment ? (
        <p className="mt-3 whitespace-pre-wrap text-body text-ink">
          {long && !expanded ? `${review.comment.slice(0, COLLAPSE)}…` : review.comment}
          {long ? (
            <button className="ml-1 text-brand hover:underline" onClick={() => setExpanded(!expanded)}>{expanded ? '閉じる' : '続きを読む'}</button>
          ) : null}
        </p>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        {own ? (
          <Button size="sm" variant="secondary" onClick={onEdit}>編集</Button>
        ) : (
          <button onClick={toggle} aria-pressed={helpful}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-label transition-colors duration-fast ${
              helpful ? 'border-brand bg-brand-subtle text-brand' : 'border-line-strong text-ink-2 hover:bg-surface-muted'}`}>
            <span key={pop} className={pop ? 'animate-pop' : ''}><Icon name="thumb" className="size-4" /></span>
            役に立った <span className="tabular">{count}</span>
          </button>
        )}
        {own ? <span className="text-caption text-ink-2">役に立った {count}</span> : null}
      </div>
    </li>
  );
}
