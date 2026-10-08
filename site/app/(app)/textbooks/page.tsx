'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { AppBar } from '@/components/shell/AppShell';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { EmptyState, Skeleton } from '@/components/ui/Skeleton';
import { ListingCard, type Listing } from '@/components/textbook/shared';
import { ListingForm } from '@/components/textbook/ListingForm';
import { LISTING_TYPE, type ListingType } from '@/lib/domain/textbook';
import { norm } from '@/lib/norm';

export default function TextbooksPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Listing[] | null>(null);
  const [type, setType] = useState<ListingType | 'all'>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const qy = query(collection(db, 'textbook_listings'), where('status', '==', 'open'), orderBy('createdAt', 'desc'), limit(200));
    return onSnapshot(qy, (s) => setItems(s.docs.map((d) => d.data() as Listing)), () => setItems([]));
  }, []);

  const shown = useMemo(() => {
    const now = new Date().toISOString();
    const terms = norm(q);
    return (items ?? []).filter((l) => l.expiresAt > now && (type === 'all' || l.type === type)
      && (!terms || norm(`${l.title}${l.courseName ?? ''}`).includes(terms)));
  }, [items, type, q]);

  return (
    <>
      <AppBar title="教科書" actions={<ButtonLink href="/textbooks/chats" variant="text" size="sm"><Icon name="chat" className="size-4" />取引</ButtonLink>} />
      <main className="mx-auto max-w-page px-4 py-6 md:px-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative flex-1">
            <span className="sr-only">本のタイトル・科目名で検索</span>
            <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-2" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="本のタイトル・科目名で検索"
              className="h-12 w-full rounded-m bg-surface-muted pl-12 pr-4 text-body outline-none ring-brand placeholder:text-ink-disabled focus:ring-2" />
          </label>
          <Button onClick={() => setOpen(true)} className="shrink-0"><Icon name="plus" className="size-5" />出品・募集する</Button>
        </div>
        <div role="tablist" className="mt-4 inline-flex gap-1 rounded-m bg-surface-muted p-1">
          {([['all', 'すべて'], ...Object.entries(LISTING_TYPE)] as [ListingType | 'all', string][]).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={type === k} onClick={() => setType(k)}
              className={`h-8 rounded-s px-3 text-caption transition-colors duration-fast ${type === k ? 'bg-surface font-medium text-ink shadow-float' : 'text-ink-2 hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-caption text-ink-2">京大生どうしの教科書の譲り合い・売り買い。受け渡しは学内で、お金のやり取りはアプリの外で行います。</p>

        {items === null ? (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-3/4" />)}</div>
        ) : shown.length === 0 ? (
          <EmptyState icon={<Icon name="book" className="size-10" />} title={q ? '見つかりませんでした' : 'まだ出品がありません'}
            body="使わなくなった教科書を出品したり、欲しい教科書を「買いたい」で募集できます。" action={<Button onClick={() => setOpen(true)}>出品・募集する</Button>} />
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {shown.map((l) => <ListingCard key={l.id} l={l} />)}
          </ul>
        )}
      </main>
      <Sheet open={open} onClose={() => setOpen(false)} title="出品・募集する">
        {open && user ? <ListingForm uid={user.uid} onDone={(id) => router.push(`/textbooks/${id}`)} /> : null}
      </Sheet>
    </>
  );
}
