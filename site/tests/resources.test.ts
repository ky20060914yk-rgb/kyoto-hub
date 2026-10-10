import { describe, it, expect, beforeEach } from 'vitest';
import { adminDb } from '@/lib/server/admin';
import { createResource, downloadResource, previewResource, createRequest, reportPost, requestTakedown, type Files } from '@/lib/server/resources';
import { balanceRef } from '@/lib/server/credits';
import { parseResourceInput, safeFileName } from '@/lib/domain/resource';
import { clearEmulators, seedCourse } from './emu';

const taro = { uid: 'taro', email: 'taro@st.kyoto-u.ac.jp' };
const hana = { uid: 'hana', email: 'hana@st.kyoto-u.ac.jp' };
const jiro = { uid: 'jiro', email: 'jiro@st.kyoto-u.ac.jp' };

function fakeFiles(initial: Record<string, { size?: number; contentType?: string }> = {}): Files & { store: Map<string, { size: number; contentType: string }> } {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, { size: v.size ?? 1000, contentType: v.contentType ?? 'application/pdf' }]));
  return {
    store,
    async list(prefix) { return [...store].filter(([k]) => k.startsWith(prefix)).map(([path, v]) => ({ path, ...v })); },
    async move(from, to) { store.set(to, store.get(from)!); store.delete(from); },
    async read(path) { if (!store.has(path)) throw new Error('missing'); return Buffer.from(`bytes:${path}`); },
    async remove(path) { store.delete(path); },
  };
}

const input = (over: Record<string, unknown> = {}) => parseResourceInput({
  courseId: 'c_1', category: 'past_exam', year: 2024, examType: 'final', title: '2024期末', description: '', uploadId: 'up1', ...over,
});
const bal = async (uid: string) => (await balanceRef(uid).get()).data()?.balance ?? 0;
const stats = async () => (await adminDb.collection('course_stats').doc('bisekibun|yamada').get()).data();

