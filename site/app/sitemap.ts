import type { MetadataRoute } from 'next';
import { connection } from 'next/server';
import { getIndexableCourses } from '@/lib/server/cached';

const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// Only courses with at least one review (spec §4.1): ~10k empty pages would dilute the site.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection(); // request time, not build time
  const courses = await getIndexableCourses();
  return [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/search`, changeFrequency: 'daily', priority: 0.9 },
    ...courses.map((c) => ({
      url: `${base}/courses/${c.id}`,
      lastModified: c.lastReviewAt ? new Date(c.lastReviewAt) : undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
}
