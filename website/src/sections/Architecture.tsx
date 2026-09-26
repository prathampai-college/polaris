import { Satellite, ShieldCheck, Workflow } from 'lucide-react';
import { SectionHead } from '../components/chrome';

export default function Architecture() {
  return (
    <section id="architecture" className="mx-auto max-w-[1280px] scroll-mt-24 px-4 py-10 sm:px-6 sm:py-14">
      <div className="grid items-start gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SectionHead kicker="07 — SYSTEM" title={<>Runs without<br /><span className="italic text-ink/70">continuous connectivity.</span></>}
            blurb="Field and operations share a consistent data model. The system runs self-contained, with synchronization applied whenever a link allows." />
          <div className="mt-5 space-y-2 font-mono text-xs leading-5">
            {[
              ['Field', 'Focused interface for station use, with local storage and straightforward workflows.'],
              ['Gateway', 'Handles exchange between field and operations, managing intermittent links.'],
              ['Operations', 'Consolidated view for planning, review and coordination across stations.'],
              ['Approach', 'Shared definitions and a single coordination point support consistency.'],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3 border border-structure bg-surface px-3 py-2.5"><span className="shrink-0 font-semibold text-ink">{k}</span><span className="text-slate">{v}</span></div>
            ))}
          </div>
        </div>
        <div className="border border-structure bg-surface p-4 lg:col-span-7">
          <div className="overflow-hidden border border-structure bg-canvas p-3">
            <div className="flex items-center justify-between font-mono text-[11px] text-slate"><span className="flex items-center gap-1.5"><Workflow size={12} /> FIELD — LINK — OPERATIONS</span><span className="border border-structure px-2 py-0.5 text-slate">Intermittent</span></div>
            <div className="mt-3 grid grid-cols-1 gap-2 font-mono text-[11px] sm:grid-cols-3">
              <div className="border border-structure bg-ink p-3 text-canvas"><div className="font-semibold">Field</div><div className="text-canvas/60">Local-first</div><div className="mt-2 bg-cobalt px-2 py-1 text-xs text-white">Updates queued</div></div>
              <div className="border border-structure bg-surface p-3 text-ink"><div className="flex items-center gap-1 font-semibold"><Satellite size={12} /> Link</div><div className="text-slate">When available</div><div className="mt-2 border border-structure px-2 py-1 text-center text-xs text-ink">Shared when possible</div></div>
              <div className="border border-structure bg-ink p-3 text-canvas"><div className="font-semibold">Operations</div><div className="text-canvas/60">Consolidated</div><div className="mt-2 bg-cobalt px-2 py-1 text-xs text-white">View reconciled</div></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[10px]"><span className="border border-structure px-2 py-1 text-slate">Local storage</span><span className="border border-structure px-2 py-1 text-slate">Queued updates</span><span className="border border-structure px-2 py-1 text-slate">Coordinated state</span></div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="border border-structure bg-canvas py-3"><div className="font-mono text-[11px] text-slate">Stations</div><div className="text-lg font-semibold text-ink">3</div><div className="font-mono text-[11px] text-slate">Supported</div></div>
            <div className="border border-structure bg-canvas py-3"><div className="font-mono text-[11px] text-slate">Locations</div><div className="text-lg font-semibold text-ink">12</div><div className="font-mono text-[11px] text-slate">Storage areas</div></div>
            <div className="border border-structure bg-canvas py-3"><div className="font-mono text-[11px] text-slate">Categories</div><div className="text-lg font-semibold text-ink">Multiple</div><div className="font-mono text-[11px] text-slate">Item types</div></div>
          </div>
          <div className="mt-3 flex items-center gap-2 border border-structure bg-surface p-3 text-xs leading-5 text-slate"><ShieldCheck size={14} className="shrink-0 text-cobalt" />A shared structure underpins both field and operations views — including inventory, requests and position data.</div>
        </div>
      </div>
    </section>
  );
}
