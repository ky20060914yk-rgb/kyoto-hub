import {
  FieldValue, type DocumentData, type DocumentSnapshot, type Firestore, type Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { UNIVERSITY_ID, isDocId } from './common.js';

export type HiddenBy = 'reports' | 'takedown' | 'operator';
export type QueueStatus = 'open' | 'hidden' | 'restored' | 'removed';
export type NotificationType = 'post_hidden' | 'post_restored' | 'post_removed';

/** `moderation_queue/{postId}` (Admin-only). One entry per post that was ever reported or named in a takedown. */
export interface QueueDoc {
  postId: string;
  authorId: string;
  postTitle: string;
  subjectId: string;
  status: QueueStatus;
  priority: 'normal' | 'takedown';
  reportCount: number;
  countedReports: number;
  takedownRequestIds: string[];
  hiddenBy: HiddenBy | null;
  hiddenByUid: string | null;
  hiddenByKey: string | null; // emailKey of whoever caused a takedown hide (discredit target)
  autoHide: boolean; // false once an operator has reviewed the post (M-8)
  transitions: number; // hide/restore/remove count; keys the notification ids (M-10)
  needsReview: boolean;
}

export interface OperatorAction { operator: string; note?: string }

export const postRef = (db: Firestore, id: string) => db.collection('posts').doc(id);
export const hiddenRef = (db: Firestore, id: string) => db.collection('hidden_posts').doc(id);
export const queueRef = (db: Firestore, id: string) => db.collection('moderation_queue').doc(id);
export const reportRef = (db: Firestore, postId: string, key: string) => queueRef(db, postId).collection('reports').doc(key); // key = emailKey
export const actorRef = (db: Firestore, key: string) => db.collection('moderation_actors').doc(key); // key = emailKey
export const notificationId = (postId: string, transitions: number) => `mod_${postId}_${transitions}`;

export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const STATUSES: QueueStatus[] = ['open', 'hidden', 'restored', 'removed'];
const HIDERS: HiddenBy[] = ['reports', 'takedown', 'operator'];

export function readQueue(snap: DocumentSnapshot, postId: string, post?: DocumentData): QueueDoc {
  const d: DocumentData = (snap.exists ? snap.data() : undefined) ?? {};
  return {
    postId,
    // Moderation state follows the post id: while the post exists its data wins
    // over whatever an older entry stored (the id may have been reused).
    authorId: String(post?.authorId ?? d.authorId ?? ''),
    postTitle: String(post?.title ?? d.postTitle ?? '').slice(0, 200),
    subjectId: String(post?.subjectId ?? d.subjectId ?? ''),
    status: STATUSES.includes(d.status) ? d.status : 'open',
    priority: d.priority === 'takedown' ? 'takedown' : 'normal',
    reportCount: num(d.reportCount),
    countedReports: num(d.countedReports),
    takedownRequestIds: Array.isArray(d.takedownRequestIds)
      ? d.takedownRequestIds.filter((x: unknown): x is string => typeof x === 'string') : [],
    hiddenBy: HIDERS.includes(d.hiddenBy) ? d.hiddenBy : null,
    hiddenByUid: typeof d.hiddenByUid === 'string' ? d.hiddenByUid : null,
    hiddenByKey: typeof d.hiddenByKey === 'string' ? d.hiddenByKey : null,
    autoHide: d.autoHide !== false,
    transitions: num(d.transitions),
    needsReview: d.needsReview === true,
  };
}

export function writeQueue(tx: Transaction, db: Firestore, q: QueueDoc, isNew: boolean): void {
  tx.set(queueRef(db, q.postId), {
    ...q,
    university_id: UNIVERSITY_ID,
    updatedAt: FieldValue.serverTimestamp(),
    ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}),
  }, { merge: true });
}

/** One notice per state transition; the id makes a replay rewrite the same doc (M-10). */
function notify(tx: Transaction, db: Firestore, q: QueueDoc, type: NotificationType): void {
  if (!q.authorId) return;
  tx.set(db.collection('notifications').doc(notificationId(q.postId, q.transitions)), {
    uid: q.authorId,
    type,
    postId: q.postId,
    postTitle: q.postTitle,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    university_id: UNIVERSITY_ID,
  });
}

function log(tx: Transaction, db: Firestore, action: string, target: string, by: string, note = ''): void {
  tx.set(db.collection('moderation_log').doc(), {
    action, target, by, note: String(note ?? '').slice(0, 500),
    at: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
  });
}

