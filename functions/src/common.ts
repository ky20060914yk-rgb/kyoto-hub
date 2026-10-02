import { HttpsError } from 'firebase-functions/v2/https';

export const REGION = 'asia-east1'; // = Firestore database region (P2-8)
export const UNIVERSITY_ID = 'kyoto_u';

/** Credit amounts — spec §4.3. */
export const CREDITS = {
  welcome: 3,
  upload: 3,
  firstReviews: 2, // each of a user's first `firstReviewCount` reviews (P2-12)
  firstReviewCount: 3,
  scarceReview: 1, // review on a course with <= `scarceThreshold` reviews (P2-13)
  scarceThreshold: 5,
  reviewDailyCap: 5, // review-bonus grants per JST day (P2-14)
  referral: 3, // each side of a successful invitation (P2-2)
  referralCap: 10, // invitations that pay a single inviter
  requestFulfilled: 3,
  downloadCost: 1,
  dailyGrantCap: 3, // grants per JST day (P2-3)
} as const;

export const SIGNED_URL_TTL_MS = 10 * 60 * 1000;

// Same shape as firestore.rules `kuVerified()` (start-anchored, single '@').
const KU_EMAIL = /^[^@]+@st\.kyoto-u\.ac\.jp$/;

export interface AuthLike {
  uid: string;
  token: { email?: string; email_verified?: boolean };
}

/** Returns the caller's uid or throws an HttpsError. */
export function requireKuVerified(auth: AuthLike | undefined | null): string {
  if (!auth) throw new HttpsError('unauthenticated', 'login required');
  const email = (auth.token.email ?? '').toLowerCase();
  if (!KU_EMAIL.test(email) || auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'verified Kyoto University account required');
  }
  return auth.uid;
}

/** `YYYY-MM-DD` in Asia/Tokyo (UTC+9, no DST). */
export function jstDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** RFC 5987 `attachment; filename*=` value: also escapes ' ( ) * (not in attr-char). */
export const attachmentDisposition = (filename: string): string =>
  `attachment; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`;

/** Moderation limits (Plan 2B rulings M-2, M-7, M-9). */
export const MODERATION = {
  reportHideThreshold: 3, // distinct COUNTED reporters that hide a post (M-2)
  reportDailyCap: 10, // reports per reporter per JST day (M-7)
  takedownDailyCapUser: 3, // takedown requests per signed-in requester per JST day (M-7)
  takedownDailyCapAnon: 20, // unverified + anonymous takedown requests per JST day, all together (M-7)
  discreditRestoredReports: 3, // from this many restored report-hides a reporter stops counting (M-9)
  discreditRestoredTakedowns: 2, // from this many restored takedown-hides: no more immediate hide (M-9)
  maxTakedownPosts: 5,
  maxDetail: 500,
  minDescription: 10,
  maxDescription: 2000,
  maxName: 100,
  maxEmail: 200,
  maxPostIdLength: 200,
} as const;

// Any Kyoto University mailbox: students (st.) and staff. Start-anchored, single
// '@', like KU_EMAIL — a subdomain other than `st.` does not pass (M-6).
const KU_ANY_EMAIL = /^[^@]+@(st\.)?kyoto-u\.ac\.jp$/;

/** The caller's uid when the token is a verified KU address (student or staff), else null. Never throws. */
export function universityVerifiedUid(auth: AuthLike | undefined | null): string | null {
  if (!auth) return null;
  const email = (auth.token.email ?? '').toLowerCase();
  return KU_ANY_EMAIL.test(email) && auth.token.email_verified === true ? auth.uid : null;
}

/** A document id a client may name: a non-empty bounded string that is not a path or reserved id. */
export function isDocId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MODERATION.maxPostIdLength &&
    !v.includes('/') && v !== '.' && v !== '..' && !/^__.*__$/.test(v);
}
