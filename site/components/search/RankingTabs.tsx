'use client';

import { useState } from 'react';
import { CourseRow } from '@/components/course/bits';
import { EmptyState } from '@/components/ui/Skeleton';
import { Icon } from '@/components/ui/Icon';
import { ButtonLink } from '@/components/ui/Button';
import type { PublicRankRow, RankingKind } from '@/lib/public-types';

const KINDS: { key: RankingKind; label: string; empty: string }[] = [
  { key: 'rakutan', label: '楽単', empty: 'レビューが2件以上ある科目がまだありません。' },
  { key: 'mostReviewed', label: 'レビューが多い', empty: 'まだレビューがありません。' },
  { key: 'mostPastExams', label: '過去問が多い', empty: 'まだ過去問がありません。' },
  { key: 'recent', label: '新着レビュー', empty: 'まだレビューがありません。' },
];

export function RankingTabs({ data }: { data: Record<RankingKind, PublicRankRow[]> }) {
  // Tabs always show; open the first ranking that has data.
  const [kind, setKind] = useState<RankingKind>(() => KINDS.find((k) => data[k.key].length)?.key ?? 'rakutan');
  const rows = data[kind];
  const meta = KINDS.find((k) => k.key === kind)!;
  return (
    <div className="mt-4">
      <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-m bg-surface-muted p-1">
        {KINDS.map((k) => (
          <button key={k.key} role="tab" aria-selected={kind === k.key} onClick={() => setKind(k.key)}
            className={`h-8 rounded-s px-3 text-caption transition-colors duration-fast ${
              kind === k.key ? 'bg-surface font-medium text-ink shadow-float' : 'text-ink-2 hover:text-ink'}`}>
            {k.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div key={kind} className="mt-4 animate-fade-in rounded-l border border-dashed border-line-strong bg-surface">
          <EmptyState icon={<Icon name="star" className="size-10 text-star" />} title={`「${meta.label}」ランキングはまだありません`}
            body={kind === 'mostPastExams'
              ? `${meta.empty} 科目ページの「過去問・資料」からアップロードすると、ここに並びます（1件につき3クレジット）。`
              : `${meta.empty} 履修した授業のレビューを書くと、ここに並びます（最初の3件はそれぞれ2クレジット）。`}
            action={<ButtonLink href="/timetable" size="sm">{kind === 'mostPastExams' ? '時間割から科目を開く' : '時間割からレビューを書く'}</ButtonLink>} />
        </div>
      ) : (
        <ol key={kind} className="mt-4 animate-fade-in rounded-l border border-line bg-surface px-4">
          {rows.map((r, i) => (
            <CourseRow key={r.id} href={`/courses/${r.id}`} name={r.name} lecturer={r.lecturer} dayOfWeek={r.dayOfWeek} period={r.period}
              avgRating={r.avgRating} reviewCount={r.reviewCount} score={r.score}
              leading={<span className={`w-6 shrink-0 text-center text-heading tabular ${i < 3 ? 'text-brand' : 'text-ink-2'}`}>{i + 1}</span>}
              trailing={kind === 'mostPastExams' ? <span className="shrink-0 text-caption text-ink-2 tabular">過去問 {r.pastExamPostCount}</span> : undefined} />
          ))}
        </ol>
      )}
    </div>
  );
}
