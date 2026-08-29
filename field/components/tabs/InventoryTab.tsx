'use client';
import { isExpiringSoon, isExpired } from '../../lib/db';

export function InventoryTab({ assets, filteredAssets, invQuery, setInvQuery, invFilter, setInvFilter, txType, setTxType, qtyDelta, setQtyDelta, overrideExp, setOverrideExp, criticalCount, expiringCount, lowCount, highlightCrate, setSelectedAsset, doConsume }: any) {
  return (
    <div className="space-y-3">
      <div className="card p-3.5 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative"><span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40">⌕</span><input value={invQuery} onChange={(e) => setInvQuery(e.target.value)} placeholder="Search SKU, name, crate ID, barcode, category…" className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-3.5 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition" /></div>
        <div className="flex gap-1.5 overflow-x-auto scroll-thin pb-1">
          {[{ id: 'ALL', label: `All (${assets.length})` }, { id: 'CRITICAL', label: `Critical (${criticalCount})` }, { id: 'EXPIRING', label: `Expiring (${expiringCount})` }, { id: 'LOW', label: `Low ≤3 (${lowCount})` }, { id: 'FUEL', label: 'Fuel' }, { id: 'MEDICAL', label: 'Medical & O₂' }, { id: 'SPARES', label: 'Spares & DG' }, { id: 'FOOD', label: 'Food Rations' }].map((f) => (
            <button key={f.id} onClick={() => setInvFilter(f.id)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 border transition ${invFilter === f.id ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20' : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white'}`}>{f.label}</button>
          ))}
        </div>
      </div>
      <div className="card p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-white/60">Mode:</span>
          <select value={txType} onChange={(e) => setTxType(e.target.value as any)} className="bg-black/40 border border-white/15 rounded-xl px-3 h-10 text-xs font-bold focus:outline-none focus:border-blue-500"><option value="CONSUME">CONSUME (-)</option><option value="IN">RESTOCK / IN (+)</option><option value="OUT">DISPATCH / OUT (-)</option><option value="ADJUST">ADJUST</option></select>
          <div className="flex items-center gap-1 bg-black/40 border border-white/15 rounded-xl px-2 h-10">
            <button onClick={() => setQtyDelta((v: number) => Math.max(1, v - 1))} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold">−</button>
            <input type="number" value={qtyDelta} onChange={(e) => setQtyDelta(Math.max(1, Number(e.target.value) || 1))} className="w-12 bg-transparent text-center font-bold text-sm focus:outline-none" />
            <button onClick={() => setQtyDelta((v: number) => v + 1)} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold">+</button>
          </div>
          <div className="flex gap-1">{[1, 5, 10, 50].map((step) => (<button key={step} onClick={() => setQtyDelta(step)} className={`px-2 py-1 rounded-lg text-xs font-mono font-semibold border ${qtyDelta === step ? 'bg-blue-600 text-white border-blue-500' : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'}`}>{step}</button>))}</div>
        </div>
        <label className="flex items-center gap-2 text-xs text-amber-300 font-medium cursor-pointer"><input type="checkbox" checked={overrideExp} onChange={(e) => setOverrideExp(e.target.checked)} className="rounded accent-amber-500" /><span>Override expired Medical/O₂ (Audited)</span></label>
      </div>
      <div className="card overflow-hidden">
        <div className="max-h-[60vh] overflow-y-auto scroll-thin divide-y divide-white/[0.06]">
          {filteredAssets.map((a: any) => {
            const expSoon = isExpiringSoon(a.expiry_date);
            const expired = isExpired(a.expiry_date);
            return (
              <div key={a.id} onClick={() => setSelectedAsset(a)} className={`p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-white/[0.03] cursor-pointer transition ${highlightCrate === a.crate_id ? 'bg-amber-500/10 border-l-4 border-l-amber-500' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-white tracking-wide">{a.sku}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${a.criticality === 'CRITICAL' ? 'bg-red-500/20 text-red-300 border-red-500/30' : a.criticality === 'HIGH' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-white/10 text-white/70 border-white/10'}`}>{a.criticality}</span>
                    {expired && <span className="text-[10px] bg-red-600 text-white px-2 py-0.5 rounded-full font-bold animate-pulse">EXPIRED: {a.expiry_date}</span>}
                    {!expired && expSoon && <span className="text-[10px] bg-amber-500 text-black px-2 py-0.5 rounded-full font-bold">EXP &lt;30d ({a.expiry_date})</span>}
                  </div>
                  <div className="text-sm font-semibold text-white/90 mt-1">{a.name}</div>
                  <div className="text-xs text-white/50 flex items-center gap-3 mt-1 flex-wrap font-mono"><span>Crate: <b className="text-white/80">{a.crate_id}</b> ({a.coords || '0,0'})</span><span>Category: <b className="text-white/80">{a.category}</b></span><span>Barcode: <b className="text-white/80">{a.barcode}</b></span></div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right"><div className="text-lg font-black text-white leading-tight">{a.qty} <span className="text-xs font-normal text-white/50">{a.unit}</span></div><div className="text-[10px] text-white/40 font-mono">v{a.version}</div></div>
                  <button onClick={(e: any) => { e.stopPropagation(); setSelectedAsset(a); doConsume(a.id); }} className={`rounded-xl font-bold text-xs px-4 h-10 shadow-sm transition active:scale-95 ${txType === 'IN' ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/25' : 'bg-red-600 hover:bg-red-500 text-white shadow-red-600/25'}`}>{txType === 'IN' ? `+${qtyDelta}` : `-${qtyDelta}`}</button>
                </div>
              </div>
            );
          })}
          {filteredAssets.length === 0 && <div className="p-12 text-center text-white/40 text-sm">No matching assets found in local station database.</div>}
        </div>
      </div>
    </div>
  );
}
