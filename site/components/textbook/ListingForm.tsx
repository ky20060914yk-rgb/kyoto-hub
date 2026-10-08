'use client';

import { useEffect, useState } from 'react';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '@/lib/firebase/client';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { TextArea, TextField } from '@/components/ui/TextField';
import { CONDITION, LISTING_TYPE, MAX_PHOTOS, MAX_PRICE, PLACES, type Condition, type ListingType } from '@/lib/domain/textbook';
import type { CatalogCourse } from '@/lib/public-types';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function Pills<T extends string>({ label, options, value, onChange }: { label: string; options: Record<T, string>; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-label">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(options) as T[]).map((k) => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
            className={`h-9 rounded-full border px-3 text-caption transition-colors duration-fast ${value === k ? 'border-brand bg-brand-subtle font-medium text-brand' : 'border-line-strong text-ink hover:bg-surface-muted'}`}>
            {options[k]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function ListingForm({ uid, onDone }: { uid: string; onDone: (id: string) => void }) {
  const [type, setType] = useState<ListingType>('sell');
  const [title, setTitle] = useState('');
  const [course, setCourse] = useState<CatalogCourse | null>(null);
  const [courseQ, setCourseQ] = useState('');
  const [courseHits, setCourseHits] = useState<CatalogCourse[]>([]);
  const [condition, setCondition] = useState<Condition>('good');
  const [price, setPrice] = useState('');
  const [place, setPlace] = useState<string>(PLACES[0]);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (course || courseQ.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/courses?q=${encodeURIComponent(courseQ)}`).then((x) => x.json()).catch(() => ({ courses: [] }));
      setCourseHits((r.courses as CatalogCourse[]).slice(0, 6));
    }, 250);
    return () => clearTimeout(t);
  }, [courseQ, course]);

  function pickPhotos(list: FileList | null) {
    const arr = [...(list ?? [])].slice(0, MAX_PHOTOS);
    if (arr.some((f) => !PHOTO_TYPES.includes(f.type) || f.size > 5 * 1024 * 1024)) return setError('写真はJPEG/PNG/WebP、1枚5MBまでです。');
    setError(null);
    setPhotos(arr);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const urls = await Promise.all(photos.map(async (f) => {
        const r = storageRef(storage, `textbook_photos/${uid}/${crypto.randomUUID()}.${f.type.split('/')[1]}`);
        await uploadBytes(r, f, { contentType: f.type });
        return getDownloadURL(r);
      }));
      const res = await api<{ listingId: string }>('/api/textbooks', {
        method: 'POST',
        json: { type, title, courseId: course?.id ?? null, condition: type === 'want' ? null : condition, price: type === 'sell' ? Number(price) : null, place, note, photos: urls },
      });
      onDone(res.listingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '出品できませんでした。');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Pills label="種類" options={LISTING_TYPE} value={type} onChange={setType} />
      <TextField label="本のタイトル" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required placeholder="例：解析入門 I（杉浦光夫）" />
      <div>
        {course ? (
          <div className="flex items-center gap-2 rounded-m bg-brand-subtle px-3 py-2 text-caption text-brand">
            <span className="flex-1 truncate">関連科目：{course.name}（{course.lecturer}）</span>
            <button type="button" onClick={() => { setCourse(null); setCourseQ(''); }} aria-label="関連科目を外す"><Icon name="close" className="size-4" /></button>
          </div>
        ) : (
          <>
            <TextField label="関連する科目（任意）" value={courseQ} onChange={(e) => setCourseQ(e.target.value)} placeholder="科目名で検索" hint="科目を選ぶと、その科目の教科書を探している人に通知が届きます" />
            {courseHits.length && courseQ.trim().length >= 2 ? (
              <ul className="mt-1 overflow-hidden rounded-m border border-line bg-surface">
                {courseHits.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setCourse(c)} className="block w-full truncate px-3 py-2 text-left text-caption hover:bg-surface-muted">
                      {c.name}<span className="text-ink-2">・{c.lecturer}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
      {type !== 'want' ? <Pills label="状態" options={CONDITION} value={condition} onChange={setCondition} /> : null}
      {type === 'sell' ? (
        <TextField label="価格（円）" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} required
          hint={`定価より安く。上限 ${MAX_PRICE.toLocaleString()}円`} />
      ) : null}
      <label className="block">
        <span className="mb-1 block text-label">受け渡し場所</span>
        <select value={place} onChange={(e) => setPlace(e.target.value)} className="h-12 w-full rounded-m bg-surface-muted px-3 text-body outline-none ring-brand focus:ring-2">
          {PLACES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <TextArea label="説明（任意）" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="版、書き込みの程度、受け渡しできる曜日など" />
      {type !== 'want' ? (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-l border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-center hover:bg-canvas">
          <Icon name="camera" className="size-6 text-ink-2" />
          <span className="text-body">{photos.length ? `${photos.length}枚選択中` : `写真を追加（${MAX_PHOTOS}枚まで）`}</span>
          <input type="file" accept={PHOTO_TYPES.join(',')} multiple className="sr-only" onChange={(e) => pickPhotos(e.target.files)} />
        </label>
      ) : null}
      <p className="rounded-m bg-warning-bg px-3 py-2 text-caption text-warning">
        お金のやり取りはアプリの外（手渡しなど）で行います。京大InfoHubは代金を預かりません。教科書以外の出品はできません。
      </p>
      {error ? <p role="alert" className="rounded-m bg-danger-bg px-3 py-2 text-caption text-danger">{error}</p> : null}
      <Button type="submit" loading={busy} disabled={!title.trim() || (type === 'sell' && !price)}>{type === 'want' ? '募集する' : '出品する'}</Button>
    </form>
  );
}
