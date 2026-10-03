import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, as, keyOf, get, NOW, DAY, later, LISTING, seedUser, seedCourse } from '../testlib/market.mjs';
import { processCreateListing, processUpdateListing, parseListingDraft } from '../lib/listings.js';

const create = (u, over = {}, now = NOW) => processCreateListing(db, as(u), LISTING(over), now);

test('createListing writes a server-owned listing: server id, owner = caller, 30-day expiry, course name copied', async () => {
  const u = await seedUser(uid('s'), '  山田‮  ');
  const c = await seedCourse(uid('c'), '線形代数A');
  const { listingId } = await create(u, { courseId: c, ownerId: 'someone_else', status: 'hidden', id: 'forged' });
  const l = (await get(`textbook_listings/${listingId}`)).data();
  assert.equal(l.id, listingId);
  assert.equal(l.ownerId, u); // the payload's ownerId is ignored
  assert.equal(l.status, 'active'); // and its status
  assert.equal(l.ownerName, '山田');
  assert.equal(l.courseId, c);
  assert.equal(l.courseName, '線形代数A');
  assert.equal(l.titleNorm, '線形代数入門第2版');
  assert.equal(l.createdAt.toMillis(), NOW.getTime());
  assert.equal(l.expiresAt.toMillis(), NOW.getTime() + 30 * DAY);
  assert.equal(l.university_id, 'kyoto_u');
  assert.deepEqual([l.type, l.price, l.listPrice, l.condition, l.place], ['sell', 1500, 3000, 'good', 'clock_tower']);
  assert.equal((await get(`market_identities/${u}`)).get('key'), keyOf(u));
  assert.equal((await get(`market_profiles/${u}`)).get('ratingCount'), 0); // the public summary exists from the start
  assert.equal((await get(`credit_balances/${u}`)).exists, false); // no credits anywhere in the market (T-3)
});

test('a named course must exist; an operator-looking display name is replaced', async () => {
  const u = await seedUser(uid('s'), '京大InfoHub運営');
  await assert.rejects(create(u, { courseId: uid('nocourse') }), (e) => e.code === 'invalid-argument');
  const { listingId } = await create(u, { courseId: '' });
  const l = (await get(`textbook_listings/${listingId}`)).data();
  assert.equal(l.ownerName, '京大生');
  assert.equal(l.courseName, '');
});

test('T-6: the 6th listing of a JST day per MAILBOX is refused; the cap follows the mailbox across a re-signup; next day is fine', async () => {
  const u = await seedUser(uid('s'));
  for (let i = 0; i < 5; i++) await create(u);
  await assert.rejects(create(u), (e) => e.code === 'resource-exhausted');
  const reborn = await seedUser(uid('s')); // delete-account + re-signup: new uid, same address
  await assert.rejects(processCreateListing(db, as(reborn, `${u}@st.kyoto-u.ac.jp`), LISTING(), NOW), (e) => e.code === 'resource-exhausted');
  await create(u, {}, new Date('2027-04-10T15:00:01Z')); // 00:00:01 JST next day
});

test('price rules: 売る needs 1..100000, 譲る is free (0 or none), 買いたい may name a budget', async () => {
  const u = await seedUser(uid('s'));
  for (const over of [{ price: 0 }, { price: null }, { price: 100001 }, { price: 1.5 }, { price: '1500' }]) {
    assert.throws(() => parseListingDraft(LISTING(over), u), (e) => e.code === 'invalid-argument', JSON.stringify(over));
  }
  assert.equal(parseListingDraft(LISTING({ price: 100000 }), u).price, 100000); // boundary
  assert.equal(parseListingDraft(LISTING({ type: 'give', price: 0 }), u).price, null);
  assert.equal(parseListingDraft(LISTING({ type: 'give', price: undefined }), u).price, null);
  assert.throws(() => parseListingDraft(LISTING({ type: 'give', price: 500 }), u), (e) => e.code === 'invalid-argument');
  assert.equal(parseListingDraft(LISTING({ type: 'want', price: 800, condition: '' }), u).price, 800);
  assert.equal(parseListingDraft(LISTING({ type: 'want', price: undefined, condition: undefined }), u).condition, '');
});

test('the draft is whitelisted and bounded: type, title, condition, place, description, photos', () => {
  const u = 'u1';
  const bads = [
    { type: 'lend' }, { type: undefined }, { title: '' }, { title: ' \u0000 ' }, { title: 'x'.repeat(101) },
    { condition: 'mint' }, { condition: '' }, { place: 'my_room' }, { description: 'x'.repeat(1001) },
    { courseId: 'a/b' }, { photoPaths: 'listings/u1/a.jpg' },
    { photoPaths: ['listings/u2/a.jpg'] }, { photoPaths: ['resources/u1/a.pdf'] }, { photoPaths: ['listings/u1/sub/a.jpg'] },
    { photoPaths: ['listings/u1/'] }, { photoPaths: ['listings/u1/../u2/a.jpg'] },
    { photoPaths: ['listings/u1/1.jpg', 'listings/u1/2.jpg', 'listings/u1/3.jpg', 'listings/u1/4.jpg'] },
  ];
  for (const over of bads) assert.throws(() => parseListingDraft(LISTING(over), u), (e) => e.code === 'invalid-argument', JSON.stringify(over));
  const d = parseListingDraft({ ...LISTING({ photoPaths: ['listings/u1/a.jpg', 'listings/u1/a.jpg'] }), ownerId: 'x', injected: 1 }, u);
  assert.deepEqual(d.photoPaths, ['listings/u1/a.jpg']);
  assert.deepEqual(Object.keys(d).sort(), ['condition', 'courseId', 'description', 'listPrice', 'photoPaths', 'place', 'price', 'title', 'type']);
  assert.equal(parseListingDraft(LISTING({ title: 'x'.repeat(100) }), u).title.length, 100); // boundary
});

