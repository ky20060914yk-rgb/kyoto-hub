import type { Firestore } from 'firebase-admin/firestore';
import { postRef, hiddenRef, queueRef, retireQueueTx } from './moderation.js';
// postDeleted.ts
export interface DeleteDeps { remove(path: string): Promise<void> }

/**
 * Deletes a removed post's files. SECURITY: only paths under the post's OWN
 * author prefix are touched. `handlePostCreated` deletes invalid posts, so a
 * post whose `filePaths` point at someone else's file must never be able to
 * make this trigger delete that file.
 */
export async function handlePostDeleted(
  deps: DeleteDeps,
  post: Record<string, unknown>,
): Promise<string[]> {
  const authorId = String(post.authorId ?? '');
  const prefix = `resources/${authorId}/`;
  const paths = !authorId || !Array.isArray(post.filePaths)
    ? []
    : post.filePaths.filter((p): p is string => typeof p === 'string' && p.startsWith(prefix) && !p.split('/').includes('..'));
  for (const p of paths) {
    try { await deps.remove(p); } catch { /* already gone */ }
  }
  return paths;
}

/**
 * Plan 2B: shared by `onPostDeleted` and `onHiddenPostDeleted`. Hide and restore
 * MOVE a post between `posts` and `hidden_posts` (M-1), which looks like a delete
 * to one of the two triggers. Files are removed only when the post now exists in
 * NEITHER collection — i.e. it is really gone (author delete, invalid post,
 * operator removal) — and then still only under the author's own prefix.
 */
export async function handlePostGone(
  db: Firestore,
  deps: DeleteDeps,
  postId: string,
  post: Record<string, unknown>,
): Promise<string[]> {
  // One transaction: confirm the post is in neither collection, then retire a
  // lingering queue entry so the operator list does not show a ghost.
  const gone = await db.runTransaction(async (tx) => {
    const live = await tx.get(postRef(db, postId));
    const hidden = await tx.get(hiddenRef(db, postId));
    const qs = await tx.get(queueRef(db, postId));
    if (live.exists || hidden.exists) return false;
    retireQueueTx(tx, db, qs, postId, 'gone', 'system');
    return true;
  });
  if (!gone) return [];
  const removed: string[] = [];
  const guarded: DeleteDeps = {
    remove: async (path) => {
      // Never delete a file another live post (visible or hidden) still lists.
      for (const col of ['posts', 'hidden_posts']) {
        const ref = await db.collection(col).where('filePaths', 'array-contains', path).limit(1).get();
        if (!ref.empty) return;
      }
      await deps.remove(path);
      removed.push(path);
    },
  };
  await handlePostDeleted(guarded, post);
  return removed;
}
