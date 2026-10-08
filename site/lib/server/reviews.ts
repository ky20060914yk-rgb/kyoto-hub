import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './admin';
import { grantReviewBonuses, type ReviewBonus } from './credits';
import type { KuUser } from './auth';
import { HttpError } from '@/lib/http-error';
import {
  applyReview, reviewDocId, slug, statsFromDoc, type CourseStats, type Review, type ReviewInput,
} from '@/lib/domain/review';

const reviews = () => adminDb.collection('reviews');
const statsRef = (courseKey: string) => adminDb.collection('course_stats').doc(slug(courseKey));

/** The stats fields a review write owns (post counts belong to resource writes). */
function reviewStatsFields(s: CourseStats) {
  const { pastExamPostCount: _p, resourcePostCount: _r, ...rest } = s;
  return rest;
}

export async function getCourseOr404(courseId: string) {
  const snap = await adminDb.collection('courses').doc(courseId).get();
  const d = snap.data();
  if (!snap.exists || !d?.courseKey) throw new HttpError(404, '科目が見つかりません。');
  return { id: snap.id, courseKey: d.courseKey as string, name: (d.name as string) ?? '' };
}

/** Create or edit the caller's review of a course. One per user per course. */
export async function upsertReview(user: KuUser, courseId: string, input: ReviewInput, now = new Date()) {
  const course = await getCourseOr404(courseId);
  const id = reviewDocId(course.courseKey, user.uid);
  const ref = reviews().doc(id);
  const profile = await adminDb.collection('users').doc(user.uid).get();
  const authorName = (profile.data()?.displayName as string) || '京大生';

  return adminDb.runTransaction(async (tx) => {
    const prevSnap = await tx.get(ref);
    const statsSnap = await tx.get(statsRef(course.courseKey));
    const previous = prevSnap.exists ? (prevSnap.data() as Review) : undefined;
    const iso = now.toISOString();

    let bonus: ReviewBonus = { first: false, scarce: false, granted: 0, capped: false };
    if (!previous) {
      const existing = (await tx.get(reviews().where('courseKey', '==', course.courseKey).count())).data().count;
      bonus = await grantReviewBonuses(tx, { id, authorId: user.uid }, existing + 1, now);
    }

    const review: Review = {
      ...input,
      id,
      courseKey: course.courseKey,
      courseSlug: slug(course.courseKey),
      courseName: course.name,
      university_id: 'kyoto_u',
      authorId: user.uid,
      authorName,
      helpfulBy: previous?.helpfulBy ?? [],
      createdAt: previous?.createdAt ?? iso,
      updatedAt: iso,
    };
    const stats = applyReview(statsFromDoc(course.courseKey, statsSnap.data()), review, 1, previous);
    tx.set(ref, review);
    tx.set(statsRef(course.courseKey), reviewStatsFields(stats), { merge: true });
    return { review, bonus, courseId: course.id };
  });
}

export async function deleteReview(user: KuUser, courseId: string) {
  const course = await getCourseOr404(courseId);
  const ref = reviews().doc(reviewDocId(course.courseKey, user.uid));
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, 'レビューが見つかりません。');
    const statsSnap = await tx.get(statsRef(course.courseKey));
    const stats = applyReview(statsFromDoc(course.courseKey, statsSnap.data()), snap.data() as Review, -1);
    tx.delete(ref);
    tx.set(statsRef(course.courseKey), reviewStatsFields(stats), { merge: true });
  });
  return { courseId: course.id };
}

/** Toggle 役に立った. The author cannot vote for their own review. */
export async function toggleHelpful(user: KuUser, reviewId: string) {
  if (!reviewId || reviewId.includes('/')) throw new HttpError(400, 'レビューの指定が正しくありません。');
  const ref = reviews().doc(reviewId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, 'レビューが見つかりません。');
    const r = snap.data() as Review;
    if (r.authorId === user.uid) throw new HttpError(403, '自分のレビューには押せません。');
    const by = Array.isArray(r.helpfulBy) ? r.helpfulBy : [];
    const helpful = !by.includes(user.uid);
    tx.update(ref, { helpfulBy: helpful ? FieldValue.arrayUnion(user.uid) : FieldValue.arrayRemove(user.uid) });
    return { helpful, count: by.length + (helpful ? 1 : -1), courseKey: r.courseKey };
  });
}
