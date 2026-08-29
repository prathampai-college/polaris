'use client';
export function ScanTab({ scan, setScan, showQr, setShowQr, selectedAsset, setHighlightCrate, setTab, doScan, doConsume, QrWrap }: any) {
  return (
    <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4">
      <div className="card p-4 space-y-4">
        <div className="flex items-center justify-between"><div><h2 className="font-bold text-base text-white">QR / Barcode Scanner</h2><p className="text-xs text-white/50">Air-gapped offline camera decoding via html5-qrcode</p></div><button onClick={() => setShowQr((v: boolean) => !v)} className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition ${showQr ? 'bg-white text-black border-white' : 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20'}`}>{showQr ? 'Close Camera' : '📷 Open Camera'}</button></div>
        {showQr && <QrWrap onScan={(text: string) => doScan(text)} onClose={() => setShowQr(false)} />}
        <div className="flex gap-2"><input value={scan} onChange={(e: any) => setScan(e.target.value)} onKeyDown={(e: any) => e.key === 'Enter' && doScan()} placeholder="Scan or type barcode SKU (e.g. FUEL-DIESEL-001)" className="flex-1 bg-black/40 border border-white/15 rounded-xl px-3.5 h-12 text-sm focus:outline-none focus:border-blue-500 transition" /><button onClick={() => doScan()} className="h-12 px-6 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition shadow-lg shadow-blue-500/25">GO</button></div>
        {selectedAsset && (
          <div className="rounded-2xl border border-blue-500/40 bg-blue-950/40 p-4 space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-blue-500/20 pb-2"><span className="text-[11px] font-mono tracking-widest text-blue-300 font-bold">SCAN RESULT • VERIFIED</span><span className="font-mono text-xs text-white/50">Crate {selectedAsset.crate_id}</span></div>
            <div><div className="font-mono font-bold text-base text-white">{selectedAsset.sku}</div><div className="text-sm text-white/80 font-medium">{selectedAsset.name}</div><div className="text-xs text-white/50 mt-1">Current Stock: <b className="text-white">{selectedAsset.qty} {selectedAsset.unit}</b> • Category: {selectedAsset.category}</div></div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => doConsume(selectedAsset.id, 1)} className="flex-1 h-11 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition">CONSUME -1</button>
              <button onClick={() => doConsume(selectedAsset.id, -1)} className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition">RESTOCK +1</button>
              <button onClick={() => { setHighlightCrate(selectedAsset.crate_id); setTab('locate'); }} className="flex-1 h-11 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white font-semibold text-xs transition">Locate in 3D →</button>
            </div>
          </div>
        )}
      </div>
      <div className="card p-4 space-y-3"><h3 className="font-bold text-white text-sm">Station Barcode Protocol</h3><ol className="space-y-2.5 text-xs text-white/70 list-decimal list-inside"><li><b className="text-white">Offline Scanning:</b> The camera engine executes in browser WASM with zero internet reliance.</li><li><b className="text-white">Atomic Transaction:</b> Every scan creates an immediate SQLite WAL commit and enqueues an outbox delta.</li><li><b className="text-white">Cold-Chain Guard:</b> Expired Medical supplies cannot be consumed without lead authorization.</li><li><b className="text-white">3D Cross-Reference:</b> A verified scan automatically highlights crate coordinates in the 3D X-Ray.</li></ol><div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300 font-medium">💡 Tip: Turn Glove Mode ON at the top to enlarge touch targets when wearing sub-zero gloves.</div></div>
    </div>
  );
}
