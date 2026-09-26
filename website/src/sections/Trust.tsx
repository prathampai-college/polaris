export default function Trust() {
  return (
    <section className="border-y border-structure bg-ink text-canvas">
      <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
        <div className="font-mono text-[11px] tracking-[0.16em] text-canvas/50">PRINCIPLES</div>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-4">
          {[
            ['Operates offline', 'Core functions stay available without connectivity, with synchronization applied when possible.'],
            ['Clear status at all times', 'The interface communicates what is current, what is delayed and what requires attention.'],
            ['No duplicate actions', 'Each update is applied once, supporting consistency across stations.'],
            ['Built for the environment', 'Designed around the practical constraints of extended polar deployment.'],
          ].map(([t, d]) => (
            <div key={t} className="border border-white/15 bg-white/[0.03] p-4"><div className="font-semibold">{t}</div><div className="mt-1 text-[13px] leading-5 text-canvas/60">{d}</div></div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 font-mono text-xs">
          <span className="bg-cobalt px-3 py-2 text-white">No new hardware required</span>
          <span className="border border-white/15 px-3 py-2 text-canvas/80">Documented and verifiable</span>
          <span className="border border-white/15 px-3 py-2 text-canvas/80">SIH26062</span>
        </div>
      </div>
    </section>
  );
}
