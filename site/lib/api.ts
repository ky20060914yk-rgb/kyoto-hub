'use client';

import { authedFetch } from '@/components/auth/AuthProvider';

/** Calls a Route Handler with the user's ID token; throws the server's Japanese message on failure. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await authedFetch(path, { ...rest, body: json === undefined ? rest.body : JSON.stringify(json) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? '通信に失敗しました。');
  return data as T;
}
