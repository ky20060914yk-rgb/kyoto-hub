// Shapes shared by server projections (lib/server/public.ts) and client components.
import type { CourseStats } from '@/lib/domain/review';

export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
export type CatalogCourse = {
  id: string; courseKey: string; name: string; lecturer: string; faculty: string; category: string;
  dayOfWeek: Day; period: number;
};
export type PublicStats = Omit<CourseStats, 'university_id' | 'courseKey'> & { avgRating: number };
export type PublicCourse = CatalogCourse & { slots: { id: string; dayOfWeek: Day; period: number }[]; stats: PublicStats };
export type RankingKind = 'rakutan' | 'mostReviewed' | 'mostPastExams' | 'recent';
export type PublicRankRow = {
  id: string; name: string; lecturer: string; dayOfWeek: Day; period: number;
  reviewCount: number; avgRating: number; score: number; pastExamPostCount: number;
};

export const DAYS: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const DAY_LABEL: Record<Day, string> = { Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金' };
