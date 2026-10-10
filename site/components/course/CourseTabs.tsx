'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ResourceSection } from './ResourceSection';
import { OPEN_REVIEW_FORM } from './CourseActions';

/** レビュー / 過去問・資料 tabs (redesign spec §4.1). Reviews are the default. */
export function CourseTabs({ reviews, resourceCount, courseId, courseKey }:
  { reviews: React.ReactNode; resourceCount: number; courseId: string; courseKey: string }) {
  const initial = useSearchParams().get('tab') === 'resources' ? 'resources' : 'reviews';
  const [tab, setTab] = useState<'reviews' | 'resources'>(initial);
  useEffect(() => {
    const toReviews = () => setTab('reviews');
    window.addEventListener(OPEN_REVIEW_FORM, toReviews);
    return () => window.removeEventListener(OPEN_REVIEW_FORM, toReviews);
  }, []);
  const tabs = [
    { key: 'reviews' as const, label: 'レビュー' },
    { key: 'resources' as const, label: `過去問・資料${resourceCount ? `（${resourceCount}）` : ''}` },
  ];
  return (
    <div>
      <div role="tablist" className="relative flex border-b border-line">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`relative h-11 flex-1 text-body transition-colors duration-fast md:flex-none md:px-6 ${
              tab === t.key ? 'font-medium text-brand' : 'text-ink-2 hover:text-ink'}`}>
            {t.label}
            <span className={`absolute inset-x-0 -bottom-px h-0.5 origin-center bg-brand transition-transform duration-fast ease-out-cubic ${
              tab === t.key ? 'scale-x-100' : 'scale-x-0'}`} />
          </button>
        ))}
      </div>
      <div className="pt-6">
        <div hidden={tab !== 'reviews'} className="animate-fade-in">{reviews}</div>
        <div hidden={tab !== 'resources'} className="animate-fade-in">
          <ResourceSection courseId={courseId} courseKey={courseKey} />
        </div>
      </div>
    </div>
  );
}
