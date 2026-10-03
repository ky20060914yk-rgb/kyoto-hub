import {
  FieldValue, type DocumentData, type DocumentSnapshot, type Firestore, type Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { MODERATION, UNIVERSITY_ID, isDocId, jstDay } from './common.js';
import { actorRef, num, type OperatorAction } from './moderation.js';
import type { DeleteDeps } from './postDeleted.js';
import { callerKey, listingRef, millisOf, roomRef, sanitizeText, type MarketCaller } from './marketCore.js';

export const LISTING_REPORT_CATEGORIES = ['not_textbook', 'spam', 'inappropriate', 'other'] as const;
export const ROOM_REPORT_CATEGORIES = ['harassment', 'no_show', 'fraud', 'other'] as const;
export type MarketReportStatus = 'reported' | 'hidden' | 'duplicate' | 'already_hidden' | 'case_opened';
export type ListingNotice = 'listing_hidden' | 'listing_restored' | 'listing_removed';

/** Admin-only: `market_queue/{listingId}` (+ `reports/{emailKey}`) and `market_cases/{roomId}_{side}`. */
export const marketQueueRef = (db: Firestore, id: string) => db.collection('market_queue').doc(id);
export const listingReportRef = (db: Firestore, id: string, key: string) => marketQueueRef(db, id).collection('reports').doc(key);
export const caseRef = (db: Firestore, id: string) => db.collection('market_cases').doc(id);
export const listingNoticeId = (listingId: string, transitions: number) => `mkt_${listingId}_${transitions}`;

export interface MarketQueueDoc {
  listingId: string;
  ownerId: string;
  title: string;
  status: 'open' | 'hidden' | 'restored' | 'removed';
  reportCount: number;
  countedReports: number;
  hiddenBy: 'reports' | 'operator' | null;
  statusBeforeHide: 'active' | 'closed';
  autoHide: boolean;
  transitions: number;
  needsReview: boolean;
}

function readMarketQueue(snap: DocumentSnapshot, listingId: string, l?: DocumentData): MarketQueueDoc {
  const d: DocumentData = (snap.exists ? snap.data() : undefined) ?? {};
  return {
    listingId,
    ownerId: String(l?.ownerId ?? d.ownerId ?? ''),
    title: String(l?.title ?? d.title ?? '').slice(0, 200),
    status: ['open', 'hidden', 'restored', 'removed'].includes(d.status) ? d.status : 'open',
    reportCount: num(d.reportCount),
    countedReports: num(d.countedReports),
    hiddenBy: d.hiddenBy === 'reports' || d.hiddenBy === 'operator' ? d.hiddenBy : null,
    statusBeforeHide: d.statusBeforeHide === 'closed' ? 'closed' : 'active',
    autoHide: d.autoHide !== false,
    transitions: num(d.transitions),
    needsReview: d.needsReview === true,
  };
}

function writeMarketQueue(tx: Transaction, db: Firestore, q: MarketQueueDoc, isNew: boolean): void {
  tx.set(marketQueueRef(db, q.listingId), {
    ...q, university_id: UNIVERSITY_ID, updatedAt: FieldValue.serverTimestamp(),
    ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}),
  }, { merge: true });
}

function notifyOwner(tx: Transaction, db: Firestore, q: MarketQueueDoc, type: ListingNotice): void {
  if (!q.ownerId) return;
  tx.set(db.collection('notifications').doc(listingNoticeId(q.listingId, q.transitions)), {
    uid: q.ownerId, type, listingId: q.listingId, postId: '', postTitle: q.title,
    read: false, createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
  });
}

function log(tx: Transaction, db: Firestore, action: string, target: string, by: string, note = ''): void {
  tx.set(db.collection('moderation_log').doc(), {
    action, target, by, note: String(note ?? '').slice(0, 500), at: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
  });
}

/** Hide a listing in place: listing writes are Function-only, so a status flip is as final as the 2B move (T-19). */
function hideListingTx(
  tx: Transaction, db: Firestore, q: MarketQueueDoc, l: DocumentData, by: 'reports' | 'operator', actor: string, note = '',
): void {
  q.statusBeforeHide = l.status === 'closed' ? 'closed' : 'active';
  tx.update(listingRef(db, q.listingId), { status: 'hidden', updatedAt: FieldValue.serverTimestamp() });
  q.status = 'hidden';
  q.hiddenBy = by;
  q.transitions += 1;
  q.needsReview = true;
  notifyOwner(tx, db, q, 'listing_hidden');
  log(tx, db, `listing_hide:${by}`, q.listingId, actor, note);
}

/**
 * `reportMarket` (T-19, T-20). kind 'listing': one report per (listing,
 * mailbox), the same daily cap and discredit counters as post reports
 * (`moderation_actors/{emailKey}`, M-7/M-9/M-20); 3 distinct counted reporters
 * hide the listing unless an operator already cleared it. kind 'room': a
 * participant files a case about the other party (harassment, 受け渡し不履行 =
 * `no_show`, fraud) — one open case per (room, side), operator-handled, never
 * an automatic sanction.
 */
