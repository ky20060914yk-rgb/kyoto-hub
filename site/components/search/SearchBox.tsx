'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, Skeleton } from '@/components/ui/Skeleton';
import { CourseRow } from '@/components/course/bits';
import { DAYS, DAY_LABEL, type CatalogCourse, type Day } from '@/lib/public-types';

const PERIODS = [1, 2, 3, 4, 5];

/** Search by name / lecturer, optionally narrowed to a slot. `onPick` turns rows into buttons (timetable picker). */
export function SearchBox({ initialDay = null, initialPeriod = null, trailing }: {
  initialDay?: Day | null;
  initialPeriod?: number | null;
  trailing?: (c: CatalogCourse) => React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const [day, setDay] = useState<Day | null>(initialDay);
  const [period, setPeriod] = useState<number | null>(initialPeriod);
  const [results, setResults] = useState<CatalogCourse[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q.trim() && !day) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      const p = new URLSearchParams({ q });
      if (day) p.set('day', day);
      if (period) p.set('period', String(period));
      try {
        const res = await fetch(`/api/courses?${p}`, { signal: ctl.signal });
        setResults(((await res.json()) as { courses: CatalogCourse[] }).courses);
      } catch {
        /* aborted */
      }
      setLoading(false);
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, day, period]);

  return (
    <div>
      <label className="relative block">
        <span className="sr-only">科目名・教員名で検索</span>
        <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-2" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="科目名・教員名で検索"
          className="h-12 w-full rounded-m bg-surface-muted pl-12 pr-4 text-body text-ink outline-none ring-brand placeholder:text-ink-disabled focus:ring-2" />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="曜日で絞り込み">
        {DAYS.map((d) => (
          <FilterChip key={d} on={day === d} onClick={() => { setDay(day === d ? null : d); if (day === d) setPeriod(null); }}>{DAY_LABEL[d]}</FilterChip>
        ))}
        {day ? (
          <>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            {PERIODS.map((n) => (
              <FilterChip key={n} on={period === n} onClick={() => setPeriod(period === n ? null : n)}>{n}限</FilterChip>
            ))}
          </>
        ) : null}
      </div>

      {results === null || (!q.trim() && !day) ? null : loading && results.length === 0 ? (
        <div className="mt-4 flex flex-col gap-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : results.length === 0 ? (
        <EmptyState icon={<Icon name="search" className="size-10" />} title="見つかりませんでした" body="別のキーワードや、曜日・時限の条件を変えて試してください。" />
      ) : (
        <ul className="mt-4 rounded-l border border-line bg-surface px-4" aria-live="polite">
          {results.map((c) => (
            <CourseRow key={c.id} href={`/courses/${c.id}`} name={c.name} lecturer={c.lecturer} dayOfWeek={c.dayOfWeek} period={c.period}
              trailing={trailing?.(c)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`h-8 min-w-10 rounded-full border px-3 text-caption transition-colors duration-fast ${
        on ? 'border-brand bg-brand-subtle font-medium text-brand' : 'border-line-strong bg-surface text-ink hover:bg-surface-muted'}`}>
      {children}
    </button>
  );
}
