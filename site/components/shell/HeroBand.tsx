'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { useNow } from '@/lib/use-now';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export function greeting(now: Date) {
  const h = now.getHours();
  if (h >= 4 && h < 11) return 'おはようございます';
  if (h >= 11 && h < 18) return 'こんにちは';
  return 'こんばんは';
}

export const dateLabel = (now: Date) => `${now.getMonth() + 1}月${now.getDate()}日（${WEEK[now.getDay()]}）`;

/** The signed-in user's display name (null while loading or signed out). */
export function useDisplayName(): string | null {
  const { user } = useAuth();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((s) => setName((s.data()?.displayName as string) ?? null)).catch(() => {});
  }, [user]);
  return user ? name : null;
}

/** Brand-colored band under a `tone="brand"` AppBar: greeting + date, then the page's hero content. */
export function HeroBand({ children, subtitle }: { children?: React.ReactNode; subtitle?: string }) {
  const name = useDisplayName();
  const now = useNow();
  return (
    <section className="bg-brand text-on-brand">
      <div className="mx-auto max-w-page px-4 pb-6 pt-1 md:px-8 md:pb-8">
        <p className="min-h-6 text-caption opacity-80">{now ? dateLabel(now) : ''}</p>
        <p className="min-h-8 text-title">
          {now ? `${greeting(now)}${name ? '、' : ''}` : ''}
          {/* the name wraps as one unit, so 「さん」 never ends up alone on a line */}
          {now && name ? <span className="inline-block">{name}さん</span> : null}
        </p>
        {subtitle ? <p className="mt-0.5 text-caption opacity-80">{subtitle}</p> : null}
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    </section>
  );
}