test('updateListing: only the owner; close is final; edit cannot touch title/type/course/owner', async () => {
  const u = await seedUser(uid('s'));
  const { listingId } = await create(u);
  await assert.rejects(processUpdateListing(db, as(uid('x')), { listingId, action: 'close' }, NOW), (e) => e.code === 'permission-denied');
  await processUpdateListing(db, as(u), { listingId, action: 'edit', ...LISTING({ price: 1200, title: '別の本', type: 'give', ownerId: 'x' }) }, NOW);
  const l = (await get(`textbook_listings/${listingId}`)).data();
  assert.deepEqual([l.price, l.title, l.type, l.ownerId], [1200, '線形代数入門 第2版', 'sell', u]);
  assert.equal((await processUpdateListing(db, as(u), { listingId, action: 'close' }, NOW)).status, 'closed');
  await assert.rejects(processUpdateListing(db, as(u), { listingId, action: 'edit', ...LISTING() }, NOW), (e) => e.code === 'failed-precondition');
  await assert.rejects(processUpdateListing(db, as(u), { listingId, action: 'frobnicate' }, NOW), (e) => e.code === 'invalid-argument');
  await assert.rejects(processUpdateListing(db, as(u), { listingId: uid('nope'), action: 'close' }, NOW), (e) => e.code === 'not-found');
});

test('T-8: renew only within the last 7 days (or after expiry), and it extends to now + 30 days', async () => {
  const u = await seedUser(uid('s'));
  const { listingId } = await create(u);
  await assert.rejects(processUpdateListing(db, as(u), { listingId, action: 'renew' }, later(22, NOW)), (e) => e.message === 'too-early');
  const at = later(23, NOW); // exactly 7 days left: allowed (boundary)
  const r = await processUpdateListing(db, as(u), { listingId, action: 'renew' }, at);
  assert.equal(r.expiresAtMs, at.getTime() + 30 * DAY);
  const l = (await get(`textbook_listings/${listingId}`)).data();
  assert.equal(l.expiresAt.toMillis(), at.getTime() + 30 * DAY);
  assert.equal(l.renewCount, 1);
  const late = later(100, NOW); // long expired: renew brings it back
  assert.equal((await processUpdateListing(db, as(u), { listingId, action: 'renew' }, late)).expiresAtMs, late.getTime() + 30 * DAY);
});

test('an expired listing cannot be edited (renew it first); a hidden one cannot be touched by its owner', async () => {
  const u = await seedUser(uid('s'));
  const { listingId } = await create(u);
  await assert.rejects(processUpdateListing(db, as(u), { listingId, action: 'edit', ...LISTING() }, later(31, NOW)), (e) => e.message === 'expired');
  await db.doc(`textbook_listings/${listingId}`).update({ status: 'hidden' });
  for (const action of ['edit', 'renew', 'close']) {
    await assert.rejects(processUpdateListing(db, as(u), { listingId, action, ...LISTING() }, NOW), (e) => e.message === 'not-active');
  }
});

test('photo paths are at most 300 characters (boundary) and listPrice is bounded 0..100000', () => {
  const u = 'u1';
  const path = (n) => `listings/u1/${'a'.repeat(n - 12 - 4)}.jpg`;
  assert.equal(path(300).length, 300);
  assert.deepEqual(parseListingDraft(LISTING({ photoPaths: [path(300)] }), u).photoPaths, [path(300)]);
  assert.throws(() => parseListingDraft(LISTING({ photoPaths: [path(301)] }), u), (e) => e.code === 'invalid-argument');
  assert.equal(parseListingDraft(LISTING({ listPrice: 100000 }), u).listPrice, 100000);
  assert.equal(parseListingDraft(LISTING({ listPrice: 0 }), u).listPrice, 0);
  for (const lp of [100001, -1, 1.5, '3000']) {
    assert.throws(() => parseListingDraft(LISTING({ listPrice: lp }), u), (e) => e.code === 'invalid-argument', String(lp));
  }
  for (const title of ['\u200b\u3164', '\u2060\u00ad']) { // I-5: an invisible-only title is empty
    assert.throws(() => parseListingDraft(LISTING({ title }), u), (e) => e.code === 'invalid-argument');
  }
});

test('T-8 boundary to the millisecond: 7 days + 1 ms left is too early, exactly 7 days is allowed', async () => {
  const u = await seedUser(uid('s'));
  const { listingId } = await create(u);
  const edge = NOW.getTime() + 23 * DAY;
  await assert.rejects(processUpdateListing(db, as(u), { listingId, action: 'renew' }, new Date(edge - 1)), (e) => e.message === 'too-early');
  assert.equal((await processUpdateListing(db, as(u), { listingId, action: 'renew' }, new Date(edge))).expiresAtMs, edge + 30 * DAY);
});
