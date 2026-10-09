import { Suspense } from 'react';
import { connection } from 'next/server';
import type { Metadata } from 'next';
import { getRankings } from '@/lib/server/cached';
import { AppBar } from '@/components/shell/AppShell';
import { Skeleton } from '@/components/ui/Skeleton';
import { SearchBox } from '@/components/search/SearchBox';
import { RankingTabs } from '@/components/search/RankingTabs';
import { MyCourses } from '@/components/search/MyCourses';

export const metadata: Metadata = {
  title: '京大の楽単・授業ランキングと科目検索',
  description: '京大生のレビューで作った楽単ランキング、レビューが多い科目、過去問が多い科目。科目名・教員名で全学共通科目を検索できます。',
  alternates: { canonical: '/search' },
};

export default function SearchPage() {
  return (
    <>
      <AppBar title="さがす" tone="brand" />
      <main>
        <SearchBox hero>
          <MyCourses />
          <section className="mt-8" aria-labelledby="rank-h">
            <h2 id="rank-h" className="flex items-center gap-2 text-title"><span className="text-star">★</span>ランキング</h2>
            <p className="mt-1 text-caption text-ink-2">京大生のレビューから毎時更新しています。</p>
            <Suspense fallback={<Skeleton className="mt-4 h-96" />}>
              <Rankings />
            </Suspense>
          </section>
        </SearchBox>
      </main>
    </>
  );
}

async function Rankings() {
  // Read at request time (data stays cached via 'use cache'), never at build: the build has no database.
  await connection();
  return <RankingTabs data={await getRankings()} />;
}
