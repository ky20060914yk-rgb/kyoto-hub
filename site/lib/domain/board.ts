// Per-course Q&A board: input parsing shared by the API routes and the form.
import { HttpError } from '@/lib/http-error';

export const BOARD_LIMITS = { questionsPerDay: 5, answersPerDay: 20, titleMax: 80, bodyMax: 1000 } as const;

export type QuestionInput = { courseId: string; title: string; body: string };
export type AnswerInput = { questionId: string; body: string };
export type BoardTarget = { questionId: string; answerId: string | null };

const id = (v: unknown, field: string) => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw new HttpError(400, `${field}の指定が正しくありません。`);
  return v;
};

function text(v: unknown, max: number, field: string, required: boolean) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${field}を入力してください。`);
  if (s.length > max) throw new HttpError(400, `${field}は${max}文字以内にしてください。`);
  return s;
}

export function parseQuestion(body: unknown): QuestionInput {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    courseId: id(b.courseId, '科目'),
    title: text(b.title, BOARD_LIMITS.titleMax, '質問', true),
    body: text(b.body, BOARD_LIMITS.bodyMax, '補足', false),
  };
}

export function parseAnswer(body: unknown): AnswerInput {
  const b = (body ?? {}) as Record<string, unknown>;
  return { questionId: id(b.questionId, '質問'), body: text(b.body, BOARD_LIMITS.bodyMax, '回答', true) };
}

export function parseTarget(body: unknown): BoardTarget {
  const b = (body ?? {}) as Record<string, unknown>;
  return { questionId: id(b.questionId, '質問'), answerId: b.answerId ? id(b.answerId, '回答') : null };
}
