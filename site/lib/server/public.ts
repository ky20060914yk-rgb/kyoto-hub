import 'server-only';
import { adminDb } from './admin';
import { statsFromDoc, slug, avgRating, type CourseStats } from '@/lib/domain/review';
import { DAYS, type Day, type CatalogCourse, type PublicStats, type PublicCourse, type RankingKind, type PublicRankRow } from '@/lib/public-types';

export * from '@/lib/public-types';

/*
 * Everything a signed-out visitor (and a search engine) may see. Every value
 * returned here is built field by field from course / aggregate data — review
 * text, author ids and user data cannot reach a public page through this file.
 * The cached wrappers live in ./cached.ts (kept apart so tests can call these
 * without the Next.js runtime).
 */

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

function toCatalog(id: string, d: Record<string, unknown>): CatalogCourse {
  return {
    id,
    courseKey: str(d.courseKey),
    name: str(d.name),
    lecturer: str(d.lecturer, '担当教員不明'),
    faculty: str(d.faculty),
    category: str(d.category),
    dayOfWeek: str(d.dayOfWeek, 'Mon') as Day,
    period: typeof d.period === 'number' ? d.period : 0,
  };
}

export async function loadCatalog(): Promise<CatalogCourse[]> {
  const snap = await adminDb.collection('courses').where('university_id', '==', 'kyoto_u').get();
  return snap.docs.map((d) => toCatalog(d.id, d.data())).filter((c) => c.courseKey && c.name);
}

/** Lower-cased NFKC without spaces: 「ﾋﾞｾｷﾌﾞﾝ Ａ」 and 「ビセキブン a」 compare equal. */
export const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export function searchCatalog(
  catalog: CatalogCourse[], q: string, filter: { day?: string | null; period?: number | null } = {}, limit = 30,
): CatalogCourse[] {
  const terms = q.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  const out: CatalogCourse[] = [];
  for (const c of catalog) {
    if (filter.day && c.dayOfWeek !== filter.day) continue;
    if (filter.period && c.period !== filter.period) continue;
    const hay = norm(c.name) + ' ' + norm(c.lecturer);
    if (terms.every((t) => hay.includes(t))) out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

function toPublicStats(s: CourseStats): PublicStats {
  const { university_id: _u, courseKey: _k, ...rest } = s;
  return { ...rest, avgRating: Math.round(avgRating(s) * 10) / 10 };
}

export async function fetchPublicCourse(id: string): Promise<PublicCourse | null> {
  if (!id || id.includes('/')) return null;
  const snap = await adminDb.collection('courses').doc(id).get();
  if (!snap.exists) return null;
  const course = toCatalog(snap.id, snap.data()!);
  if (!course.courseKey) return null;
  const [siblings, statsSnap] = await Promise.all([
    adminDb.collection('courses').where('courseKey', '==', course.courseKey).limit(10).get(),
    adminDb.collection('course_stats').doc(slug(course.courseKey)).get(),
  ]);
  const slots = siblings.docs
    .map((d) => toCatalog(d.id, d.data()))
    .map(({ id: sid, dayOfWeek, period }) => ({ id: sid, dayOfWeek, period }))
    .sort((a, b) => DAYS.indexOf(a.dayOfWeek) - DAYS.indexOf(b.dayOfWeek) || a.period - b.period);
  return { ...course, slots, stats: toPublicStats(statsFromDoc(course.courseKey, statsSnap.data())) };
}


export async function fetchRankings(catalog: CatalogCourse[]): Promise<Record<RankingKind, PublicRankRow[]>> {
  const byKey = new Map<string, CatalogCourse>();
  for (const c of catalog) if (!byKey.has(c.courseKey)) byKey.set(c.courseKey, c);

  const stats = adminDb.collection('course_stats');
  const [reviewed, exams, recent] = await Promise.all([
    stats.where('reviewCount', '>=', 1).orderBy('reviewCount', 'desc').limit(120).get(),
    stats.where('pastExamPostCount', '>=', 1).orderBy('pastExamPostCount', 'desc').limit(40).get(),
    stats.orderBy('lastReviewAt', 'desc').limit(40).get(),
  ]);
  const rows = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) =>
    docs.flatMap((d) => {
      const data = d.data();
      const course = byKey.get(str(data.courseKey));
      if (!course) return [];
      const s = statsFromDoc(course.courseKey, data);
      const row: PublicRankRow = {
        id: course.id, name: course.name, lecturer: course.lecturer, dayOfWeek: course.dayOfWeek, period: course.period,
        reviewCount: s.reviewCount, avgRating: Math.round(avgRating(s) * 10) / 10, score: s.score,
        pastExamPostCount: s.pastExamPostCount,
      };
      return [row];
    });

  const reviewedRows = rows(reviewed.docs);
  return {
    rakutan: reviewedRows.filter((r) => r.reviewCount >= 2).sort((a, b) => b.score - a.score || b.reviewCount - a.reviewCount).slice(0, 20),
    mostReviewed: reviewedRows.slice(0, 20),
    mostPastExams: rows(exams.docs).slice(0, 20),
    recent: rows(recent.docs).filter((r) => r.reviewCount >= 1).slice(0, 20),
  };
}

/** Course ids worth indexing: those with at least one review (spec §4.1). */
export async function fetchIndexableCourses(catalog: CatalogCourse[]): Promise<{ id: string; lastReviewAt: string | null }[]> {
  const byKey = new Map<string, string>();
  for (const c of catalog) if (!byKey.has(c.courseKey)) byKey.set(c.courseKey, c.id);
  const snap = await adminDb.collection('course_stats').where('reviewCount', '>=', 1).get();
  return snap.docs.flatMap((d) => {
    const id = byKey.get(str(d.data().courseKey));
    return id ? [{ id, lastReviewAt: typeof d.data().lastReviewAt === 'string' ? d.data().lastReviewAt : null }] : [];
  });
}
