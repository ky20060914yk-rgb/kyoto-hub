'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';

/** Unread notifications for the bell (capped at 99). */
export function useUnreadCount(): number {
  const { user, verified } = useAuth();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!user || !verified) return;
    const q = query(collection(db, 'notifications'), where('uid', '==', user.uid), where('read', '==', false), limit(99));
    return onSnapshot(q, (s) => setCount(s.size), () => setCount(0));
  }, [user, verified]);
  return user && verified ? count : 0;
}
