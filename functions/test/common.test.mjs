import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireKuVerified, jstDay, CREDITS, attachmentDisposition, MODERATION, universityVerifiedUid, isDocId } from '../lib/common.js';

test('requireKuVerified returns the uid for a verified KU address', () => {
  assert.equal(
    requireKuVerified({ uid: 'u1', token: { email: 'a@st.kyoto-u.ac.jp', email_verified: true } }),
    'u1',
  );
});

test('requireKuVerified is case-insensitive on the mailbox', () => {
  assert.equal(
    requireKuVerified({ uid: 'u1', token: { email: 'A@ST.KYOTO-U.AC.JP', email_verified: true } }),
    'u1',
  );
});

test('requireKuVerified rejects: no auth, unverified, outsider, spoofed domains', () => {
  const bad = [
    undefined,
    null,
    { uid: 'u', token: { email: 'a@st.kyoto-u.ac.jp', email_verified: false } },
    { uid: 'u', token: { email: 'a@gmail.com', email_verified: true } },
    { uid: 'u', token: { email: 'evil@evil.com@st.kyoto-u.ac.jp', email_verified: true } },
    { uid: 'u', token: { email: 'a@st.kyoto-u.ac.jp.attacker.com', email_verified: true } },
    { uid: 'u', token: {} },
  ];
  for (const a of bad) {
    assert.throws(() => requireKuVerified(a), (e) => ['unauthenticated', 'permission-denied'].includes(e.code));
  }
});

test('jstDay rolls over at 15:00 UTC', () => {
  assert.equal(jstDay(new Date('2026-10-03T14:59:59Z')), '2026-10-03');
  assert.equal(jstDay(new Date('2026-10-03T15:00:00Z')), '2026-10-04');
});

test('credit constants match spec §4.3', () => {
  assert.deepEqual({ ...CREDITS }, {
    welcome: 3, upload: 3, firstReviews: 2, firstReviewCount: 3, scarceReview: 1, scarceThreshold: 5,
    reviewDailyCap: 5, requestFulfilled: 3, downloadCost: 1, dailyGrantCap: 3, referral: 3, referralCap: 10,
  });
});

test('attachmentDisposition percent-escapes the RFC 5987 specials \' ( ) *', () => {
  assert.equal(attachmentDisposition("a b(1)*'x'.pdf"), "attachment; filename*=UTF-8''a%20b%281%29%2A%27x%27.pdf");
  assert.equal(attachmentDisposition('過去問.pdf'), "attachment; filename*=UTF-8''%E9%81%8E%E5%8E%BB%E5%95%8F.pdf");
});

test('universityVerifiedUid accepts verified student AND staff addresses, case-insensitively', () => {
  for (const email of ['a@st.kyoto-u.ac.jp', 'prof@kyoto-u.ac.jp', 'PROF@KYOTO-U.AC.JP', 'B@ST.KYOTO-U.AC.JP']) {
    assert.equal(universityVerifiedUid({ uid: 'u1', token: { email, email_verified: true } }), 'u1', email);
  }
});

test('universityVerifiedUid returns null (never throws) for anyone else', () => {
  const bad = [
    undefined,
    null,
    { uid: 'u', token: {} },
    { uid: 'u', token: { email: 'prof@kyoto-u.ac.jp', email_verified: false } },
    { uid: 'u', token: { email: 'a@gmail.com', email_verified: true } },
    { uid: 'u', token: { email: 'a@evil.kyoto-u.ac.jp', email_verified: true } },
    { uid: 'u', token: { email: 'a@notkyoto-u.ac.jp', email_verified: true } },
    { uid: 'u', token: { email: 'a@kyoto-u.ac.jp.attacker.com', email_verified: true } },
    { uid: 'u', token: { email: 'evil@x.com@kyoto-u.ac.jp', email_verified: true } },
  ];
  for (const a of bad) assert.equal(universityVerifiedUid(a), null, JSON.stringify(a));
});

test('isDocId accepts a plain id and rejects paths, empties, non-strings, reserved and oversized ids', () => {
  assert.equal(isDocId('post_1760000000000'), true);
  assert.equal(isDocId('x'.repeat(200)), true);
  for (const v of ['', 'a/b', '.', '..', '__x__', 'x'.repeat(201), 42, null, undefined, ['p']]) {
    assert.equal(isDocId(v), false, String(v));
  }
});

test('moderation limits match Plan 2B rulings M-2 / M-7 / M-9', () => {
  assert.deepEqual({ ...MODERATION }, {
    reportHideThreshold: 3, reportDailyCap: 10, takedownDailyCapUser: 3, takedownDailyCapAnon: 20,
    maxImmediateHidesPerDay: 3, discreditRestoredReports: 3, discreditRestoredTakedowns: 2, maxTakedownPosts: 5, maxDetail: 500,
    minDescription: 10, maxDescription: 2000, maxName: 100, maxEmail: 200, maxPostIdLength: 200,
  });
});
