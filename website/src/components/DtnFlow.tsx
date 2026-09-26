import { Crosshair, Database, Radio } from 'lucide-react';

/**
 * DTN custody flow, read left → right: a bundle is created on the field
 * tablet, physically carried by a mule (person/vehicle), then merged at HQ.
 * Small squares animate along each connector to read as "packets moving,"
 * not as a data table — the previous 3-column list was clearer to build
 * than to read at a glance.
 */
export default function DtnFlow({ bundled }: { bundled: number }) {
  const stages = [
    { title: 'FIELD TABLET', sub: 'Bundled locally, OPFS', count: bundled, Icon: Crosshair, tag: 'PENDING' },
    { title: 'MULE', sub: 'Carried — QR / BroadcastChannel', count: 3, Icon: Radio, tag: 'CUSTODY' },
    { title: 'HQ INDIA', sub: 'Merged — LWW + vector clock', count: 4, Icon: Database, tag: 'APPLIED' },
  ];
  return (
    <div className="flex min-h-[280px] flex-col justify-center border border-structure bg-surface p-5 sm:p-8">
      <div className="flex items-start">
        {stages.map((s, i) => (
          <div key={s.title} className="flex items-start" style={{ flex: i === stages.length - 1 ? '0 0 auto' : '1 1 0%' }}>
            <div className="flex w-[100px] shrink-0 flex-col items-center text-center sm:w-[128px]">
              <div className="grid h-14 w-14 place-items-center border-2 border-structure bg-canvas">
                <s.Icon size={20} className="text-ink" />
              </div>
              <div className="mt-2 font-mono text-[10px] tracking-[0.1em] text-ink">{s.title}</div>
              <div className="mt-0.5 font-mono text-[9px] leading-tight text-slate">{s.sub}</div>
              <div className="mt-2 border border-structure bg-ink px-2 py-0.5 font-mono text-[11px] font-semibold text-canvas">{s.count}</div>
              <div className="mt-1 font-mono text-[9px] tracking-[0.08em] text-slate">{s.tag}</div>
            </div>
            {i < stages.length - 1 && (
              <div className="relative mt-7 h-px flex-1 bg-structure/25">
                {Array.from({ length: 4 }).map((_, k) => (
                  <span
                    key={k}
                    className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 bg-cobalt animate-flow-right"
                    style={{ animationDelay: `${k * 0.45 + i * 0.2}s` }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-6 font-mono text-[11px] leading-5 text-slate">
        Bundles move Field → Mule → HQ opportunistically, over whichever link or hand-carry is available. Each is applied exactly once, in any arrival order, via vector-clock reconciliation.
      </div>
    </div>
  );
}
