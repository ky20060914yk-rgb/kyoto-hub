import { FieldValue, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { MODERATION, UNIVERSITY_ID, isDocId, jstDay } from './common.js';
import { actorRef, hiddenRef, hideInTx, num, postRef, queueRef, readQueue, writeQueue } from './moderation.js';

export const TAKEDOWN_ROLES = ['instructor', 'university', 'publisher', 'other'] as const;
export type TakedownRole = (typeof TAKEDOWN_ROLES)[number];

/** Who called; null = signed out. `verified` = universityVerifiedUid() accepted the token (M-6). */
export interface TakedownCaller { uid: string; verified: boolean; email: string }
export interface TakedownForm {
  postIds: string[]; requesterName: string; role: TakedownRole; contactEmail: string; description: string;
}
export interface TakedownResult { requestId: string; hidden: string[] }

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const bad = (what: string) => new HttpsError('invalid-argument', `bad ${what}`);

/** Whitelist + bounds. Only these five fields ever reach Firestore. */
export function parseTakedown(input: Record<string, unknown>): TakedownForm {
  const raw = input?.postIds ?? [];
  if (!Array.isArray(raw) || raw.length > MODERATION.maxTakedownPosts || !raw.every((x) => isDocId(x))) throw bad('post ids');
  const requesterName = typeof input.requesterName === 'string' ? input.requesterName.trim() : '';
  if (requesterName.length < 1 || requesterName.length > MODERATION.maxName) throw bad('name');
  const role = input.role;
  if (typeof role !== 'string' || !(TAKEDOWN_ROLES as readonly string[]).includes(role)) throw bad('role');
  const contactEmail = typeof input.contactEmail === 'string' ? input.contactEmail.trim() : '';
  if (contactEmail.length > MODERATION.maxEmail || !EMAIL.test(contactEmail)) throw bad('email');
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length < MODERATION.minDescription || description.length > MODERATION.maxDescription) throw bad('description');
  return { postIds: [...new Set(raw as string[])], requesterName, role: role as TakedownRole, contactEmail, description };
}

/**
 * 「担当教員・権利者の方はこちら」 (spec §4.3; M-6, M-7, M-8, M-9). Always files a
 * priority request. A verified Kyoto University requester (student or staff) who
 * is not discredited also hides each named post AT ONCE — unless an operator
 * already cleared it or they wrote it. Anyone else only queues: an anonymous
 * form must never be a censorship button. Caps: per signed-in requester per JST
 * day, and one global per-day pool for every unverified request.
 */
export async function processTakedown(
  db: Firestore,
  caller: TakedownCaller | null,
  input: Record<string, unknown>,
  now: Date = new Date(),
): Promise<TakedownResult> {
  const form = parseTakedown(input);
  const day = jstDay(now);
  const verified = caller?.verified === true;
  const reqRef = db.collection('takedown_requests').doc();
  const anonRef = db.collection('moderation_meta').doc(`takedown_anon_${day}`);

  return db.runTransaction(async (tx) => {
    // ---- reads
    const actorSnap = caller ? await tx.get(actorRef(db, caller.uid)) : null;
    const anonSnap = verified ? null : await tx.get(anonRef);
    const targets: { id: string; post: DocumentSnapshot; hidden: DocumentSnapshot; queue: DocumentSnapshot }[] = [];
    for (const id of form.postIds) {
      targets.push({
        id,
        post: await tx.get(postRef(db, id)),
        hidden: await tx.get(hiddenRef(db, id)),
        queue: await tx.get(queueRef(db, id)),
      });
    }

    // ---- limits
    const actor = actorSnap?.data() ?? {};
    const usedByCaller = actor.takedownDay === day ? num(actor.takedownsToday) : 0;
    if (caller && usedByCaller >= MODERATION.takedownDailyCapUser) throw new HttpsError('resource-exhausted', 'takedown-limit');
    const anonUsed = num(anonSnap?.get('count'));
    if (!verified && anonUsed >= MODERATION.takedownDailyCapAnon) throw new HttpsError('resource-exhausted', 'takedown-limit');
    const mayHide = verified && num(actor.restoredTakedowns) < MODERATION.discreditRestoredTakedowns;

    // ---- writes
    tx.create(reqRef, {
      ...form,
      verified,
      requesterUid: caller?.uid ?? null,
      requesterEmail: caller?.email || null,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
      university_id: UNIVERSITY_ID,
    });
    if (caller) {
      tx.set(actorRef(db, caller.uid), { takedownDay: day, takedownsToday: usedByCaller + 1, university_id: UNIVERSITY_ID }, { merge: true });
    }
    if (!verified) tx.set(anonRef, { day, count: anonUsed + 1, university_id: UNIVERSITY_ID }, { merge: true });

    const hidden: string[] = [];
    for (const t of targets) {
      const snap = t.post.exists ? t.post : t.hidden;
      if (!snap.exists) continue; // unknown id: kept on the request only, no queue entry
      const post = snap.data()!;
      const q = readQueue(t.queue, t.id, post);
      q.priority = 'takedown';
      q.needsReview = true;
      if (!q.takedownRequestIds.includes(reqRef.id)) q.takedownRequestIds.push(reqRef.id);
      if (t.post.exists && mayHide && q.autoHide && post.authorId !== caller!.uid) {
        hideInTx(tx, db, q, post, 'takedown', caller!.uid, 'system');
        hidden.push(t.id);
      }
      writeQueue(tx, db, q, !t.queue.exists);
    }
    return { requestId: reqRef.id, hidden };
  });
}
