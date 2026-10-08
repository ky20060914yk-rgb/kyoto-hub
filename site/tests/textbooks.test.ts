import { describe, it, expect, beforeEach } from 'vitest';
import { adminDb } from '@/lib/server/admin';
import { createListing, updateListing, openChat, completeChat, rateTrade } from '@/lib/server/textbooks';
import { parseListingInput, isOwnPhotoUrl } from '@/lib/domain/textbook';
import { clearEmulators, seedCourse } from './emu';

const taro = { uid: 'taro', email: 'taro@st.kyoto-u.ac.jp' };
const hana = { uid: 'hana', email: 'hana@st.kyoto-u.ac.jp' };
const jiro = { uid: 'jiro', email: 'jiro@st.kyoto-u.ac.jp' };

const sell = (over: Record<string, unknown> = {}, uid = 'taro') =>
  parseListingInput({ type: 'sell', title: '解析入門', courseId: 'c_1', condition: 'good', price: 1500, place: '時計台前', note: '', photos: [], ...over }, uid);

describe('textbook domain', () => {
  it('validates listings', () => {
    expect(sell().price).toBe(1500);
    expect(() => sell({ price: -1 })).toThrow('価格');
    expect(() => sell({ condition: '' })).toThrow('状態');
    expect(parseListingInput({ type: 'want', title: 'x', place: '時計台前' }, 'u')).toMatchObject({ condition: null, price: null });
    expect(() => sell({ photos: ['https://evil.example/x.png'] })).toThrow('写真');
  });
  it('accepts only the caller’s own photo URLs', () => {
    const own = 'https://firebasestorage.googleapis.com/v0/b/kyodai-sns.firebasestorage.app/o/textbook_photos%2Ftaro%2Fa.jpg?alt=media';
    expect(isOwnPhotoUrl(own, 'taro')).toBe(true);
    expect(isOwnPhotoUrl(own, 'hana')).toBe(false);
  });
});

describe('textbook marketplace', () => {
  beforeEach(async () => {
    await clearEmulators();
    await seedCourse();
  });

  it('a new sale notifies people who want a book for that course', async () => {
    await createListing(hana, parseListingInput({ type: 'want', title: '解析の教科書', courseId: 'c_1', place: '時計台前' }, 'hana'));
    const { listingId } = await createListing(taro, sell());
    const n = await adminDb.collection('notifications').where('uid', '==', 'hana').get();
    expect(n.docs.map((d) => d.data().href)).toEqual([`/textbooks/${listingId}`]);
    expect((await adminDb.collection('textbook_listings').doc(listingId).get()).data()).toMatchObject({ courseKey: 'bisekibun|yamada', status: 'open' });
  });

  it('chat → complete → both rate once; aggregates are server-side', async () => {
    const { listingId } = await createListing(taro, sell());
    await expect(openChat(taro, listingId)).rejects.toMatchObject({ status: 400 });
    const { chatId, created } = await openChat(hana, listingId);
    expect(created).toBe(true);
    expect((await openChat(hana, listingId)).created).toBe(false);
    await expect(rateTrade(hana, chatId, 5, '')).rejects.toMatchObject({ status: 409 });
    await expect(completeChat(jiro, chatId)).rejects.toMatchObject({ status: 404 });
    await completeChat(taro, chatId);
    expect((await adminDb.collection('textbook_listings').doc(listingId).get()).data()?.status).toBe('closed');
    await rateTrade(hana, chatId, 5, 'スムーズでした');
    await rateTrade(taro, chatId, 4, '');
    await expect(rateTrade(hana, chatId, 5, '')).rejects.toMatchObject({ status: 409 });
    expect((await adminDb.collection('user_stats').doc('taro').get()).data()).toMatchObject({ tradeRatingSum: 5, tradeRatingCount: 1 });
    await expect(openChat(jiro, listingId)).rejects.toMatchObject({ status: 404 });
  });

  it('only the seller can close or extend', async () => {
    const { listingId } = await createListing(taro, sell());
    await expect(updateListing(hana, listingId, 'close')).rejects.toMatchObject({ status: 403 });
    await updateListing(taro, listingId, 'close');
    await updateListing(taro, listingId, 'extend');
    expect((await adminDb.collection('textbook_listings').doc(listingId).get()).data()?.status).toBe('open');
  });

  it('expired listings cannot be opened', async () => {
    const { listingId } = await createListing(taro, sell(), new Date('2026-01-01T00:00:00Z'));
    await expect(openChat(hana, listingId, new Date('2026-03-01T00:00:00Z'))).rejects.toMatchObject({ status: 404 });
  });
});
