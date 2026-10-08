'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { isKuEmail } from '@/lib/ku';

type AuthState = { user: User | null; loading: boolean; verified: boolean };

const AuthContext = createContext<AuthState>({ user: null, loading: true, verified: false });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, verified: false });
  useEffect(
    () =>
      onIdTokenChanged(auth, (user) =>
        setState({ user, loading: false, verified: !!user && user.emailVerified && isKuEmail(user.email ?? '') }),
      ),
    [],
  );
  // First verified session: claim the welcome credits + invitation code (idempotent server-side).
  const uid = state.verified ? state.user?.uid : undefined;
  useEffect(() => {
    if (!uid) return;
    const key = `welcome:${uid}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* storage blocked: the server call is idempotent anyway */
    }
    authedFetch('/api/welcome', { method: 'POST' }).catch(() => {});
  }, [uid]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** ID token for Route Handlers (`Authorization: Bearer …`). */
export async function authedFetch(input: string, init: RequestInit = {}) {
  const token = await auth.currentUser?.getIdToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(input, { ...init, headers });
}
