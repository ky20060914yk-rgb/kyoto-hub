'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { CourseIcon, slotLabel } from '@/components/course/bits';
import { Icon } from '@/components/ui/Icon';
import type { Day } from '@/lib/public-types';

type Row = { id: string; name: string; slot: string };

/** Signed-in only: the user's timetable courses, one tap from their reviews (and from writing one). */
export function MyCourses() {
  const { user, verified } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!user || !verified) return;
    return onSnapshot(doc(db, 'user_timetables', user.uid), async (s) => {
      const tt = (s.data()?.timetable as Record<string, string>) ?? {};
      const seen = new Map<string, string>();
      for (const [key, id] of Object.entries(tt)) if (!seen.has(id)) seen.set(id, key);
      const out = await Promise.all([...seen].slice(0, 12).map(async ([id, key]) => {
        const d = (await getDoc(doc(db, 'courses', id))).data();
        const [day, p] = key.split('_');
        return { id, name: (d?.name as string) ?? '科目', slot: slotLabel(day as Day, Number(p)) };
      }));
      setRows(out);
    }, () => setRows([]));
  }, [user, verified]);

  if (!rows || rows.length === 0) return null;
  return (
    <section aria-labelledby="mine-h" className="mt-6">
      <div className="flex items-baseline justify-between">
        <h2 id="mine-h" className="text-heading">あなたの時間割の授業</h2>
        <Link href="/timetable" className="text-caption text-brand hover:underline">時間割へ</Link>
      </div>
      <ul className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
        {rows.map((r) => (
          <li key={r.id} className="w-56 shrink-0 snap-start md:w-auto">
            <Link href={`/courses/${r.id}`} className="flex h-full items-center gap-3 rounded-l border border-line bg-surface p-3 transition-colors duration-instant hover:border-line-strong">
              <CourseIcon name={r.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">{r.name}</span>
                <span className="block text-caption text-ink-2">{r.slot}</span>
              </span>
              <Icon name="chevronRight" className="size-4 shrink-0 text-ink-disabled" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
