import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './admin';
import { getCourseOr404 } from './reviews';
import { notify } from './notify';
import type { KuUser } from './auth';
import { HttpError } from '@/lib/http-error';
import { LISTING_DAYS, chatIdFor, type ListingInput } from '@/lib/domain/textbook';

const listings = () => adminDb.collection('textbook_listings');
const chats = () => adminDb.collection('chats');
const DAY = 86400_000;

async function displayName(uid: string) {
  return ((await adminDb.collection('users').doc(uid).get()).data()?.displayName as string) || '京大生';
}

/** Create a listing; a give/sell for a course notifies everyone who wants a book for that course. */
export async function createListing(user: KuUser, input: ListingInput, now = new Date()) {
  const course = input.courseId ? await getCourseOr404(input.courseId) : null;
  const open = await listings().where('sellerId', '==', user.uid).where('status', '==', 'open').count().get();
  if (open.data().count >= 20) throw new HttpError(429, '公開中の出品は20件までです。');
  const ref = listings().doc();
  await ref.set({
    id: ref.id, university_id: 'kyoto_u', ...input, courseId: course?.id ?? null, courseKey: course?.courseKey ?? null,
    courseName: course?.name ?? null, sellerId: user.uid, sellerName: await displayName(user.uid), status: 'open',
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + LISTING_DAYS * DAY).toISOString(),
  });

  if (course && input.type !== 'want') {
    const wants = await listings().where('courseKey', '==', course.courseKey).where('type', '==', 'want').where('status', '==', 'open').limit(30).get();
    const batch = adminDb.batch();
    const told = new Set<string>();
    for (const w of wants.docs) {
      const uid = w.data().sellerId as string;
      if (uid === user.uid || told.has(uid)) continue;
      told.add(uid);
      notify({ uid, kind: 'textbook_match', title: `「${course.name}」の教科書が出品されました`, body: input.title, href: `/textbooks/${ref.id}` }, batch);
    }
    await batch.commit();
  }
  return { listingId: ref.id };
}

async function ownListing(user: KuUser, id: string) {
  const snap = await listings().doc(id).get();
  if (!snap.exists) throw new HttpError(404, '出品が見つかりません。');
  if (snap.data()!.sellerId !== user.uid) throw new HttpError(403, '自分の出品だけ変更できます。');
  return snap;
}

/** Seller actions: close (取り下げ / 取引完了) or extend another 30 days. */
export async function updateListing(user: KuUser, id: string, action: 'close' | 'extend', now = new Date()) {
  await ownListing(user, id);
  if (action === 'close') await listings().doc(id).update({ status: 'closed', closedAt: now.toISOString() });
  else await listings().doc(id).update({ status: 'open', expiresAt: new Date(now.getTime() + LISTING_DAYS * DAY).toISOString() });
  return { ok: true };
}

/** Buyer opens (or reuses) the one chat for this listing. */
export async function openChat(user: KuUser, listingId: string, now = new Date()) {
  const snap = await listings().doc(listingId).get();
  const l = snap.data();
  if (!l || l.status !== 'open' || l.expiresAt < now.toISOString()) throw new HttpError(404, 'この出品は受付を終了しました。');
  if (l.sellerId === user.uid) throw new HttpError(400, '自分の出品です。');
  const id = chatIdFor(listingId, user.uid);
  const ref = chats().doc(id);
  const created = await adminDb.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return false;
    const buyerName = await displayName(user.uid);
    tx.create(ref, {
      id, listingId, listingTitle: l.title, listingType: l.type, sellerId: l.sellerId, sellerName: l.sellerName, buyerId: user.uid,
      buyerName, members: [l.sellerId, user.uid], status: 'open', lastMessage: '', lastAt: now.toISOString(),
      createdAt: now.toISOString(), ratedBy: [], university_id: 'kyoto_u',
    });
    notify({ uid: l.sellerId, kind: 'textbook_message', title: `「${l.title}」に取引の申し込みがありました`, body: `${buyerName}さんから`, href: `/textbooks/chats/${id}` }, tx);
    return true;
  });
  return { chatId: id, created };
}

/** Either side marks the trade done; the listing closes and both may rate. */
export async function completeChat(user: KuUser, chatId: string, now = new Date()) {
  const ref = chats().doc(chatId);
  await adminDb.runTransaction(async (tx) => {
    const c = (await tx.get(ref)).data();
    if (!c || !c.members.includes(user.uid)) throw new HttpError(404, '取引が見つかりません。');
    if (c.status === 'done') return;
    tx.update(ref, { status: 'done', doneAt: now.toISOString() });
    tx.update(listings().doc(c.listingId), { status: 'closed', closedAt: now.toISOString() });
  });
  return { ok: true };
}

/** One rating per side after the trade is done; aggregates live in server-only user_stats. */
export async function rateTrade(user: KuUser, chatId: string, stars: number, comment: string, now = new Date()) {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, '評価は★1〜5で選んでください。');
  const ref = chats().doc(chatId);
  await adminDb.runTransaction(async (tx) => {
    const c = (await tx.get(ref)).data();
    if (!c || !c.members.includes(user.uid)) throw new HttpError(404, '取引が見つかりません。');
    if (c.status !== 'done') throw new HttpError(409, '取引が完了してから評価できます。');
    if ((c.ratedBy ?? []).includes(user.uid)) throw new HttpError(409, 'すでに評価しました。');
    const to = c.sellerId === user.uid ? c.buyerId : c.sellerId;
    tx.create(adminDb.collection('trade_ratings').doc(`${chatId}_${user.uid}`), {
      chatId, listingId: c.listingId, from: user.uid, to, stars, comment: comment.trim().slice(0, 200), createdAt: now.toISOString(), university_id: 'kyoto_u',
    });
    tx.update(ref, { ratedBy: FieldValue.arrayUnion(user.uid) });
    tx.set(adminDb.collection('user_stats').doc(to), { tradeRatingSum: FieldValue.increment(stars), tradeRatingCount: FieldValue.increment(1) }, { merge: true });
    notify({ uid: to, kind: 'textbook_rated', title: `「${c.listingTitle}」の取引相手から評価が届きました`, body: `★${stars}`, href: `/textbooks/chats/${chatId}` }, tx);
  });
  return { ok: true };
}
