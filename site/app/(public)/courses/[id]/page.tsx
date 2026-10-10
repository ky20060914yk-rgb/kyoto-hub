import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getPublicCourse } from '@/lib/server/cached';
import { AppBar } from '@/components/shell/AppShell';
import { Skeleton } from '@/components/ui/Skeleton';
import { Chip, CourseIcon, DistributionBars, RakutanChip, Stars, slotLabel } from '@/components/course/bits';
import { CourseActions } from '@/components/course/CourseActions';
import { Icon } from '@/components/ui/Icon';
import { ReviewSection } from '@/components/course/ReviewSection';
import { CourseTabs } from '@/components/course/CourseTabs';
import { RAKUTAN, ATTENDANCE, GRADING, PAST_EXAM, BRING_IN } from '@/lib/domain/review';
import type { PublicCourse } from '@/lib/public-types';

export async function generateMetadata(props: PageProps<'/courses/[id]'>): Promise<Metadata> {
  const { id } = await props.params;
  const c = await getPublicCourse(id);
  if (!c) return { title: '科目が見つかりません', robots: { index: false } };
  const s = c.stats;
  const title = `${c.name}（${c.lecturer}）の楽単度・評判`;
  const description = s.reviewCount
    ? `京大「${c.name}」${c.lecturer}。おすすめ度 ★${s.avgRating}（${s.reviewCount}件）。楽単度・出席・成績のつけ方・過去問の効きを京大生のレビューで。`
    : `京大「${c.name}」${c.lecturer}の授業レビュー。履修した京大生のレビューを募集中です。`;
  return {
    title,
    description,
    alternates: { canonical: `/courses/${c.id}` },
    robots: s.reviewCount === 0 ? { index: false, follow: true } : undefined,
    openGraph: { title, description, type: 'article' },
  };
}

export default function CoursePage(props: PageProps<'/courses/[id]'>) {
  return (
    <Suspense fallback={<CourseSkeleton />}>
      <CourseDetail params={props.params} />
    </Suspense>
  );
}

async function CourseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getPublicCourse(id);
  if (!c) notFound();
  return (
    <>
      <AppBar title={c.name} back="/search" />
      <main className="mx-auto grid max-w-page gap-6 px-4 py-6 md:px-8 xl:grid-cols-course xl:gap-x-8">
        <CourseHeader c={c} />
        <aside className="xl:sticky xl:top-20 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:self-start">
          <SideCard c={c} />
        </aside>
        <div className="min-w-0 xl:col-start-1">
          <JsonLd c={c} />
          <CourseTabs
            resourceCount={c.stats.pastExamPostCount + c.stats.resourcePostCount}
            reviews={<ReviewSection courseId={c.id} courseKey={c.courseKey} courseName={c.name} />}
            courseId={c.id}
            courseKey={c.courseKey}
          />
        </div>
      </main>
    </>
  );
}

function CourseHeader({ c }: { c: PublicCourse }) {
  return (
    <header className="flex items-start gap-4 xl:col-start-1">
      <span className="hidden sm:block"><CourseIcon name={c.name} size="lg" /></span>
      <div className="min-w-0">
        <h1 className="text-title md:text-display">{c.name}</h1>
        <p className="mt-1 text-caption text-ink-2">
          {c.lecturer}
          {c.category ? `・${c.category}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {c.slots.map((s) => (
            <Link key={s.id} href={`/courses/${s.id}`}>
              <Chip tone={s.id === c.id ? 'brand' : 'neutral'}>{slotLabel(s.dayOfWeek, s.period)}</Chip>
            </Link>
          ))}
          {c.stats.reviewCount > 0 && c.stats.reviewCount < 5 ? <Chip tone="warning">レビュー募集中</Chip> : null}
        </div>
      </div>
    </header>
  );
}

/** Summary + actions. Side column on wide screens, under the header on phones. */
function SideCard({ c }: { c: PublicCourse }) {
  const s = c.stats;
  const resources = s.pastExamPostCount + s.resourcePostCount;
  return (
    <section aria-label="この授業のまとめ" className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-5">
      {s.reviewCount === 0 ? (
        <div className="rounded-l bg-warning-bg p-4">
          <p className="flex items-center gap-2 text-heading text-warning"><Icon name="star" className="size-5" />レビュー募集中</p>
          <p className="mt-1 text-caption text-ink">まだレビューがありません。履修したことがあれば、最初の1件を書いてみませんか？ 後輩の履修選びの助けになります。</p>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <span className="text-display tabular">{s.avgRating.toFixed(1)}</span>
          <div className="flex flex-col gap-1">
            <Stars value={s.avgRating} size="lg" showValue={false} />
            <span className="flex items-center gap-2 text-caption text-ink-2">{s.reviewCount}件のレビュー<RakutanChip score={s.score} reviewCount={s.reviewCount} /></span>
          </div>
        </div>
      )}

      <CourseActions courseId={c.id} courseName={c.name} dayOfWeek={c.dayOfWeek} period={c.period} />

      {s.reviewCount > 0 ? (
        <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2 xl:grid-cols-1">
          <DistributionBars title="楽単度" counts={s.rakutanCounts} labels={RAKUTAN} />
          <DistributionBars title="出席" counts={s.attendanceCounts} labels={ATTENDANCE} />
          <DistributionBars title="成績のつけ方" counts={s.gradingCounts} labels={GRADING} />
          <DistributionBars title="過去問の効き" counts={s.pastExamCounts} labels={PAST_EXAM} />
          <DistributionBars title="持ち込み" counts={s.bringInCounts} labels={BRING_IN} />
        </div>
      ) : null}

      <dl className="grid grid-cols-dl gap-y-2 border-t border-line pt-5 text-caption">
        <dt className="text-ink-2">開講</dt>
        <dd>{c.slots.map((x) => slotLabel(x.dayOfWeek, x.period)).join('・')}</dd>
        <dt className="text-ink-2">担当</dt>
        <dd>{c.lecturer}</dd>
        {c.category ? (<><dt className="text-ink-2">区分</dt><dd>{c.category}</dd></>) : null}
        <dt className="text-ink-2">過去問・資料</dt>
        <dd>{resources ? `${resources}件` : 'まだありません'}</dd>
      </dl>
    </section>
  );
}

function JsonLd({ c }: { c: PublicCourse }) {
  if (c.stats.reviewCount < 3) return null;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: c.name,
    description: `京都大学「${c.name}」（${c.lecturer}）`,
    provider: { '@type': 'CollegeOrUniversity', name: '京都大学' },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: c.stats.avgRating, ratingCount: c.stats.reviewCount, bestRating: 5, worstRating: 1 },
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

function CourseSkeleton() {
  return (
    <main className="mx-auto max-w-page px-4 py-6 md:px-8" aria-busy>
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="mt-2 h-4 w-1/3" />
      <Skeleton className="mt-6 h-48" />
    </main>
  );
}
