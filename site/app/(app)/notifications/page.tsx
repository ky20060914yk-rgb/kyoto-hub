'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { AppBar } from '@/components/shell/AppShell';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, Skeleton } from '@/components/ui/Skeleton';
import { timeAgo } from '@/lib/format';

type Notification = { id: string; title: string; body: string; href: string | null; read: boolean; createdAt: string };

export default function NotificationsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[] | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'notifications'), where('uid', '==', user.uid), orderBy('createdAt', 'desc'), limit(50));
    return onSnapshot(q, (s) => setItems(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Notification, 'id'>) }))), () => setItems([]));
  }, [user]);

  const markRead = (n: Notification) => {
    if (!n.read) updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(() => {});
  };

  return (
    <>
      <AppBar title="通知" />
      <main className="mx-auto max-w-content px-4 py-6">
        {items === null ? (
          <div className="flex flex-col gap-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Icon name="bell" className="size-10" />} title="通知はまだありません"
            body="レビューが「役に立った」と言われたときや、リクエストした過去問が届いたときにお知らせします。" />
        ) : (
          <ul className="overflow-hidden rounded-l border border-line bg-surface">
            {items.map((n) => {
              const inner = (
                <>
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-brand'}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-body ${n.read ? 'text-ink-2' : 'font-medium text-ink'}`}>{n.title}</span>
                    {n.body ? <span className="mt-0.5 block text-caption text-ink-2">{n.body}</span> : null}
                    <span className="mt-1 block text-label text-ink-disabled">{timeAgo(n.createdAt)}</span>
                  </span>
                  {!n.read ? <span className="sr-only">未読</span> : null}
                </>
              );
              const cls = 'flex gap-3 border-b border-line px-4 py-3 last:border-b-0 transition-colors duration-instant hover:bg-surface-muted';
              return (
                <li key={n.id}>
                  {n.href ? (
                    <Link href={n.href} onClick={() => markRead(n)} className={cls}>{inner}</Link>
                  ) : (
                    <button onClick={() => markRead(n)} className={`${cls} w-full text-left`}>{inner}</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
