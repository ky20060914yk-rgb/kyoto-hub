import 'server-only';
import { FieldValue, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from './admin';
import { jstDay } from './credits';
import { getCourseOr404 } from './reviews';
import { authorName } from './resources';
import { notify } from './notify';
import { alertOwner } from './alert';
import type { KuUser } from './auth';
import { HttpError } from '@/lib/http-error';
import { REPORT_THRESHOLD } from '@/lib/domain/resource';
import { BOARD_LIMITS, type AnswerInput, type BoardTarget, type QuestionInput } from '@/lib/domain/board';

// Per-course Q&A board (owner decisions 2026-10-15: no credits for posting, no
// exam-period lock; reports hide at REPORT_THRESHOLD and email the operator).
// questions/{id} and questions/{id}/answers/{id} are server-written only.

const questions = () => adminDb.collection('questions');

/** Daily posting caps per user (JST day), read and written inside the caller's transaction. */
async function takeQuota(tx: Transaction, uid: string, kind: 'questions' | 'answers', now: Date) {
  const ref = adminDb.collection('board_limits').doc(uid);
  const d = (await tx.get(ref)).data() ?? {};
  const day = jstDay(now);
  const used = d.day === day ? Number(d[kind] ?? 0) : 0;
  const cap = kind === 'questions' ? BOARD_LIMITS.questionsPerDay : BOARD_LIMITS.answersPerDay;
  if (used >= cap) throw new HttpError(429, `${kind === 'questions' ? '質問' : '回答'}は1日${cap}件までです。`);
  return () => tx.set(ref, d.day === day ? { [kind]: used + 1 } : { day, questions: 0, answers: 0, [kind]: 1 }, { merge: true });
}

export async function createQuestion(user: KuUser, input: QuestionInput, now = new Date()) {
  const course = await getCourseOr404(input.courseId);
  const name = await authorName(user.uid);
  const ref = questions().doc();
  const iso = now.toISOString();
  await adminDb.runTransaction(async (tx) => {
    const commitQuota = await takeQuota(tx, user.uid, 'questions', now);
    commitQuota();
    tx.create(ref, {
      id: ref.id, university_id: 'kyoto_u', courseId: course.id, courseKey: course.courseKey, courseName: course.name,
      authorId: user.uid, authorName: name, title: input.title, body: input.body, answerCount: 0,
      createdAt: iso, lastActivityAt: iso, hidden: false, reports: [],
    });
  });
  return { questionId: ref.id, courseId: course.id };
}

export async function createAnswer(user: KuUser, input: AnswerInput, now = new Date()) {
  const qRef = questions().doc(input.questionId);
  const name = await authorName(user.uid);
  const aRef = qRef.collection('answers').doc();
  const iso = now.toISOString();
  await adminDb.runTransaction(async (tx) => {
    const q = (await tx.get(qRef)).data();
    if (!q || q.hidden) throw new HttpError(404, '質問が見つかりません。');
    const commitQuota = await takeQuota(tx, user.uid, 'answers', now);
    commitQuota();
    tx.create(aRef, { id: aRef.id, questionId: qRef.id, authorId: user.uid, authorName: name, body: input.body, createdAt: iso, hidden: false, reports: [] });
    tx.update(qRef, { answerCount: FieldValue.increment(1), lastActivityAt: iso });
    if (q.authorId !== user.uid) {
      notify({ uid: q.authorId, kind: 'question_answered', title: `「${q.title}」に回答がつきました`, body: q.courseName ?? '',
        href: `/courses/${q.courseId}?tab=questions` }, tx);
    }
  });
  return { answerId: aRef.id };
}

function targetRef(t: BoardTarget): DocumentReference {
  const q = questions().doc(t.questionId);
  return t.answerId ? q.collection('answers').doc(t.answerId) : q;
}

/** One report per account; at REPORT_THRESHOLD the item is hidden, queued, and the operator is emailed. */
export async function reportBoard(user: KuUser, t: BoardTarget, reason: string, alert = alertOwner) {
  const ref = targetRef(t);
  const out = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, '書き込みが見つかりません。');
    const d = snap.data()!;
    const reports: string[] = Array.isArray(d.reports) ? d.reports : [];
    if (d.authorId === user.uid) throw new HttpError(403, '自分の書き込みは通報できません。');
    if (reports.includes(user.uid)) return { hidden: !!d.hidden, already: true, text: '' };
    const hide = !d.hidden && reports.length + 1 >= REPORT_THRESHOLD;
    tx.update(ref, { reports: FieldValue.arrayUnion(user.uid), ...(hide ? { hidden: true } : {}) });
    tx.create(adminDb.collection('moderation_queue').doc(), {
      kind: 'board_report', path: ref.path, reporter: user.uid, reason: reason.slice(0, 500), hiddenNow: hide,
      priority: false, createdAt: new Date().toISOString(), status: 'open',
    });
    return { hidden: hide, already: false, text: String(d.title ? `${d.title}\n${d.body}` : d.body).slice(0, 500) };
  });
  if (out.hidden && !out.already) {
    await alert('【京大InfoHub】掲示板の書き込みが通報で非公開になりました', [
      `通報が${REPORT_THRESHOLD}件に達したため、自動で非公開にしました。問題なければ hidden を false に戻してください。`,
      '', `場所：${ref.path}`, '', out.text,
    ].join('\n'));
  }
  return { hidden: out.hidden, already: out.already };
}

/** Authors can take down their own question or answer (kept as hidden for moderation history). */
export async function deleteOwn(user: KuUser, t: BoardTarget) {
  const ref = targetRef(t);
  return adminDb.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (!d || d.hidden) throw new HttpError(404, '書き込みが見つかりません。');
    if (d.authorId !== user.uid) throw new HttpError(403, '自分の書き込みだけ削除できます。');
    tx.update(ref, { hidden: true, deletedByAuthor: true });
    if (t.answerId) tx.update(questions().doc(t.questionId), { answerCount: FieldValue.increment(-1) });
    return { ok: true };
  });
}
