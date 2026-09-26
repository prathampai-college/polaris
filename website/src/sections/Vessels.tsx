import { motion } from 'motion/react';
import { Ship } from 'lucide-react';
import { SectionHead } from '../components/chrome';
import { VESSELS } from '../lib/data';

/**
 * A shared ETA ruler beats three disconnected per-vessel mini-diagrams:
 * one glance answers "which vessel arrives first, and how far apart are they."
 * All markers sit uniformly above the axis (own connector down to it) so
 * nothing overlaps the tick labels below or the cards underneath.
 */
export default function Vessels() {
  const maxEta = Math.ceil(Math.max(...VESSELS.map((v) => v.etaH)) / 24) * 24;
  const ticks = Array.from({ length: maxEta / 24 + 1 }, (_, i) => i * 24);

  return (
    <section id="vessels" className="border-y border-structure bg-canvas">
      <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6 sm:py-14">
        <SectionHead kicker="06 — RESUPPLY COORDINATION" title={<>Align supply<br /><span className="italic text-ink/70">with operational need.</span></>} blurb="All scheduled vessels on one timeline, so relative timing is obvious at a glance — even when live tracking is temporarily unavailable." />

        <div className="mt-8 overflow-x-auto border border-structure bg-surface">
          <div className="min-w-[600px] px-12 pb-8 pt-32 sm:px-20">
            <div className="relative h-px bg-structure/40">
              <div className="absolute -left-1 -top-1.5 h-3 w-[3px] bg-ink" />
              <div className="absolute -top-7 left-0 -translate-x-1/2 font-mono text-[10px] tracking-[0.08em] text-ink">NOW</div>

              {ticks.map((t) => (
                <div key={t} className="absolute top-0 -translate-x-1/2" style={{ left: `${(t / maxEta) * 100}%` }}>
                  <div className="h-2 w-px bg-structure/50" />
                  <div className="mt-1.5 whitespace-nowrap font-mono text-[10px] text-slate">{t}h</div>
                </div>
              ))}

              {VESSELS.map((v, i) => {
                const pct = (v.etaH / maxEta) * 100;
                const urgent = v.etaH <= 24;
                return (
                  <motion.div
                    key={v.imo}
                    initial={{ opacity: 0, y: -6 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08 }}
                    className="absolute -top-[104px] flex -translate-x-1/2 flex-col items-center"
                    style={{ left: `${pct}%` }}
                  >
                    <div className={`whitespace-nowrap border px-2 py-1 font-mono text-[10px] ${urgent ? 'border-flare bg-flare text-white' : 'border-structure bg-ink text-canvas'}`}>{v.name}</div>
                    <div className={`mt-1 grid h-7 w-7 place-items-center border-2 ${urgent ? 'border-flare' : 'border-cobalt'} bg-canvas`}>
                      <Ship size={13} className={urgent ? 'text-flare' : 'text-cobalt'} />
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-slate">ETA {v.etaH}h</div>
                    <div className="mt-1.5 h-4 w-px bg-structure/40" />
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {VESSELS.map((v) => (
            <div key={v.imo} className="flex items-center justify-between border border-structure bg-surface px-4 py-3 font-mono text-[11px]">
              <span className="text-ink">{v.name} <span className="text-slate">· IMO {v.imo}</span></span>
              <span className="text-slate">{v.sog} kn</span>
            </div>
          ))}
        </div>
        <div className="mt-3 font-mono text-[11px] text-slate">Timings are estimates for planning purposes · illustrative schedule</div>
      </div>
    </section>
  );
}
