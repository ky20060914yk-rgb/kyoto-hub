// Credit amounts (2A plan). Shared by the server (lib/server/credits.ts) and the /guide page.
export const CREDITS = {
  welcome: 3,
  upload: 3,
  firstReviews: 2, // each of a user's first `firstReviewCount` reviews (P2-12)
  firstReviewCount: 3,
  scarceReview: 1, // review on a course with <= `scarceThreshold` reviews (P2-13)
  scarceThreshold: 5,
  reviewDailyCap: 5, // review-bonus grants per JST day (P2-14)
  referral: 3, // each side of a successful invitation (P2-2)
  referralCap: 10,
  requestFulfilled: 3,
  downloadCost: 1,
  dailyGrantCap: 3, // upload / request grants per JST day (P2-3)
} as const;
