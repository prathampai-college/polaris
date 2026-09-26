export default function Marquee() {
  return (
    <div className="overflow-hidden border-b border-structure bg-ink text-canvas">
      <div className="flex w-max animate-marquee whitespace-nowrap">
        {[0, 1].map((dup) => (
          <div key={dup} className="flex items-center gap-6 px-6 py-3 font-mono text-[13px] tracking-[0.08em]">
            <span>Built for extended winter isolation</span><span className="opacity-30">—</span>
            <span>Reliable coordination over Iridium-grade links</span><span className="opacity-30">—</span>
            <span>Forecasting that conserves reserves, not just watts</span><span className="opacity-30">—</span>
            <span>Positioning without reliance on GPS</span><span className="opacity-30">—</span>
            <span>Coordinated resupply across three stations</span><span className="opacity-30">—</span>
          </div>
        ))}
      </div>
    </div>
  );
}
