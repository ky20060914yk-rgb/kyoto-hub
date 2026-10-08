import { describe, it, expect, beforeAll } from 'vitest';
import { adminDb } from '@/lib/server/admin';
import { upsertReview } from '@/lib/server/reviews';
import { loadCatalog, searchCatalog, fetchPublicCourse, fetchRankings, fetchIndexableCourses } from '@/lib/server/public';
import { clearEmulators } from './emu';

const input = {
  rating: 4, rakutan: 'raku', attendance: 'light', grading: 'exam_report', pastExam: 'similar', bringIn: 'na',
  comment: 'SECRET-COMMENT', termTaken: null, gradeTaken: null,
} as const;

async function course(id: string, courseKey: string, name: string, lecturer: string, dayOfWeek = 'Mon', period = 1) {
  await adminDb.collection('courses').doc(id).set({
    id, courseKey, name, lecturer, faculty: '全学共通', category: '全学共通科目', dayOfWeek, period, university_id: 'kyoto_u',
  });
}

describe('public projections', () => {
  beforeAll(async () => {
    await clearEmulators();
    await course('c_a1', 'bisekibun-a|yamada', '微分積分学（講義・演習）A', '山田 太郎', 'Mon', 2);
    await course('c_a2', 'bisekibun-a|yamada', '微分積分学（講義・演習）A', '山田 太郎', 'Thu', 1);
    await course('c_b', 'english|smith', '英語リーディング', 'SMITH, John', 'Tue', 3);
    await course('c_c', 'psych|sato', '心理学', '佐藤 花子', 'Wed', 4);
    for (const [uid, rakutan] of [['u1', 'raku'], ['u2', 'raku']] as const) {
      await upsertReview({ uid, email: `${uid}@st.kyoto-u.ac.jp` }, 'c_a1', { ...input, rakutan });
    }
    await upsertReview({ uid: 'u3', email: 'u3@st.kyoto-u.ac.jp' }, 'c_c', { ...input, rakutan: 'muzu', rating: 2 });
  });

  it('never exposes review text or authors', async () => {
    const pub = await fetchPublicCourse('c_a1');
    const json = JSON.stringify(pub);
    expect(json).not.toContain('SECRET-COMMENT');
    expect(json).not.toContain('u1');
    expect(json).not.toMatch(/authorId|helpfulBy|comment/);
    expect(pub?.stats).toMatchObject({ reviewCount: 2, avgRating: 4 });
  });

  it('lists every slot of the same course in weekday order', async () => {
    const pub = await fetchPublicCourse('c_a2');
    expect(pub?.slots.map((s) => `${s.dayOfWeek}${s.period}`)).toEqual(['Mon2', 'Thu1']);
  });

  it('returns null for unknown or path-like ids', async () => {
    expect(await fetchPublicCourse('missing')).toBeNull();
    expect(await fetchPublicCourse('a/b')).toBeNull();
  });

  it('searches by name or lecturer, width- and case-insensitively', async () => {
    const cat = await loadCatalog();
    expect(searchCatalog(cat, '微分').map((c) => c.id)).toEqual(['c_a1', 'c_a2']);
    expect(searchCatalog(cat, 'ｓｍｉｔｈ').map((c) => c.id)).toEqual(['c_b']);
    expect(searchCatalog(cat, '微分 山田').length).toBe(2);
    expect(searchCatalog(cat, '微分', { day: 'Thu' }).map((c) => c.id)).toEqual(['c_a2']);
  });

  it('rankings: rakutan needs >= 2 reviews; most reviewed first', async () => {
    const r = await fetchRankings(await loadCatalog());
    expect(r.rakutan.map((x) => x.id)).toEqual(['c_a1']);
    expect(r.mostReviewed.map((x) => x.id)).toEqual(['c_a1', 'c_c']);
    expect(JSON.stringify(r)).not.toContain('SECRET-COMMENT');
  });

  it('indexable courses are the reviewed ones', async () => {
    const ids = (await fetchIndexableCourses(await loadCatalog())).map((x) => x.id).sort();
    expect(ids).toEqual(['c_a1', 'c_c']);
  });
});
