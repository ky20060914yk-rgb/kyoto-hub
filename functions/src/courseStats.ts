import { FieldValue, type DocumentData, type Firestore, type Query, type QuerySnapshot } from 'firebase-admin/firestore';
import { UNIVERSITY_ID, isDocId } from './common.js';
import { reviewSlug } from './reviewCreated.js';

/**
 * Server-side `course_stats` (Plan 2B, M-11..M-14). Mirrors
 * lib/models/course_stats.dart + lib/models/review.dart exactly: the same enum
 * values and `fromString` fallbacks, the same rating clamp, the same
 * rakutanScore formula in the same operation order. Parity is enforced by
 * test/fixtures/course_stats_parity.json, asserted by BOTH test suites.
 */
// Review field -> its enum values (lib/models/review.dart `.value`s) and the
// value `fromString` falls back to. The doc fields are `<field>Counts`.
const BUCKETS: Record<'rakutan' | 'attendance' | 'grading' | 'pastExam' | 'bringIn', { keys: readonly string[]; fallback: string }> = {
  rakutan: { keys: ['raku', 'futsu', 'muzu'], fallback: 'futsu' },
  attendance: { keys: ['none', 'light', 'heavy'], fallback: 'light' },
  grading: { keys: ['exam_only', 'exam_report', 'report_mainly', 'attendance_heavy'], fallback: 'exam_report' },
  pastExam: { keys: ['as_is', 'similar', 'trend_only', 'not_useful'], fallback: 'trend_only' },
  bringIn: { keys: ['no', 'yes', 'na'], fallback: 'na' },
};
type Bucket = keyof typeof BUCKETS;
const BUCKET_NAMES = Object.keys(BUCKETS) as Bucket[];

export interface CourseStatsDoc {
  courseKey: string;
  university_id: string;
  reviewCount: number;
  ratingSum: number;
  rakutanCounts: Record<string, number>;
  attendanceCounts: Record<string, number>;
  gradingCounts: Record<string, number>;
  pastExamCounts: Record<string, number>;
  bringInCounts: Record<string, number>;
  pastExamPostCount: number;
  resourcePostCount: number;
  lastReviewAt?: string;
  score: number;
}

export interface PostCounts { pastExam: number; resource: number }

const ISO_8601 = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$/;

/** Review._rating: a whole number clamped to 0..5; anything else is 0. */
const rating = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
  return n < 0 ? 0 : n > 5 ? 5 : n;
};

/**
 * `XxxX.fromString(map[k]?.toString() ?? '')`: an unknown value takes the enum's
 * default. Only a STRING can match (an array's toString() is never an enum key
 * in Dart; JS String(['raku']) would be), so anything else takes the fallback.
 */
const bucketValue = (b: Bucket, v: unknown): string =>
  typeof v === 'string' && BUCKETS[b].keys.includes(v) ? v : BUCKETS[b].fallback;

/** CourseStats.rakutanScore (unrounded). Same operations, same order => bit-identical doubles. */
export function rakutanScore(
  s: Pick<CourseStatsDoc, 'reviewCount' | 'ratingSum' | 'rakutanCounts' | 'attendanceCounts'>,
): number {
  const n = s.reviewCount;
  if (n === 0) return 50;
  const avgRating = s.ratingSum / n;
  const rakuFrac = (s.rakutanCounts.raku ?? 0) / n;
  const muzuFrac = (s.rakutanCounts.muzu ?? 0) / n;
  const lightFrac = (s.attendanceCounts.none ?? 0) / n + 0.5 * ((s.attendanceCounts.light ?? 0) / n);
  const base = 50 + 35 * (rakuFrac - muzuFrac) + 10 * (avgRating - 3) / 2 + 10 * (lightFrac - 0.5);
  return Math.min(100, Math.max(0, base));
}

/** Pure: the aggregate of `reviews` (raw docs, possibly malformed) and the post counts. */
export function aggregateCourseStats(courseKey: string, reviews: DocumentData[], posts: PostCounts): CourseStatsDoc {
  const counts = Object.fromEntries(
    BUCKET_NAMES.map((b) => [b, Object.fromEntries(BUCKETS[b].keys.map((k) => [k, 0]))]),
  ) as Record<Bucket, Record<string, number>>;
  let ratingSum = 0;
  let last: { ms: number; raw: string } | null = null;
  for (const r of reviews) {
    ratingSum += rating(r.rating);
    for (const b of BUCKET_NAMES) counts[b][bucketValue(b, r[b])] += 1;
    const raw = typeof r.updatedAt === 'string' ? r.updatedAt : '';
    // Only ISO-8601 (what Dart's DateTime.tryParse accepts and `toMap` writes);
    // V8's Date.parse also takes "Sep 1 2030", which would diverge.
    const ms = ISO_8601.test(raw) ? Date.parse(raw) : NaN;
    if (!Number.isNaN(ms) && (last === null || ms > last.ms)) last = { ms, raw }; // M-13
  }
  const doc: CourseStatsDoc = {
    courseKey,
    university_id: UNIVERSITY_ID,
    reviewCount: reviews.length,
    ratingSum,
    rakutanCounts: counts.rakutan,
    attendanceCounts: counts.attendance,
    gradingCounts: counts.grading,
    pastExamCounts: counts.pastExam,
    bringInCounts: counts.bringIn,
    pastExamPostCount: posts.pastExam,
    resourcePostCount: posts.resource,
    score: 50,
    ...(last ? { lastReviewAt: last.raw } : {}),
  };
  doc.score = Math.round(rakutanScore(doc)); // Dart .round(): identical for the non-negative range
  return doc;
}

