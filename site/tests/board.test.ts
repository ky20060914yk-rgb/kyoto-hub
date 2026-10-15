import { describe, it, expect, beforeEach } from 'vitest';
import { adminDb } from '@/lib/server/admin';
import { createAnswer, createQuestion, deleteOwn, reportBoard } from '@/lib/server/board';
import { BOARD_LIMITS, parseQuestion } from '@/lib/domain/board';
import { clearEmulators, seedCourse } from './emu';

const taro = { uid: 'taro', email: 'taro@st.kyoto-u.ac.jp' };
const hana = { uid: 'hana', email: 'hana@st.kyoto-u.ac.jp' };
const q = (questionId: string) => adminDb.collection('questions').doc(questionId);

describe('board', () => {
  beforeEach(async () => {
    await clearEmulators();
    await seedCourse();
  });

  it('validates input', () => {
    expect(() => parseQuestion({ courseId: 'c_1', title: '  ' })).toThrow('質問');
    expect(() => parseQuestion({ courseId: 'c_1', title: 'x'.repeat(81) })).toThrow('80');
    expect(() => parseQuestion({ courseId: '../x', title: 'ok' })).toThrow();
  });

  it('a question gets answers, a counter, and notifies the asker (not self-answers)', async () => {
    const { questionId } = await createQuestion(taro, parseQuestion({ courseId: 'c_1', title: '教科書いる？', body: '' }));
    expect((await q(questionId).get()).data()).toMatchObject({ courseKey: 'bisekibun|yamada', answerCount: 0, hidden: false });

    await createAnswer(hana, { questionId, body: 'いらない' });
    await createAnswer(taro, { questionId, body: 'ありがとう' });
    expect((await q(questionId).get()).data()?.answerCount).toBe(2);
    const notes = await adminDb.collection('notifications').where('uid', '==', 'taro').get();
    expect(notes.docs.map((d) => d.data().kind)).toEqual(['question_answered']);
  });

  it('caps questions per JST day', async () => {
    const now = new Date('2026-10-15T03:00:00Z');
    for (let i = 0; i < BOARD_LIMITS.questionsPerDay; i++) await createQuestion(taro, { courseId: 'c_1', title: `q${i}`, body: '' }, now);
    await expect(createQuestion(taro, { courseId: 'c_1', title: 'more', body: '' }, now)).rejects.toMatchObject({ status: 429 });
    await expect(createQuestion(taro, { courseId: 'c_1', title: 'next day', body: '' }, new Date('2026-10-16T03:00:00Z'))).resolves.toBeTruthy();
  });

  it('three reports hide an answer and email the operator once; authors can delete their own', async () => {
    const { questionId } = await createQuestion(taro, { courseId: 'c_1', title: 'q', body: '' });
    const { answerId } = await createAnswer(hana, { questionId, body: 'bad' });
    const alerts: string[] = [];
    const alert = async (s: string) => { alerts.push(s); return true; };
    await expect(reportBoard(hana, { questionId, answerId }, 'x', alert)).rejects.toMatchObject({ status: 403 });
    for (const uid of ['a', 'b']) await reportBoard({ uid, email: `${uid}@st.kyoto-u.ac.jp` }, { questionId, answerId }, 'x', alert);
    expect(alerts).toHaveLength(0);
    expect(await reportBoard({ uid: 'c', email: 'c@st.kyoto-u.ac.jp' }, { questionId, answerId }, 'x', alert)).toMatchObject({ hidden: true });
    expect(alerts).toHaveLength(1);

    await expect(deleteOwn(hana, { questionId, answerId: null })).rejects.toMatchObject({ status: 403 });
    await deleteOwn(taro, { questionId, answerId: null });
    expect((await q(questionId).get()).data()).toMatchObject({ hidden: true, deletedByAuthor: true });
    await expect(createAnswer(hana, { questionId, body: 'late' })).rejects.toMatchObject({ status: 404 });
  });
});
