'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { AppBar } from '@/components/shell/AppShell';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, Skeleton } from '@/components/ui/Skeleton';
import { Chip } from '@/components/course/bits';
import { timeAgo } from '@/lib/format';

type Chat = { id: string; listingTitle: string; sellerId: string; sellerName: string; buyerName: string; lastMessage: string; lastAt: string; status: string };

export default function ChatsPage() {
  const { user } = useAuth();
  const [chats, setChats] = useState<Chat[] | null>(null);
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'chats'), where('members', 'array-contains', user.uid), orderBy('lastAt', 'desc'), limit(50));
    return onSnapshot(q, (s) => setChats(s.docs.map((d) => d.data() as Chat)), () => setChats([]));
  }, [user]);

  return (
    <>
      <AppBar title="取引" back="/textbooks" />
      <main className="mx-auto max-w-content px-4 py-6">
        {chats === null ? <Skeleton className="h-40" /> : chats.length === 0 ? (
          <EmptyState icon={<Icon name="chat" className="size-10" />} title="取引はまだありません" body="気になる教科書の「取引を申し込む」から始められます。" />
        ) : (
          <ul className="overflow-hidden rounded-l border border-line bg-surface">
            {chats.map((c) => {
              const selling = c.sellerId === user?.uid;
              return (
                <li key={c.id}>
                  <Link href={`/textbooks/chats/${c.id}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-surface-muted">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2"><span className="truncate text-body font-medium">{c.listingTitle}</span>{c.status === 'done' ? <Chip tone="success">完了</Chip> : null}</span>
                      <span className="block truncate text-caption text-ink-2">{selling ? `${c.buyerName}さん` : `${c.sellerName}さん`}・{c.lastMessage || 'メッセージはまだありません'}</span>
                    </span>
                    <span className="shrink-0 text-label text-ink-disabled">{timeAgo(c.lastAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
