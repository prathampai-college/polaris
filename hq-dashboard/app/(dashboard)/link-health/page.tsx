'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';

type Station = {
  station_id: string;
  name: string;
  status: 'LIVE' | 'STORE_FWD' | 'QUIET' | 'SILENT' | 'UNKNOWN';
  tablets_connected: number;
  last_frame_at: string | null;
  frames_since_gateway_start: number;
  dtn_bundles_24h: number;
  last_dtn_at: string | null;
  last_contact_at: string | null;
  quiet_minutes: number | null;
  open_sos: number;
};
type Health = { gateway_reachable: boolean; stations: Station[]; checked_at: string };

const STYLE: Record<Station['status'], { label: string; cls: string; hint: string }> = {
  LIVE: { label: 'LIVE', cls: 'border-cobalt bg-cobalt text-white', hint: 'Tablets connected over the satellite link' },
  STORE_FWD: { label: 'STORE & FORWARD', cls: 'border-amber-500 bg-amber-50 text-amber-800', hint: 'No live link; data arriving as DTN bundles' },
  QUIET: { label: 'QUIET', cls: 'border-amber-500 bg-amber-50 text-amber-800', hint: 'Heard from in the last hour, nothing connected now' },
  SILENT: { label: 'SILENT', cls: 'border-flare bg-flare text-white', hint: 'No contact for over an hour, or never' },
  UNKNOWN: { label: 'UNKNOWN', cls: 'border-structure/40 bg-canvas text-slate', hint: 'Gateway unreachable from HQ' },
};

function ago(min: number | null) {
  if (min == null) return 'never';
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
}

export default function LinkHealthPage() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.hidden) return; // no polling from a background tab
      api
        .get<Health>('/stations/link-health')
        .then((d) => { if (!cancelled) { setData(d); setError(null); } })
        .catch((e: ApiError) => !cancelled && setError(e.message));
    };
    load();
    const id = setInterval(load, 15000);
    document.addEventListener('visibilitychange', load);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener('visibilitychange', load); };
  }, []);

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="display text-base font-bold text-ink">Station Link Health</h2>
        <p className="text-sm text-slate">
          Which stations HQ can hear right now, and how. A station going quiet is normal on a 20–50 kbps link; a silent one
          with an open SOS is not.
        </p>
        {data && !data.gateway_reachable && (
          <p className="mt-3 border border-flare/40 bg-flare/5 p-2 text-sm text-flare" role="status">
            HQ cannot reach the sync gateway — live status unknown; showing DTN arrivals only.
          </p>
        )}
      </div>

      {error && (
        <div className="border border-flare/40 bg-flare/5 p-4 text-sm text-flare" role="alert">
          Couldn't load link health: {error}
        </div>
      )}
      {!data && !error && <div className="card p-5 text-sm text-slate">Loading link status…</div>}

      <div className="grid gap-4 md:grid-cols-3">
        {data?.stations.map((s) => {
          const st = STYLE[s.status];
          return (
            <section key={s.station_id} className="card space-y-3 p-5" aria-label={`${s.name} link status`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-black text-ink">{s.name}</h3>
                <span className={`border px-2 py-1 font-mono text-xs font-bold ${st.cls}`} title={st.hint}>{st.label}</span>
              </div>
              <p className="text-xs text-slate">{st.hint}</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <dt className="text-slate">Last contact</dt>
                <dd className="font-mono text-ink">{ago(s.quiet_minutes)}</dd>
                <dt className="text-slate">Tablets online</dt>
                <dd className="font-mono text-ink">{s.tablets_connected}</dd>
                <dt className="text-slate">Live frames</dt>
                <dd className="font-mono text-ink">{s.frames_since_gateway_start}</dd>
                <dt className="text-slate">DTN bundles (24 h)</dt>
                <dd className="font-mono text-ink">{s.dtn_bundles_24h}</dd>
              </dl>
              {s.open_sos > 0 && (
                <p className={`border p-2 text-sm font-bold ${s.status === 'LIVE' ? 'border-flare/40 text-flare' : 'border-flare bg-flare text-white'}`}>
                  {s.open_sos} open SOS{s.status !== 'LIVE' ? ' — station not reachable live' : ''}
                </p>
              )}
            </section>
          );
        })}
      </div>
      {data && <p className="font-mono text-xs text-slate">Checked {new Date(data.checked_at).toLocaleString()}</p>}
    </div>
  );
}
