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
