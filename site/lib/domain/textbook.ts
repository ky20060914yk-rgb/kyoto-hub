// Textbook marketplace (redesign spec §4.4). Payment happens outside the app.
import { HttpError } from '@/lib/http-error';

export const LISTING_TYPE = { give: '譲ります', sell: '売ります', want: '買いたい' } as const;
export type ListingType = keyof typeof LISTING_TYPE;
export const CONDITION = { like_new: '新品同様', good: '目立つ傷なし', fair: 'やや傷あり', marked: '書き込みあり' } as const;
export type Condition = keyof typeof CONDITION;
export const PLACES = ['時計台前', '吉田生協前', 'ルネ前', '附属図書館前', '吉田南総合館前', '桂キャンパス', '宇治キャンパス', '相談して決める'] as const;

export const LISTING_DAYS = 30;
export const MAX_PRICE = 30000;
export const MAX_PHOTOS = 3;
export const MAX_MESSAGE = 1000;

export type ListingInput = {
  type: ListingType;
  title: string;
  courseId: string | null;
  condition: Condition | null;
  price: number | null;
  place: string;
  note: string;
  photos: string[];
};

function text(v: unknown, max: number, field: string, required = false) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${field}を入力してください。`);
  if (s.length > max) throw new HttpError(400, `${field}は${max}文字以内にしてください。`);
  return s;
}

/** Photos must be download URLs of the caller's own textbook_photos folder. */
export function isOwnPhotoUrl(url: string, uid: string) {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.split('/o/')[1] ?? '');
    return /^(https:\/\/firebasestorage\.googleapis\.com|http:\/\/127\.0\.0\.1:9199)$/.test(u.origin) && path.startsWith(`textbook_photos/${uid}/`);
  } catch {
    return false;
  }
}

export function parseListingInput(body: unknown, uid: string): ListingInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!(typeof b.type === 'string' && b.type in LISTING_TYPE)) throw new HttpError(400, '出品の種類を選んでください。');
  const type = b.type as ListingType;
  const condition = b.condition == null || b.condition === '' ? null : b.condition;
  if (type !== 'want' && !(typeof condition === 'string' && condition in CONDITION)) throw new HttpError(400, '本の状態を選んでください。');
  let price: number | null = null;
  if (type === 'sell') {
    price = Number(b.price);
    if (!Number.isInteger(price) || price < 0 || price > MAX_PRICE) throw new HttpError(400, `価格は0〜${MAX_PRICE.toLocaleString()}円で入力してください。`);
  }
  const place = text(b.place, 30, '受け渡し場所', true);
  const photos = Array.isArray(b.photos) ? b.photos.filter((p): p is string => typeof p === 'string') : [];
  if (photos.length > MAX_PHOTOS) throw new HttpError(400, `写真は${MAX_PHOTOS}枚までです。`);
  if (photos.some((p) => !isOwnPhotoUrl(p, uid))) throw new HttpError(400, '写真の指定が正しくありません。');
  const courseId = typeof b.courseId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(b.courseId) ? b.courseId : null;
  return {
    type, title: text(b.title, 100, '本のタイトル', true), courseId,
    condition: type === 'want' ? null : (condition as Condition), price, place, note: text(b.note, 1000, '説明'), photos,
  };
}

export const chatIdFor = (listingId: string, buyerId: string) => `${listingId}_${buyerId}`;
