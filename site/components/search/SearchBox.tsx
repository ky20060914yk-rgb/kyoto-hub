'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, Skeleton } from '@/components/ui/Skeleton';
import { CourseRow } from '@/components/course/bits';
import { HeroBand } from '@/components/shell/HeroBand';
import { useNow } from '@/lib/use-now';
import { DAYS, DAY_LABEL, type CatalogCourse, type Day } from '@/lib/public-types';

const PERIODS = [1, 2, 3, 4, 5];
/** One-tap searches for the courses first-years look up most. */
const POPULAR = ['微分積分', '線形代数', '英語', '物理学', '化学', '心理学', '経済学', '情報'];

/**
 * Search by name / lecturer, optionally narrowed to a slot. `trailing` adds a
 * per-row action (timetable picker). With `hero`, the controls sit in the brand
 * band and `children` (rankings etc.) show while nothing is being searched.
 */
export function SearchBox({ initialDay = null, initialPeriod = null, trailing, hero = false, children }: {
  initialDay?: Day | null;
  initialPeriod?: number | null;
  trailing?: (c: CatalogCourse) => React.ReactNode;
  hero?: boolean;
  children?: React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const [day, setDay] = useState<Day | null>(initialDay);
  const [period, setPeriod] = useState<number | null>(initialPeriod);
  const [resultsState, setResults] = useState<CatalogCourse[] | null>(null);
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

  const searching = !!q.trim() || !!day;
  const now = useNow();
  const today: Day | null = now ? DAYS[now.getDay() - 1] ?? null : null;

  const input = (
    <label className="relative block">
      <span className="sr-only">科目名・教員名で検索</span>
      <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-2" />
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="科目名・教員名で検索"
        className={`w-full rounded-m pl-12 pr-4 text-body text-ink outline-none ring-brand placeholder:text-ink-disabled focus:ring-2 ${
          hero ? 'h-14 bg-surface shadow-float' : 'h-12 bg-surface-muted'}`} />
    </label>
  );

  const dayChips = (
    <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="曜日で絞り込み">
      {DAYS.map((d) => (
        <FilterChip key={d} on={day === d} onBrand={hero} onClick={() => { setDay(day === d ? null : d); if (day === d) setPeriod(null); }}>
          {DAY_LABEL[d]}
        </FilterChip>
      ))}
      {day ? (
        <>
          <span className={`mx-1 h-5 w-px ${hero ? 'bg-on-brand/30' : 'bg-line'}`} aria-hidden />
          {PERIODS.map((n) => (
            <FilterChip key={n} on={period === n} onBrand={hero} onClick={() => setPeriod(period === n ? null : n)}>{n}限</FilterChip>
          ))}
        </>
      ) : null}
    </div>
  );

  const results = !searching || resultsState === null ? null : loading && resultsState.length === 0 ? (
    <div className="mt-4 flex flex-col gap-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
  ) : resultsState.length === 0 ? (
    <EmptyState icon={<Icon name="search" className="size-10" />} title="見つかりませんでした" body="別のキーワードや、曜日・時限の条件を変えて試してください。" />
  ) : (
    <ul className="mt-4 animate-fade-in rounded-l border border-line bg-surface px-4" aria-live="polite">
      {resultsState.map((c) => (
        <CourseRow key={c.id} href={`/courses/${c.id}`} name={c.name} lecturer={c.lecturer} dayOfWeek={c.dayOfWeek} period={c.period}
          trailing={trailing?.(c)} />
      ))}
    </ul>
  );

  if (!hero) {
    return (
      <div>
        {input}
        {dayChips}
        {results}
      </div>
    );
  }

  return (
    <>
      <HeroBand subtitle="授業名・先生の名前・曜日からさがせます">
        {input}
        {searching ? dayChips : (
          <>
            <div className="mt-3 flex flex-wrap gap-2" aria-label="よく検索される科目">
              {today ? (
                <FilterChip on={false} onBrand onClick={() => setDay(today)}>
                  <Icon name="calendar" className="mr-1 inline size-3.5 -mt-0.5" />今日（{DAY_LABEL[today]}）の授業
                </FilterChip>
              ) : null}
              {POPULAR.map((w) => <FilterChip key={w} on={false} onBrand onClick={() => setQ(w)}>{w}</FilterChip>)}
            </div>
            {dayChips}
          </>
        )}
      </HeroBand>
      <div className="mx-auto max-w-page px-4 pb-8 md:px-8">
        {searching ? (
          <div className="pt-2">
            <button type="button" onClick={() => { setQ(''); setDay(null); setPeriod(null); }} className="mt-4 inline-flex items-center gap-1 text-caption text-brand hover:underline">
              <Icon name="chevronLeft" className="size-4" />検索をやめる
            </button>
            {results}
          </div>
        ) : children}
      </div>
    </>
  );
}

function FilterChip({ on, onBrand = false, onClick, children }: { on: boolean; onBrand?: boolean; onClick: () => void; children: React.ReactNode }) {
  const look = onBrand
    ? on ? 'border-surface bg-surface font-medium text-brand' : 'border-on-brand/30 bg-on-brand/10 text-on-brand hover:bg-on-brand/20'
    : on ? 'border-brand bg-brand-subtle font-medium text-brand' : 'border-line-strong bg-surface text-ink hover:bg-surface-muted';
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`h-8 min-w-10 rounded-full border px-3 text-caption transition-colors duration-fast ${look}`}>
      {children}
    </button>
  );
}