/**
 * Hide = MOVE (M-1): the post's data goes to Admin-only `hidden_posts/{id}`
 * unchanged and `posts/{id}` is deleted in the same transaction, so every client
 * query, the course counters and `downloadResource` stop seeing it. Storage
 * files stay (handlePostGone skips while either doc exists). Never touches a
 * credit (M-4). The caller has done every read; it writes the queue doc after.
 */
export function hideInTx(
  tx: Transaction, db: Firestore, q: QueueDoc, post: DocumentData,
  by: HiddenBy, byUid: string | null, actor: string, note = '', byKey: string | null = null,
): void {
  tx.create(hiddenRef(db, q.postId), post); // never overwrite a hidden doc
  tx.delete(postRef(db, q.postId));
  q.status = 'hidden';
  q.hiddenBy = by;
  q.hiddenByUid = byUid;
  q.hiddenByKey = byKey;
  q.transitions += 1;
  q.needsReview = true;
  notify(tx, db, q, 'post_hidden');
  log(tx, db, `hide:${by}`, q.postId, actor, note);
}

/**
 * The post is in neither collection but its queue entry lingers: retire it so
 * listQueue stops showing it. No notice (the author-visible transition already
 * happened or the author deleted it themselves). Returns false if nothing to do.
 */
export function retireQueueTx(
  tx: Transaction, db: Firestore, qs: DocumentSnapshot, postId: string, action: string, actor: string, note = '',
): boolean {
  if (!qs.exists) return false;
  if (qs.get('status') === 'removed' && qs.get('needsReview') !== true) return false;
  tx.set(queueRef(db, postId), {
    status: 'removed', needsReview: false, autoHide: false,
    updatedAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
  }, { merge: true });
  log(tx, db, action, postId, actor, note);
  return true;
}

function operatorName(act: OperatorAction | undefined): string {
  const op = String(act?.operator ?? '').trim();
  if (!op || op.length > 50) throw new HttpsError('invalid-argument', 'operator required');
  return op;
}

function requireId(id: unknown): string {
  if (!isDocId(id)) throw new HttpsError('invalid-argument', 'bad id');
  return id;
}

/** Operator hide (e.g. after checking an unverified takedown). Idempotent. */
export async function hidePost(db: Firestore, postIdIn: unknown, act: OperatorAction): Promise<{ changed: boolean }> {
  const op = operatorName(act);
  const postId = requireId(postIdIn);
  return db.runTransaction(async (tx) => {
    const p = await tx.get(postRef(db, postId));
    const h = await tx.get(hiddenRef(db, postId));
    const qs = await tx.get(queueRef(db, postId));
    if (!p.exists) {
      if (h.exists) return { changed: false };
      throw new HttpsError('not-found', 'post not found');
    }
    const q = readQueue(qs, postId, p.data());
    hideInTx(tx, db, q, p.data()!, 'operator', null, `operator:${op}`, act.note);
    writeQueue(tx, db, q, !qs.exists);
    return { changed: true };
  });
}

/**
 * Operator: the post is fine. A hidden post moves back (identical data) and its
 * author is told; a visible queued post is acknowledged. Either way automatic
 * hiding is switched off for it (M-8), and whoever caused the hide is
 * discredited by one (M-9). Never overwrites a live doc; never touches credits.
 */
export async function restorePost(
  db: Firestore, postIdIn: unknown, act: OperatorAction,
): Promise<{ changed: boolean; discredited: string[] }> {
  const op = operatorName(act);
  const postId = requireId(postIdIn);
  return db.runTransaction(async (tx) => {
    const h = await tx.get(hiddenRef(db, postId));
    const p = await tx.get(postRef(db, postId));
    const qs = await tx.get(queueRef(db, postId));
    const counted = await tx.get(queueRef(db, postId).collection('reports').where('counted', '==', true));
    if (!h.exists && !p.exists) {
      if (retireQueueTx(tx, db, qs, postId, 'retire', `operator:${op}`, act.note)) return { changed: false, discredited: [] };
      if (qs.exists) return { changed: false, discredited: [] };
      throw new HttpsError('not-found', 'post not found');
    }
    if (h.exists && p.exists) throw new HttpsError('failed-precondition', 'a live post holds this id');

    const q = readQueue(qs, postId, (h.exists ? h : p).data());
    const discredited: string[] = [];
    if (h.exists) {
      tx.create(postRef(db, postId), h.data()!);
      tx.delete(hiddenRef(db, postId));
      if (q.hiddenBy === 'reports') for (const r of counted.docs) discredited.push(r.id);
      if (q.hiddenBy === 'takedown' && q.hiddenByKey) discredited.push(q.hiddenByKey);
      const field = q.hiddenBy === 'takedown' ? 'restoredTakedowns' : 'restoredReports';
      for (const u of discredited) {
        tx.set(actorRef(db, u), { [field]: FieldValue.increment(1), university_id: UNIVERSITY_ID }, { merge: true });
        log(tx, db, 'discredit', u, `operator:${op}`, `${field}+1 for post ${postId}`);
      }
      q.transitions += 1;
      notify(tx, db, q, 'post_restored');
    }
    q.status = 'restored';
    q.autoHide = false;
    q.needsReview = false;
    log(tx, db, h.exists ? 'restore' : 'acknowledge', postId, `operator:${op}`, act.note);
    writeQueue(tx, db, q, !qs.exists);
    return { changed: h.exists, discredited };
  });
}

