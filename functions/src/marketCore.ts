import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { emailKey } from './common.js';

/**
 * Textbook market (Plan 3) — shared limits, wire values, refs and text helpers.
 * No money moves through the app (spec §4.4): `price` is information shown to
 * the other party, never charged, and nothing here touches a credit.
 */
export const MARKET = {
  listingDailyCap: 5, // listings created per MAILBOX per JST day (T-6)
  roomDailyCap: 10, // new chats opened per MAILBOX per JST day (T-6)
  listingDays: 30, // a listing is visible for 30 days unless renewed (T-8)
  renewWindowDays: 7, // renew only in the last 7 days (or after expiry)
  maxTitle: 100,
  maxDescription: 1000,
  maxPhotos: 3,
  maxPrice: 100000, // yen; a sanity bound, not a policy (T-3)
  maxMessage: 1000, // firestore.rules mirrors this
  maxComment: 60,
  maxDisplayName: 30,
  matchMaxRecipients: 20, // want-owners told about ONE new offer (T-9)
  matchNoticeDailyCap: 10, // match notices ONE recipient gets per JST day (T-9)
  matchMinLength: 4, // normalized title length below which titles never match
  ratingRevealDays: 14, // a one-sided rating counts after this many days (T-11)
  recentComments: 5,
  previewLength: 80,
} as const;

export const LISTING_TYPES = ['give', 'sell', 'want'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];
export const BOOK_CONDITIONS = ['like_new', 'good', 'fair', 'marked'] as const;
export const HANDOFF_PLACES = [
  'clock_tower', 'coop_central', 'library', 'yoshida_south', 'north_campus', 'katsura', 'uji', 'other',
] as const;
export type ListingStatus = 'active' | 'closed' | 'hidden';

/** The verified caller of a market callable. Identity for caps and reputation is the MAILBOX. */
export interface MarketCaller { uid: string; email: string }

export const listingRef = (db: Firestore, id: string) => db.collection('textbook_listings').doc(id);
export const roomRef = (db: Firestore, id: string) => db.collection('talk_rooms').doc(id);
/** Admin-only: uid -> emailKey of everyone who used a market callable (T-12). */
export const identityRef = (db: Firestore, uid: string) => db.collection('market_identities').doc(uid);
/** Admin-only per-mailbox market counters (listings / rooms per day). */
export const marketActorRef = (db: Firestore, key: string) => db.collection('market_actors').doc(key);
export const blockRef = (db: Firestore, blocker: string, blocked: string) =>
  db.collection('market_blocks').doc(`${blocker}_${blocked}`);

/** One room per (listing, requester): opening twice returns the same room (T-14). */
export const roomIdFor = (listingId: string, uid: string) => `l_${listingId}_${uid}`;

export const DAY_MS = 24 * 3600 * 1000;

/**
 * Blocks are stored twice (T-17): by uid (operator-friendly) and by MAILBOX, so a
 * blocked person cannot shed the block by deleting the account and re-signing up.
 */
export const mailboxBlockRef = (db: Firestore, blockerKey: string, blockedKey: string) =>
  db.collection('market_blocks').doc(`mb_${blockerKey}_${blockedKey}`);

// Controls (Cc), invisible format characters (Cf: zero-width, bidi overrides and
// isolates, soft hyphen, BOM...) and the blank fillers that render as nothing
// (Hangul fillers, Braille blank). Tab and newline are kept for the callers to fold.
const INVISIBLE = /(?![\t\n])[\p{Cc}\p{Cf}\u3164\u115f\u1160\u2800]/gu;

/** One line of user text: controls and invisibles out, whitespace runs collapsed, trimmed. */
export function sanitizeLine(v: unknown): string {
  return typeof v === 'string' ? v.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim() : '';
}

/** Multi-line user text: controls out (newlines kept, at most 2 in a row), trimmed. */
export function sanitizeText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(INVISIBLE, '').replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** `s` cut to at most `n` code points (never splits a surrogate pair). */
export const clip = (s: string, n: number): string => [...s].slice(0, n).join('');

/** Matching key of a title: NFKC, lower case, no whitespace / punctuation / symbols. */
export function normalizeTitle(v: unknown): string {
  return typeof v === 'string' ? v.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '') : '';
}

// Names that would let a student pass as the operator (T-13).
const RESERVED_NAME = /運営|運營|公式|管理者|事務局|admin|official|support|infohub/i;

/** The name shown next to a listing or in a chat: sanitized, bounded, never an operator-looking name. */
export function displayNameFor(v: unknown): string {
  const s = clip(sanitizeLine(v), MARKET.maxDisplayName);
  const probe = s.normalize('NFKC').replace(/[\s\p{Cf}]/gu, ''); // "運 営" and "ad<ZWJ>min" must not slip through
  return s === '' || RESERVED_NAME.test(probe) ? '京大生' : s;
}

/** The mailbox key of a verified caller (throws if the token carries no email). */
export function callerKey(caller: MarketCaller): string {
  if (!caller.email || !caller.email.trim()) throw new HttpsError('permission-denied', 'email required');
  return emailKey(caller.email);
}

/** uid -> mailbox key from the Admin-only identity map; `uid:<uid>` when the user never used the market. */
export function keyFromIdentity(snap: { exists: boolean; get(f: string): unknown }, uid: string): string {
  const k = snap.exists ? snap.get('key') : undefined;
  return typeof k === 'string' && k !== '' ? k : `uid:${uid}`;
}

export const millisOf = (v: unknown): number =>
  v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : 0;

export const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** Whether a listing doc is visible to buyers right now. */
export function isLive(d: DocumentData | undefined, now: Date): boolean {
  return !!d && d.status === 'active' && millisOf(d.expiresAt) > now.getTime();
}
