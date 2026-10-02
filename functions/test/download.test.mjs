import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, emailOf, seedPost, fakeDeps } from '../testlib/helpers.mjs';
import { claimWelcome } from '../lib/welcome.js';
import { processDownload } from '../lib/download.js';

const withCredits = async () => { const u = uid(); await claimWelcome(db, u, emailOf(u)); return u; }; // balance 3
const bal = async (u) => (await db.collection('credit_balances').doc(u).get()).get('balance');

test('a paid download charges 1 credit, records the ledger, bumps the count, signs 10 min', async () => {
  const u = await withCredits(); const pid = uid('p');
  await seedPost(pid);
  const deps = fakeDeps();
  const r = await processDownload(db, deps, u, { postId: pid });
  assert.deepEqual(r, { url: 'https://signed.test/resources/author/1_a.pdf', charged: true, balance: 2 });
  assert.equal(await bal(u), 2);
  const led = await db.collection('credits_ledger').doc(`dl_${u}_${pid}`).get();
  assert.equal(led.get('delta'), -1);
  assert.equal(led.get('reason'), 'download');
  assert.equal(led.get('refId'), pid);
  assert.equal((await db.collection('posts').doc(pid).get()).get('downloadCount'), 1);
  assert.deepEqual(deps.signed, [{ path: 'resources/author/1_a.pdf', opts: { filename: 'a.pdf', expiresMs: 600000 } }]);
});

test('re-downloading the same post is free and does not recount (P2-4)', async () => {
  const u = await withCredits(); const pid = uid('p');
  await seedPost(pid);
  await processDownload(db, fakeDeps(), u, { postId: pid });
  const again = await processDownload(db, fakeDeps(), u, { postId: pid });
  assert.equal(again.charged, false);
  assert.equal(again.balance, 2);
  assert.equal(await bal(u), 2);
  assert.equal((await db.collection('posts').doc(pid).get()).get('downloadCount'), 1);
  assert.equal((await db.collection('credits_ledger').where('uid', '==', u).get()).size, 2); // welcome + 1 download
});

test('insufficient credits: failed-precondition, nothing signed, nothing written', async () => {
  const u = uid(); const pid = uid('p'); // never claimed welcome -> balance 0
  await seedPost(pid);
  const deps = fakeDeps();
  await assert.rejects(processDownload(db, deps, u, { postId: pid }),
    (e) => e.code === 'failed-precondition' && /insufficient-credits/.test(e.message));
  assert.equal(deps.signed.length, 0);
  assert.equal((await db.collection('posts').doc(pid).get()).get('downloadCount'), 0);
  assert.equal((await db.collection('credits_ledger').doc(`dl_${u}_${pid}`).get()).exists, false);
  assert.equal((await db.collection('credit_balances').doc(u).get()).exists, false); // balance unchanged (still absent = 0)
});

test('the author downloads their own post free, without bumping the count', async () => {
  const author = uid(); const pid = uid('p');
  await seedPost(pid, { authorId: author, filePaths: [`resources/${author}/1_a.pdf`] });
  const r = await processDownload(db, fakeDeps(), author, { postId: pid });
  assert.equal(r.charged, false);
  assert.equal(r.balance, 0);
  const led = await db.collection('credits_ledger').doc(`dl_${author}_${pid}`).get();
  assert.equal(led.get('delta'), 0);
  assert.equal(led.get('reason'), 'download_free');
  assert.equal((await db.collection('posts').doc(pid).get()).get('downloadCount'), 0);
});

test('the requester whose request this post fulfilled downloads free', async () => {
  const requester = uid(); const pid = uid('p'); const rid = uid('r');
  await seedPost(pid, { requestId: rid });
  await db.collection('requests').doc(rid).set({
    authorId: requester, university_id: 'kyoto_u', isFulfilled: true, fulfilledPostId: pid,
  });
  const r = await processDownload(db, fakeDeps(), requester, { postId: pid });
  assert.equal(r.charged, false);
  assert.equal(r.balance, 0);
});

test('a request with a client-forged fulfilledPostId pointing at an unrelated post is NOT free', async () => {
  const u = await withCredits(); const pid = uid('p'); const rid = uid('r');
  await seedPost(pid); // not created for this request, no fulfill ledger
  await db.collection('requests').doc(rid).set({
    authorId: u, university_id: 'kyoto_u', isFulfilled: true, fulfilledPostId: pid,
  });
  const r = await processDownload(db, fakeDeps(), u, { postId: pid });
  assert.equal(r.charged, true);
  assert.equal(r.balance, 2);
});

