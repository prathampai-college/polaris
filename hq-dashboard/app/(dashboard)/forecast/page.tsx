'use client';
import { useEffect, useState } from 'react';
import { useDashboard } from '../../../lib/context';
import { api, ApiError } from '../../../lib/api';
import { TrendChart, ProcurementTable } from '../../../components/TrendChart';

type Forecast = {
  qty: number;
  physics: number;
  residual: number;
  total_per_day: number;
  days_to_stockout: number;
  ci: [number, number];
  used_model: boolean;
  tele?: any;
} | null;

export default function ForecastPage() {
  const { selectedStation, stationName, trend, pushToast } = useDashboard();
  const [forecast, setForecast] = useState<Forecast>(null);
  const [procurement, setProcurement] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([
      api.get<Forecast>(`/forecast/${selectedStation}`),
      api.get<any[]>(`/procurement/${selectedStation}`),
    ])
      .then(([fc, pr]) => {
        if (cancelled) return;
        setForecast(fc);
        setProcurement(pr || []);
      })
      .catch((e: ApiError) => !cancelled && setError(e.message));
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

  if (error) {
    return (
      <div className="border border-flare/40 bg-flare/5 p-4 text-xs text-flare">
        Couldn't load forecast data: {error}. Check the HQ API is reachable.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="display text-lg text-ink">Thermo Hybrid Inference Engine</h2>
            <p className="text-xs text-slate">Physics first-principles + ML neural network residual model</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => sendTelemetry('calm')} className="border border-structure px-3.5 py-1.5 font-mono text-xs font-bold text-ink hover:bg-structure hover:text-canvas">
              Calm
            </button>
            <button onClick={() => sendTelemetry('blizzard')} className="border border-structure bg-flare px-3.5 py-1.5 font-mono text-xs font-bold text-white hover:bg-structure">
              Blizzard (42→18d)
            </button>
            <button onClick={() => sendTelemetry('acoustic')} className="border border-structure bg-amber-500 px-3.5 py-1.5 font-mono text-xs font-bold text-black hover:bg-structure hover:text-white">
              Bearing anomaly
            </button>
          </div>
        </div>

        {forecast && (
          <div className="grid lg:grid-cols-3 gap-3">
            <div className="p-4 bg-canvas border border-structure space-y-1">
              <div className="eyebrow">Physics burn rate</div>
              <div className="text-2xl font-black text-ink">{forecast.physics} <span className="text-xs font-normal text-slate">L/day</span></div>
              <div className="text-[11px] text-slate font-mono">110 × (1 + 0.012ΔT + 0.018W) + 0.08ΔP</div>
            </div>

            <div className="p-4 bg-canvas border border-structure space-y-1">
              <div className="eyebrow">ML neural residual</div>
              <div className="text-2xl font-black text-phosphor">+{forecast.residual} <span className="text-xs font-normal text-slate">L/day</span></div>
              <div className="text-[11px] text-slate font-mono">Tiny MLP 5→16→8→1 (1.3KB ONNX)</div>
            </div>

            <div className="p-4 bg-ink border border-structure space-y-1 text-canvas">
              <div className="eyebrow text-canvas/60">Days to zero fuel</div>
              <div className="text-2xl font-black">{forecast.days_to_stockout} <span className="text-xs font-normal text-canvas/60">days</span></div>
              <div className="text-[11px] text-canvas/50 font-mono">95% CI: {forecast.ci[0]}–{forecast.ci[1]} days</div>
            </div>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <TrendChart data={trend} stationName={stationName} />
        <ProcurementTable rows={procurement} />
      </div>
    </div>
  );
}
