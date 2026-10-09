'use client';

import { useSyncExternalStore } from 'react';

const subscribe = (tick: () => void) => {
  const t = setInterval(tick, 30_000);
  return () => clearInterval(t);
};
const minute = () => Math.floor(Date.now() / 60_000) * 60_000;

/**
 * The current time on the client, refreshed every minute; null while
 * prerendering (the shell must not bake in the build-time clock).
 */
export function useNow(): Date | null {
  const ms = useSyncExternalStore(subscribe, minute, () => 0);
  return ms ? new Date(ms) : null;
}
