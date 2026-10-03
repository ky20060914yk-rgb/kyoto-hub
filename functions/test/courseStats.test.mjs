import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { db, uid } from '../testlib/helpers.mjs';
import {
  aggregateCourseStats, rakutanScore, recomputeCourseStats, computeCourseStats,
  handleReviewWritten, handlePostWritten, reviewStatsKeys, postStatsSubjects,
} from '../lib/courseStats.js';

const fixture = JSON.parse(readFileSync(new URL('../../test/fixtures/course_stats_parity.json', import.meta.url), 'utf8'));
const REVIEW_FIELDS = Object.keys(fixture.expected); // exactly what CourseStats.toMap() emits
const NO_POSTS = { pastExam: 0, resource: 0 };
const slug = (s) => s.replace(/%/g, '%25').replace(/\//g, '%2F');
const statsDoc = async (ck) => (await db.collection('course_stats').doc(slug(ck)).get()).data();
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

const review = (ck, author, over = {}) => db.collection('reviews').doc(`${slug(ck)}_${author}`).set({
  courseKey: ck, courseSlug: slug(ck), authorId: author, university_id: 'kyoto_u', rating: 4,
  rakutan: 'raku', attendance: 'none', grading: 'exam_only', pastExam: 'as_is', bringIn: 'no',
  helpfulBy: [], createdAt: '2026-09-01T00:00:00.000', updatedAt: '2026-09-01T00:00:00.000', ...over,
});
const course = (id, ck) => db.collection('courses').doc(id).set({ id, courseKey: ck, name: 'n', university_id: 'kyoto_u' });
const post = (id, subjectId, category) => db.collection('posts').doc(id).set({
  authorId: 'a', subjectId, category, title: 't', university_id: 'kyoto_u',
});

test('PARITY: the aggregate equals CourseStats.applyReview on the shared fixture (M-14)', () => {
  const out = aggregateCourseStats(fixture.courseKey, fixture.reviews, NO_POSTS);
  assert.deepEqual(pick(out, REVIEW_FIELDS), fixture.expected);
  assert.deepEqual(Object.keys(out).sort(), [...REVIEW_FIELDS, 'pastExamPostCount', 'resourcePostCount'].sort());
});

test('rakutanScore: neutral 50 with no reviews, clamps at 0 and at 100', () => {
  assert.equal(aggregateCourseStats('k', [], NO_POSTS).score, 50);
  assert.equal(aggregateCourseStats('k', [{ rating: 1, rakutan: 'muzu', attendance: 'heavy' }], NO_POSTS).score, 0);
  assert.equal(aggregateCourseStats('k', [{ rating: 5, rakutan: 'raku', attendance: 'none' }], NO_POSTS).score, 100);
  assert.equal(rakutanScore(fixture.expected), 53.57142857142857);
});

test('an empty course: zero counters, every bucket key present, no lastReviewAt', () => {
  const out = aggregateCourseStats('k', [], NO_POSTS);
  assert.equal(out.reviewCount, 0);
  assert.equal(out.ratingSum, 0);
  assert.deepEqual(out.rakutanCounts, { raku: 0, futsu: 0, muzu: 0 });
  assert.deepEqual(out.gradingCounts, { exam_only: 0, exam_report: 0, report_mainly: 0, attendance_heavy: 0 });
  assert.equal('lastReviewAt' in out, false);
  assert.equal(out.university_id, 'kyoto_u');
});

test('recompute overwrites a forged aggregate with the true counts, under the slugged id', async () => {
  const ck = `${uid('ck')}/x|教員`; // C1: a courseKey with '/'
  await db.collection('course_stats').doc(slug(ck)).set({
    courseKey: ck, reviewCount: 999, score: 100, pinned: true, university_id: 'kyoto_u',
  });
  await review(ck, uid('a'), { rating: 5 });
  await review(ck, uid('a'), { rating: 3, rakutan: 'muzu', attendance: 'heavy' });
  const out = await recomputeCourseStats(db, ck);
  const s = await statsDoc(ck);
  assert.equal(s.reviewCount, 2);
  assert.equal(s.ratingSum, 8);
  assert.equal(s.score, 55); // raku-muzu 0, avg 4 -> +5, light 0.5 -> 0
  assert.equal(s.pinned, undefined); // a plain set, not a merge: forged fields do not survive
  assert.equal(s.courseKey, ck);
  assert.equal(s.university_id, 'kyoto_u');
  assert.ok(s.aggregatedAt);
  assert.equal(out.reviewCount, 2);
});

test('recompute: post counters span every course doc of the courseKey; hidden and foreign posts do not count', async () => {
  const ck = uid('ck'); const c1 = uid('c'); const c2 = uid('c'); const other = uid('c');
  await course(c1, ck);
  await course(c2, ck);
  await course(other, uid('ck'));
  await post(uid('p'), c1, 'past_exam');
  await post(uid('p'), c1, 'other');
  await post(uid('p'), c2, 'test_prep');
  await post(uid('p'), other, 'past_exam');
  await db.collection('hidden_posts').doc(uid('h')).set({
    authorId: 'a', subjectId: c1, category: 'past_exam', university_id: 'kyoto_u',
  });
  await recomputeCourseStats(db, ck);
  const s = await statsDoc(ck);
  assert.equal(s.pastExamPostCount, 1);
  assert.equal(s.resourcePostCount, 2);
  assert.equal(s.reviewCount, 0);
});

test('recompute is idempotent, and computeCourseStats predicts it without writing', async () => {
  const ck = uid('ck');
  await review(ck, uid('a'));
  const predicted = await computeCourseStats(db, ck);
  assert.equal(await statsDoc(ck), undefined); // compute never writes
  const a = await recomputeCourseStats(db, ck);
  const b = await recomputeCourseStats(db, ck);
  assert.deepEqual(a, b);
  assert.deepEqual(a, predicted);
});

test('reviewStatsKeys: a helpful vote or a comment-only change recounts nothing; stats fields, create and delete do', () => {
  const base = {
    courseKey: 'k', rating: 3, rakutan: 'raku', attendance: 'none', grading: 'exam_only',
    pastExam: 'as_is', bringIn: 'no', updatedAt: 'x', helpfulBy: [],
  };
  assert.deepEqual(reviewStatsKeys(base, { ...base, helpfulBy: ['u2'] }), []);
  assert.deepEqual(reviewStatsKeys(base, { ...base, comment: 'edited' }), []);
  assert.deepEqual(reviewStatsKeys(base, { ...base, rating: 4 }), ['k']);
  assert.deepEqual(reviewStatsKeys(base, { ...base, updatedAt: 'y' }), ['k']);
  assert.deepEqual(reviewStatsKeys(undefined, base), ['k']);
  assert.deepEqual(reviewStatsKeys(base, undefined), ['k']);
  assert.deepEqual(reviewStatsKeys(base, { ...base, courseKey: 'k2' }).sort(), ['k', 'k2']);
  assert.deepEqual(reviewStatsKeys({ ...base, courseKey: '' }, undefined), []);
});

test('postStatsSubjects: a downloadCount bump or title edit recounts nothing; create/delete/re-file does', () => {
  const p = { subjectId: 'c1', category: 'past_exam', downloadCount: 0 };
  assert.deepEqual(postStatsSubjects(p, { ...p, downloadCount: 1 }), []);
  assert.deepEqual(postStatsSubjects(p, { ...p, title: 'edited' }), []);
  assert.deepEqual(postStatsSubjects(undefined, p), ['c1']);
  assert.deepEqual(postStatsSubjects(p, undefined), ['c1']);
  assert.deepEqual(postStatsSubjects(p, { ...p, category: 'other' }), ['c1']);
  assert.deepEqual(postStatsSubjects(p, { ...p, subjectId: 'c2' }).sort(), ['c1', 'c2']);
  assert.deepEqual(postStatsSubjects({ subjectId: 'a/b', category: 'other' }, undefined), []); // never a path
});

test('handleReviewWritten recounts on create and delete, and skips vote-only writes', async () => {
  const ck = uid('ck'); const a = uid('a');
  const r = {
    courseKey: ck, rating: 4, rakutan: 'raku', attendance: 'none', grading: 'exam_only', pastExam: 'as_is',
    bringIn: 'no', updatedAt: '2026-09-01T00:00:00.000', helpfulBy: [],
  };
  assert.deepEqual(await handleReviewWritten(db, r, { ...r, helpfulBy: ['x'] }), []);
  assert.equal(await statsDoc(ck), undefined);
  await review(ck, a);
  assert.deepEqual(await handleReviewWritten(db, undefined, r), [ck]);
  assert.equal((await statsDoc(ck)).reviewCount, 1);
  await db.collection('reviews').doc(`${slug(ck)}_${a}`).delete();
  await handleReviewWritten(db, r, undefined);
  assert.equal((await statsDoc(ck)).reviewCount, 0);
});

test('handlePostWritten resolves subjectId -> courseKey; an unknown course is skipped without throwing', async () => {
  const ck = uid('ck'); const c = uid('c');
  await course(c, ck);
  await post(uid('p'), c, 'past_exam');
  const p = { subjectId: c, category: 'past_exam', downloadCount: 0 };
  assert.deepEqual(await handlePostWritten(db, undefined, p), [ck]);
  assert.equal((await statsDoc(ck)).pastExamPostCount, 1);
  assert.deepEqual(await handlePostWritten(db, p, { ...p, downloadCount: 5 }), []);
  assert.deepEqual(await handlePostWritten(db, undefined, { subjectId: uid('nocourse'), category: 'past_exam' }), []);
});

test('lastReviewAt takes only ISO-8601 updatedAt strings (Dart tryParse parity); V8-only formats are ignored', () => {
  const out = aggregateCourseStats('k', [
    { updatedAt: 'Sep 1 2030' }, { updatedAt: '2030' }, { updatedAt: 12345 }, { updatedAt: '2026-09-01T10:00:00.000' },
  ], NO_POSTS);
  assert.equal(out.lastReviewAt, '2026-09-01T10:00:00.000');
  assert.equal('lastReviewAt' in aggregateCourseStats('k', [{ updatedAt: 'Sep 1 2030' }], NO_POSTS), false);
});

test('keys whose slug is not a usable document id are never recounted', async () => {
  assert.deepEqual(reviewStatsKeys(undefined, { courseKey: '__bad__', rating: 3 }), []);
  assert.deepEqual(reviewStatsKeys(undefined, { courseKey: 'x'.repeat(201), rating: 3 }), []);
  assert.deepEqual(reviewStatsKeys(undefined, { courseKey: 'ok|key', rating: 3 }), ['ok|key']);
  const id = uid('c');
  await db.collection('courses').doc(id).set({ id, courseKey: '__bad__', name: 'n', university_id: 'kyoto_u' });
  assert.deepEqual(await handlePostWritten(db, undefined, { subjectId: id, category: 'past_exam' }), []);
  await assert.rejects(recomputeCourseStats(db, '__bad__'));
});
