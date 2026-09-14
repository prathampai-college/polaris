import { motion } from 'framer-motion';
import { Crosshair, Database, Radio } from 'lucide-react';

/** DTN custody flow: tablet → mule → HQ */
export default function DtnFlow({ bundled }: { bundled: number }) {
  const cols = [
    { title: 'FIELD TABLET', sub: 'OPFS • BUNDLED', Icon: Crosshair, n: bundled, dot: 'bg-cyan-400', tag: 'PENDING' },
    { title: 'MULE', sub: 'QR • BroadcastChannel', Icon: Radio, n: 3, dot: 'bg-amber-400', tag: 'CUSTODY' },
    { title: 'HQ INDIA', sub: 'LWW + Vector Clock', Icon: Database, n: 4, dot: 'bg-violet-400', tag: 'APPLIED' },
  ];
  return (
    <div className="relative h-[300px] overflow-hidden rounded-xl border border-white/10 bg-[#060f1a] p-4">
      <div className="dotgrid absolute inset-0 opacity-[0.12]" />
      <div className="relative grid h-full grid-cols-3 gap-3">
        {cols.map((col, i) => (
          <div key={col.title} className="flex flex-col rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 backdrop-blur">
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-white/60">
              <col.Icon size={12} />{col.title}
            </div>
            <div className="mt-1 font-mono text-[11px] text-white/35">{col.sub}</div>
            <div className="mt-3 flex-1 space-y-2 overflow-hidden">
              {Array.from({ length: col.n }).map((_, k) => (
                <motion.div key={`${i}-${k}-${col.n}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: k * 0.07 }}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-2 py-2">
                  <div className={`h-2 w-2 animate-pulse rounded-full ${col.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[11px] text-white">#{String(1000 + k * 137 + i * 19).padStart(4, '0')} ULID</div>
                    <div className="font-mono text-[10px] text-white/40">VC [2,1,4] • {col.tag}</div>
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="mt-2 font-mono text-[10px] text-white/30">{col.n} bundles</div>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute left-[32%] top-1/2 -translate-y-1/2 text-xl text-cyan-300/60">››</div>
      <div className="pointer-events-none absolute left-[64%] top-1/2 -translate-y-1/2 text-xl text-amber-300/60">››</div>
    </div>
  );
}
