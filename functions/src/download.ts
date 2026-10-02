import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { CREDITS, SIGNED_URL_TTL_MS } from './common.js';
import { ledgerRef, readBalance, writeCredit } from './credits.js';

export interface DownloadDeps {
  sign(path: string, opts: { filename: string; expiresMs: number }): Promise<string>;
}
export interface DownloadResult { url: string; charged: boolean; balance: number }

export async function processDownload(
  db: Firestore,
  deps: DownloadDeps,
  uid: string,
  input: { postId: string; fileIndex?: number },
): Promise<DownloadResult> {
  if (typeof input.postId !== 'string' || input.postId.length === 0 || input.postId.includes('/')) {
    throw new HttpsError('invalid-argument', 'bad post id');
  }
  const postRef = db.collection('posts').doc(input.postId);
  const post = (await postRef.get()).data();
  if (!post) throw new HttpsError('not-found', 'post not found');

  const paths: string[] = Array.isArray(post.filePaths) ? post.filePaths : [];
  const idx = input.fileIndex ?? 0;
  if (!Number.isInteger(idx) || idx < 0 || idx >= paths.length) {
    throw new HttpsError('invalid-argument', 'bad file index');
  }
  const p = paths[idx];
  const prefix = `resources/${post.authorId}/`;
  if (typeof p !== 'string' || !p.startsWith(prefix) || p.length <= prefix.length || p.split('/').includes('..')) {
    throw new HttpsError('invalid-argument', 'bad file path');
  }

  const isAuthor = post.authorId === uid;
  let free = isAuthor;
  if (!free) {
    const fulfilled = await db.collection('requests')
      .where('fulfilledPostId', '==', input.postId)
      .where('authorId', '==', uid)
      .limit(1)
      .get();
    free = !fulfilled.empty;
  }

  const ledgerId = `dl_${uid}_${input.postId}`;
  const outcome = await db.runTransaction(async (tx) => {
    const led = await tx.get(ledgerRef(db, ledgerId));
    const cur = await readBalance(tx, db, uid);
    if (led.exists) return { charged: false, balance: cur.balance }; // already unlocked (P2-4)
    const delta = free ? 0 : -CREDITS.downloadCost;
    const next = writeCredit(
      tx, db,
      { uid, delta, reason: free ? 'download_free' : 'download', ledgerId, refId: input.postId },
      cur,
    );
    if (!isAuthor) tx.update(postRef, { downloadCount: FieldValue.increment(1) });
    return { charged: !free, balance: next.balance };
  });

  const names: string[] = Array.isArray(post.fileNames) ? post.fileNames : [];
  const filename = names[idx] ?? paths[idx].split('/').pop() ?? 'download';
  const url = await deps.sign(paths[idx], { filename, expiresMs: SIGNED_URL_TTL_MS });
  return { url, ...outcome };
}
