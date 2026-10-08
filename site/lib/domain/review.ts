// Port of lib/models/review.dart + course_stats.dart. Wire values must stay
// identical: the Flutter app and existing documents use them.
import { HttpError } from '@/lib/http-error';

export const RAKUTAN = { raku: '楽', futsu: '普通', muzu: '難' } as const;
export const ATTENDANCE = { none: '取らない', light: '取る（ゆるい）', heavy: '毎回（重い）' } as const;
export const GRADING = {
  exam_only: '試験一発', exam_report: '試験＋レポート', report_mainly: 'レポート中心', attendance_heavy: '出席重視',
} as const;
export const PAST_EXAM = { as_is: 'ほぼそのまま', similar: '類題が出る', trend_only: '傾向把握に有用', not_useful: '効かない・不明' } as const;
export const BRING_IN = { no: '不可', yes: '可', na: '該当なし' } as const;

export type Rakutan = keyof typeof RAKUTAN;
export type Attendance = keyof typeof ATTENDANCE;
export type Grading = keyof typeof GRADING;
export type PastExam = keyof typeof PAST_EXAM;
export type BringIn = keyof typeof BRING_IN;

export type ReviewInput = {
  rating: number;
  rakutan: Rakutan;
  attendance: Attendance;
  grading: Grading;
  pastExam: PastExam;
  bringIn: BringIn;
  comment: string;
  termTaken: string | null;
  gradeTaken: string | null;
};

export type Review = ReviewInput & {
  id: string;
  courseKey: string;
  courseSlug: string;
  courseName: string;
  university_id: 'kyoto_u';
  authorId: string;
  authorName: string;
  helpfulBy: string[];
  createdAt: string;
  updatedAt: string;
};

type Counts = Record<string, number>;

export type CourseStats = {
  courseKey: string;
  university_id: 'kyoto_u';
  reviewCount: number;
  ratingSum: number;
  rakutanCounts: Counts;
  attendanceCounts: Counts;
  gradingCounts: Counts;
  pastExamCounts: Counts;
  bringInCounts: Counts;
  pastExamPostCount: number;
  resourcePostCount: number;
  lastReviewAt: string | null;
  score: number;
};

export const MAX_COMMENT = 2000;

/** Injective escape for document ids: '%' first, then '/'. */
export const slug = (courseKey: string) => courseKey.replaceAll('%', '%25').replaceAll('/', '%2F');
export const reviewDocId = (courseKey: string, uid: string) => `${slug(courseKey)}_${uid}`;

const zero = (keys: object): Counts => Object.fromEntries(Object.keys(keys).map((k) => [k, 0]));

export function emptyStats(courseKey: string): CourseStats {
  return {
    courseKey, university_id: 'kyoto_u', reviewCount: 0, ratingSum: 0,
    rakutanCounts: zero(RAKUTAN), attendanceCounts: zero(ATTENDANCE), gradingCounts: zero(GRADING),
    pastExamCounts: zero(PAST_EXAM), bringInCounts: zero(BRING_IN),
    pastExamPostCount: 0, resourcePostCount: 0, lastReviewAt: null, score: 50,
  };
}

/** Tolerant read of a stored stats doc (fields may be missing or forged). */
export function statsFromDoc(courseKey: string, d: Record<string, unknown> | undefined): CourseStats {
  const s = emptyStats(courseKey);
  if (!d) return s;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const counts = (v: unknown, into: Counts) => {
    if (v && typeof v === 'object') for (const k of Object.keys(into)) into[k] = n((v as Counts)[k]);
    return into;
  };
  s.reviewCount = n(d.reviewCount);
  s.ratingSum = n(d.ratingSum);
  counts(d.rakutanCounts, s.rakutanCounts);
  counts(d.attendanceCounts, s.attendanceCounts);
  counts(d.gradingCounts, s.gradingCounts);
  counts(d.pastExamCounts, s.pastExamCounts);
  counts(d.bringInCounts, s.bringInCounts);
  s.pastExamPostCount = n(d.pastExamPostCount);
  s.resourcePostCount = n(d.resourcePostCount);
  s.lastReviewAt = typeof d.lastReviewAt === 'string' ? d.lastReviewAt : null;
  s.score = Math.round(rakutanScore(s));
  return s;
}

