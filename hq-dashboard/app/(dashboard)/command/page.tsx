'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { Badge } from '../../../components/ui/badge';

type TimelineEvent = { kind?: string; title?: string; ts?: string };
type Override = { id: string | number; ts?: string; actor_id?: string; ref_type?: string; ref_id?: string | number; action?: string; stated_risk?: string | number };

function fmtTs(ts?: string) {
  return String(ts || '').slice(0, 19).replace('T', ' ');
}

export default function CommandPage() {
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([
      api.get<TimelineEvent[]>('/timeline?limit=30'),
      api.get<Override[]>('/overrides?limit=20'),
    ])
      .then(([t, o]) => {
        if (cancelled) return;
        setTimeline(t || []);
        setOverrides(o || []);
      })
      .catch((e: ApiError) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="border border-flare/40 bg-flare/5 p-4 text-xs text-flare">
        Couldn't load command data: {error}. Check the HQ API is reachable.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-3">
        <h2 className="font-bold text-base text-ink">Command timeline — all stations</h2>
        <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1 scroll-thin">
          {timeline.map((t, i) => (
            <div key={i} className="border border-structure px-3 py-2 flex items-center gap-3 text-xs bg-canvas">
              <Badge variant={t.kind === 'emergency' ? 'critical' : t.kind === 'sortie' ? 'active' : 'neutral'}>{t.kind}</Badge>
              <span className="text-ink flex-1 truncate">{t.title}</span>
              <span className="font-mono text-slate">{fmtTs(t.ts)}</span>
            </div>
          ))}
          {timeline.length === 0 && <div className="text-xs text-slate">No events yet.</div>}
        </div>
      </div>
      <div className="card p-5 space-y-3">
        <h3 className="font-bold text-base text-ink">Decision overrides — who overrode what risk</h3>
        {overrides.length === 0 && <div className="text-xs text-slate">No overrides recorded.</div>}
        {overrides.map((o) => (
          <div key={o.id} className="border border-structure px-3 py-2 text-xs text-slate font-mono bg-canvas">
            {fmtTs(o.ts)} · {o.actor_id} · {o.ref_type} {o.ref_id} · {o.action} · risk: {o.stated_risk}
          </div>
        ))}
      </div>
    </div>
  );
}
