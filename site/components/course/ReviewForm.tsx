'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextArea, TextField } from '@/components/ui/TextField';
import { StarGlyph } from './bits';
import {
  RAKUTAN, ATTENDANCE, GRADING, PAST_EXAM, BRING_IN, MAX_COMMENT, type ReviewInput,
} from '@/lib/domain/review';

const DEFAULTS: Omit<ReviewInput, 'rating'> & { rating: number } = {
  rating: 0, rakutan: 'futsu', attendance: 'light', grading: 'exam_report', pastExam: 'trend_only', bringIn: 'na',
  comment: '', termTaken: null, gradeTaken: null,
};

function Segmented<T extends string>({ label, options, value, onChange }:
  { label: string; options: Record<T, string>; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-label text-ink">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(options) as T[]).map((k) => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
            className={`h-9 rounded-full border px-3 text-caption transition-colors duration-fast ${
              value === k ? 'border-brand bg-brand-subtle font-medium text-brand' : 'border-line-strong bg-surface text-ink hover:bg-surface-muted'}`}>
            {options[k]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function ReviewForm({ initial, onSubmit, onDelete }: {
  initial?: ReviewInput;
  onSubmit: (input: ReviewInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [v, setV] = useState<typeof DEFAULTS>(initial ?? DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [popped, setPopped] = useState(0);
  const set = <K extends keyof typeof DEFAULTS>(k: K, val: (typeof DEFAULTS)[K]) => setV((p) => ({ ...p, [k]: val }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (v.rating < 1) return setError('おすすめ度を選んでください。');
    setBusy(true);
    setError(null);
    try {
      await onSubmit(v as ReviewInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存できませんでした。');
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset>
        <legend className="mb-1 text-label text-ink">おすすめ度</legend>
        <div className="flex" role="radiogroup" aria-label="おすすめ度">
          {[1, 2, 3, 4, 5].map((i) => (
            <button key={i} type="button" role="radio" aria-checked={v.rating === i} aria-label={`${i}点`}
              onClick={() => { set('rating', i); setPopped(i); }}
              className="grid size-tap place-items-center">
              <span key={popped === i ? `p${i}` : i} className={popped === i ? 'animate-pop' : ''}>
                <StarGlyph fill={v.rating >= i ? 1 : 0} className="size-8" />
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <Segmented label="楽単度" options={RAKUTAN} value={v.rakutan} onChange={(x) => set('rakutan', x)} />
      <Segmented label="出席" options={ATTENDANCE} value={v.attendance} onChange={(x) => set('attendance', x)} />
      <Segmented label="成績のつけ方" options={GRADING} value={v.grading} onChange={(x) => set('grading', x)} />
      <Segmented label="過去問の効き" options={PAST_EXAM} value={v.pastExam} onChange={(x) => set('pastExam', x)} />
      <Segmented label="持ち込み" options={BRING_IN} value={v.bringIn} onChange={(x) => set('bringIn', x)} />
      <TextArea label="コメント（任意）" maxLength={MAX_COMMENT} value={v.comment} onChange={(e) => set('comment', e.target.value)}
        placeholder="教授の特徴、テストの傾向、これから取る人へのアドバイスなど" />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="履修時期（任意）" placeholder="2025前期" value={v.termTaken ?? ''} onChange={(e) => set('termTaken', e.target.value || null)} maxLength={20} />
        <TextField label="評価（任意）" placeholder="A" value={v.gradeTaken ?? ''} onChange={(e) => set('gradeTaken', e.target.value || null)} maxLength={4} />
      </div>
      <p className="text-caption text-ink-2">レビューは匿名（表示名のみ）で公開され、京大生だけが読めます。</p>
      {error ? <p role="alert" className="rounded-m bg-danger-bg px-3 py-2 text-caption text-danger">{error}</p> : null}
      <Button type="submit" loading={busy}>{initial ? '更新する' : '投稿する'}</Button>
      {onDelete ? (
        <Button type="button" variant="text" className="text-danger" onClick={async () => {
          if (!confirm('このレビューを削除しますか？')) return;
          setBusy(true);
          await onDelete().catch((e) => setError(e instanceof Error ? e.message : '削除できませんでした。'));
          setBusy(false);
        }}>レビューを削除</Button>
      ) : null}
    </form>
  );
}