export const avgRating = (s: CourseStats) => (s.reviewCount === 0 ? 0 : s.ratingSum / s.reviewCount);

/** 0..100, higher = easier credit. Same formula as CourseStats.rakutanScore (Dart). */
export function rakutanScore(s: CourseStats): number {
  const n = s.reviewCount;
  if (n === 0) return 50;
  const rakuFrac = (s.rakutanCounts.raku ?? 0) / n;
  const muzuFrac = (s.rakutanCounts.muzu ?? 0) / n;
  const lightFrac = (s.attendanceCounts.none ?? 0) / n + 0.5 * ((s.attendanceCounts.light ?? 0) / n);
  const base = 50 + 35 * (rakuFrac - muzuFrac) + (10 * (avgRating(s) - 3)) / 2 + 10 * (lightFrac - 0.5);
  return Math.min(100, Math.max(0, base));
}

const bump = (c: Counts, key: string, delta: number): Counts => ({ ...c, [key]: Math.max(0, (c[key] ?? 0) + delta) });

function apply(s: CourseStats, r: ReviewInput & { updatedAt?: string }, delta: number): CourseStats {
  const next: CourseStats = {
    ...s,
    reviewCount: Math.max(0, s.reviewCount + delta),
    ratingSum: Math.max(0, s.ratingSum + delta * r.rating),
    rakutanCounts: bump(s.rakutanCounts, r.rakutan, delta),
    attendanceCounts: bump(s.attendanceCounts, r.attendance, delta),
    gradingCounts: bump(s.gradingCounts, r.grading, delta),
    pastExamCounts: bump(s.pastExamCounts, r.pastExam, delta),
    bringInCounts: bump(s.bringInCounts, r.bringIn, delta),
    lastReviewAt: delta === 1 ? r.updatedAt ?? s.lastReviewAt : s.lastReviewAt,
  };
  return { ...next, score: Math.round(rakutanScore(next)) };
}

/** Adds (delta 1) or removes (delta -1) a review; with `previous` it is an edit. */
export function applyReview(
  s: CourseStats, review: ReviewInput & { updatedAt?: string }, delta: 1 | -1, previous?: ReviewInput,
): CourseStats {
  return previous ? apply(apply(s, previous, -1), review, 1) : apply(s, review, delta);
}

function pick<T extends object>(map: T, v: unknown, field: string): keyof T {
  if (typeof v === 'string' && v in map) return v as keyof T;
  throw new HttpError(400, `${field} の値が正しくありません。`);
}

function optText(v: unknown, max: number, field: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.trim().length > max) throw new HttpError(400, `${field} の値が正しくありません。`);
  return v.trim() || null;
}

/** Validates an untrusted review body. Throws HttpError(400). */
export function parseReviewInput(body: unknown): ReviewInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const rating = b.rating;
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpError(400, 'おすすめ度は1〜5で選んでください。');
  }
  const comment = typeof b.comment === 'string' ? b.comment.trim() : '';
  if (comment.length > MAX_COMMENT) throw new HttpError(400, `コメントは${MAX_COMMENT}文字以内にしてください。`);
  return {
    rating,
    rakutan: pick(RAKUTAN, b.rakutan, '楽単度'),
    attendance: pick(ATTENDANCE, b.attendance, '出席'),
    grading: pick(GRADING, b.grading, '成績のつけ方'),
    pastExam: pick(PAST_EXAM, b.pastExam, '過去問の効き'),
    bringIn: pick(BRING_IN, b.bringIn, '持ち込み'),
    comment,
    termTaken: optText(b.termTaken, 20, '履修時期'),
    gradeTaken: optText(b.gradeTaken, 4, '評価'),
  };
}
