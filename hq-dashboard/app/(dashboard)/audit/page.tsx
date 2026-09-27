'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';

type AuditEvent = { ts: string; action: string; entity: string; actor_id: string; after?: unknown };

export default function AuditPage() {
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<AuditEvent[]>('/audit?limit=50')
      .then((a) => !cancelled && setAudit(a || []))
      .catch((e: ApiError) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="border border-flare/40 bg-flare/5 p-4 text-xs text-flare">
        Couldn't load audit trail: {error}. Check the HQ API is reachable.
      </div>
    );
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="display font-bold text-base text-ink">Immutable Compliance & Audit Trail</h2>
        <p className="text-xs text-slate">Append-only cryptographic audit records across all expedition stations</p>
      </div>

      <div className="space-y-2 max-h-[560px] overflow-y-auto scroll-thin pr-1">
        {audit.map((a, i) => (
          <div key={i} className="p-3 bg-canvas border border-structure/20 flex items-start gap-3">
            <span className="font-mono text-xs text-cobalt shrink-0 mt-0.5">
              {a.ts?.slice(11, 19) || a.ts?.slice(0, 19)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-ink flex items-center gap-2">
                <span>{a.action}</span>
                <span className="text-slate font-normal">• {a.entity}</span>
                <span className="text-xs text-slate font-mono ml-auto">Actor: {a.actor_id}</span>
              </div>
              {a.after != null && (
                <div className="text-[11px] font-mono text-slate truncate mt-1 bg-surface border border-structure/10 p-1.5">
                  {typeof a.after === 'string' ? a.after : JSON.stringify(a.after)}
                </div>
              )}
            </div>
          </div>
        ))}
        {!loading && audit.length === 0 && (
          <div className="text-center py-8 text-xs text-slate">No audit events recorded yet.</div>
        )}
      </div>
    </div>
  );
}
