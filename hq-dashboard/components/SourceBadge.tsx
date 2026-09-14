'use client';
import React, { useEffect, useState } from 'react';

export type SourceKind = 'live' | 'stale_cache' | 'mock' | 'offline' | 'sim';

function relTime(fetchedAt?: string | null, ageSec?: number | null): string {
  let age: number | null = ageSec ?? null;
  if ((age == null) && fetchedAt) {
    const t = Date.parse(fetchedAt);
    if (!Number.isNaN(t)) age = Math.max(0, Math.round((Date.now() - t) / 1000));
  }
  if (age == null) return '';
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  return `${Math.floor(age / 3600)}h ago`;
}

/** Freshness badge: LIVE x ago / STALE x ago / MOCK SCHEDULE / OFFLINE. */
export function SourceBadge({
  source,
  fetchedAt,
  ageSec,
  liveLabel = 'LIVE',
  className = '',
}: {
  source?: string | null;
  fetchedAt?: string | null;
  ageSec?: number | null;
  liveLabel?: string;
  className?: string;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(id);
  }, []);
  void tick;
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  let kind: SourceKind = 'mock';
  if (source === 'sim') kind = 'sim';
  else if (offline) kind = 'offline';
  else if (source === 'live') kind = 'live';
  else if (source === 'stale_cache' || source === 'stale') kind = 'stale_cache';
  const age = relTime(fetchedAt, ageSec);
  if (kind === 'live')
    return <span className={`pill pill-live ${className}`}><span className="dot-live" />{liveLabel}{age ? ` · ${age}` : ''}</span>;
  if (kind === 'stale_cache')
    return <span className={`pill pill-stale ${className}`}><span className="w-2 h-2 rounded-full bg-amber-400" />STALE{age ? ` · ${age}` : ''}</span>;
  if (kind === 'sim')
    return <span className={`pill border-cyan-400/25 bg-cyan-500/10 text-cyan-300 ${className}`} title="Simulated sensor — no hardware">SIM-LIDAR{age ? ` · ${age}` : ''}</span>;
  if (kind === 'offline')
    return <span className={`pill border-white/15 bg-white/5 text-white/50 ${className}`}>OFFLINE{age ? ` · last ${age}` : ''}</span>;
  return <span className={`pill pill-stale ${className}`}>MOCK SCHEDULE</span>;
}
