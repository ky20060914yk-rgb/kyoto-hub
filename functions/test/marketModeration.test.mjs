import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, as, keyOf, get, NOW, LISTING, seedUser } from '../testlib/market.mjs';
import { fakeDeps } from '../testlib/helpers.mjs';
import { processCreateListing } from '../lib/listings.js';
import { processOpenChat } from '../lib/chat.js';
import {
  processMarketReport, hideListing, restoreListing, removeListing, closeCase, listMarketQueue, handleListingDeleted,
} from '../lib/marketModeration.js';

const OP = { operator: 'tester' };
const mk = async (over = {}) => {
  const owner = await seedUser(uid('o'));
  const { listingId } = await processCreateListing(db, as(owner), LISTING(over), NOW);
  return { owner, listingId };
};
const report = (u, targetId, over = {}) =>
  processMarketReport(db, as(u), { kind: 'listing', targetId, category: 'not_textbook', detail: '教科書ではない', ...over }, NOW);
const status = async (id) => (await get(`textbook_listings/${id}`)).get('status');

test('one report per (listing, mailbox); the 3rd distinct reporter hides it in place and tells the owner once', async () => {
  const { owner, listingId } = await mk();
  const r1 = await seedUser(uid('r'));
  assert.deepEqual(await report(r1, listingId), { status: 'reported' });
  assert.deepEqual(await report(r1, listingId), { status: 'duplicate' });
  const rep = (await get(`market_queue/${listingId}/reports/${keyOf(r1)}`)).data();
  assert.deepEqual([rep.reporterUid, rep.category, rep.counted, rep.university_id], [r1, 'not_textbook', true, 'kyoto_u']);
  assert.equal((await report(await seedUser(uid('r')), listingId)).status, 'reported');
  assert.equal(await status(listingId), 'active');
  assert.equal((await report(await seedUser(uid('r')), listingId)).status, 'hidden');
  assert.equal(await status(listingId), 'hidden');
  const n = (await get(`notifications/mkt_${listingId}_1`)).data();
  assert.deepEqual([n.uid, n.type, n.listingId, n.university_id], [owner, 'listing_hidden', listingId, 'kyoto_u']);
  assert.equal((await report(await seedUser(uid('r')), listingId)).status, 'already_hidden');
  const q = (await get(`market_queue/${listingId}`)).data();
  assert.deepEqual([q.status, q.hiddenBy, q.transitions, q.needsReview, q.university_id], ['hidden', 'reports', 1, true, 'kyoto_u']);
});

test('the owner cannot report their own listing; reports share the post-report daily cap (10/day per mailbox)', async () => {
  const { owner, listingId } = await mk();
  await assert.rejects(report(owner, listingId), (e) => e.message === 'own-listing');
  const r = await seedUser(uid('r'));
  await db.doc(`moderation_actors/${keyOf(r)}`).set({ reportDay: '2027-04-10', reportsToday: 10 });
  await assert.rejects(report(r, listingId), (e) => e.code === 'resource-exhausted');
  assert.equal((await get(`market_queue/${listingId}/reports/${keyOf(r)}`)).exists, false);
});

test('M-9 reuse: a discredited reporter is recorded but not counted; restore discredits the counted reporters', async () => {
  const { listingId } = await mk();
  const bad = await seedUser(uid('r'));
  await db.doc(`moderation_actors/${keyOf(bad)}`).set({ restoredReports: 3 });
  const good = [await seedUser(uid('r')), await seedUser(uid('r'))];
  for (const g of good) await report(g, listingId);
  assert.equal((await report(bad, listingId)).status, 'reported'); // silent
  assert.equal(await status(listingId), 'active');
  const third = await seedUser(uid('r'));
  assert.equal((await report(third, listingId)).status, 'hidden');
  const out = await restoreListing(db, listingId, OP);
  assert.deepEqual(out.discredited.sort(), [...good, third].map(keyOf).sort());
  assert.equal(await status(listingId), 'active');
  assert.equal((await get(`moderation_actors/${keyOf(third)}`)).get('restoredReports'), 1);
  assert.equal((await get(`notifications/mkt_${listingId}_2`)).get('type'), 'listing_restored');
  for (let i = 0; i < 3; i++) await report(await seedUser(uid('r')), listingId); // M-8: cleared once, never auto-hidden again
  assert.equal(await status(listingId), 'active');
  assert.equal((await get(`market_queue/${listingId}`)).get('needsReview'), true);
});

