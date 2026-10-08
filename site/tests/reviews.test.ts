import { describe, it, expect, beforeEach } from 'vitest';
import { adminDb } from '@/lib/server/admin';
import { upsertReview, deleteReview, toggleHelpful } from '@/lib/server/reviews';
import { balanceRef } from '@/lib/server/credits';
import type { ReviewInput } from '@/lib/domain/review';
import { clearEmulators } from './emu';

const taro = { uid: 'taro', email: 'taro@st.kyoto-u.ac.jp' };
const hana = { uid: 'hana', email: 'hana@st.kyoto-u.ac.jp' };
const input: ReviewInput = {
  rating: 5, rakutan: 'raku', attendance: 'none', grading: 'exam_only', pastExam: 'as_is', bringIn: 'no',
  comment: 'おすすめ', termTaken: '2025前期', gradeTaken: 'A',
};

export async function seedCourse(id = 'c_1', courseKey = 'bisekibun|yamada') {
  await adminDb.collection('courses').doc(id).set({
    id, courseKey, name: '微分積分学A', lecturer: '山田太郎', faculty: '全学共通', category: '全学共通科目',
    dayOfWeek: 'Mon', period: 2, university_id: 'kyoto_u',
  });
}

const stats = async () => (await adminDb.collection('course_stats').doc('bisekibun|yamada').get()).data();

describe('reviews', () => {
  beforeEach(async () => {
    await clearEmulators();
    await seedCourse();
    await adminDb.collection('users').doc('taro').set({ displayName: '京大生_1234' });
  });

  it('creates a review, updates stats and pays first + scarce bonuses', async () => {
    const { review, bonus } = await upsertReview(taro, 'c_1', input);
    expect(review.id).toBe('bisekibun|yamada_taro');
    expect(review.authorName).toBe('京大生_1234');
    expect(bonus).toMatchObject({ first: true, scarce: true, granted: 3 });
    expect(await stats()).toMatchObject({ reviewCount: 1, ratingSum: 5, rakutanCounts: { raku: 1 } });
    expect((await balanceRef('taro').get()).data()?.balance).toBe(3);
  });

  it('an edit keeps the count, replaces the contribution and pays nothing', async () => {
    await upsertReview(taro, 'c_1', input);
    const { bonus } = await upsertReview(taro, 'c_1', { ...input, rating: 2, rakutan: 'muzu' });
    expect(bonus.granted).toBe(0);
    expect(await stats()).toMatchObject({ reviewCount: 1, ratingSum: 2, rakutanCounts: { raku: 0, muzu: 1 } });
  });

  it('delete removes the contribution; re-posting does not pay again', async () => {
    await upsertReview(taro, 'c_1', input);
    await deleteReview(taro, 'c_1');
    expect(await stats()).toMatchObject({ reviewCount: 0, ratingSum: 0 });
    const { bonus } = await upsertReview(taro, 'c_1', input);
    expect(bonus.granted).toBe(0);
  });

  it('keeps post counts written by resource uploads', async () => {
    await adminDb.collection('course_stats').doc('bisekibun|yamada').set({ pastExamPostCount: 4 });
    await upsertReview(taro, 'c_1', input);
    expect((await stats())?.pastExamPostCount).toBe(4);
  });

  it('helpful toggles on and off; the author cannot vote', async () => {
    const { review } = await upsertReview(taro, 'c_1', input);
    expect(await toggleHelpful(hana, review.id)).toMatchObject({ helpful: true, count: 1 });
    expect(await toggleHelpful(hana, review.id)).toMatchObject({ helpful: false, count: 0 });
    await expect(toggleHelpful(taro, review.id)).rejects.toMatchObject({ status: 403 });
  });

  it('404 for an unknown course', async () => {
    await expect(upsertReview(taro, 'nope', input)).rejects.toMatchObject({ status: 404 });
  });
});
