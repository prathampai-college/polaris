import { Ship, Thermometer, Timer, Wind } from 'lucide-react';
import { SectionHead } from '../components/chrome';
import { STATIONS, INVENTORY, statusColor, type Station } from '../lib/data';
import { fmt } from '../lib/physics';

type Forecast = { physics: number; residual: number; total: number; days: number; lo: number; hi: number };

export default function Simulator({
  temp, setTemp, wind, setWind, stationIdx, setStationIdx, st, f, critical, bundled,
}: {
  temp: number;
  setTemp: (v: number) => void;
  wind: number;
  setWind: (v: number) => void;
  stationIdx: number;
  setStationIdx: (i: number) => void;
  st: Station;
  f: Forecast;
  critical: boolean;
  bundled: number;
}) {
  return (
    <section id="live-ops" className="mx-auto max-w-[1280px] scroll-mt-24 px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHead kicker="03 — SIMULATOR" title={<>Move the dials.<br />Watch the coverage window move.</>} blurb="This interactive estimate shows how temperature and wind change consumption — and, in turn, days until resupply is due. Values are illustrative." />
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-slate">Station</span>
          <div className="flex border border-structure p-1">
            {STATIONS.map((s, i) => <button key={s.id} onClick={() => setStationIdx(i)} className={`px-3 py-1 font-mono text-xs ${i === stationIdx ? 'bg-ink text-canvas' : 'text-slate'}`}>{s.name}</button>)}
          </div>
        </div>
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-12">
        <div className="border border-structure bg-surface p-4 lg:col-span-4">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[11px] tracking-[0.12em] text-slate">CONDITIONS · {st.id}</div>
            <span className="bg-ink px-2 py-1 text-[10px] font-semibold text-canvas">{st.coord}</span>
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <div className="flex justify-between font-mono text-xs text-slate"><span className="flex items-center gap-1"><Thermometer size={12} /> Outside temperature</span><span className="font-semibold text-ink">{temp}°C</span></div>
              <input type="range" min={-40} max={-8} value={temp} onChange={(e) => setTemp(parseInt(e.target.value))} aria-label="Outside temperature in Celsius" className="mt-2 w-full" />
              <div className="flex justify-between font-mono text-[10px] text-slate"><span>Colder</span><span>Milder</span></div>
            </div>
            <div>
              <div className="flex justify-between font-mono text-xs text-slate"><span className="flex items-center gap-1"><Wind size={12} /> Wind</span><span className="font-semibold text-ink">{wind} m/s</span></div>
              <input type="range" min={2} max={26} value={wind} onChange={(e) => setWind(parseInt(e.target.value))} aria-label="Wind speed in meters per second" className="alert mt-2 w-full" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setTemp(-15); setWind(5); }} className="border border-structure bg-ink py-2.5 text-xs font-semibold text-canvas">Calm conditions</button>
              <button onClick={() => { setTemp(-38); setWind(22); }} className="border border-structure bg-surface py-2.5 text-xs font-semibold text-ink">Severe conditions</button>
            </div>
            <div className="border border-structure bg-canvas p-3 font-mono text-xs leading-5">
              <div className="text-slate">Estimated daily consumption</div>
              <div className="text-ink">{fmt(f.total)} L/day · range {fmt(f.lo, 0)}–{fmt(f.hi, 0)} days</div>
              <div className="text-slate">Illustrative model for demonstration</div>
            </div>
            <div className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium ${critical ? 'bg-flare text-white' : 'border border-structure text-ink'}`}>
              <Timer size={14} />{critical ? 'Coverage is becoming limited — review resupply timing' : `Estimated coverage: ${fmt(f.days)} days`}
            </div>
          </div>
        </div>
        <div className="space-y-5 lg:col-span-8">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="border border-structure bg-ink p-4 text-canvas">
              <div className="font-mono text-[10px] tracking-[0.12em] text-canvas/60">ESTIMATED COVERAGE</div>
              <div className="mt-1 text-[30px] font-black leading-none">{fmt(f.days)} <span className="text-sm font-medium text-canvas/70">days</span></div>
              <div className="text-xs text-canvas/60">Current reserve: {st.dieselL.toLocaleString()} L</div>
              <div className="mt-2 h-1.5 overflow-hidden bg-canvas/20"><div className="h-full bg-cobalt transition-all" style={{ width: `${Math.min(100, (f.days / 42) * 100)}%` }} /></div>
            </div>
            <div className="border border-structure bg-surface p-4">
              <div className="font-mono text-[10px] tracking-[0.12em] text-slate">RESUPPLY</div>
              <div className="mt-2 flex items-center gap-2 text-sm font-medium text-ink"><Ship size={14} className="text-slate" /> Next window · ~14 days</div>
              <div className={`mt-2 inline-flex px-2.5 py-1 text-xs font-medium ${f.days < 14 ? 'bg-flare text-white' : 'border border-structure text-ink'}`}>{f.days < 14 ? 'Review timing' : 'Within current window'}</div>
              <div className="mt-1 font-mono text-[11px] text-slate">Seasonal scheduling</div>
            </div>
            <div className="border border-structure bg-surface p-4">
              <div className="font-mono text-[10px] tracking-[0.12em] text-slate">SYNCHRONIZATION</div>
              <div className="mt-1 text-sm font-medium text-ink">{bundled} updates queued</div>
              <div className="mt-1 text-xs leading-5 text-slate">Held locally and shared when a link is available.</div>
            </div>
          </div>
          <div className="overflow-hidden border border-structure bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-structure px-4 py-3">
              <div className="font-mono text-[11px] tracking-[0.12em] text-slate">INVENTORY · {st.name.toUpperCase()}</div>
              <div className="flex flex-wrap gap-1.5 font-mono text-[10px]"><span className="border border-structure px-2 py-1 text-slate">Illustrative</span></div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="font-mono text-[11px] text-slate"><tr className="border-b border-structure"><th className="px-4 py-2 text-left">Item</th><th className="text-left">Location</th><th className="text-right">Quantity</th><th className="pl-4 text-left">Status</th></tr></thead>
                <tbody className="font-mono text-xs">
                  {INVENTORY.slice(0, 5).map((r) => (
                    <tr key={r.sku} className="border-b border-structure/40 hover:bg-canvas">
                      <td className="px-4 py-2.5 text-ink">{r.sku}</td><td className="text-slate">{r.crate}</td><td className="text-right text-ink">{r.qty.toLocaleString()} {r.unit}</td><td className={`pl-4 ${statusColor(r.status)}`}>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 font-mono text-[11px] text-slate">Sample data for demonstration · quantities and locations are illustrative</div>
          </div>
        </div>
      </div>
    </section>
  );
}
