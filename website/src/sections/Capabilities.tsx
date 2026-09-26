import { motion } from 'motion/react';
import LidarCanvas from '../components/canvas/LidarCanvas';
import SnnCanvas from '../components/canvas/SnnCanvas';
import DtnFlow from '../components/DtnFlow';
import { SectionHead } from '../components/chrome';

export default function Capabilities({
  whiteout, setWhiteout, snnActive, setSnnActive, bundled, setBundled,
}: {
  whiteout: boolean;
  setWhiteout: (v: boolean | ((v: boolean) => boolean)) => void;
  snnActive: boolean;
  setSnnActive: (v: boolean | ((v: boolean) => boolean)) => void;
  bundled: number;
  setBundled: (v: number | ((v: number) => number)) => void;
}) {
  return (
    <section id="pillars" className="border-t border-structure bg-canvas">
      <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHead kicker="02 — CAPABILITIES"
            title={<>Three constraints,<br />one system built around all of them.</>} />
          <div className="max-w-[44ch] text-sm leading-6 text-slate">Positioning, energy and connectivity each fail differently at −40°C. Each capability answers one of those failures, inside the same platform.</div>
        </div>
        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="overflow-hidden border border-structure bg-surface">
            <div className="p-5">
              <div className="font-mono text-[11px] tracking-[0.12em] text-slate">01 · POSITIONING</div>
              <h3 className="mt-3 text-[18px] font-bold leading-tight text-ink">Reliable tracking<br /><span className="font-medium text-slate">when GPS goes dark.</span></h3>
              <p className="mt-2 text-[13px] leading-5 text-slate">Local sensing holds position estimates at sub-meter accuracy when satellite navigation is unavailable. Whiteout doesn't change that.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setWhiteout((v) => !v)} className={`border px-3 py-1.5 font-mono text-xs ${whiteout ? 'border-flare bg-flare text-white' : 'border-structure bg-surface text-slate'}`}>{whiteout ? 'Limited visibility' : 'Standard conditions'}</button>
                <span className="border border-structure bg-surface px-3 py-1.5 font-mono text-xs text-slate">Interactive demo</span>
              </div>
            </div>
            <div className="px-3 pb-3"><LidarCanvas whiteout={whiteout} /></div>
            <div className="px-5 pb-4 font-mono text-[11px] text-slate">Illustrative sensor fusion · simulated data for demonstration</div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.06 }}
            className="overflow-hidden border border-structure bg-surface">
            <div className="p-5">
              <div className="font-mono text-[11px] tracking-[0.12em] text-slate">02 · FORECASTING</div>
              <h3 className="mt-3 text-[18px] font-bold leading-tight text-ink">Forecasting that<br /><span className="font-medium text-slate">respects the power budget.</span></h3>
              <p className="mt-2 text-[13px] leading-5 text-slate">Consumption is estimated from environmental and operational inputs. Inference runs only when something meaningfully changes.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setSnnActive((v) => !v)} className={`px-3 py-1.5 text-xs font-semibold ${snnActive ? 'bg-ink text-canvas' : 'border border-structure text-ink'}`}>{snnActive ? 'Adaptive mode' : 'Conservative mode'}</button>
                <span className="border border-structure bg-surface px-3 py-1.5 font-mono text-xs text-slate">Energy-aware</span>
              </div>
            </div>
            <div className="px-3 pb-3"><SnnCanvas active={snnActive} /></div>
            <div className="px-5 pb-4 font-mono text-[11px] text-slate">Conceptual model · illustrates adaptive inference</div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.12 }}
            className="overflow-hidden border border-structure bg-surface">
            <div className="p-5">
              <div className="font-mono text-[11px] tracking-[0.12em] text-slate">03 · CONNECTIVITY</div>
              <h3 className="mt-3 text-[18px] font-bold leading-tight text-ink">Stay coordinated<br /><span className="font-medium text-slate">even fully disconnected.</span></h3>
              <p className="mt-2 text-[13px] leading-5 text-slate">Updates are held locally and shared opportunistically — over a link or by hand — with deterministic reconciliation on reconnect.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setBundled((b) => Math.min(8, b + 1))} className="bg-ink px-3 py-1.5 text-xs font-semibold text-canvas">Add update</button>
                <button onClick={() => setBundled((b) => Math.max(1, b - 1))} className="border border-structure bg-surface px-3 py-1.5 font-mono text-xs text-slate">Remove</button>
              </div>
            </div>
            <div className="px-3 pb-3"><DtnFlow bundled={bundled} /></div>
            <div className="px-5 pb-4 font-mono text-[11px] text-slate">Illustrative transfer flow · opportunistic synchronization</div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
