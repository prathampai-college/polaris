import { motion } from 'motion/react';
import { Boxes, ClipboardList, Package, QrCode, ScanLine } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { SectionHead } from '../components/chrome';
import { INVENTORY, statusColor, TABS, type Station } from '../lib/data';
import { fmt } from '../lib/physics';

type Forecast = { physics: number; residual: number; total: number; days: number; lo: number; hi: number };

export default function FieldInterface({
  st, tab, setTab, f, snnActive, setSnnActive, bundled, setTemp, setWind,
}: {
  st: Station;
  tab: (typeof TABS)[number];
  setTab: (t: (typeof TABS)[number]) => void;
  f: Forecast;
  snnActive: boolean;
  setSnnActive: (v: boolean | ((v: boolean) => boolean)) => void;
  bundled: number;
  setTemp: (v: number) => void;
  setWind: (v: number) => void;
}) {
  return (
    <section id="field" className="border-y border-structure bg-canvas">
      <div className="mx-auto max-w-[1280px] scroll-mt-24 px-4 py-10 sm:px-6 sm:py-14">
        <SectionHead kicker="04 — FIELD INTERFACE"
          title={<>Built for gloves,<br /><span className="italic text-ink/70">not glass desks.</span></>}
          blurb="A focused, offline-capable interface for station personnel. The same information model is shared across field and operations views." />
        <div className="mt-8 grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])}>
              <div className="overflow-hidden border border-structure bg-ink shadow-panel">
                <div className="flex items-center justify-between border-b border-structure/60 bg-white/[0.04] px-4 py-2.5">
                  <div className="flex gap-1.5"><span className="h-2.5 w-2.5 bg-flare" /><span className="h-2.5 w-2.5 bg-amber-500" /><span className="h-2.5 w-2.5 bg-phosphor" /></div>
                  <span className="font-mono text-[10px] text-canvas/60">{st.name.toUpperCase()} · FIELD VIEW</span>
                </div>
                <TabsList className="border-b border-structure/60 p-2">
                  {TABS.map((t) => (
                    <TabsTrigger key={t} value={t} className="text-canvas/70 data-[state=active]:bg-canvas data-[state=active]:text-ink">{t}</TabsTrigger>
                  ))}
                </TabsList>
                <div className="min-h-[300px] p-4">
                  <TabsContent value="Today" className="space-y-3">
                    <div className="bg-canvas p-3 text-ink"><div className="font-mono text-[10px] text-slate">ESTIMATED COVERAGE</div><div className="text-2xl font-black">{fmt(f.days)} days</div><div className="font-mono text-[11px] text-slate">Based on current conditions</div></div>
                    <div className="flex gap-2">
                      <button onClick={() => { setTemp(-15); setWind(5); }} className="flex-1 bg-white/10 py-3 font-mono text-xs text-canvas">Calm</button>
                      <button onClick={() => { setTemp(-38); setWind(22); }} className="flex-1 bg-white/10 py-3 font-mono text-xs text-canvas">Severe</button>
                      <button onClick={() => setSnnActive((v) => !v)} className="flex-1 bg-canvas py-3 font-mono text-xs font-semibold text-ink">{snnActive ? 'Adaptive' : 'Standard'}</button>
                    </div>
                    <div className="border border-structure/60 bg-white/[0.04] p-3 font-mono text-[11px] text-canvas/70">{bundled} updates awaiting synchronization</div>
                  </TabsContent>
                  <TabsContent value="Inventory" className="space-y-2">
                    <div className="flex gap-1.5 font-mono text-[10px]">{['All', 'Attention', 'Expiring', 'Low'].map((p, i) => <span key={p} className={`px-2 py-1 ${i === 0 ? 'bg-canvas font-semibold text-ink' : 'bg-white/10 text-canvas/70'}`}>{p}</span>)}</div>
                    {INVENTORY.slice(0, 4).map((r) => (
                      <div key={r.sku} className="flex items-center justify-between border border-structure/60 bg-white/[0.04] px-3 py-2.5">
                        <div><div className="font-mono text-xs text-canvas">{r.sku}</div><div className="font-mono text-[10px] text-canvas/50">{r.crate}</div></div>
                        <div className={`font-mono text-xs font-medium ${statusColor(r.status)}`}>{r.qty.toLocaleString()} {r.unit}</div>
                      </div>
                    ))}
                  </TabsContent>
                  <TabsContent value="Scan" className="space-y-3">
                    <div className="grid place-items-center border-2 border-dashed border-structure/50 bg-white/[0.03] py-8">
                      <ScanLine size={28} className="text-canvas/50" />
                      <div className="mt-2 font-mono text-xs text-canvas/70">Scan to identify item and location</div>
                      <div className="mt-1 bg-canvas px-3 py-1 font-mono text-[11px] font-semibold text-ink">FUEL-DIESEL-001</div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">{['FUEL-DIESEL-001', 'O2-CYL-47L-003', 'BEARING-6205'].map((c) => <span key={c} className="bg-white/10 px-2.5 py-1.5 font-mono text-[10px] text-canvas/80">{c}</span>)}</div>
                  </TabsContent>
                  <TabsContent value="Indents" className="space-y-2">
                    {[
                      ['IND-8F2A', 'Diesel 500 L', 'Requires attention', 'bg-flare text-white'],
                      ['IND-91BC', 'Bearings 4 pcs', 'Approved', 'bg-canvas text-ink'],
                      ['IND-77E0', 'Oxygen 6 cyl', 'In transit', 'bg-white/15 text-canvas'],
                    ].map(([id, what, stt, cls]) => (
                      <div key={id} className="border border-structure/60 bg-white/[0.04] p-3">
                        <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-canvas">{id} · {what}</span><span className={`shrink-0 px-2 py-0.5 font-mono text-[10px] font-semibold ${cls}`}>{stt}</span></div>
                        <div className="mt-1 font-mono text-[10px] text-canvas/50">Request → Review → Dispatch → Received</div>
                      </div>
                    ))}
                  </TabsContent>
                  <TabsContent value="Locate" className="space-y-2">
                    <div className="flex gap-2 font-mono text-[11px]">
                      <span className="bg-white/10 px-2.5 py-1 text-canvas/70">Satellite unavailable</span>
                      <span className="bg-canvas px-2.5 py-1 font-semibold text-ink">Local positioning</span>
                    </div>
                    <div className="dotgrid border border-structure/60 bg-black p-3">
                      <div className="relative h-[150px]">
                        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 bg-phosphor" />
                        <div className="absolute left-[30%] top-[30%] bg-canvas px-1.5 py-0.5 font-mono text-[9px] font-semibold text-ink">C1-K1</div>
                        <div className="absolute left-[62%] top-[58%] bg-white/15 px-1.5 py-0.5 font-mono text-[9px] text-canvas">C2-K1</div>
                        <div className="absolute bottom-1 left-2 font-mono text-[9px] text-canvas/50">Local grid · illustrative</div>
                      </div>
                    </div>
                  </TabsContent>
                </div>
                <div className="border-t border-structure/60 bg-white/[0.03] px-4 py-2.5 font-mono text-[10px] text-canvas/50">Sample interface · data shown is illustrative</div>
              </div>
            </Tabs>
          </div>
          <div className="space-y-4 lg:col-span-7">
            {[
              ['Clear actions in difficult conditions', 'The interface prioritizes legibility and simple actions suitable for field use, including operation with limited dexterity.', <Package key="i" size={16} />],
              ['Identification by scan', 'Items can be identified quickly to confirm location and status, supporting accurate handling and handover.', <QrCode key="i" size={16} />],
              ['Understand where things are', 'Storage locations are shown in context to reduce search time and support orderly management.', <Boxes key="i" size={16} />],
              ['A consistent workflow', 'Requests follow a clear lifecycle from need to receipt, with a shared understanding between field and operations.', <ClipboardList key="i" size={16} />],
            ].map(([h, p, icon]) => (
              <motion.div key={h as string} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                className="flex gap-3 border border-structure bg-surface p-4">
                <div className="grid h-9 w-9 shrink-0 place-items-center border border-structure text-ink">{icon as React.ReactNode}</div>
                <div><div className="text-sm font-semibold text-ink">{h as string}</div><div className="mt-1 text-[13px] leading-5 text-slate">{p as string}</div></div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
