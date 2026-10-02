import type { Firestore } from 'firebase-admin/firestore';
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
  const [live, hidden] = await Promise.all([
    db.collection('posts').doc(postId).get(),
    db.collection('hidden_posts').doc(postId).get(),
  ]);
  if (live.exists || hidden.exists) return [];
  return handlePostDeleted(deps, post);
}
