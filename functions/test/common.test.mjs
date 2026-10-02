import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireKuVerified, jstDay, CREDITS, attachmentDisposition } from '../lib/common.js';

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
