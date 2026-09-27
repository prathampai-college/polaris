'use client';
import React, { useState } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';

// Chart theme — Polaris Expedition Palette. Keep in sync with website/src/lib/tokens.ts.
const COBALT = '#0047FF';
const PHOSPHOR = '#00C2FF';
const FLARE = '#FF4800';
const STRUCTURE = '#101928';
const SLATE = '#5B6776';

export function TrendChart({
  data = [],
  unit = 'L',
  stationName = 'Bharati',
}: {
  data: any[];
  unit?: string;
  stationName?: string;
}) {
  const [metric, setMetric] = useState<'fuel' | 'temp' | 'load'>('fuel');

  // Only render fields the backend actually sent — a chart drawing a plausible-looking
  // fake curve for missing data is worse than an honest empty state.
  const chartData = React.useMemo(() => {
    return data
      .filter((d) => d.qty != null || d.avg_temp != null || d.temp_outside != null || d.avg_load != null || d.dg_load != null)
      .map((d, i) => ({
        day: d.day ? String(d.day).slice(-5) : `D-${data.length - 1 - i}`,
        qty: d.qty != null ? Number(d.qty) : null,
        forecast: d.forecast != null ? Number(d.forecast) : null,
        avg_temp: d.avg_temp != null ? Number(d.avg_temp) : d.temp_outside != null ? Number(d.temp_outside) : null,
        avg_load: d.avg_load != null ? Math.round(Number(d.avg_load) * 100) : d.dg_load != null ? Math.round(Number(d.dg_load) * 100) : null,
      }));
  }, [data]);

  const metricHasData = metric === 'fuel' ? chartData.some((d) => d.qty != null) : metric === 'temp' ? chartData.some((d) => d.avg_temp != null) : chartData.some((d) => d.avg_load != null);

  return (
    <div className="w-full border border-structure bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs font-bold text-ink flex items-center gap-2">
            <span>Telemetry Trends — {stationName}</span>
            <span className="border border-structure bg-canvas px-2 py-0.5 font-mono text-[10px] text-slate">TimescaleDB</span>
          </div>
          <div className="text-[11px] text-slate mt-0.5">
            {metric === 'fuel' ? 'Diesel fuel consumption & stockout forecast' : metric === 'temp' ? 'Ambient polar temperature' : 'Diesel generator (DG) electrical load (%)'}
          </div>
        </div>

        <div className="flex items-center gap-1 border border-structure p-1">
          {(['fuel', 'temp', 'load'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-2.5 py-1 font-mono text-xs font-semibold transition ${metric === m ? 'bg-ink text-canvas' : 'text-slate hover:text-ink'}`}
            >
              {m === 'fuel' ? `Fuel (${unit})` : m === 'temp' ? 'Weather (°C)' : 'DG Load (%)'}
            </button>
          ))}
        </div>
      </div>

      {!metricHasData ? (
        <div className="w-full h-48 sm:h-52 grid place-items-center border border-dashed border-structure/40 bg-canvas">
          <div className="text-center space-y-1">
            <div className="text-xs font-bold text-ink">No telemetry yet for this metric</div>
            <div className="text-[11px] text-slate">Post telemetry via HQ — telemetry poller or field tablet</div>
          </div>
        </div>
      ) : (
        <div className="w-full h-48 sm:h-52">
          <ResponsiveContainer width="100%" height="100%">
            {metric === 'fuel' ? (
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="fuelGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COBALT} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={COBALT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(16,25,40,0.08)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: SLATE }} />
                <YAxis tick={{ fontSize: 11, fill: SLATE }} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ backgroundColor: STRUCTURE, border: 'none', borderRadius: 0, fontSize: '12px', color: '#fff' }} formatter={(value: any, name: any) => [`${value} ${unit}`, name === 'qty' ? 'Actual stock' : 'Predicted curve']} />
                <Area type="monotone" dataKey="qty" stroke={COBALT} strokeWidth={2.5} fillOpacity={1} fill="url(#fuelGrad)" connectNulls />
                <Line type="monotone" dataKey="forecast" stroke={FLARE} strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls />
                <ReferenceLine y={1200} stroke={FLARE} strokeDasharray="3 3" label={{ value: 'CRITICAL (1200L)', fill: FLARE, fontSize: 10, position: 'insideTopLeft' }} />
              </AreaChart>
            ) : metric === 'temp' ? (
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(16,25,40,0.08)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: SLATE }} />
                <YAxis tick={{ fontSize: 11, fill: SLATE }} domain={[-45, 0]} />
                <Tooltip contentStyle={{ backgroundColor: STRUCTURE, border: 'none', borderRadius: 0, fontSize: '12px', color: '#fff' }} formatter={(value: any) => [`${value}°C`, 'Outside temp']} />
                <ReferenceLine y={-30} stroke={FLARE} strokeDasharray="3 3" label={{ value: 'BLIZZARD (-30°C)', fill: FLARE, fontSize: 10, position: 'insideBottomLeft' }} />
                <Line type="monotone" dataKey="avg_temp" stroke={PHOSPHOR} strokeWidth={2.5} dot={{ r: 3, fill: PHOSPHOR }} activeDot={{ r: 5 }} connectNulls />
              </LineChart>
            ) : (
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="loadGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={FLARE} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={FLARE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(16,25,40,0.08)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: SLATE }} />
                <YAxis tick={{ fontSize: 11, fill: SLATE }} domain={[0, 100]} />
                <Tooltip contentStyle={{ backgroundColor: STRUCTURE, border: 'none', borderRadius: 0, fontSize: '12px', color: '#fff' }} formatter={(value: any) => [`${value}%`, 'DG generator load']} />
                <ReferenceLine y={85} stroke={FLARE} strokeDasharray="3 3" label={{ value: 'OVERLOAD (85%)', fill: FLARE, fontSize: 10, position: 'insideTopLeft' }} />
                <Area type="monotone" dataKey="avg_load" stroke={FLARE} strokeWidth={2.5} fillOpacity={1} fill="url(#loadGrad)" connectNulls />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-slate pt-1 border-t border-structure/30">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-cobalt" /> Actual level</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-flare" /> Forecast burn</span>
        </div>
        <div className="mono text-ink/70">{data.length ? 'Live full-duplex stream' : 'No data'}</div>
      </div>
    </div>
  );
}

export function ProcurementTable({
  rows = [],
  onCreateIndent,
}: {
  rows: { sku: string; name: string; need: number; unit: string; eta: string; cost: string }[];
  onCreateIndent?: (sku: string, need: number) => void;
}) {
  const totalCost = rows.reduce((sum, r) => {
    const num = parseFloat(r.cost?.replace(/[^\d.]/g, '') || '0');
    return sum + (isNaN(num) ? 0 : num);
  }, 0);

  return (
    <div className="w-full border border-structure bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-ink flex items-center gap-2">
            <span>Pre-winter resupply needs</span>
            <span className="border border-flare/30 bg-flare/10 px-2 py-0.5 font-mono text-[10px] font-bold text-flare">{rows.length} shortfalls</span>
          </div>
          <div className="text-[11px] text-slate mt-0.5">Estimated pre-freeze resupply budget: ₹{totalCost.toFixed(1)} lakhs</div>
        </div>
      </div>

      <div className="overflow-x-auto scroll-thin">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-structure text-slate text-left">
              <th className="py-2 px-2">SKU & item</th>
              <th className="py-2 px-2 text-center">Shortfall</th>
              <th className="py-2 px-2 text-center">Deadline</th>
              <th className="py-2 px-2 text-center">Est. cost</th>
              <th className="py-2 px-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku} className="border-b border-structure/20 hover:bg-canvas transition">
                <td className="py-2.5 px-2">
                  <div className="font-mono font-bold text-ink text-xs">{r.sku}</div>
                  <div className="text-[11px] text-slate">{r.name}</div>
                </td>
                <td className="py-2.5 px-2 text-center">
                  <span className="border border-amber-300 bg-amber-50 px-2 py-0.5 font-bold text-amber-700">+{r.need} {r.unit}</span>
                </td>
                <td className="py-2.5 px-2 text-center text-slate text-[11px]">{r.eta}</td>
                <td className="py-2.5 px-2 text-center font-mono font-semibold text-ink">{r.cost}</td>
                <td className="py-2.5 px-2 text-right">
                  {onCreateIndent ? (
                    <button onClick={() => onCreateIndent(r.sku, r.need)} className="border border-structure bg-cobalt px-3 py-1 font-semibold text-white text-xs hover:bg-structure">
                      Indent →
                    </button>
                  ) : (
                    <span className="text-[11px] font-semibold text-cobalt">Priority 1</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate text-xs">All station inventory is within safe seasonal buffer targets.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