describe('resources', () => {
  beforeEach(async () => {
    await clearEmulators();
    await seedCourse();
    await balanceRef('hana').set({ balance: 1 });
  });

  it('parses and sanitises input', () => {
    expect(() => parseResourceInput({ courseId: 'c_1', category: 'past_exam', title: '', uploadId: 'u' })).toThrow('タイトル');
    expect(() => input({ year: 1800 })).toThrow('年度');
    expect(() => input({ uploadId: '../x' })).toThrow();
    expect(safeFileName('a/b\\c:d.pdf')).toBe('a_b_c_d.pdf');
  });

  it('publishes an upload, moves files, counts it and pays +3 once per shape', async () => {
    const files = fakeFiles({ 'uploads/taro/pending/up1/exam.pdf': {} });
    const r = await createResource(taro, input(), files);
    expect(r.granted).toBe(3);
    const post = (await adminDb.collection('posts').doc(r.postId).get()).data();
    expect(post).toMatchObject({ courseKey: 'bisekibun|yamada', fileNames: ['exam.pdf'], hidden: false });
    expect([...files.store.keys()]).toEqual([`resources/${r.postId}/0_exam.pdf`]);
    expect((await stats())?.pastExamPostCount).toBe(1);

    files.store.set('uploads/taro/pending/up2/notes.pdf', { size: 10, contentType: 'application/pdf' });
    await createResource(taro, input({ uploadId: 'up2', category: 'test_prep', examType: null }), files);
    files.store.set('uploads/taro/pending/up3/again.pdf', { size: 10, contentType: 'application/pdf' });
    const dup = await createResource(taro, input({ uploadId: 'up3', category: 'test_prep', examType: null }), files);
    expect(dup).toMatchObject({ duplicate: true, granted: 0 });
    expect(await bal('taro')).toBe(6);
  });

  it('allows one past exam per course and year; a hidden one no longer blocks', async () => {
    const files = fakeFiles({ 'uploads/taro/pending/up1/exam.pdf': {}, 'uploads/hana/pending/up2/exam.pdf': {} });
    const first = await createResource(taro, input(), files);
    await expect(createResource(hana, input({ uploadId: 'up2', examType: 'midterm' }), files)).rejects.toMatchObject({ status: 409 });
    files.store.set('uploads/hana/pending/up3/exam.pdf', { size: 1, contentType: 'application/pdf' });
    await createResource(hana, input({ uploadId: 'up3', year: 2023 }), files);
    await adminDb.collection('posts').doc(first.postId).update({ hidden: true });
    await expect(createResource(hana, input({ uploadId: 'up2' }), files)).resolves.toMatchObject({ postId: expect.any(String) });
  });

  it('keeps a small JPEG preview apart from the files and serves it', async () => {
    const files = fakeFiles({ 'uploads/taro/pending/up1/exam.pdf': {}, 'uploads/taro/pending/up1/__preview.jpg': { size: 5000, contentType: 'image/jpeg' } });
    const r = await createResource(taro, input(), files);
    const post = (await adminDb.collection('posts').doc(r.postId).get()).data();
    expect(post).toMatchObject({ fileNames: ['exam.pdf'], previewPath: `resources/${r.postId}/__preview.jpg` });
    expect(String(await previewResource(r.postId, files))).toContain('__preview.jpg');

    const bad = fakeFiles({ 'uploads/taro/pending/up2/exam.pdf': {}, 'uploads/taro/pending/up2/__preview.jpg': { size: 5 * 1024 * 1024, contentType: 'image/jpeg' } });
    const r2 = await createResource(taro, input({ uploadId: 'up2', year: 2020 }), bad);
    expect((await adminDb.collection('posts').doc(r2.postId).get()).data()?.previewPath).toBeNull();
    expect([...bad.store.keys()]).toEqual([`resources/${r2.postId}/0_exam.pdf`]);
    await expect(previewResource(r2.postId, bad)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects missing, oversized or non-PDF/image files', async () => {
    await expect(createResource(taro, input(), fakeFiles())).rejects.toMatchObject({ status: 400 });
    await expect(createResource(taro, input(), fakeFiles({ 'uploads/taro/pending/up1/big.pdf': { size: 30 * 1024 * 1024 } }))).rejects.toThrow('20MB');
    await expect(createResource(taro, input(), fakeFiles({ 'uploads/taro/pending/up1/x.exe': { contentType: 'application/x-msdownload' } }))).rejects.toThrow('PDF');
  });

  it('caps upload grants at 3 per JST day', async () => {
    const files = fakeFiles();
    let total = 0;
    for (let i = 0; i < 4; i++) {
      files.store.set(`uploads/taro/pending/u${i}/f.pdf`, { size: 1, contentType: 'application/pdf' });
      total += (await createResource(taro, input({ uploadId: `u${i}`, year: 2020 + i }), files)).granted;
    }
    expect(total).toBe(9);
  });

  it('download charges once, re-download is free, author is free, no credit → 409', async () => {
    const files = fakeFiles({ 'uploads/taro/pending/up1/exam.pdf': {} });
    const { postId } = await createResource(taro, input(), files);
    const first = await downloadResource(hana, postId, 0, files);
    expect(first).toMatchObject({ charged: true, balance: 0, filename: 'exam.pdf' });
    expect(first.bytes.toString()).toContain(`resources/${postId}/0_exam.pdf`);
    expect(await downloadResource(hana, postId, 0, files)).toMatchObject({ charged: false, balance: 0 });
    expect(await downloadResource(taro, postId, 0, files)).toMatchObject({ charged: false });
    await expect(downloadResource(jiro, postId, 0, files)).rejects.toMatchObject({ status: 409 });
    expect((await adminDb.collection('posts').doc(postId).get()).data()?.downloadCount).toBe(1);
  });

  it('fulfilling a request pays +3, notifies, and is free for the requester', async () => {
    const { requestId } = await createRequest(jiro, { courseId: 'c_1', category: 'past_exam', year: 2024, title: '2024期末', description: '' });
    const files = fakeFiles({ 'uploads/taro/pending/up1/exam.pdf': {} });
    const r = await createResource(taro, input({ requestId }), files);
    expect(r).toMatchObject({ fulfilled: true, granted: 6 });
    expect((await adminDb.collection('requests').doc(requestId).get()).data()).toMatchObject({ isFulfilled: true, fulfilledPostId: r.postId });
    const n = await adminDb.collection('notifications').where('uid', '==', 'jiro').get();
    expect(n.size).toBe(1);
    expect(await downloadResource(jiro, r.postId, 0, files)).toMatchObject({ charged: false, balance: 0 });
  });

  it('three distinct reports hide a post; a takedown request is only queued', async () => {
    const files = fakeFiles({ 'uploads/taro/pending/up1/exam.pdf': {} });
    const { postId } = await createResource(taro, input(), files);
    await reportPost(hana, postId, 'spam');
    await reportPost(hana, postId, 'spam');
    await reportPost(jiro, postId, 'spam');
    expect((await adminDb.collection('posts').doc(postId).get()).data()?.hidden).toBe(false);
    expect(await reportPost({ uid: 'kumi', email: 'k@st.kyoto-u.ac.jp' }, postId, 'x')).toMatchObject({ hidden: true });
    await expect(reportPost(taro, postId, 'x')).rejects.toMatchObject({ status: 403 });

    const other = await createResource(taro, input({ uploadId: 'up9', year: 2019 }), fakeFiles({ 'uploads/taro/pending/up9/a.pdf': {} }));
    await requestTakedown({ postId: other.postId, name: '山田', email: 'y@kyoto-u.ac.jp', affiliation: '理学研究科', detail: '著作権' });
    // The owner decides after checking it (a public form must not let anyone hide anything).
    expect((await adminDb.collection('posts').doc(other.postId).get()).data()?.hidden).toBe(false);
    const q = await adminDb.collection('moderation_queue').where('kind', '==', 'takedown').get();
    expect(q.docs.map((d) => d.data())).toEqual([expect.objectContaining({ postId: other.postId, priority: true, status: 'open', postFound: true })]);
    expect((await adminDb.collection('notifications').where('uid', '==', 'taro').where('kind', '==', 'resource_removed').get()).size).toBe(0);
  });
});
