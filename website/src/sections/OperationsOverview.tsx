import { motion } from 'motion/react';
import { Activity, Anchor, Boxes, Layers } from 'lucide-react';
import { SectionHead } from '../components/chrome';
import BurnChart from '../components/canvas/BurnChart';
import { STATIONS } from '../lib/data';
import { thermoHybrid, fmt } from '../lib/physics';

type Forecast = { physics: number; residual: number; total: number; days: number; lo: number; hi: number };

export default function OperationsOverview({
  f, temp, wind, critical, stationIdx, setStationIdx,
}: {
  f: Forecast;
  temp: number;
  wind: number;
  critical: boolean;
  stationIdx: number;
  setStationIdx: (i: number) => void;
}) {
  return (
    <section id="hq" className="mx-auto max-w-[1280px] scroll-mt-24 px-4 py-10 sm:px-6 sm:py-14">
      <SectionHead kicker="05 — OPERATIONS & COVERAGE"
        title={<>One shared view,<br /><span className="italic text-ink/70">consistent for every station.</span></>}
        blurb="Operations sees a consolidated picture of inventory, requests and per-station coverage — comparable at a glance, and coherent even when a station's data is delayed." />

      <div className="mt-8 overflow-hidden border border-structure bg-surface">
        <div className="flex items-center justify-between border-b border-structure px-4 py-3">
          <div className="flex gap-1.5">{['Overview', 'Forecast', 'Inventory', 'Requests', 'Trends', 'Planning', 'History'].map((t, i) => <span key={t} className={`hidden px-3 py-1.5 font-mono text-[11px] sm:inline ${i === 1 ? 'bg-ink font-semibold text-canvas' : 'text-slate'}`}>{t}</span>)}</div>
          <span className="inline-flex items-center gap-1.5 border border-structure px-2.5 py-1 font-mono text-[11px] text-slate">Live when available</span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-5">
          {[
            ['Stations', '3', 'Bharati · Maitri · Himadri'],
            ['Tracked items', '20', 'Across categories'],
            ['Requiring attention', '3', 'Based on thresholds'],
            ['Active requests', '7', 'Across lifecycle'],
            ['Expiring soon', '2', 'Within 30 days'],
          ].map(([k, v, s]) => (
            <div key={k} className="border border-structure bg-canvas p-3 text-center">
              <div className="font-mono text-[10px] tracking-[0.1em] text-slate">{k}</div>
              <div className="text-xl font-semibold text-ink">{v}</div>
              <div className="font-mono text-[10px] text-slate">{s}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-end justify-between gap-4">
        <div className="font-mono text-[11px] tracking-[0.12em] text-slate">PER-STATION COVERAGE · select to forecast below</div>
        <div className="font-mono text-xs text-slate">Illustrative figures</div>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        {STATIONS.map((s, i) => {
          const sf = i === stationIdx ? f : thermoHybrid(s.crew % 2 ? -26 : -18, s.crew % 3 ? 11 : 4, true, s.dieselL);
          return (
            <motion.button key={s.id} onClick={() => setStationIdx(i)} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className={`border p-4 text-left ${i === stationIdx ? 'border-cobalt bg-surface' : 'border-structure bg-surface hover:border-cobalt/50'}`}>
              <div className="flex items-center justify-between">
                <div className="font-mono text-[11px] tracking-[0.12em] text-slate">{s.id}</div>
                <span className="border border-structure px-2 py-1 font-mono text-[11px] text-slate">Crew {s.crew}</span>
              </div>
              <div className="mt-2 text-[20px] font-semibold text-ink">{s.name} <span className="font-mono text-xs font-normal text-slate">{s.coord}</span></div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="bg-ink py-2 text-canvas"><div className="font-mono text-[11px] text-canvas/60">Fuel</div><div className="text-sm font-semibold">{s.dieselL.toLocaleString()} L</div></div>
                <div className="border border-structure py-2"><div className="font-mono text-[11px] text-slate">Oxygen</div><div className="text-sm font-medium text-ink">{s.oxygenCyl} cyl</div></div>
                <div className="border border-structure py-2"><div className="font-mono text-[11px] text-slate">Spares</div><div className="text-sm font-medium text-ink">{s.bearings} pcs</div></div>
              </div>
              <div className="mt-3 flex items-center gap-2 font-mono text-xs">
                <span className="inline-flex items-center gap-1 border border-structure px-2 py-1 text-slate"><Activity size={12} />{fmt(sf.days)} days</span>
                <span className={`ml-auto px-2.5 py-1 text-xs font-medium ${sf.days < 20 ? 'bg-flare text-white' : 'border border-structure text-slate'}`}>{sf.days < 20 ? 'Review' : 'Adequate'}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden bg-structure/10"><div className="h-full bg-cobalt transition-all" style={{ width: `${Math.min(100, (sf.days / 42) * 100)}%` }} /></div>
            </motion.button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="border border-structure bg-ink p-4 text-canvas">
          <div className="font-mono text-[10px] tracking-[0.12em] text-canvas/60">CONSUMPTION OUTLOOK · {STATIONS[stationIdx].name.toUpperCase()}</div>
          <div className="mt-1 text-[22px] font-semibold">Estimated {fmt(f.total)} L/day · {fmt(f.days)} days coverage</div>
          <BurnChart temp={temp} wind={wind} critical={critical} />
          <div className="mt-1 font-mono text-[11px] text-canvas/60">Range {fmt(f.lo, 0)}–{fmt(f.hi, 0)} days · illustrative estimate</div>
        </div>
        <div className="border border-structure bg-canvas p-4">
          <div className="font-mono text-[10px] tracking-[0.12em] text-slate">RESUPPLY PLANNING</div>
          {[['Diesel', '850 L', 'Estimated need'], ['Oxygen', '6 cyl', 'Estimated need'], ['Bearings', '4 pcs', 'Recommended']].map(([item, qty, note]) => (
            <div key={item} className="mt-2 flex items-center justify-between border border-structure bg-surface px-3 py-2.5">
              <span className="text-sm text-ink">{item} · {qty}</span>
              <span className="font-mono text-[11px] text-slate">{note}</span>
            </div>
          ))}
          <div className="mt-2 font-mono text-[11px] text-slate">Planning is based on current reserve and forecast</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border border-structure bg-surface p-4 font-mono text-xs text-slate">
        <span className="inline-flex items-center gap-1.5 bg-ink px-3 py-1.5 font-medium text-canvas"><Boxes size={12} /> Storage areas</span>
        <span className="inline-flex items-center gap-1.5 border border-structure px-3 py-1.5"><Layers size={12} /> Inventory categories</span>
        <span className="inline-flex items-center gap-1.5 border border-structure px-3 py-1.5"><Anchor size={12} /> Resupply coordination</span>
        <span className="w-full text-slate sm:ml-auto sm:w-auto">All stations share the same coordination model</span>
      </div>
    </section>
  );
}
