import { ArrowUpRight, MapPin } from 'lucide-react';
import type { Station } from '../lib/data';

export default function Cta({ st }: { st: Station }) {
  return (
    <section className="relative overflow-hidden bg-canvas">
      <div className="tickgrid absolute inset-0 opacity-60" />
      <div className="relative mx-auto max-w-[1280px] px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-col items-start justify-between gap-6 border border-structure bg-surface p-6 shadow-panel sm:p-8 lg:flex-row lg:items-center">
          <div>
            <div className="font-mono text-[11px] tracking-[0.16em] text-slate">DEPLOYMENT</div>
            <h3 className="mt-2 font-display text-[30px] leading-none tracking-[-0.03em] text-ink sm:text-[40px]">Ready for extended operation.</h3>
            <p className="mt-2 max-w-[60ch] text-sm leading-6 text-slate">A self-contained setup for evaluation. Field, gateway and operations components run together, with synchronization reflecting real deployment behavior.</p>
            <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-xs">
              <span className="inline-flex items-center gap-1.5 bg-ink px-3 py-1.5 font-medium text-canvas"><MapPin size={12} /> {st.name} · {st.coord}</span>
              <span className="border border-structure px-3 py-1.5 text-slate">Self-contained deployment</span>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 lg:w-auto">
            <a href="#top" className="inline-flex items-center justify-center gap-2 border border-structure bg-cobalt px-6 py-3 text-sm font-semibold text-white hover:bg-structure">Back to top <ArrowUpRight size={14} /></a>
            <a href="#live-ops" className="inline-flex items-center justify-center gap-2 border border-structure bg-surface px-6 py-3 text-sm font-medium text-ink hover:bg-structure hover:text-canvas">Try the simulator</a>
            <div className="text-center font-mono text-[11px] text-slate">No external services required</div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate">
          <span>SIH26062</span><span>Built for Bharati, Maitri and Himadri</span>
        </div>
      </div>
    </section>
  );
}
