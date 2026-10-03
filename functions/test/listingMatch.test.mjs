import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, as, get, NOW, later, LISTING, seedUser, seedCourse } from '../testlib/market.mjs';
import { processCreateListing } from '../lib/listings.js';
import { handleListingCreated, titlesMatch, listingsMatch } from '../lib/listingMatch.js';
import { normalizeTitle } from '../lib/marketCore.js';

// Every test uses its own unique title words, so the shared emulator's other
// want listings can never match (the query is global by design).
const T = () => `${uid('本')}の線形代数`;
const want = async (u, over = {}, now = NOW) => (await processCreateListing(db, as(u), LISTING({ type: 'want', condition: '', price: undefined, ...over }), now)).listingId;
const offer = async (u, over = {}, now = NOW) => (await processCreateListing(db, as(u), LISTING(over), now)).listingId;
const notes = async (listingId) => (await db.collection('notifications').where('listingId', '==', listingId).get()).docs.map((d) => d.data());

test('titlesMatch: containment of normalized titles, never below 4 characters', () => {
  assert.equal(titlesMatch(normalizeTitle('線形代数'), normalizeTitle('線形代数入門 第2版')), true);
  assert.equal(titlesMatch(normalizeTitle('Campbell Biology'), normalizeTitle('ｃａｍｐｂｅｌｌ ｂｉｏｌｏｇｙ 11th')), true);
  assert.equal(titlesMatch('数学', '数学入門'), false); // 2 chars: too loose
  assert.equal(titlesMatch('abc', 'abcd'), false); // boundary: 3 never matches
  assert.equal(titlesMatch('abcd', 'xabcdx'), true); // boundary: 4 does
  assert.equal(listingsMatch({ courseId: 'c1', title: 'A本' }, { courseId: 'c1', title: '全然ちがう' }), true);
  assert.equal(listingsMatch({ courseId: '', title: 'A本' }, { courseId: '', title: '全然ちがう' }), false);
});

test('a new offer notifies the owners of matching live wants once, never its own owner', async () => {
  const title = T();
  const seller = await seedUser(uid('s')); const w1 = await seedUser(uid('w')); const w2 = await seedUser(uid('w'));
  await want(w1, { title });
  await want(w2, { title: `${title} 第3版` });
  await want(seller, { title }); // the seller's own want: no self-notice
  const other = await seedUser(uid('w'));
  await want(other, { title: `${uid('x')}まったく別の本` });
  const id = await offer(seller, { title });
  const got = await handleListingCreated(db, id, NOW);
  assert.deepEqual(got.sort(), [w1, w2].sort());
  const n = (await get(`notifications/mkt_match_${id}_${w1}`)).data();
  assert.deepEqual([n.uid, n.type, n.listingId, n.postTitle, n.read, n.university_id], [w1, 'listing_match', id, title, false, 'kyoto_u']);
  assert.deepEqual(await handleListingCreated(db, id, NOW), []); // a trigger retry writes nothing new
  assert.equal((await notes(id)).length, 2);
});

test('a want with the same course matches whatever the title', async () => {
  const c = await seedCourse();
  const seller = await seedUser(uid('s')); const w = await seedUser(uid('w'));
  await want(w, { title: `${uid('x')}教科書ならなんでも`, courseId: c });
  const id = await offer(seller, { title: T(), courseId: c });
  assert.deepEqual(await handleListingCreated(db, id, NOW), [w]);
});

test('expired, closed or hidden wants and want-type listings never notify', async () => {
  const title = T();
  const seller = await seedUser(uid('s'));
  const old = await seedUser(uid('w')); const closed = await seedUser(uid('w')); const hidden = await seedUser(uid('w'));
  await want(old, { title }, later(-31));
  const c = await want(closed, { title });
  await db.doc(`textbook_listings/${c}`).update({ status: 'closed' });
  const h = await want(hidden, { title });
  await db.doc(`textbook_listings/${h}`).update({ status: 'hidden' });
  const id = await offer(seller, { title });
  assert.deepEqual(await handleListingCreated(db, id, NOW), []);
  const w = await seedUser(uid('w'));
  await want(w, { title });
  const wantId = await want(await seedUser(uid('w')), { title });
  assert.deepEqual(await handleListingCreated(db, wantId, NOW), []); // a NEW want triggers nothing
});

test('T-9: at most 20 recipients per offer', async () => {
  const title = T();
  for (let i = 0; i < 22; i++) await want(await seedUser(uid('w')), { title });
  const id = await offer(await seedUser(uid('s')), { title });
  assert.equal((await handleListingCreated(db, id, NOW)).length, 20);
  assert.equal((await notes(id)).length, 20);
});

test('T-9: at most 10 match notices per recipient per JST day — offer flooding cannot spam a wanter', async () => {
  const w = await seedUser(uid('w'));
  const title = T();
  await want(w, { title });
  const sellers = [];
  for (let i = 0; i < 3; i++) sellers.push(await seedUser(uid('s')));
  let sent = 0;
  for (let i = 0; i < 12; i++) {
    const id = await offer(sellers[i % 3], { title: `${title}${i}` });
    sent += (await handleListingCreated(db, id, NOW)).length;
  }
  assert.equal(sent, 10);
  const id = await offer(sellers[0], { title }, later(1));
  assert.deepEqual(await handleListingCreated(db, id, later(1)), [w]); // the next JST day
});

test('a block in either direction suppresses match notices', async () => {
  const title = T();
  const seller = await seedUser(uid('s')); const w1 = await seedUser(uid('w')); const w2 = await seedUser(uid('w'));
  await want(w1, { title });
  await want(w2, { title });
  await db.doc(`market_blocks/${w1}_${seller}`).set({ blocker: w1, blocked: seller });
  await db.doc(`market_blocks/${seller}_${w2}`).set({ blocker: seller, blocked: w2 });
  const id = await offer(seller, { title });
  assert.deepEqual(await handleListingCreated(db, id, NOW), []);
});
