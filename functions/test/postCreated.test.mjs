import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db, uid, seedPost, fakeDeps } from '../testlib/helpers.mjs';
import { handlePostCreated } from '../lib/postCreated.js';

const bal = async (u) => (await db.collection('credit_balances').doc(u).get()).get('balance') ?? 0;
const mk = async (over = {}) => {
  const a = uid('a'); const id = uid('p');
  const path = `resources/${a}/1_a.pdf`;
  await seedPost(id, { authorId: a, filePaths: [path], subjectId: uid('c'), ...over });
  return { a, id, path };
};

test('a valid past-exam upload earns +3 and a ledger row', async () => {
  const { a, id, path } = await mk();
  const r = await handlePostCreated(db, fakeDeps([path]), id);
  assert.deepEqual(r, { valid: true, duplicate: false, granted: 3, capped: false, fulfilled: false });
  assert.equal(await bal(a), 3);
  const led = await db.collection('credits_ledger').doc(`upload_${id}`).get();
  assert.equal(led.get('delta'), 3);
  assert.equal(led.get('reason'), 'upload');
});

test('replaying the trigger for the same post grants only once', async () => {
  const { a, id, path } = await mk();
  await handlePostCreated(db, fakeDeps([path]), id);
  const again = await handlePostCreated(db, fakeDeps([path]), id);
  assert.equal(again.granted, 0);
  assert.equal(await bal(a), 3);
});

test('a missing file invalidates the post: the doc is deleted, no credit', async () => {
  const { a, id } = await mk();
  const r = await handlePostCreated(db, fakeDeps([]), id);
  assert.equal(r.valid, false);
  assert.equal((await db.collection('posts').doc(id).get()).exists, false);
  assert.equal(await bal(a), 0);
});

test('a path under another user’s prefix invalidates the post', async () => {
  const { a, id } = await mk({ filePaths: ['resources/victim/1_secret.pdf'] });
  const r = await handlePostCreated(db, fakeDeps(['resources/victim/1_secret.pdf']), id);
  assert.equal(r.valid, false);
  assert.equal((await db.collection('posts').doc(id).get()).exists, false);
  assert.equal(await bal(a), 0);
});

