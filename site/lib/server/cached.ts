import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { loadCatalog, fetchPublicCourse, fetchRankings, fetchIndexableCourses } from './public';

// Cached entry points for pages and Route Handlers. Writes call
// revalidateTag('course:<id>' | 'rankings' | 'catalog', 'max').

export async function getCatalog() {
  'use cache';
  cacheLife('days');
  cacheTag('catalog');
  return loadCatalog();
}

export async function getPublicCourse(id: string) {
  'use cache';
  cacheLife('hours');
  cacheTag(`course:${id}`);
  return fetchPublicCourse(id);
}

export async function getRankings() {
  'use cache';
  cacheLife('hours');
  cacheTag('rankings');
  return fetchRankings(await getCatalog());
}

export async function getIndexableCourses() {
  'use cache';
  cacheLife('hours');
  cacheTag('rankings');
  return fetchIndexableCourses(await getCatalog());
}
