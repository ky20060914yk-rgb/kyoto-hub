import { describe, it, expect } from 'vitest';
import {
  slug, reviewDocId, emptyStats, applyReview, rakutanScore, avgRating, parseReviewInput, type Review,
} from '@/lib/domain/review';

const base: Review = {
  id: 'k_u1', courseKey: 'k', courseSlug: 'k', courseName: '微分積分学', university_id: 'kyoto_u',
  authorId: 'u1', authorName: '京大生_1', rating: 5, rakutan: 'raku', attendance: 'none', grading: 'exam_only',
  pastExam: 'as_is', bringIn: 'no', comment: '', termTaken: null, gradeTaken: null, helpfulBy: [],
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('slug', () => {
  it('escapes % before / so it stays injective', () => {
    expect(slug('a/b')).toBe('a%2Fb');
    expect(slug('a%2Fb')).toBe('a%252Fb');
    expect(slug('a/b')).not.toBe(slug('a%2Fb'));
    expect(reviewDocId('a/b', 'u')).toBe('a%2Fb_u');
  });
});

describe('stats', () => {
  it('easy course scores far above a hard one', () => {
    const easy = applyReview(emptyStats('e'), base, 1);
    const hard = applyReview(emptyStats('h'), { ...base, rating: 1, rakutan: 'muzu', attendance: 'heavy' }, 1);
    expect(rakutanScore(easy)).toBeGreaterThan(rakutanScore(hard) + 30);
    expect(easy.score).toBe(Math.round(rakutanScore(easy)));
  });

  it('add then remove returns to neutral', () => {
    const s = applyReview(applyReview(emptyStats('k'), base, 1), base, -1);
    expect(s.reviewCount).toBe(0);
    expect(s.ratingSum).toBe(0);
    expect(s.rakutanCounts.raku).toBe(0);
    expect(s.score).toBe(50);
  });

  it('an edit replaces the previous contribution', () => {
    const one = applyReview(emptyStats('k'), base, 1);
    const edited = applyReview(one, { ...base, rating: 2, rakutan: 'muzu' }, 1, base);
    expect(edited.reviewCount).toBe(1);
    expect(edited.ratingSum).toBe(2);
    expect(edited.rakutanCounts).toMatchObject({ raku: 0, muzu: 1 });
    expect(avgRating(edited)).toBe(2);
  });

  it('never goes negative', () => {
    const s = applyReview(emptyStats('k'), base, -1);
    expect(s.reviewCount).toBe(0);
    expect(s.rakutanCounts.raku).toBe(0);
  });
});

describe('parseReviewInput', () => {
  const ok = { rating: 4, rakutan: 'futsu', attendance: 'light', grading: 'exam_report', pastExam: 'similar', bringIn: 'na', comment: ' よい ', termTaken: '2024前期', gradeTaken: 'A' };
  it('accepts and trims a valid input', () => {
    expect(parseReviewInput(ok)).toMatchObject({ rating: 4, comment: 'よい', termTaken: '2024前期' });
  });
  it.each([
    [{ rating: 0 }], [{ rating: 6 }], [{ rating: 3.5 }], [{ rakutan: 'easy' }], [{ comment: 'あ'.repeat(2001) }],
    [{ termTaken: 3 }], [{ gradeTaken: 'Z'.repeat(10) }],
  ])('rejects %j', (patch) => {
    expect(() => parseReviewInput({ ...ok, ...patch })).toThrow();
  });
});
