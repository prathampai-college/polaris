import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { STATIONS } from '../lib/data';

const LINKS: [string, string][] = [
  ['Capabilities', '#pillars'],
  ['Simulator', '#live-ops'],
  ['Field', '#field'],
  ['Operations', '#hq'],
  ['Logistics', '#vessels'],
  ['Coverage', '#fleet'],
  ['API', '#api'],
  ['System', '#architecture'],
];

export function Nav({ stationIdx, setStationIdx }: { stationIdx: number; setStationIdx: (i: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#020a12]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[64px] max-w-[1280px] items-center justify-between gap-3 px-4 sm:px-6">
        <a href="#top" className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 font-black text-black">◊</div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-black leading-none tracking-[0.14em]">POLARIS</div>
            <div className="-mt-0.5 truncate font-mono text-[10px] tracking-[0.18em] text-white/50">Polar Logistics Platform</div>
          </div>
        </a>
        <div className="hidden items-center gap-1 font-mono text-[12px] xl:flex">
          {LINKS.map(([l, h]) => (
            <a key={h} href={h} className="whitespace-nowrap rounded-full px-3 py-2 text-white/60 transition hover:bg-white/10 hover:text-white">{l}</a>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] p-1 sm:flex">
            {STATIONS.map((s, i) => (
              <button key={s.id} onClick={() => setStationIdx(i)}
                className={`rounded-full px-3 py-1.5 font-mono text-xs transition ${i === stationIdx ? 'bg-white font-semibold text-black' : 'text-white/60 hover:text-white'}`}>
                {s.name}
              </button>
            ))}
          </div>
          <span className="hidden items-center rounded-full border border-white/12 bg-white/5 px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.08em] text-white/70 sm:inline-flex">SIH26062</span>
          <a href="#live-ops" className="hidden items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90 sm:inline-flex">
            Mission Control <ArrowUpRight size={14} />
          </a>
          <button onClick={() => setOpen((o) => !o)} aria-label="Toggle menu"
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/5 text-white/80 xl:hidden">
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-white/[0.06] xl:hidden">
            <div className="grid gap-1 px-4 py-3 sm:px-6">
              {LINKS.map(([l, h]) => (
                <a key={h} href={h} onClick={() => setOpen(false)}
                  className="rounded-xl px-3 py-2.5 font-mono text-sm text-white/75 transition hover:bg-white/10 hover:text-white">{l}</a>
              ))}
              <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1 sm:hidden">
                {STATIONS.map((s, i) => (
                  <button key={s.id} onClick={() => { setStationIdx(i); setOpen(false); }}
                    className={`flex-1 rounded-lg px-3 py-2 font-mono text-xs ${i === stationIdx ? 'bg-white font-semibold text-black' : 'text-white/60'}`}>
                    {s.name}
                  </button>
                ))}
              </div>
              <div className="pt-1 font-mono text-[11px] tracking-[0.08em] text-white/35">SIH26062 — Smart India Hackathon</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return <div className="font-mono text-[11px] tracking-[0.16em] text-cyan-300">{children}</div>;
}

export function SectionHead({ kicker, title, blurb }: { kicker: string; title: ReactNode; blurb?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.6 }}>
      <Kicker>{kicker}</Kicker>
      <h2 className="mt-2 text-balance font-display text-[30px] leading-[1.05] tracking-[-0.03em] sm:text-[42px]">{title}</h2>
      {blurb && <p className="mt-3 max-w-[62ch] text-pretty text-sm leading-6 text-white/60">{blurb}</p>}
    </motion.div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#020a12]">
      <div className="mx-auto grid max-w-[1280px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500 font-black text-black">◊</div>
            <span className="font-black tracking-[0.14em]">POLARIS</span>
          </div>
          <p className="mt-3 text-[13px] leading-5 text-white/50">Designed for sustained operations in polar environments. Supporting Bharati, Maitri and Himadri with reliable, offline-capable logistics.</p>
          <div className="mt-3 font-mono text-[11px] text-white/40">SIH26062 • © 2026</div>
        </div>
        {[
          ['Platform', ['Field application', 'Sync gateway', 'Operations API', 'Command dashboard']],
          ['Capabilities', ['Position tracking without GPS', 'Efficient forecasting', 'Offline data transfer', 'Supply vessel coordination']],
          ['Resources', ['API reference', 'System architecture', 'Deployment guide', 'Verification suite']],
        ].map(([h, items]) => (
          <div key={h as string}>
            <div className="font-mono text-[11px] tracking-[0.14em] text-white/40">{h}</div>
            <ul className="mt-3 space-y-2 text-[13px] text-white/65">
              {(items as string[]).map((i) => <li key={i} className="text-[13px] leading-5">{i}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-[1280px] flex-wrap gap-x-4 gap-y-1 px-4 py-4 font-mono text-[11px] text-white/35 sm:px-6">
          <span>Built for offline operation. No cloud dependency.</span>
          <span className="sm:ml-auto">SIH26062</span>
        </div>
      </div>
    </footer>
  );
}
