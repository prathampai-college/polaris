import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { STATIONS } from '../lib/data';

const LINKS: [string, string][] = [
  ['Capabilities', '#pillars'],
  ['Simulator', '#live-ops'],
  ['Field', '#field'],
  ['Operations', '#hq'],
  ['Logistics', '#vessels'],
  ['API', '#api'],
  ['System', '#architecture'],
];

export function Nav({ stationIdx, setStationIdx }: { stationIdx: number; setStationIdx: (i: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-40 border-b border-structure bg-canvas/95 backdrop-blur">
      <div className="mx-auto flex h-[64px] max-w-[1280px] items-center justify-between gap-3 px-4 sm:px-6">
        <a href="#top" className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center border border-structure bg-cobalt font-black text-white">◊</div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-black leading-none tracking-[0.14em] text-ink">POLARIS</div>
            <div className="-mt-0.5 truncate font-mono text-[10px] tracking-[0.18em] text-slate">Polar Logistics Platform</div>
          </div>
        </a>
        <div className="hidden items-center gap-1 font-mono text-[12px] xl:flex">
          {LINKS.map(([l, h]) => (
            <a key={h} href={h} className="whitespace-nowrap px-3 py-2 text-slate transition hover:bg-structure hover:text-canvas">{l}</a>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-1 border border-structure p-1 sm:flex">
            {STATIONS.map((s, i) => (
              <button key={s.id} onClick={() => setStationIdx(i)}
                className={`px-3 py-1.5 font-mono text-xs transition ${i === stationIdx ? 'bg-ink font-semibold text-canvas' : 'text-slate hover:text-ink'}`}>
                {s.name}
              </button>
            ))}
          </div>
          <span className="hidden items-center border border-structure px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.08em] text-ink sm:inline-flex">SIH26062</span>
          <a href="#live-ops" className="hidden items-center gap-2 border border-structure bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-structure sm:inline-flex">
            Mission Control <ArrowUpRight size={14} />
          </a>
          <button onClick={() => setOpen((o) => !o)} aria-label="Toggle menu"
            className="grid h-10 w-10 place-items-center border border-structure text-ink xl:hidden">
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-structure xl:hidden">
            <div className="grid gap-1 px-4 py-3 sm:px-6">
              {LINKS.map(([l, h]) => (
                <a key={h} href={h} onClick={() => setOpen(false)}
                  className="px-3 py-2.5 font-mono text-sm text-ink transition hover:bg-structure hover:text-canvas">{l}</a>
              ))}
              <div className="flex gap-1 border border-structure p-1 sm:hidden">
                {STATIONS.map((s, i) => (
                  <button key={s.id} onClick={() => { setStationIdx(i); setOpen(false); }}
                    className={`flex-1 px-3 py-2 font-mono text-xs ${i === stationIdx ? 'bg-ink font-semibold text-canvas' : 'text-slate'}`}>
                    {s.name}
                  </button>
                ))}
              </div>
              <div className="pt-1 font-mono text-[11px] tracking-[0.08em] text-slate">SIH26062 — Smart India Hackathon</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.16em] text-cobalt">
      <span className="h-1.5 w-1.5 bg-cobalt" />{children}
    </div>
  );
}

export function SectionHead({ kicker, title, blurb }: { kicker: string; title: ReactNode; blurb?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.5 }}>
      <Kicker>{kicker}</Kicker>
      <h2 className="mt-2 text-balance font-display text-[30px] leading-[1.05] tracking-[-0.03em] text-ink sm:text-[42px]">{title}</h2>
      {blurb && <p className="mt-3 max-w-[62ch] text-pretty text-sm leading-6 text-slate">{blurb}</p>}
    </motion.div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-structure bg-canvas">
      <div className="mx-auto grid max-w-[1280px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center border border-structure bg-cobalt font-black text-white">◊</div>
            <span className="font-black tracking-[0.14em] text-ink">POLARIS</span>
          </div>
          <p className="mt-3 text-[13px] leading-5 text-slate">Built for sustained operation in polar environments. Supporting Bharati, Maitri and Himadri with logistics infrastructure that does not depend on the cloud.</p>
          <div className="mt-3 font-mono text-[11px] text-slate">SIH26062 • © 2026</div>
        </div>
        {[
          ['Platform', ['Field application', 'Sync gateway', 'Operations API', 'Command dashboard']],
          ['Capabilities', ['Position tracking without GPS', 'Efficient forecasting', 'Offline data transfer', 'Supply vessel coordination']],
          ['Resources', ['API reference', 'System architecture', 'Deployment guide', 'Verification suite']],
        ].map(([h, items]) => (
          <div key={h as string}>
            <div className="font-mono text-[11px] tracking-[0.14em] text-slate">{h}</div>
            <ul className="mt-3 space-y-2 text-[13px] text-ink/80">
              {(items as string[]).map((i) => <li key={i} className="text-[13px] leading-5">{i}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-structure">
        <div className="mx-auto flex max-w-[1280px] flex-wrap gap-x-4 gap-y-1 px-4 py-4 font-mono text-[11px] text-slate sm:px-6">
          <span>Built for offline operation. No cloud dependency.</span>
          <span className="sm:ml-auto">SIH26062</span>
        </div>
      </div>
    </footer>
  );
}
