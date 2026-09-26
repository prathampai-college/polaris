import { SectionHead } from '../components/chrome';
import { API_ROUTES, type Station } from '../lib/data';
import { fmt } from '../lib/physics';

type Forecast = { physics: number; residual: number; total: number; days: number; lo: number; hi: number };

export default function ApiExplorer({
  apiQ, setApiQ, apiSel, setApiSel, st, f, snnActive,
}: {
  apiQ: string;
  setApiQ: (v: string) => void;
  apiSel: number;
  setApiSel: (i: number) => void;
  st: Station;
  f: Forecast;
  snnActive: boolean;
}) {
  const apiFiltered = API_ROUTES.filter((r) => (r.method + ' ' + r.path + ' ' + r.note).toLowerCase().includes(apiQ.toLowerCase()));
  const sel = API_ROUTES[apiSel];
  return (
    <section id="api" className="border-y border-structure bg-canvas">
      <div className="mx-auto max-w-[1280px] scroll-mt-24 px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHead kicker="08 — INTERFACE" title={<>Integrate without<br /><span className="italic text-ink/70">added complexity.</span></>} blurb="A documented HTTP interface covers core operations. Responses are versioned to support reliable synchronization." />
          <input value={apiQ} onChange={(e) => setApiQ(e.target.value)} placeholder="Filter — e.g. inventory" className="w-full max-w-[260px] border border-structure bg-surface px-4 py-2 font-mono text-xs text-ink placeholder:text-slate/60 focus:outline-none focus:ring-1 focus:ring-cobalt" />
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="overflow-hidden border border-structure">
            {apiFiltered.map((r) => (
              <button key={r.path} onClick={() => setApiSel(API_ROUTES.indexOf(r))} className={`flex w-full items-center gap-3 border-b border-structure/60 px-4 py-2.5 text-left font-mono text-xs ${API_ROUTES.indexOf(r) === apiSel ? 'bg-canvas' : 'bg-surface hover:bg-canvas'}`}>
                <span className={`px-1.5 py-0.5 text-[10px] font-semibold ${r.method === 'GET' ? 'bg-ink text-canvas' : 'bg-cobalt text-white'}`}>{r.method}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{r.path}</span>
                <span className="ml-auto hidden text-slate sm:inline">{r.note}</span>
              </button>
            ))}
            {apiFiltered.length === 0 && <div className="bg-surface px-4 py-6 font-mono text-xs text-slate">No routes match &ldquo;{apiQ}&rdquo;.</div>}
          </div>
          <div className="border border-structure bg-ink p-4 font-mono text-xs leading-5 text-canvas">
            <div className="flex items-center justify-between text-canvas/60"><span>{sel.method} {sel.path}</span><span className="bg-cobalt px-2 py-0.5 font-semibold text-white">Example</span></div>
            <pre className="mt-3 overflow-x-auto text-canvas/80">$ curl $HQ{sel.path}{sel.method === 'POST' ? " -H 'Authorization: Bearer $TOKEN'" : ''}</pre>
            <pre className="mt-2 overflow-x-auto border border-white/10 bg-white/[0.03] p-3 text-canvas/80">{sel.path.includes('forecast/snn')
              ? `{\n  "quantity": ${st.dieselL},\n  "estimate_per_day": ${fmt(f.total)},\n  "days_remaining": ${fmt(f.days)},\n  "mode": "${snnActive ? 'adaptive' : 'conservative'}"\n}`
              : sel.path.includes('forecast')
                ? `{\n  "quantity": ${st.dieselL},\n  "estimate_per_day": ${fmt(f.total)},\n  "days_remaining": ${fmt(f.days)},\n  "range": [${fmt(f.lo, 0)}, ${fmt(f.hi, 0)}]\n}`
                : sel.path.includes('vessels')
                  ? `[{ "name": "SAGAR NIDHI",\n   "eta": "~14h",\n   "status": "scheduled" }]`
                  : `{\n  "station": "${st.id}",\n  "status": "recorded",\n  "version": "3.1.2"\n}`}</pre>
            <div className="mt-2 text-[11px] text-canvas/50">Illustrative response · structure matches the implemented API</div>
          </div>
        </div>
      </div>
    </section>
  );
}