export async function processMarketReport(
  db: Firestore, reporter: MarketCaller, input: Record<string, unknown>, now: Date = new Date(),
): Promise<{ status: MarketReportStatus }> {
  const kind = input?.kind;
  const targetId = input?.targetId;
  if (kind !== 'listing' && kind !== 'room') throw new HttpsError('invalid-argument', 'bad kind');
  if (!isDocId(targetId)) throw new HttpsError('invalid-argument', 'bad target');
  const cats: readonly string[] = kind === 'listing' ? LISTING_REPORT_CATEGORIES : ROOM_REPORT_CATEGORIES;
  const category = input.category;
  if (typeof category !== 'string' || !cats.includes(category)) throw new HttpsError('invalid-argument', 'bad category');
  const detail = sanitizeText(input.detail);
  if (detail.length > MODERATION.maxDetail) throw new HttpsError('invalid-argument', 'detail too long');
  const key = callerKey(reporter);
  const day = jstDay(now);

  return db.runTransaction(async (tx) => {
    const actorSnap = await tx.get(actorRef(db, key));
    const actor = actorSnap.data() ?? {};
    const usedToday = actor.reportDay === day ? num(actor.reportsToday) : 0;
    const bump = () => tx.set(actorRef(db, key), { reportDay: day, reportsToday: usedToday + 1, university_id: UNIVERSITY_ID }, { merge: true });

    if (kind === 'room') {
      const room = await tx.get(roomRef(db, targetId));
      if (!room.exists) throw new HttpsError('not-found', 'room not found');
      const r = room.data()!;
      const side = r.lenderId === reporter.uid ? 'lender' : r.borrowerId === reporter.uid ? 'borrower' : null;
      if (!side) throw new HttpsError('permission-denied', 'not-participant');
      const ref = caseRef(db, `${targetId}_${side}`);
      const existing = await tx.get(ref);
      if (existing.exists && existing.get('status') === 'open') return { status: 'duplicate' as const };
      if (usedToday >= MODERATION.reportDailyCap) throw new HttpsError('resource-exhausted', 'report-limit');
      tx.set(ref, {
        roomId: targetId, listingId: String(r.listingId ?? ''), category, detail, status: 'open',
        reporterUid: reporter.uid, reportedUid: side === 'lender' ? r.borrowerId : r.lenderId,
        priority: category === 'harassment' || category === 'fraud' ? 'high' : 'normal',
        createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
      });
      bump();
      return { status: 'case_opened' as const };
    }

    const listing = await tx.get(listingRef(db, targetId));
    const mine = await tx.get(listingReportRef(db, targetId, key));
    const qs = await tx.get(marketQueueRef(db, targetId));
    if (!listing.exists) throw new HttpsError('not-found', 'listing not found');
    const l = listing.data()!;
    if (l.status === 'hidden') return { status: 'already_hidden' as const };
    if (l.ownerId === reporter.uid) throw new HttpsError('failed-precondition', 'own-listing');
    if (mine.exists) return { status: 'duplicate' as const };
    if (usedToday >= MODERATION.reportDailyCap) throw new HttpsError('resource-exhausted', 'report-limit');
    const counted = num(actor.restoredReports) < MODERATION.discreditRestoredReports;
    const q = readMarketQueue(qs, targetId, l);
    q.reportCount += 1;
    if (counted) q.countedReports += 1;
    tx.create(listingReportRef(db, targetId, key), {
      listingId: targetId, reporterUid: reporter.uid, category, detail, counted,
      createdAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID,
    });
    bump();
    let status: MarketReportStatus = 'reported';
    if (q.autoHide && q.countedReports >= MODERATION.reportHideThreshold) {
      hideListingTx(tx, db, q, l, 'reports', 'system');
      status = 'hidden';
    } else if (!q.autoHide) {
      q.needsReview = true;
    }
    writeMarketQueue(tx, db, q, !qs.exists);
    return { status };
  });
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

/** Operator: hide a listing (any status but hidden). Idempotent. */
export async function hideListing(db: Firestore, idIn: unknown, act: OperatorAction): Promise<{ changed: boolean }> {
  const op = operatorName(act);
  const id = requireId(idIn);
  return db.runTransaction(async (tx) => {
    const l = await tx.get(listingRef(db, id));
    const qs = await tx.get(marketQueueRef(db, id));
    if (!l.exists) throw new HttpsError('not-found', 'listing not found');
    if (l.get('status') === 'hidden') return { changed: false };
    const q = readMarketQueue(qs, id, l.data());
    hideListingTx(tx, db, q, l.data()!, 'operator', `operator:${op}`, act.note);
    writeMarketQueue(tx, db, q, !qs.exists);
    return { changed: true };
  });
}

/**
 * Operator: the listing is fine. A hidden listing goes back to the status it had
 * (its expiry is unchanged, so an expired one simply stays out of the list);
 * auto-hide is switched off for it (M-8) and the reporters behind a report-hide
 * are discredited exactly like post reporters (M-9).
 */
export async function restoreListing(
  db: Firestore, idIn: unknown, act: OperatorAction,
): Promise<{ changed: boolean; discredited: string[] }> {
  const op = operatorName(act);
  const id = requireId(idIn);
  return db.runTransaction(async (tx) => {
    const l = await tx.get(listingRef(db, id));
    const qs = await tx.get(marketQueueRef(db, id));
    const counted = await tx.get(marketQueueRef(db, id).collection('reports').where('counted', '==', true));
    if (!l.exists) throw new HttpsError('not-found', 'listing not found');
    const q = readMarketQueue(qs, id, l.data());
    const hidden = l.get('status') === 'hidden';
    const discredited: string[] = [];
    if (hidden) {
      tx.update(listingRef(db, id), { status: q.statusBeforeHide, updatedAt: FieldValue.serverTimestamp() });
      if (q.hiddenBy === 'reports') for (const r of counted.docs) discredited.push(r.id);
      for (const k of discredited) {
        tx.set(actorRef(db, k), { restoredReports: FieldValue.increment(1), university_id: UNIVERSITY_ID }, { merge: true });
        log(tx, db, 'discredit', k, `operator:${op}`, `restoredReports+1 for listing ${id}`);
      }
      q.transitions += 1;
      notifyOwner(tx, db, q, 'listing_restored');
    }
    q.status = 'restored';
    q.autoHide = false;
    q.needsReview = false;
    log(tx, db, hidden ? 'listing_restore' : 'listing_acknowledge', id, `operator:${op}`, act.note);
    writeMarketQueue(tx, db, q, !qs.exists);
    return { changed: hidden, discredited };
  });
}

/** Operator: delete a listing for good. Its photos go via onListingDeleted. */
export async function removeListing(db: Firestore, idIn: unknown, act: OperatorAction): Promise<{ changed: boolean }> {
  const op = operatorName(act);
  const id = requireId(idIn);
  return db.runTransaction(async (tx) => {
    const l = await tx.get(listingRef(db, id));
    const qs = await tx.get(marketQueueRef(db, id));
    if (!l.exists) throw new HttpsError('not-found', 'listing not found');
    const q = readMarketQueue(qs, id, l.data());
    tx.delete(listingRef(db, id));
    q.status = 'removed';
    q.autoHide = false;
    q.needsReview = false;
    q.transitions += 1;
    notifyOwner(tx, db, q, 'listing_removed');
    log(tx, db, 'listing_remove', id, `operator:${op}`, act.note);
    writeMarketQueue(tx, db, q, !qs.exists);
    return { changed: true };
  });
}

/** Operator: a room case (harassment / 受け渡し不履行 / fraud) has been dealt with. */
export async function closeCase(db: Firestore, idIn: unknown, act: OperatorAction): Promise<{ changed: boolean }> {
  const op = operatorName(act);
  const id = requireId(idIn);
  return db.runTransaction(async (tx) => {
    const c = await tx.get(caseRef(db, id));
    if (!c.exists) throw new HttpsError('not-found', 'case not found');
    if (c.get('status') === 'closed') return { changed: false };
    tx.update(caseRef(db, id), { status: 'closed', closedBy: op, closedAt: FieldValue.serverTimestamp() });
    log(tx, db, 'case_close', id, `operator:${op}`, act.note);
    return { changed: true };
  });
}

/** What needs an operator in the market: reported/hidden/flagged listings and open cases (high priority first). */
export async function listMarketQueue(db: Firestore, limit = 50): Promise<{
  listings: Array<MarketQueueDoc & { updatedAtMs: number }>;
  cases: Array<DocumentData & { id: string }>;
}> {
  const [active, flagged, open] = await Promise.all([
    db.collection('market_queue').where('status', 'in', ['open', 'hidden']).limit(limit).get(),
    db.collection('market_queue').where('needsReview', '==', true).limit(limit).get(),
    db.collection('market_cases').where('status', '==', 'open').limit(limit).get(),
  ]);
  const byId = new Map<string, MarketQueueDoc & { updatedAtMs: number }>();
  for (const d of [...active.docs, ...flagged.docs]) byId.set(d.id, { ...readMarketQueue(d, d.id), updatedAtMs: millisOf(d.get('updatedAt')) });
  const cases = open.docs.map((d): DocumentData & { id: string } => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1) || millisOf(b.createdAt) - millisOf(a.createdAt));
  return { listings: [...byId.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs), cases };
}

/**
 * `onListingDeleted` (T-21): a listing is deleted only by an operator; its photos
 * go too — but ONLY objects under the owner's own `listings/<ownerId>/` prefix,
 * so a forged path list could never delete someone else's file.
 */
export async function handleListingDeleted(deps: DeleteDeps, listing: Record<string, unknown>): Promise<string[]> {
  const owner = String(listing.ownerId ?? '');
  const prefix = `listings/${owner}/`;
  const paths = !owner || !Array.isArray(listing.photoPaths) ? [] : listing.photoPaths.filter((p): p is string =>
    typeof p === 'string' && p.startsWith(prefix) && !p.slice(prefix.length).includes('/') && !p.includes('..'));
  for (const p of paths) {
    try { await deps.remove(p); } catch { /* already gone */ }
  }
  return paths;
}