test('empty or oversized filePaths are invalid', async () => {
  for (const filePaths of [[], Array.from({ length: 6 }, (_, i) => `x${i}`), 'not-a-list']) {
    const { id } = await mk({ filePaths });
    assert.equal((await handlePostCreated(db, fakeDeps(), id)).valid, false);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a duplicate past exam (same course+year, earlier post exists) earns nothing but is kept', async () => {
  const subjectId = uid('c');
  const first = await mk({ subjectId });
  await sleep(20);
  const second = await mk({ subjectId });
  const r = await handlePostCreated(db, fakeDeps([second.path]), second.id);
  assert.equal(r.duplicate, true);
  assert.equal(r.granted, 0);
  assert.equal((await db.collection('posts').doc(second.id).get()).exists, true);
  assert.equal(await bal(second.a), 0);
  // the original is not a duplicate of the later one
  assert.equal((await handlePostCreated(db, fakeDeps([first.path]), first.id)).duplicate, false);
});

test('a forged created_at_ts=0 on the later post does not make it the original', async () => {
  const subjectId = uid('c');
  const first = await mk({ subjectId });
  await sleep(20);
  const second = await mk({ subjectId, created_at_ts: Timestamp.fromMillis(0) });
  assert.equal((await handlePostCreated(db, fakeDeps([second.path]), second.id)).duplicate, true);
  assert.equal((await handlePostCreated(db, fakeDeps([first.path]), first.id)).duplicate, false);
});

test('equal server createTime: the smaller doc id is the original', async () => {
  const subjectId = uid('c'); const tag = uid('t');
  const mkDoc = (id, a) => ({
    authorId: a, university_id: 'kyoto_u', subjectId, category: 'past_exam', year: 2024,
    filePaths: [`resources/${a}/1.pdf`], fileNames: ['1.pdf'],
  });
  const ida = `a_${tag}`; const idb = `b_${tag}`;
  const batch = db.batch(); // one commit => identical createTime
  batch.set(db.collection('posts').doc(ida), mkDoc(ida, 'ua'));
  batch.set(db.collection('posts').doc(idb), mkDoc(idb, 'ub'));
  await batch.commit();
  const [sa, sb] = await Promise.all([ida, idb].map((i) => db.collection('posts').doc(i).get()));
  assert.equal(sa.createTime.toMillis(), sb.createTime.toMillis());
  assert.equal((await handlePostCreated(db, fakeDeps(['resources/ua/1.pdf']), ida)).duplicate, false);
  assert.equal((await handlePostCreated(db, fakeDeps(['resources/ub/1.pdf']), idb)).duplicate, true);
});

test('a missing or string year cannot dodge the duplicate check', async () => {
  for (const [y1, y2] of [[undefined, undefined], [2024, '2024'], ['2024', 2024]]) {
    const subjectId = uid('c');
    const o1 = { subjectId, year: y1 ?? null };
    const first = await mk(o1);
    if (y1 === undefined) await db.collection('posts').doc(first.id).update({ year: FieldValue.delete() });
    await sleep(20);
    const o2 = { subjectId, year: y2 ?? null };
    const second = await mk(o2);
    if (y2 === undefined) await db.collection('posts').doc(second.id).update({ year: FieldValue.delete() });
    const r = await handlePostCreated(db, fakeDeps([second.path]), second.id);
    assert.equal(r.duplicate, true, `years ${String(y1)} / ${String(y2)}`);
    assert.equal(r.granted, 0);
  }
});

test('a post without a subjectId is invalid and deleted without throwing', async () => {
  const { a, id, path } = await mk();
  await db.collection('posts').doc(id).update({ subjectId: FieldValue.delete() });
  const r = await handlePostCreated(db, fakeDeps([path]), id);
  assert.equal(r.valid, false);
  assert.equal((await db.collection('posts').doc(id).get()).exists, false);
  assert.equal(await bal(a), 0);
});

test('partial files: two paths with one missing invalidates the post, no credit', async () => {
  const a = uid('a'); const id = uid('p');
  const p1 = `resources/${a}/1.pdf`; const p2 = `resources/${a}/2.pdf`;
  await seedPost(id, { authorId: a, filePaths: [p1, p2], subjectId: uid('c') });
  const r = await handlePostCreated(db, fakeDeps([p1]), id);
  assert.equal(r.valid, false);
  assert.equal((await db.collection('posts').doc(id).get()).exists, false);
  assert.equal(await bal(a), 0);
});

test('fulfilment shares the daily cap (P2-3/P2-10)', async () => {
  const now = new Date('2026-10-03T03:00:00Z');
  const upload = async (a, over = {}) => {
    const id = uid('p'); const path = `resources/${a}/${id}.pdf`;
    await seedPost(id, { authorId: a, filePaths: [path], subjectId: uid('c'), ...over });
    return handlePostCreated(db, fakeDeps([path]), id, now);
  };
  const req = async () => {
    const rid = uid('r');
    await db.collection('requests').doc(rid).set({ authorId: uid('q'), university_id: 'kyoto_u', isFulfilled: false, fulfilledPostId: null });
    return rid;
  };
  // 2 uploads used, then a fulfilling upload: fulfil grant fits (3rd), upload grant is capped
  const a = uid('a');
  await upload(a); await upload(a);
  const rid = await req();
  const r = await upload(a, { requestId: rid });
  assert.deepEqual({ f: r.fulfilled, g: r.granted, c: r.capped }, { f: true, g: 3, c: true });
  assert.equal(await bal(a), 9);
  // already at the cap: still marks the request fulfilled, but pays nothing and writes no ledger
  const b = uid('a');
  await upload(b); await upload(b); await upload(b);
  const rid2 = await req();
  const r2 = await upload(b, { requestId: rid2 });
  assert.deepEqual({ f: r2.fulfilled, g: r2.granted, c: r2.capped }, { f: true, g: 0, c: true });
  assert.equal(await bal(b), 9);
  assert.equal((await db.collection('requests').doc(rid2).get()).get('isFulfilled'), true);
  assert.equal((await db.collection('credits_ledger').doc(`fulfill_${rid2}`).get()).exists, false);
});

test('fulfilment replay pays once (fulfill_<rid>)', async () => {
  const rid = uid('r');
  await db.collection('requests').doc(rid).set({ authorId: uid('q'), university_id: 'kyoto_u', isFulfilled: false, fulfilledPostId: null });
  const { a, id, path } = await mk({ requestId: rid });
  await handlePostCreated(db, fakeDeps([path]), id);
  const again = await handlePostCreated(db, fakeDeps([path]), id);
  assert.equal(again.granted, 0);
  assert.equal(await bal(a), 6);
  // even with the request flag reset, the ledger marker blocks a second payout
  await db.collection('requests').doc(rid).update({ isFulfilled: false, fulfilledPostId: null });
  assert.equal((await handlePostCreated(db, fakeDeps([path]), id)).granted, 0);
  assert.equal(await bal(a), 6);
});

test('non-past-exam categories are never deduplicated', async () => {
  const subjectId = uid('c');
  await mk({ subjectId, category: 'test_prep', year: null, created_at_ts: Timestamp.fromMillis(1_000) });
  const second = await mk({ subjectId, category: 'test_prep', year: null, created_at_ts: Timestamp.fromMillis(2_000) });
  const r = await handlePostCreated(db, fakeDeps([second.path]), second.id);
  assert.equal(r.duplicate, false);
  assert.equal(r.granted, 3);
});

test('daily cap: the 4th grant on a JST day is capped, the next day grants again (P2-3)', async () => {
  const a = uid('a');
  const day1 = new Date('2026-10-03T03:00:00Z'); // 12:00 JST Oct 3
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const id = uid('p'); ids.push(id);
    const path = `resources/${a}/${i}_a.pdf`;
    await seedPost(id, { authorId: a, filePaths: [path], subjectId: uid('c') });
    const r = await handlePostCreated(db, fakeDeps([path]), id, day1);
    assert.equal(r.granted, i < 3 ? 3 : 0);
    assert.equal(r.capped, i >= 3);
  }
  assert.equal(await bal(a), 9);
  const id5 = uid('p'); const p5 = `resources/${a}/5_a.pdf`;
  await seedPost(id5, { authorId: a, filePaths: [p5], subjectId: uid('c') });
  const r5 = await handlePostCreated(db, fakeDeps([p5]), id5, new Date('2026-10-03T16:00:00Z')); // 01:00 JST Oct 4
  assert.equal(r5.granted, 3);
  assert.equal(await bal(a), 12);
});

