'use client';
import { useEffect } from 'react';

/** Offline app shell. Production only — a caching SW in `next dev` serves stale chunks. */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[polaris] service worker not registered:', e));
  }, []);
  return null;
}