export const statsRef = (db: Firestore, courseKey: string) =>
  db.collection('course_stats').doc(reviewSlug(courseKey));

type QueryGet = (q: Query) => Promise<QuerySnapshot>;

/** Every input of one course's aggregate (M-12: posts across every course doc of the courseKey). */
async function gather(db: Firestore, get: QueryGet, courseKey: string): Promise<{ reviews: DocumentData[]; posts: PostCounts }> {
  const reviews = (await get(db.collection('reviews').where('courseKey', '==', courseKey))).docs.map((d) => d.data());
  const courseIds = (await get(db.collection('courses').where('courseKey', '==', courseKey))).docs.map((d) => d.id);
  const posts: PostCounts = { pastExam: 0, resource: 0 };
  for (let i = 0; i < courseIds.length; i += 30) { // an 'in' filter takes at most 30 values
    const snap = await get(db.collection('posts').where('subjectId', 'in', courseIds.slice(i, i + 30)));
    for (const d of snap.docs) {
      if (d.get('category') === 'past_exam') posts.pastExam += 1;
      else posts.resource += 1; // PostCategoryX.fromString: anything else is 'other'
    }
  }
  return { reviews, posts };
}

/** Read-only: what a recount would write (the backfill dry run uses this). */
export async function computeCourseStats(db: Firestore, courseKey: string): Promise<CourseStatsDoc> {
  const { reviews, posts } = await gather(db, (q) => q.get(), courseKey);
  return aggregateCourseStats(courseKey, reviews, posts);
}

/**
 * Full recount of one course, written with a plain `set` (not merge) so a forged
 * or stale field cannot survive (M-11). The stats doc is read FIRST: its
 * pessimistic lock serialises concurrent recounts of the same course, so the
 * last writer always counted after the last committed source write.
 */
export async function recomputeCourseStats(db: Firestore, courseKey: string): Promise<CourseStatsDoc> {
  if (!isDocId(reviewSlug(courseKey))) throw new Error('recomputeCourseStats: unusable courseKey');
  const ref = statsRef(db, courseKey);
  return db.runTransaction(async (tx) => {
    await tx.get(ref);
    const { reviews, posts } = await gather(db, (q) => tx.get(q), courseKey);
    const doc = aggregateCourseStats(courseKey, reviews, posts);
    tx.set(ref, { ...doc, aggregatedAt: FieldValue.serverTimestamp() });
    return doc;
  });
}

// Review fields the aggregate reads; a write touching none of them recounts nothing.
const REVIEW_STATS_FIELDS = ['courseKey', 'rating', 'rakutan', 'attendance', 'grading', 'pastExam', 'bringIn', 'updatedAt'];
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function reviewStatsKeys(before?: DocumentData, after?: DocumentData): string[] {
  if (before && after && REVIEW_STATS_FIELDS.every((f) => same(before[f], after[f]))) return [];
  const keys = new Set<string>();
  for (const d of [before, after]) {
    if (typeof d?.courseKey === 'string' && isDocId(reviewSlug(d.courseKey))) keys.add(d.courseKey);
  }
  return [...keys];
}

export function postStatsSubjects(before?: DocumentData, after?: DocumentData): string[] {
  if (before && after && same(before.subjectId, after.subjectId) && same(before.category, after.category)) return [];
  const ids = new Set<string>();
  for (const d of [before, after]) {
    const s: unknown = d?.subjectId;
    if (isDocId(s)) ids.add(s);
  }
  return [...ids];
}

export async function handleReviewWritten(db: Firestore, before?: DocumentData, after?: DocumentData): Promise<string[]> {
  const keys = reviewStatsKeys(before, after);
  for (const k of keys) await recomputeCourseStats(db, k);
  return keys;
}

export async function handlePostWritten(db: Firestore, before?: DocumentData, after?: DocumentData): Promise<string[]> {
  const keys = new Set<string>();
  for (const id of postStatsSubjects(before, after)) {
    const ck = (await db.collection('courses').doc(id).get()).get('courseKey');
    if (typeof ck === 'string' && isDocId(reviewSlug(ck))) keys.add(ck);
  }
  for (const k of keys) await recomputeCourseStats(db, k);
  return [...keys];
}