test('fulfilling someone else’s request marks it solved and pays +3 on top of the upload (P2-10)', async () => {
  const requester = uid('q'); const rid = uid('r');
  await db.collection('requests').doc(rid).set({
    authorId: requester, university_id: 'kyoto_u', isFulfilled: false, fulfilledPostId: null,
  });
  const { a, id, path } = await mk({ requestId: rid });
  const r = await handlePostCreated(db, fakeDeps([path]), id);
  assert.equal(r.fulfilled, true);
  assert.equal(r.granted, 6);
  assert.equal(await bal(a), 6);
  const req = await db.collection('requests').doc(rid).get();
  assert.equal(req.get('isFulfilled'), true);
  assert.equal(req.get('fulfilledPostId'), id);
  assert.equal((await db.collection('credits_ledger').doc(`fulfill_${rid}`).get()).get('reason'), 'request_fulfilled');
});

test('you cannot fulfil your own request, nor one that is already solved', async () => {
  const a = uid('a');
  const own = uid('r'); const done = uid('r');
  await db.collection('requests').doc(own).set({ authorId: a, university_id: 'kyoto_u', isFulfilled: false });
  await db.collection('requests').doc(done).set({ authorId: 'other', university_id: 'kyoto_u', isFulfilled: true, fulfilledPostId: 'earlier' });
  for (const requestId of [own, done]) {
    const id = uid('p'); const path = `resources/${a}/${requestId}.pdf`;
    await seedPost(id, { authorId: a, filePaths: [path], subjectId: uid('c'), requestId });
    const r = await handlePostCreated(db, fakeDeps([path]), id);
    assert.equal(r.fulfilled, false);
  }
  assert.equal((await db.collection('requests').doc(own).get()).get('isFulfilled'), false);
  assert.equal((await db.collection('requests').doc(done).get()).get('fulfilledPostId'), 'earlier');
});

test('a path containing a .. segment invalidates the post', async () => {
  const a = uid('a'); const id = uid('p');
  const bad = `resources/${a}/../victim/x.pdf`;
  await seedPost(id, { authorId: a, filePaths: [bad], subjectId: uid('c') });
  assert.equal((await handlePostCreated(db, fakeDeps([bad]), id)).valid, false);
});

test('hide + re-upload cannot re-earn: a same course+year+category post in hidden_posts makes the new upload a duplicate', async () => {
  const subjectId = uid('c');
  const first = await mk({ subjectId });
  assert.equal((await handlePostCreated(db, fakeDeps([first.path]), first.id)).granted, 3);
  const data = (await db.collection('posts').doc(first.id).get()).data();
  await db.collection('hidden_posts').doc(first.id).set(data);   // hidden: moved, so its createTime is the hide time
  await db.collection('posts').doc(first.id).delete();
  await sleep(20);
  const againPath = first.path.replace('1_a', '2_a');
  const again = await mk({ subjectId, authorId: first.a, filePaths: [againPath] });
  const r = await handlePostCreated(db, fakeDeps([againPath]), again.id);
  assert.deepEqual([r.duplicate, r.granted], [true, 0]);
  // a different year is not a duplicate of the hidden post
  const other = await mk({ subjectId, year: 1999 });
  assert.equal((await handlePostCreated(db, fakeDeps([other.path]), other.id)).duplicate, false);
  // the original poster's restore: the hidden doc is gone, so the post is judged against live posts only
  await db.collection('posts').doc(first.id).set(data);
  await db.collection('hidden_posts').doc(first.id).delete();
  assert.equal((await handlePostCreated(db, fakeDeps([first.path]), first.id)).granted, 0); // already paid: ledger id is idempotent
});
