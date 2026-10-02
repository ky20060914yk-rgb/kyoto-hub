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
