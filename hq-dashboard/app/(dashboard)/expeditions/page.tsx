'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';

type Expedition = { id: string; name: string; program: 'ARCTIC' | 'ANTARCTIC' | string; status: string; season: string };
type StationReadiness = { staged: number; manifest_total: number; staged_pct: number; fuel_days?: number; two_month_warning?: boolean };
type Readiness = { expedition_id: string; stations: Record<string, StationReadiness> };
type MutualAid = { sku: string; from_station: string; surplus: number; to_station: string; need: number; transfer_qty: number; via_leg?: { from_point: string; to_point: string } };

export default function ExpeditionsPage() {
  const [expeditions, setExpeditions] = useState<Expedition[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [mutualAid, setMutualAid] = useState<MutualAid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<Expedition[]>('/expeditions'),
      api.get<MutualAid[]>('/procurement/mutual-aid'),
    ])
      .then(([exps, aid]) => {
        if (cancelled) return;
        setExpeditions(exps || []);
        setMutualAid(aid || []);
        if (exps && exps.length) {
          api
            .get<Readiness>(`/expeditions/${exps[0].id}/readiness`)
            .then((r) => !cancelled && setReadiness(r))
            .catch(() => {});
        }
      })
      .catch((e: ApiError) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="border border-flare/40 bg-flare/5 p-4 text-xs text-flare">
        Couldn't load expedition data: {error}. Check the HQ API is reachable.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Expedition planner */}
      <div className="card p-5 space-y-3">
        <div>
          <h2 className="display text-lg text-ink">Expedition Planner — ISEA Antarctic + Himadri Arctic</h2>
          <p className="eyebrow mt-0.5">{expeditions.length} EXPEDITIONS · CUSTODY GOA→MUMBAI→CAPETOWN→VESSEL→STATION→CRATE</p>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {expeditions.map((e) => (
            <div key={e.id} className="card p-4 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 font-bold border ${e.program === 'ARCTIC' ? 'bg-phosphor/10 text-cyan-700 border-phosphor/30' : 'bg-cobalt/10 text-cobalt border-cobalt/30'}`}>{e.program}</span>
                <span className="text-[10px] px-2 py-0.5 font-mono font-bold border border-structure/30 bg-canvas text-slate">{e.status}</span>
              </div>
              <div className="font-bold text-sm text-ink">{e.name}</div>
              <div className="text-[11px] text-slate font-mono">{e.season} · {e.id}</div>
            </div>
          ))}
          {!loading && expeditions.length === 0 && <div className="text-xs text-slate">No expeditions yet.</div>}
        </div>
      </div>

      {/* Station readiness */}
      {readiness && (
        <div className="card p-5 space-y-3">
          <h3 className="font-bold text-base text-ink">Station readiness — {readiness.expedition_id}</h3>
          <div className="grid md:grid-cols-3 gap-3">
            {Object.entries(readiness.stations || {}).map(([sid, r]) => (
              <div key={sid} className="card p-4 space-y-1">
                <div className="font-bold text-sm text-ink">{sid}</div>
                <div className="text-xs text-slate font-mono">{r.staged}/{r.manifest_total} staged ({r.staged_pct}%)</div>
                <div className="text-xs text-slate font-mono">
                  Fuel: {r.fuel_days ?? '—'} days{' '}
                  {r.two_month_warning && <span className="text-flare font-bold">⚠ 60-day watch</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mutual aid suggestions */}
      <div className="card p-5 space-y-3">
        <h3 className="font-bold text-base text-ink">Mutual aid suggestions</h3>
        {mutualAid.length === 0 && <div className="text-xs text-slate">No inter-station transfers needed — all stations above target.</div>}
        {mutualAid.slice(0, 8).map((m, i) => (
          <div key={i} className="card p-3 text-xs text-slate font-mono">
            {m.sku}: {m.from_station} (surplus {m.surplus}) → {m.to_station} (need {m.need}) — transfer {m.transfer_qty}
            {m.via_leg ? ` via ${m.via_leg.from_point}→${m.via_leg.to_point}` : ' (no leg on record)'}
          </div>
        ))}
      </div>
    </div>
  );
}
