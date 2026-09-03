'use client';
import { Icons } from '../Icons';

export function TodayTab({ forecast, snn, assets, indents, sendTelemetry, setTab, setInvFilter, glove }: any) {
  const criticalCount = assets.filter((a: any) => a.criticality === 'CRITICAL' && a.qty <= 5).length;
  const expiringCount = assets.filter((a: any) => {
    if (!a.expiry_date) return false;
    const d = new Date(a.expiry_date).getTime() - Date.now();
    return d >= 0 && d < 30 * 86400000;
  }).length;
  const openIndents = indents.filter((i: any) => i.status !== 'RECEIVED').length;
  return (
    <div className="space-y-4">
      {forecast ? (
        <div className="card glass-panel p-5 card-glow relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none opacity-40" style={{ background: 'radial-gradient(600px 250px at 20% 0%, rgba(59,130,246,0.25), transparent), radial-gradient(500px 200px at 80% 0%, rgba(6,182,212,0.18), transparent)' }} />
          <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono tracking-widest text-blue-400 font-bold">THERMO HYBRID RESIDUAL AI</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30">{forecast.used_model ? 'ONNX int8 <2MB' : 'Physics Fallback'}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-3 flex-wrap">
                <div className="text-4xl font-black tracking-tight leading-none text-white">{forecast.days_to_stockout}<span className="text-lg font-medium text-white/50"> days</span></div>
                <span className="text-xs px-3 py-1 rounded-full bg-white/10 border border-white/10 font-mono text-white/80">95% CI: {forecast.ci[0]}–{forecast.ci[1]} days</span>
                <span className={`text-xs px-3 py-1 rounded-full font-bold border ${forecast.days_to_stockout <= 20 ? 'bg-red-500/20 text-red-300 border-red-500/30 animate-pulse' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'}`}>{forecast.days_to_stockout <= 20 ? '⚠️ AUTO CRITICAL INDENT ESCALATED' : '✓ Stock Levels Stable'}</span>
              </div>
              <div className="mt-3 text-xs text-white/60 flex flex-wrap gap-x-4 gap-y-1">
                <span>Diesel Reserve: <b>{forecast.qty} L</b></span><span>Outside Temp: <b>{forecast.tele?.temp_outside ?? -15}°C</b></span><span>Wind Speed: <b>{forecast.tele?.wind_speed ?? 5} m/s</b></span><span>Physics Burn: <b>{forecast.physics} L/d</b> + Residual: <b>{forecast.residual} L/d</b></span>
              </div>
              <div className="mt-3 h-2 bg-white/10 rounded-full overflow-hidden max-w-[480px]"><div className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500 transition-all duration-500" style={{ width: `${Math.min(100, forecast.days_to_stockout * 2.2)}%` }} /></div>
              <div className="mt-1.5 text-[11px] text-white/40">Physics-informed hybrid inference • Sub-200ms latency on edge tablet</div>
              {snn && (
                <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold border bg-cyan-500/10 text-cyan-300 border-cyan-500/30">
                  <span className={`w-2 h-2 rounded-full ${snn.snn_active ? 'bg-cyan-400 animate-pulse' : 'bg-white/40'}`} />
                  ⚡ SNN {snn.snn_active ? `Active • ${snn.spike_count} spikes • ${snn.snn_residual} L/d` : 'Idle (event-gated)'} • 0.8mW vs 8.2mW ANN ({snn.saved_pct ?? 90}% saved)
                </div>
              )}
            </div>
            <div className="flex sm:flex-row lg:flex-col gap-2 shrink-0">
              <button onClick={() => sendTelemetry({ ts: new Date().toISOString(), station_id: forecast.station_id || 'ST-BHARATI', temp_outside: -15, wind_speed: 5, pressure: 1013, dg_load: 0.7, acoustic_anomaly: 0.1 })} className="flex-1 lg:w-[190px] bg-white/10 hover:bg-white/20 border border-white/10 text-white rounded-xl py-2.5 px-3 text-xs font-bold transition">☀️ Calm Baseline</button>
              <button onClick={() => sendTelemetry({ ts: new Date().toISOString(), station_id: forecast.station_id || 'ST-BHARATI', temp_outside: -38, wind_speed: 22, pressure: 960, dg_load: 0.9, acoustic_anomaly: 0.1 })} className="flex-1 lg:w-[190px] bg-red-600 hover:bg-red-500 text-white rounded-xl py-2.5 px-3 text-xs font-bold transition shadow-md shadow-red-600/30">❄️ Blizzard (42→18d)</button>
              <button onClick={() => sendTelemetry({ ts: new Date().toISOString(), station_id: forecast.station_id || 'ST-BHARATI', temp_outside: -15, wind_speed: 5, pressure: 1013, dg_load: 0.7, acoustic_anomaly: 0.95 })} className="flex-1 lg:w-[190px] bg-amber-600 hover:bg-amber-500 text-white rounded-xl py-2.5 px-3 text-xs font-bold transition shadow-md shadow-amber-600/30">🔊 Bearing Failure</button>
            </div>
          </div>
        </div>
      ) : <div className="card p-5 text-sm text-white/50">Calculating Thermo Hybrid forecast…</div>}
      <div className="grid sm:grid-cols-3 gap-3">
        <button onClick={() => { setInvFilter('CRITICAL'); setTab('inventory'); }} className="card card-hover p-4 text-left group"><div className="text-[11px] font-mono text-red-400 font-bold">CRITICAL ATTENTION</div><div className="mt-1 text-2xl font-bold text-white">{criticalCount} <span className="text-xs font-normal text-white/50">SKUs critically low</span></div><div className="mt-1 text-xs text-white/50">Stock ≤5 units • Tap to inspect</div><div className="mt-2 text-xs font-bold text-blue-400 group-hover:underline">Filter Inventory →</div></button>
        <button onClick={() => { setInvFilter('EXPIRING'); setTab('inventory'); }} className="card card-hover p-4 text-left group"><div className="text-[11px] font-mono text-amber-400 font-bold">EXPIRING &lt;30 DAYS</div><div className="mt-1 text-2xl font-bold text-white">{expiringCount} <span className="text-xs font-normal text-white/50">items expiring soon</span></div><div className="mt-1 text-xs text-white/50">Medical & Food Cold-Chain</div><div className="mt-2 text-xs font-bold text-amber-400 group-hover:underline">Review Cold Chain →</div></button>
        <button onClick={() => setTab('indents')} className="card card-hover p-4 text-left group"><div className="text-[11px] font-mono text-emerald-400 font-bold">ACTIVE INDENTS</div><div className="mt-1 text-2xl font-bold text-white">{openIndents} <span className="text-xs font-normal text-white/50">in pipeline</span></div><div className="mt-1 text-xs text-white/50">DRAFT → APPROVED → DISPATCHED</div><div className="mt-2 text-xs font-bold text-emerald-400 group-hover:underline">Manage Indents →</div></button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <button onClick={() => setTab('scan')} className={`card-raised p-5 flex items-center gap-4 hover:bg-[#18294F] border border-white/10 hover:border-blue-500/40 transition text-left group ${glove ? 'py-7' : ''}`}><div className="w-12 h-12 rounded-2xl bg-blue-600 grid place-items-center text-white shadow-lg shadow-blue-500/30 shrink-0"><Icons.scan /></div><div><div className="font-bold text-base text-white group-hover:text-blue-300">Scan QR / Barcode</div><div className="text-xs text-white/50">Offline camera scan & instant 1-tap consumption</div></div><span className="ml-auto w-8 h-8 rounded-full bg-white/10 group-hover:bg-blue-600 group-hover:text-white grid place-items-center transition">→</span></button>
        <button onClick={() => setTab('indents')} className={`card p-5 flex items-center gap-4 hover:bg-[#18294F] border border-white/10 hover:border-amber-500/40 transition text-left group ${glove ? 'py-7' : ''}`}><div className="w-12 h-12 rounded-2xl bg-amber-500 grid place-items-center text-black font-black text-lg shadow-lg shadow-amber-500/30 shrink-0">!</div><div><div className="font-bold text-base text-white group-hover:text-amber-300">Create Indent</div><div className="text-xs text-white/50">Request emergency supplies • Syncs in &lt;2s</div></div><span className="ml-auto w-8 h-8 rounded-full bg-white/10 group-hover:bg-amber-500 group-hover:text-black grid place-items-center transition">→</span></button>
      </div>
    </div>
  );
}
