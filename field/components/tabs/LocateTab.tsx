'use client';
export function LocateTab({ assets, highlightCrate, setHighlightCrate, LocatorWrap }: any) {
  return (
    <div className="grid lg:grid-cols-[1.25fr_0.75fr] gap-4">
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between"><div><h2 className="font-bold text-base text-white">3D Container X-Ray Locator</h2><p className="text-xs text-white/50">Interactive digital twin • Coordinate-indexed bay visualization</p></div><span className="text-[10px] font-mono px-2 py-1 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">Three.js + WebGL</span></div>
        <LocatorWrap assets={assets} highlight={highlightCrate} onPick={(crateId: string) => setHighlightCrate(crateId)} />
      </div>
      <div className="card p-4 space-y-3">
        <h3 className="font-bold text-white text-sm">Station Crate Matrix</h3><p className="text-xs text-white/50">Click any crate to highlight & inspect in 3D X-Ray</p>
        <div className="grid grid-cols-2 gap-2 max-h-[480px] overflow-y-auto scroll-thin pr-1">
          {Array.from(new Set(assets.map((a: any) => a.crate_id))).map((cid: any) => {
            const crateAssets = assets.filter((a: any) => a.crate_id === cid);
            const isSelected = highlightCrate === cid;
            return (
              <button key={cid as string} onClick={() => setHighlightCrate(cid)} className={`p-2.5 rounded-xl border text-left transition ${isSelected ? 'bg-amber-500 text-black border-amber-400 font-bold shadow-md shadow-amber-500/20' : 'bg-black/30 border-white/10 hover:bg-white/5 hover:border-blue-500/40 text-white'}`}>
                <div className="font-mono text-xs font-bold">{cid as string}</div><div className={`text-[11px] truncate mt-0.5 ${isSelected ? 'text-black/80' : 'text-white/60'}`}>{crateAssets.map((a: any) => a.sku).join(', ') || 'Empty'}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
