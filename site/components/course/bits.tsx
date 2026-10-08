import Link from 'next/link';
import { DAY_LABEL, type Day } from '@/lib/public-types';

/** ★ display: 5 stars + number + count (design.md §6.4). Stars never stand alone. */
export function Stars({ value, count, size = 'sm', showValue = true }: { value: number; count?: number; size?: 'sm' | 'lg'; showValue?: boolean }) {
  const px = size === 'lg' ? 'size-5' : 'size-4';
  return (
    <span className="inline-flex items-center gap-1" aria-label={`5点中${value.toFixed(1)}点${count !== undefined ? `、${count}件` : ''}`}>
      <span className="inline-flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <StarGlyph key={i} fill={Math.max(0, Math.min(1, value - i + 1))} className={px} />
        ))}
      </span>
      {showValue ? <span className="font-medium tabular text-ink">{value.toFixed(1)}</span> : null}
      {count !== undefined ? <span className="tabular text-ink-2">({count})</span> : null}
    </span>
  );
}

const STAR = 'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9L12 2.8z';

export function StarGlyph({ fill, className }: { fill: number; className?: string }) {
  const id = `s${Math.round(fill * 100)}`;
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <defs>
        <linearGradient id={id}>
          <stop offset={`${fill * 100}%`} stopColor="var(--color-star)" />
          <stop offset={`${fill * 100}%`} stopColor="var(--color-line)" />
        </linearGradient>
      </defs>
      <path d={STAR} fill={`url(#${id})`} />
    </svg>
  );
}

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'brand';
const TONE: Record<Tone, string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  neutral: 'bg-surface-muted text-ink-2',
  brand: 'bg-brand-subtle text-brand',
};

export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex h-6 items-center rounded-s px-2 text-label ${TONE[tone]}`}>{children}</span>;
}

/** 楽単度 chip from the 0..100 score (needs at least one review). */
export function RakutanChip({ score, reviewCount }: { score: number; reviewCount: number }) {
  if (reviewCount === 0) return null;
  if (score >= 62) return <Chip tone="success">楽単</Chip>;
  if (score <= 38) return <Chip tone="danger">難しめ</Chip>;
  return <Chip>普通</Chip>;
}

export const slotLabel = (dayOfWeek: Day, period: number) => `${DAY_LABEL[dayOfWeek]}${period}`;

/** Penmark-style course row (design.md §6.3). */
export function CourseRow({ href, name, lecturer, dayOfWeek, period, avgRating, reviewCount, score, leading, trailing }: {
  leading?: React.ReactNode; href: string; name: string; lecturer: string; dayOfWeek: Day; period: number;
  avgRating?: number; reviewCount?: number; score?: number; trailing?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-line last:border-b-0">
      {leading}
      <Link href={href} className="flex min-h-18 min-w-0 flex-1 flex-col justify-center gap-0.5 py-3 transition-colors duration-instant hover:bg-surface-muted md:px-2">
        <span className="truncate text-heading text-ink">{name}</span>
        <span className="truncate text-caption text-ink-2">{slotLabel(dayOfWeek, period)}・{lecturer}</span>
        {reviewCount !== undefined ? (
          <span className="mt-1 flex flex-wrap items-center gap-2 text-caption">
            {reviewCount > 0 ? <Stars value={avgRating ?? 0} count={reviewCount} /> : <span className="text-ink-2">まだレビューがありません</span>}
            {score !== undefined ? <RakutanChip score={score} reviewCount={reviewCount} /> : null}
            {reviewCount > 0 && reviewCount < 5 ? <Chip tone="warning">レビュー募集中</Chip> : null}
          </span>
        ) : null}
      </Link>
      {trailing}
    </li>
  );
}

/** Horizontal distribution bar with a % label (design.md §6.6). Animates once on mount. */
export function DistributionBars({ title, counts, labels }: { title: string; counts: Record<string, number>; labels: Record<string, string> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div>
      <p className="text-label text-ink-2">{title}</p>
      <ul className="mt-1 flex flex-col gap-1.5">
        {Object.entries(labels).map(([key, label]) => {
          const pct = total ? Math.round(((counts[key] ?? 0) / total) * 100) : 0;
          return (
            <li key={key} className="grid grid-cols-dist items-center gap-2 text-caption">
              <span className="truncate text-ink">{label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <span className="block h-full origin-left animate-grow rounded-full bg-brand" style={{ width: `${pct}%` }} />
              </span>
              <span className="text-right tabular text-ink-2">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
