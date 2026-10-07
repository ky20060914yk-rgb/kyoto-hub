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