test('a fulfill_<requestId> ledger row (written only by the Function) also makes it free', async () => {
  const u = uid(); const pid = uid('p'); const rid = uid('r');
  await seedPost(pid); // post without requestId (e.g. capped path aside)
  await db.collection('requests').doc(rid).set({
    authorId: u, university_id: 'kyoto_u', isFulfilled: true, fulfilledPostId: pid,
  });
  await db.collection('credits_ledger').doc(`fulfill_${rid}`).set({ uid: 'author', delta: 1, reason: 'request_fulfilled', refId: rid });
  assert.equal((await processDownload(db, fakeDeps(), u, { postId: pid })).charged, false);
});

test('someone else’s fulfilled request does not make the post free for the caller', async () => {
  const u = await withCredits(); const pid = uid('p');
  await seedPost(pid);
  await db.collection('requests').doc(uid('r')).set({
    authorId: 'someone_else', university_id: 'kyoto_u', isFulfilled: true, fulfilledPostId: pid,
  });
  assert.equal((await processDownload(db, fakeDeps(), u, { postId: pid })).charged, true);
});

test('unknown post -> not-found; bad file index -> invalid-argument', async () => {
  const u = await withCredits(); const pid = uid('p');
  await assert.rejects(processDownload(db, fakeDeps(), u, { postId: 'nope' }), (e) => e.code === 'not-found');
  await seedPost(pid);
  for (const fileIndex of [-1, 1, 1.5]) {
    await assert.rejects(processDownload(db, fakeDeps(), u, { postId: pid, fileIndex }),
      (e) => e.code === 'invalid-argument');
  }
  assert.equal(await bal(u), 3); // nothing was charged
});

test('a post with no filePaths (legacy, un-migrated) is invalid-argument, not a charge', async () => {
  const u = await withCredits(); const pid = uid('p');
  await seedPost(pid, { filePaths: [] });
  await assert.rejects(processDownload(db, fakeDeps(), u, { postId: pid }), (e) => e.code === 'invalid-argument');
  assert.equal(await bal(u), 3);
});

test('a file path outside the author prefix or containing .. is invalid-argument (no sign, no charge)', async () => {
  const u = await withCredits();
  for (const bad of ['resources/someone_else/1_a.pdf', 'resources/author/../victim/1_a.pdf', 'resources/author/', '/etc/passwd']) {
    const pid = uid('p');
    await seedPost(pid, { filePaths: [bad] });
    const deps = fakeDeps();
    await assert.rejects(processDownload(db, deps, u, { postId: pid }), (e) => e.code === 'invalid-argument');
    assert.equal(deps.signed.length, 0);
    assert.equal((await db.collection('credits_ledger').doc(`dl_${u}_${pid}`).get()).exists, false);
  }
  assert.equal(await bal(u), 3);
});

test('postId must be a non-empty string', async () => {
  const u = await withCredits();
  for (const postId of ['', undefined, 42, 'a/b']) {
    await assert.rejects(processDownload(db, fakeDeps(), u, { postId }), (e) => e.code === 'invalid-argument');
  }
});

test('concurrent downloads of the same post by the same user charge exactly once', async () => {
  const u = await withCredits(); const pid = uid('p');
  await seedPost(pid);
  const rs = await Promise.all([
    processDownload(db, fakeDeps(), u, { postId: pid }),
    processDownload(db, fakeDeps(), u, { postId: pid }),
  ]);
  assert.equal(rs.filter((r) => r.charged).length, 1);
  assert.equal(await bal(u), 2);
  assert.equal((await db.collection('posts').doc(pid).get()).get('downloadCount'), 1);
  assert.equal((await db.collection('credits_ledger').where('uid', '==', u).get()).size, 2);
});

test('a signing failure after commit is not refunded; the retry is free', async () => {
  // Deliberate: the unlock marker is the ledger row, so the user keeps the unlock and retries at no cost.
  const u = await withCredits(); const pid = uid('p');
  await seedPost(pid);
  let n = 0;
  const flaky = { sign: async (path) => { if (n++ === 0) throw new Error('sign failed'); return `https://signed.test/${path}`; } };
  await assert.rejects(processDownload(db, flaky, u, { postId: pid }), /sign failed/);
  assert.equal(await bal(u), 2);
  const retry = await processDownload(db, flaky, u, { postId: pid });
  assert.equal(retry.charged, false);
  assert.equal(await bal(u), 2);
  assert.equal((await db.collection('posts').doc(pid).get()).get('downloadCount'), 1);
});
