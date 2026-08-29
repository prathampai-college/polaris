'use client';
export function IndentsTab({ assets, indents, indentAsset, setIndentAsset, indentQty, setIndentQty, indentUrg, setIndentUrg, doIndent, doReceive }: any) {
  return (
    <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-4">
      <div className="card p-4 space-y-4">
        <div><h2 className="font-bold text-base text-white">Create Resupply Indent</h2><p className="text-xs text-white/50">Queued locally in outbox • Broadcasts to HQ over WebSocket in &lt;2s</p></div>
        <div className="space-y-3">
          <div><label className="text-xs font-semibold text-white/70 block mb-1">Target Asset</label><select value={indentAsset} onChange={(e) => setIndentAsset(e.target.value)} className="w-full bg-black/40 border border-white/15 rounded-xl px-3 h-11 text-xs focus:outline-none focus:border-blue-500 font-mono"><option value="">Select supply SKU…</option>{assets.map((a: any) => (<option key={a.id} value={a.id}>{a.sku} — {a.name} (Stock: {a.qty} {a.unit})</option>))}</select></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs font-semibold text-white/70 block mb-1">Quantity</label><div className="flex items-center gap-1 bg-black/40 border border-white/15 rounded-xl px-2 h-11"><button onClick={() => setIndentQty((v: number) => Math.max(1, v - 1))} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold">−</button><input type="number" value={indentQty} onChange={(e) => setIndentQty(Math.max(1, Number(e.target.value) || 1))} className="flex-1 bg-transparent text-center font-bold text-sm focus:outline-none" /><button onClick={() => setIndentQty((v: number) => v + 1)} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold">+</button></div></div>
            <div><label className="text-xs font-semibold text-white/70 block mb-1">Urgency</label><select value={indentUrg} onChange={(e) => setIndentUrg(e.target.value)} className="w-full bg-black/40 border border-white/15 rounded-xl px-3 h-11 text-xs font-bold focus:outline-none focus:border-blue-500"><option value="CRITICAL">🔴 CRITICAL (Immediate)</option><option value="MEDIUM">🟡 MEDIUM (Seasonal)</option><option value="LOW">🟢 LOW (Routine)</option></select></div>
          </div>
          <button onClick={doIndent} className="w-full h-11 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs shadow-lg shadow-amber-500/25 transition active:scale-98">Create DRAFT Indent</button>
        </div>
        <div className="text-[11px] text-white/40 text-center font-mono">Lifecycle: DRAFT → APPROVED → DISPATCHED → RECEIVED</div>
      </div>
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-bold text-white text-sm">Active Indent Pipeline <span className="text-xs font-normal text-white/50">({indents.length} total)</span></h3><span className="text-[10px] text-emerald-400 font-mono font-medium">Real-Time Full-Duplex</span></div>
        <div className="space-y-2 max-h-[520px] overflow-y-auto scroll-thin pr-1">
          {indents.map((ind: any) => {
            const stages = ['DRAFT', 'APPROVED', 'DISPATCHED', 'RECEIVED'];
            const stageIndex = stages.indexOf(ind.status);
            const isAuto = ind.created_by?.includes('AUTO') || ind.created_by?.includes('AI');
            return (
              <div key={ind.id} className="bg-black/40 border border-white/10 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2"><div className="flex items-center gap-2"><span className="font-mono text-xs font-bold text-white">{ind.id.slice(0, 8)}</span><span className="text-xs text-white/80 font-medium">{ind.sku || ind.asset_id} • <b>{ind.qty_requested}x</b></span>{isAuto && <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">🤖 AI AUTOMATED</span>}</div><div className="flex items-center gap-2"><span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${ind.urgency === 'CRITICAL' ? 'bg-red-500 text-white' : 'bg-white/10 text-white/70'}`}>{ind.urgency}</span><span className="text-xs font-bold text-blue-400 font-mono">{ind.status}</span></div></div>
                <div className="grid grid-cols-4 gap-1 pt-1">{stages.map((stg, i) => (<div key={stg} className="flex flex-col gap-1"><div className={`h-1.5 rounded-full transition-all ${i <= stageIndex ? 'bg-blue-500' : 'bg-white/10'}`} /><span className="text-[9px] text-center font-mono text-white/40">{stg}</span></div>))}</div>
                {ind.status === 'DISPATCHED' && (<div className="pt-2 flex justify-end"><button onClick={() => doReceive(ind.id)} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">Mark RECEIVED ✓</button></div>)}
              </div>
            );
          })}
          {indents.length === 0 && <div className="text-center py-12 text-xs text-white/40">No active indents found. Create one using the form on the left.</div>}
        </div>
      </div>
    </div>
  );
}
