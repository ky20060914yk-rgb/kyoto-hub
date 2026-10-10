// Past exams / study materials (redesign spec §4.3). Category wire values are
// the Flutter ones: 'past_exam' is 過去問; 'test_prep' and 'other' are both
// shown as 資料 (the spec drops the テスト対策 / その他 split).
import { HttpError } from '@/lib/http-error';

export const RESOURCE_CATEGORY = { past_exam: '過去問', test_prep: '資料' } as const;
export type ResourceCategory = keyof typeof RESOURCE_CATEGORY;
export const EXAM_TYPE = { midterm: '中間', final: '期末', makeup: '追試', other: 'その他' } as const;
export type ExamType = keyof typeof EXAM_TYPE;

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
export const REPORT_THRESHOLD = 3;
/** Blurred first-page preview the browser makes at upload (see ResourceSection); not counted as a file. */
export const PREVIEW_NAME = '__preview.jpg';
export const MAX_PREVIEW_BYTES = 1024 * 1024;

export const isPastExam = (category: unknown) => category === 'past_exam';

export type ResourceInput = {
  courseId: string;
  category: ResourceCategory;
  year: number | null;
  examType: ExamType | null;
  title: string;
  description: string;
  uploadId: string;
  requestId: string | null;
};

export type RequestInput = {
  courseId: string;
  category: ResourceCategory;
  year: number | null;
  title: string;
  description: string;
};

const thisYear = () => new Date().getFullYear();

function year(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1990 || n > thisYear() + 1) throw new HttpError(400, '年度の値が正しくありません。');
  return n;
}

function text(v: unknown, max: number, field: string, required = false): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${field}を入力してください。`);
  if (s.length > max) throw new HttpError(400, `${field}は${max}文字以内にしてください。`);
  return s;
}

const id = (v: unknown, field: string) => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw new HttpError(400, `${field}の指定が正しくありません。`);
  return v;
};

export function parseResourceInput(body: unknown): ResourceInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!(typeof b.category === 'string' && b.category in RESOURCE_CATEGORY)) throw new HttpError(400, '種類を選んでください。');
  const examType = b.examType == null || b.examType === '' ? null : b.examType;
  if (examType !== null && !(typeof examType === 'string' && examType in EXAM_TYPE)) throw new HttpError(400, '試験の種類が正しくありません。');
  return {
    courseId: id(b.courseId, '科目'),
    category: b.category as ResourceCategory,
    year: year(b.year),
    examType: examType as ExamType | null,
    title: text(b.title, 80, 'タイトル', true),
    description: text(b.description, 1000, '説明'),
    uploadId: id(b.uploadId, 'アップロード'),
    requestId: b.requestId ? id(b.requestId, 'リクエスト') : null,
  };
}

export function parseRequestInput(body: unknown): RequestInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!(typeof b.category === 'string' && b.category in RESOURCE_CATEGORY)) throw new HttpError(400, '種類を選んでください。');
  return {
    courseId: id(b.courseId, '科目'),
    category: b.category as ResourceCategory,
    year: year(b.year),
    title: text(b.title, 80, 'タイトル', true),
    description: text(b.description, 500, '説明'),
  };
}

/** Same-shaped uploads (course + category + year + exam type) earn credits only once. */
export const dedupKey = (courseKey: string, r: Pick<ResourceInput, 'category' | 'year' | 'examType'>) =>
  `${courseKey}|${r.category}|${r.year ?? '-'}|${r.examType ?? '-'}`;

/** Storage-safe file name: keeps the extension, drops path characters. */
export function safeFileName(name: string): string {
  const cleaned = name.normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return (cleaned || 'file').slice(-100);
}
