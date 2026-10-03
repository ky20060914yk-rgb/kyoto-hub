import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET, LISTING_TYPES, BOOK_CONDITIONS, HANDOFF_PLACES, sanitizeLine, sanitizeText, normalizeTitle, displayNameFor,
  callerKey, keyFromIdentity, isLive,
} from '../lib/marketCore.js';
import { emailKey } from '../lib/common.js';

test('market limits and wire values match the Plan 3 rulings (T-3, T-6, T-8, T-9, T-11)', () => {
  assert.deepEqual({ ...MARKET }, {
    listingDailyCap: 5, roomDailyCap: 10, listingDays: 30, renewWindowDays: 7, maxTitle: 100, maxDescription: 1000,
    maxPhotos: 3, maxPrice: 100000, maxMessage: 1000, maxComment: 60, maxDisplayName: 30, matchMaxRecipients: 20,
    matchNoticeDailyCap: 10, matchMinLength: 4, ratingRevealDays: 14, recentComments: 5, previewLength: 80,
  });
  assert.deepEqual([...LISTING_TYPES], ['give', 'sell', 'want']);
  assert.deepEqual([...BOOK_CONDITIONS], ['like_new', 'good', 'fair', 'marked']);
  assert.deepEqual([...HANDOFF_PLACES], ['clock_tower', 'coop_central', 'library', 'yoshida_south', 'north_campus', 'katsura', 'uji', 'other']);
});

test('sanitizeLine strips controls and bidi overrides, collapses whitespace, never throws on garbage', () => {
  assert.equal(sanitizeLine('  線形代数\t\n入門  '), '線形代数 入門');
  assert.equal(sanitizeLine('a\u0000b\u001b[2Jc‮d⁦e'), 'ab[2Jcde');
  for (const v of [undefined, null, 42, ['x'], { a: 1 }]) assert.equal(sanitizeLine(v), '');
});

test('sanitizeText keeps single and double newlines but no more, and no controls', () => {
  assert.equal(sanitizeText('a\r\nb\n\n\n\nc\u0007'), 'a\nb\n\nc');
  assert.equal(sanitizeText('  x   y  '), 'x y');
  assert.equal(sanitizeText(7), '');
});

test('normalizeTitle: NFKC, lower case, no spaces or punctuation (full-width folds to half-width)', () => {
  assert.equal(normalizeTitle('Ｃａｍｐｂｅｌｌ 生物学（第11版）'), 'campbell生物学第11版');
  assert.equal(normalizeTitle('線形代数・入門!'), '線形代数入門');
  assert.equal(normalizeTitle(null), '');
});

test('displayNameFor: operator-looking or empty names become 京大生; others are bounded', () => {
  for (const n of ['運営', '京大InfoHub運営', 'ADMIN', 'Ｏｆｆｉｃｉａｌ', '事務局です', '', '  ', null]) assert.equal(displayNameFor(n), '京大生', String(n));
  assert.equal(displayNameFor('京大生_1234'), '京大生_1234');
  assert.equal(displayNameFor('x'.repeat(40)).length, 30);
});

test('callerKey is the mailbox key; an empty email is refused', () => {
  assert.equal(callerKey({ uid: 'u', email: ' A@st.kyoto-u.ac.jp ' }), emailKey('a@st.kyoto-u.ac.jp'));
  assert.throws(() => callerKey({ uid: 'u', email: '' }), (e) => e.code === 'permission-denied');
});

test('keyFromIdentity falls back to uid:<uid>; isLive needs active AND unexpired', () => {
  assert.equal(keyFromIdentity({ exists: true, get: () => 'k1' }, 'u'), 'k1');
  assert.equal(keyFromIdentity({ exists: false, get: () => undefined }, 'u'), 'uid:u');
  const now = new Date('2027-04-01T00:00:00Z');
  const at = (ms) => ({ toMillis: () => ms });
  assert.equal(isLive({ status: 'active', expiresAt: at(now.getTime() + 1) }, now), true);
  assert.equal(isLive({ status: 'active', expiresAt: at(now.getTime()) }, now), false); // boundary: expired AT now
  assert.equal(isLive({ status: 'closed', expiresAt: at(now.getTime() + 1e9) }, now), false);
  assert.equal(isLive(undefined, now), false);
});

test('I-5: invisible characters and look-alikes never let a name pass as the operator', () => {
  for (const n of ['運\u200b営', '運\u00ad営', 'ad\u200dmin', '運 営', '運營', '運\u3164営', 'ad\u2800min', '公\u2060式']) {
    assert.equal(displayNameFor(n), '京大生', JSON.stringify(n));
  }
  assert.equal(sanitizeLine('a\u200bb\u00adc\ufeffd\u3164e'), 'abcde');
  assert.equal(sanitizeLine('\u200b\u3164 \u2060'), ''); // invisible-only is empty
  assert.equal(sanitizeText('a\u200b\nb'), 'a\nb'); // newlines survive in text
});

test('M-3: names are cut by code point, never through a surrogate pair', () => {
  const n = displayNameFor('𠮷'.repeat(40));
  assert.equal([...n].length, 30);
  assert.equal(n, '𠮷'.repeat(30)); // no lone surrogate at the end
});