/** Operator: permanent removal (visible or hidden). Files go via handlePostGone; credits stay (M-4). */
export async function removePost(
  db: Firestore, postIdIn: unknown, act: OperatorAction,
): Promise<{ removedFrom: 'posts' | 'hidden_posts' | 'none' }> {
  const op = operatorName(act);
  const postId = requireId(postIdIn);
  return db.runTransaction(async (tx) => {
    const p = await tx.get(postRef(db, postId));
    const h = await tx.get(hiddenRef(db, postId));
    const qs = await tx.get(queueRef(db, postId));
    if (!p.exists && !h.exists) {
      if (!qs.exists) throw new HttpsError('not-found', 'post not found');
      retireQueueTx(tx, db, qs, postId, 'retire', `operator:${op}`, act.note);
      return { removedFrom: 'none' as const };
    }
    const q = readQueue(qs, postId, (p.exists ? p : h).data());
    if (p.exists) tx.delete(postRef(db, postId));
    if (h.exists) tx.delete(hiddenRef(db, postId));
    q.status = 'removed';
    q.autoHide = false;
    q.needsReview = false;
    q.transitions += 1;
    notify(tx, db, q, 'post_removed');
    log(tx, db, 'remove', postId, `operator:${op}`, act.note);
    writeQueue(tx, db, q, !qs.exists);
    return { removedFrom: p.exists ? 'posts' as const : 'hidden_posts' as const };
  });
}

/** Operator: a takedown request has been dealt with (or needs no action). */
export async function closeTakedown(db: Firestore, requestIdIn: unknown, act: OperatorAction): Promise<{ changed: boolean }> {
  const op = operatorName(act);
  const id = requireId(requestIdIn);
  const ref = db.collection('takedown_requests').doc(id);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', 'request not found');
    if (s.get('status') === 'closed') return { changed: false };
    tx.update(ref, { status: 'closed', closedBy: op, closedAt: FieldValue.serverTimestamp() });
    log(tx, db, 'close_takedown', id, `operator:${op}`, act.note);
    return { changed: true };
  });
}

const millis = (v: unknown): number =>
  v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : 0;

/** What needs an operator: open/hidden entries and flagged ones (takedown priority first), plus open requests. */
export async function listQueue(db: Firestore, limit = 50): Promise<{
  queue: Array<QueueDoc & { updatedAtMs: number }>;
  requests: Array<DocumentData & { id: string }>;
}> {
  const [active, flagged, open] = await Promise.all([
    db.collection('moderation_queue').where('status', 'in', ['open', 'hidden']).limit(limit).get(),
    db.collection('moderation_queue').where('needsReview', '==', true).limit(limit).get(),
    db.collection('takedown_requests').where('status', '==', 'open').limit(limit).get(),
  ]);
  const byId = new Map<string, QueueDoc & { updatedAtMs: number }>();
  for (const d of [...active.docs, ...flagged.docs]) {
    byId.set(d.id, { ...readQueue(d, d.id), updatedAtMs: millis(d.get('updatedAt')) });
  }
  const rank = (x: QueueDoc) => (x.priority === 'takedown' ? 0 : 1);
  const queue = [...byId.values()].sort((a, b) => rank(a) - rank(b) || b.updatedAtMs - a.updatedAtMs);
  return { queue, requests: open.docs.map((d) => ({ id: d.id, ...d.data() })) };
}
