import { motion } from 'motion/react';
import { ShieldCheck } from 'lucide-react';
import { SectionHead } from '../components/chrome';

export default function Context() {
  return (
    <section className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6 sm:py-14">
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SectionHead kicker="01 — THE SURVIVAL EQUATION"
            title={<>Reserves ÷ burn rate<br /><span className="italic text-ink/70">= days until failure.</span></>}
            blurb="Every station runs that calculation, whether the software helps or not. Conventional logistics platforms assume stable connectivity, accurate positioning and continuous power — polar stations guarantee none of it. POLARIS is built around the constraint, not around the assumption." />
          <div className="mt-6 grid grid-cols-1 gap-3">
            {[
              ['Positioning holds when GPS doesn’t', 'Local sensor fusion keeps coordinates accurate when satellite navigation degrades in whiteout or high-latitude conditions.'],
              ['Built for links that drop for hours', 'Compact, incremental synchronization keeps stations coordinated on 20–50 kbps Iridium links that come and go.'],
              ['Spends energy only when it matters', 'Forecasting runs event-gated inference, computing only when conditions actually change.'],
            ].map(([h, p]) => (
              <motion.div key={h} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                className="border border-structure bg-surface p-4">
                <div className="text-sm font-semibold text-ink">{h}</div>
                <div className="mt-1 text-[13px] leading-5 text-slate">{p}</div>
              </motion.div>
            ))}
          </div>
        </div>
        <div className="lg:col-span-7">
          <div className="overflow-hidden border border-structure bg-surface">
            <div className="grid grid-cols-3 divide-x divide-structure">
              {[
                ['PAYLOAD SIZE', '1.1 KB', 'compact updates'],
                ['RECONNECT', '<2 s', 'after outage'],
                ['INTEGRITY', 'Verified', 'no duplication'],
              ].map(([l, v, s]) => (
                <div key={l} className="p-4 text-center">
                  <div className="font-mono text-[10px] tracking-[0.12em] text-slate">{l}</div>
                  <div className="mt-1 text-[22px] font-black text-ink">{v}</div>
                  <div className="text-[11px] text-slate">{s}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-3 border-t border-structure p-4 text-sm sm:grid-cols-2">
              <div className="border border-structure bg-canvas p-3">
                <div className="font-mono text-[11px] tracking-[0.08em] text-slate">SYNCHRONIZATION</div>
                <div className="mt-1 text-sm font-medium text-ink">Incremental updates, not full transfers</div>
                <div className="mt-1 text-xs leading-5 text-slate">Only what changed is shared. Each update is verified and applied once, keeping stations aligned without excess bandwidth.</div>
              </div>
              <div className="border border-structure bg-ink p-3 text-canvas">
                <div className="font-mono text-[11px] tracking-[0.1em] text-canvas/60">ACCOUNTABILITY</div>
                <div className="mt-1 text-sm font-semibold">Complete record of every change</div>
                <div className="text-xs leading-5 text-canvas/70">A consistent audit trail supports review and handover across rotations.</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 px-4 pb-4 font-mono text-[11px]">
              <span className="border border-structure px-3 py-1.5 text-slate">Works offline by default</span>
              <span className="border border-structure px-3 py-1.5 text-slate">Coordinated across stations</span>
              <span className="bg-ink px-3 py-1.5 font-semibold text-canvas">Supports multiple stations</span>
            </div>
          </div>
          <div className="mt-3 flex items-start gap-3 border border-structure bg-surface p-3">
            <ShieldCheck className="mt-0.5 shrink-0 text-cobalt" size={16} />
            <div className="text-[13px] leading-5 text-slate">With resupply windows measured in weeks, early and reliable forecasting is essential. The system surfaces risk well in advance, even while offline.</div>
          </div>
        </div>
      </div>
    </section>
  );
}
