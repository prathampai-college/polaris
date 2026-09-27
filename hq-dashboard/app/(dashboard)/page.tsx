'use client';
import { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { useDashboard } from '../../lib/context';
import { api, ApiError } from '../../lib/api';
import { TrendChart, ProcurementTable } from '../../components/TrendChart';
import { SourceBadge } from '../../components/SourceBadge';

type Forecast = { qty: number; physics: number; residual: number; total_per_day: number; days_to_stockout: number; ci: [number, number]; used_model: boolean; tele?: any } | null;
type Station = { id: string; name: string; containers?: number; assets?: number; winter_crew_count?: number; days_to_stockout?: number; critical_low?: number; open_indents?: number };

export default function OverviewPage() {
  const { selectedStation, setSelectedStation, stationName, tele, trend, pushToast } = useDashboard();
  const [stations, setStations] = useState<Station[]>([]);
  const [forecast, setForecast] = useState<Forecast>(null);
  const [procurement, setProcurement] = useState<any[]>([]);
  const [indentCount, setIndentCount] = useState({ total: 0, draft: 0, approved: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<Station[]>('/stations/overview'),
      api.get<Forecast>(`/forecast/${selectedStation}`),
      api.get<any[]>(`/procurement/${selectedStation}`),
      api.get<any[]>(`/indents?station_id=${selectedStation}`),
    ])
      .then(([s, fc, pr, ind]) => {
        if (cancelled) return;
        setStations(s || []);
        setForecast(fc);
        setProcurement(pr || []);
        setIndentCount({ total: ind?.length || 0, draft: ind?.filter((i) => i.status === 'DRAFT').length || 0, approved: ind?.filter((i) => i.status === 'APPROVED').length || 0 });
      })
      .catch((e: ApiError) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [selectedStation]);

  async function sendTelemetry(mode: 'calm' | 'blizzard' | 'acoustic') {
    const payload =
      mode === 'blizzard'
        ? { ts: new Date().toISOString(), station_id: selectedStation, temp_outside: -38, wind_speed: 22, pressure: 960, dg_load: 0.9, acoustic_anomaly: 0.1 }
        : mode === 'acoustic'
        ? { ts: new Date().toISOString(), station_id: selectedStation, temp_outside: -15, wind_speed: 5, pressure: 1013, dg_load: 0.7, acoustic_anomaly: 0.95 }
        : { ts: new Date().toISOString(), station_id: selectedStation, temp_outside: -15, wind_speed: 5, pressure: 1013, dg_load: 0.7, acoustic_anomaly: 0.1 };
    try {
      await api.post('/telemetry', payload);
      pushToast(`Telemetry trigger: ${mode.toUpperCase()}`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.message : 'telemetry error');
    }
  }

  const kpi = useMemo(
    () => ({
      stations: stations.length || 3,
      critical: stations.reduce((s, x) => s + (x.critical_low || 0), 0),
      open: stations.reduce((s, x) => s + (x.open_indents || 0), 0),
    }),
    [stations]
  );

  if (error) {
    return (
      <div className="border border-flare/40 bg-flare/5 p-4 text-xs text-flare">
        Couldn't load overview data: {error}. Check the HQ API is reachable.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="card p-3.5 flex items-center gap-3">
          <div className="w-10 h-10 border border-cobalt/30 bg-cobalt/10 grid place-items-center text-cobalt"><MapIcon size={16} /></div>
          <div>
            <div className="eyebrow">POLAR FLEET</div>
            <div className="text-base font-black text-ink">{kpi.stations} stations</div>
          </div>
        </div>
        <div className="card p-3.5">
          <div className="eyebrow">STOCKOUT HORIZON</div>
          <div className="text-base font-black text-ink mt-0.5 flex items-baseline gap-2">
            <span>{forecast?.days_to_stockout ?? '—'} days</span>
            <span className={`text-[9px] px-1.5 py-0.5 font-bold ${forecast && forecast.days_to_stockout <= 20 ? 'bg-flare text-white' : 'bg-cobalt/10 text-cobalt'}`}>
              {forecast && forecast.days_to_stockout <= 20 ? 'CRITICAL' : 'STABLE'}
            </span>
          </div>
        </div>
        <div className="card p-3.5">
          <div className="eyebrow flex items-center gap-2">TELEMETRY {tele?.source ? <SourceBadge source={tele.source} fetchedAt={tele.fetched_at} ageSec={tele.age_sec} /> : null}</div>
          <div className="text-sm font-bold text-ink mt-0.5">{tele?.temp_outside ?? forecast?.tele?.temp_outside ?? '—'}°C · {tele?.wind_speed ?? forecast?.tele?.wind_speed ?? '—'} m/s</div>
        </div>
        <div className="card p-3.5">
          <div className="eyebrow">INDENT PIPELINE</div>
          <div className="text-base font-black text-ink mt-0.5">{indentCount.total} orders</div>
          <div className="text-[11px] text-slate">{indentCount.draft} draft · {indentCount.approved} approved</div>
        </div>
      </div>

      {/* Thermo hybrid hero */}
      {forecast && (
        <div className="card p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="space-y-2 max-w-2xl">
              <div className="flex items-center gap-2">
                <h2 className="display text-lg text-ink">Thermo Hybrid AI Prognostics</h2>
                <span className="border border-cobalt/30 bg-cobalt/10 px-2 py-0.5 font-mono text-[10px] font-bold text-cobalt">{forecast.used_model ? 'ONNX int8' : 'Physics fallback'}</span>
              </div>
              <div className="text-xs text-slate">Station: <b className="text-ink">{stationName}</b> · Diesel stock: <b className="text-ink">{forecast.qty} L</b></div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => sendTelemetry('calm')} className="border border-structure px-3.5 py-1.5 font-mono text-xs font-bold text-ink hover:bg-structure hover:text-canvas">Calm baseline</button>
                <button onClick={() => sendTelemetry('blizzard')} className="border border-structure bg-flare px-3.5 py-1.5 font-mono text-xs font-bold text-white hover:bg-structure">Blizzard (42→18d)</button>
                <button onClick={() => sendTelemetry('acoustic')} className="border border-structure bg-amber-500 px-3.5 py-1.5 font-mono text-xs font-bold text-black hover:bg-structure hover:text-white">Bearing failure AI</button>
              </div>
              <div className="text-[11px] font-mono text-slate">
                Physics {forecast.physics} L/d + ML residual {forecast.residual} L/d = <b className="text-ink">{forecast.total_per_day} L/d total</b> ({'±'}15% illustrative band: {forecast.ci[0]}–{forecast.ci[1]}d)
              </div>
            </div>
            <div className="border border-structure bg-ink p-4 min-w-[240px] text-left lg:text-right space-y-1 text-canvas">
              <div className="eyebrow text-canvas/60">DAYS TO DIESEL STOCKOUT</div>
              <div className="text-4xl font-black">{forecast.days_to_stockout} <span className="text-sm font-normal text-canvas/60">days</span></div>
              <div className="w-full h-1.5 bg-canvas/15 mt-2"><div className="h-full bg-cobalt" style={{ width: `${Math.min(100, forecast.days_to_stockout * 2.2)}%` }} /></div>
            </div>
          </div>
        </div>
      )}

      {/* Station summary cards */}
      <div className="grid md:grid-cols-3 gap-3">
        {stations.map((s) => {
          const isCurrent = s.id === selectedStation;
          return (
            <button key={s.id} onClick={() => setSelectedStation(s.id)} className={`card p-4 text-left transition ${isCurrent ? 'border-cobalt' : 'hover:border-cobalt/50'}`}>
              <div className="font-bold text-base text-ink">{s.name} Station</div>
              <div className="text-xs text-slate font-mono mt-0.5">{s.id}</div>
              <div className="grid grid-cols-3 gap-2 text-center mt-3 pt-3 border-t border-structure/30">
                <div className="p-2 bg-canvas"><div className="text-base font-black text-ink">{s.containers ?? '—'}</div><div className="text-[10px] text-slate uppercase">Bays</div></div>
                <div className="p-2 bg-canvas"><div className="text-base font-black text-ink">{s.assets ?? '—'}</div><div className="text-[10px] text-slate uppercase">SKUs</div></div>
                <div className="p-2 bg-canvas"><div className="text-base font-black text-ink">{s.winter_crew_count ?? '—'}</div><div className="text-[10px] text-slate uppercase">Crew</div></div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs pt-1">
                <span className="text-slate">Stockout forecast:</span>
                <span className="font-bold text-ink font-mono">{s.days_to_stockout ?? (isCurrent ? forecast?.days_to_stockout : '—')} days</span>
              </div>
            </button>
          );
        })}
        {!loading && stations.length === 0 && <div className="text-xs text-slate">No station data.</div>}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <TrendChart data={trend} stationName={stationName} />
        <ProcurementTable rows={procurement} />
      </div>
    </div>
  );
}
