'use client';

import { EmptyState } from '@/components/ui/Skeleton';
import { Icon } from '@/components/ui/Icon';

// Replaced in M4 (past exams + credits).
export function ResourceSection(_: { courseId: string; courseKey: string }) {
  return <EmptyState icon={<Icon name="file" className="size-10" />} title="過去問・資料は準備中です" />;
}