test('operator hide/restore returns a CLOSED listing to closed, not to active', async () => {
  const { owner, listingId } = await mk();
  await db.doc(`textbook_listings/${listingId}`).update({ status: 'closed' });
  assert.deepEqual(await hideListing(db, listingId, OP), { changed: true });
  assert.deepEqual(await hideListing(db, listingId, OP), { changed: false });
  assert.equal(await status(listingId), 'hidden');
  assert.equal((await restoreListing(db, listingId, OP)).changed, true);
  assert.equal(await status(listingId), 'closed');
  assert.equal((await get(`notifications/mkt_${listingId}_1`)).get('uid'), owner);
});

test('remove deletes the listing, notifies, and the photo cleanup touches only the owner prefix', async () => {
  const owner = await seedUser(uid('o'));
  const { listingId } = await processCreateListing(db, as(owner), LISTING({ photoPaths: [`listings/${owner}/1.jpg`] }), NOW);
  assert.deepEqual(await removeListing(db, listingId, OP), { changed: true });
  assert.equal((await get(`textbook_listings/${listingId}`)).exists, false);
  assert.equal((await get(`notifications/mkt_${listingId}_1`)).get('type'), 'listing_removed');
  const deps = fakeDeps();
  const out = await handleListingDeleted(deps, {
    ownerId: owner, photoPaths: [`listings/${owner}/1.jpg`, 'listings/victim/2.jpg', `listings/${owner}/../victim/3.jpg`, `resources/${owner}/a.pdf`],
  });
  assert.deepEqual(out, [`listings/${owner}/1.jpg`]);
  assert.deepEqual(deps.removed, [`listings/${owner}/1.jpg`]);
  assert.deepEqual(await handleListingDeleted(fakeDeps(), { photoPaths: ['listings//x.jpg'] }), []); // no owner: nothing
});

test('room cases: only a participant, one open case per (room, side), priority for harassment', async () => {
  const { owner, listingId } = await mk();
  const buyer = await seedUser(uid('b'));
  const { roomId } = await processOpenChat(db, as(buyer), { listingId }, NOW);
  const file = (u, category) => processMarketReport(db, as(u), { kind: 'room', targetId: roomId, category, detail: '来なかった' }, NOW);
  await assert.rejects(file(uid('x'), 'no_show'), (e) => e.code === 'permission-denied');
  await assert.rejects(file(buyer, 'not_textbook'), (e) => e.code === 'invalid-argument'); // a listing category
  assert.deepEqual(await file(buyer, 'no_show'), { status: 'case_opened' });
  assert.deepEqual(await file(buyer, 'harassment'), { status: 'duplicate' });
  const c = (await get(`market_cases/${roomId}_borrower`)).data();
  assert.deepEqual([c.reporterUid, c.reportedUid, c.category, c.status, c.priority, c.university_id], [buyer, owner, 'no_show', 'open', 'normal', 'kyoto_u']);
  assert.deepEqual(await file(owner, 'harassment'), { status: 'case_opened' });
  const { cases } = await listMarketQueue(db, 500);
  const mine = cases.filter((x) => x.roomId === roomId);
  assert.deepEqual(mine.map((x) => x.id), [`${roomId}_lender`, `${roomId}_borrower`]); // high priority first
  assert.deepEqual(await closeCase(db, `${roomId}_borrower`, OP), { changed: true });
  assert.deepEqual(await closeCase(db, `${roomId}_borrower`, OP), { changed: false });
  assert.deepEqual(await file(buyer, 'harassment'), { status: 'case_opened' }); // a closed case can be re-filed
});

test('operator actions need an operator name and a valid id; every action is audited', async () => {
  const { listingId } = await mk();
  for (const fn of [hideListing, restoreListing, removeListing, closeCase]) {
    await assert.rejects(fn(db, listingId, { operator: '' }), (e) => e.code === 'invalid-argument');
    await assert.rejects(fn(db, 'a/b', OP), (e) => e.code === 'invalid-argument');
    await assert.rejects(fn(db, uid('nope'), OP), (e) => e.code === 'not-found');
  }
  await hideListing(db, listingId, { operator: 'alice', note: 'spam' });
  const rows = (await db.collection('moderation_log').where('target', '==', listingId).get()).docs.map((d) => d.data());
  assert.deepEqual(rows.map((r) => [r.action, r.by, r.note]), [['listing_hide:operator', 'operator:alice', 'spam']]);
});

test('bad report input is refused before anything is written', async () => {
  const { listingId } = await mk();
  const r = await seedUser(uid('r'));
  for (const over of [{ kind: 'post' }, { targetId: 'a/b' }, { category: 'copyright' }, { detail: 'x'.repeat(501) }]) {
    await assert.rejects(report(r, listingId, over), (e) => e.code === 'invalid-argument', JSON.stringify(over));
  }
  assert.equal((await get(`moderation_actors/${keyOf(r)}`)).exists, false);
  await assert.rejects(report(r, uid('nope')), (e) => e.code === 'not-found');
});
