import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { UNIVERSITY_ID } from './common.js';
import { DAY_MS, MARKET, identityRef, keyFromIdentity, millisOf } from './marketCore.js';

export type Side = 'lender' | 'borrower';
/** Admin-only: one immutable rating per (room, side) — the id IS the uniqueness rule (T-10). */
export const ratingRef = (db: Firestore, roomId: string, side: Side) =>
  db.collection('market_ratings').doc(`${roomId}_${side}`);
/** Admin-only aggregate per MAILBOX; the KU-readable copy is market_profiles/{uid}. */
export const reputationRef = (db: Firestore, key: string) => db.collection('market_reputation').doc(key);
export const profileRef = (db: Firestore, uid: string) => db.collection('market_profiles').doc(uid);

export interface Reputation {
  ratingCount: number;
  ratingSum: number;
  recentComments: Array<{ stars: number; comment: string; at: string }>;
}

/**
 * Pure: the aggregate a set of rating docs produces at `now` (T-10, T-11).
 * A rating counts once it is revealed (both sides rated) or older than
 * `ratingRevealDays`; per rater MAILBOX only the newest counted rating counts,
 * so one friend cannot inflate a score by trading again and again.
 */
export function aggregateRatings(ratings: DocumentData[], now: Date): Reputation {
  const cutoff = now.getTime() - MARKET.ratingRevealDays * DAY_MS;
  const latest = new Map<string, DocumentData>();
  for (const r of ratings) {
    const stars = r.stars;
    if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) continue;
    if (r.revealed !== true && millisOf(r.createdAt) > cutoff) continue;
    const k = String(r.raterKey ?? '');
    const prev = latest.get(k);
    if (!prev || millisOf(r.createdAt) > millisOf(prev.createdAt)) latest.set(k, r);
  }
  const counted = [...latest.values()].sort((a, b) => millisOf(b.createdAt) - millisOf(a.createdAt));
  return {
    ratingCount: counted.length,
    ratingSum: counted.reduce((s, r) => s + (r.stars as number), 0),
    recentComments: counted.filter((r) => typeof r.comment === 'string' && r.comment !== '')
      .slice(0, MARKET.recentComments)
      .map((r) => ({ stars: r.stars as number, comment: String(r.comment), at: new Date(millisOf(r.createdAt)).toISOString() })),
  };
}

/**
 * Recount one user's reputation from every rating about their MAILBOX and write
 * it to the Admin-only aggregate and the KU-readable `market_profiles/{uid}`.
 * A full recount (never an increment): idempotent, self-healing, and a forged
 * or stale field cannot survive. The aggregate doc is read first so concurrent
 * recounts of the same mailbox serialise (the course_stats pattern, M-11).
 */
export async function refreshReputation(db: Firestore, uid: string, now: Date = new Date()): Promise<Reputation> {
  return db.runTransaction(async (tx) => {
    const key = keyFromIdentity(await tx.get(identityRef(db, uid)), uid);
    await tx.get(reputationRef(db, key));
    const ratings = (await tx.get(db.collection('market_ratings').where('rateeKey', '==', key))).docs.map((d) => d.data());
    const rep = aggregateRatings(ratings, now);
    tx.set(reputationRef(db, key), { ...rep, lastUid: uid, updatedAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID });
    tx.set(profileRef(db, uid), { ...rep, updatedAt: FieldValue.serverTimestamp(), university_id: UNIVERSITY_ID });
    return rep;
  });
}
