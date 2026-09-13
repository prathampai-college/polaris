'use client';
import { useEffect, useRef, useState } from 'react';
export function LocateTab({ assets, highlightCrate, setHighlightCrate, LocatorWrap }: any) {
  const [mode, setMode] = useState<'LOCAL'|'GPS'>('LOCAL');
  const [localPos, setLocalPos] = useState<any[]>([]);
  const [whiteout, setWhiteout] = useState(false);
  const [hf, setHf] = useState(false);

  useEffect(() => {
    let stop: (()=>void)|null=null;
    (async () => {
      const { startFusionLoop } = await import('../../lib/sensors/fusion');
      const ids = assets.slice(0,3).map((a:any)=>a.id);
      if (!ids.length) return;
      const sid = assets[0]?.station_id || 'ST-BHARATI';
      stop = await startFusionLoop(ids, sid, 3000);
    })();
    return () => { if (stop) stop(); };
  }, [assets]);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const { getDb } = await import('../../lib/db');
        const db = await getDb();
        const rows = db.selectObjects('SELECT * FROM asset_positions ORDER BY last_sensor_ts DESC LIMIT 5');
        setLocalPos(rows);
      } catch {}
    }, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="grid lg:grid-cols-[1.25fr_0.75fr] gap-4">
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div><h2 className="font-bold text-base text-white">Vision-Fused Local Tracking</h2><p className="text-xs text-white/50">2D LiDAR + Camera fusion • Local frame (GPS-denied whiteout)</p></div>
          <div className="flex items-center gap-2">
            <button onClick={()=>setMode(mode==='LOCAL'?'GPS':'LOCAL')} className={`px-3 py-1.5 rounded-full text-[11px] font-bold border ${mode==='LOCAL'?'bg-cyan-500/20 text-cyan-300 border-cyan-500/30':'bg-white/5 text-white/50 border-white/10'}`}>{mode==='LOCAL'?'LOCAL (No GPS)':'GPS Mode'}</button>
            <button onClick={()=>setWhiteout(v=>!v)} className={`px-2 py-1 rounded-full text-[10px] font-mono border ${whiteout?'bg-white text-black border-white':'bg-white/5 text-white/40 border-white/10'}`}>Whiteout {whiteout?'ON':'OFF'}</button>
            <span className="text-[10px] font-mono px-2 py-1 rounded bg-teal-400/10 text-teal-300 border border-teal-400/20">Three.js + WebGL</span>
          </div>
        </div>
        {mode==='GPS' ? (
          <div className="h-72 rounded-2xl border border-red-500/30 bg-red-950/20 grid place-items-center p-6 text-center">
            <div><div className="text-red-300 font-bold">GPS Unavailable</div><div className="text-xs text-white/50 mt-1">Ionospheric interference + whiteout (visibility ~0.8m). Satellite fix lost. Switch to LOCAL.</div></div>
          </div>
        ) : (
          <>
            <LocatorWrap assets={assets} highlight={highlightCrate} onPick={(crateId: string) => setHighlightCrate(crateId)} />
            <LocalGrid positions={localPos} whiteout={whiteout} />
          </>
        )}
      </div>
      <div className="card p-4 space-y-3">
        <h3 className="font-bold text-white text-sm">Station Crate Matrix</h3><p className="text-xs text-white/50">Click any crate to highlight & inspect in 3D X-Ray</p>
        <div className="grid grid-cols-2 gap-2 max-h-[280px] overflow-y-auto scroll-thin pr-1">
          {Array.from(new Set(assets.map((a: any) => a.crate_id))).map((cid: any) => {
            const crateAssets = assets.filter((a: any) => a.crate_id === cid);
            const isSelected = highlightCrate === cid;
            return (
              <button key={cid as string} onClick={() => setHighlightCrate(cid)} className={`p-2.5 rounded-xl border text-left transition ${isSelected ? 'bg-amber-500 text-black border-amber-400 font-bold shadow-md shadow-amber-500/20' : 'bg-black/30 border-white/10 hover:bg-white/5 hover:border-teal-400/40 text-white'}`}>
                <div className="font-mono text-xs font-bold">{cid as string}</div><div className={`text-[11px] truncate mt-0.5 ${isSelected ? 'text-black/80' : 'text-white/60'}`}>{crateAssets.map((a: any) => a.sku).join(', ') || 'Empty'}</div>
              </button>
            );
          })}
        </div>
        <div className="border-t border-white/10 pt-3">
          <div className="text-xs font-bold text-cyan-300">Local Coordinates (LiDAR-fused)</div>
          <div className="text-[11px] text-white/50">No GPS — local frame via 2D LiDAR + Camera • 70% LiDAR + 30% Camera + Kalman</div>
          <div className="mt-2 space-y-1 max-h-[150px] overflow-auto">
            {localPos.length ? localPos.map((p:any)=><div key={p.asset_id} className="flex justify-between text-xs font-mono bg-black/30 border border-white/5 rounded-lg px-2 py-1.5"><span className="text-white">{p.asset_id.slice(0,8)}</span><span className="text-cyan-300">[{p.x?.toFixed(1)},{p.y?.toFixed(1)}]</span><span className={p.conf>0.6?'text-emerald-400':'text-amber-400'}>{(p.conf*100).toFixed(0)}%</span></div>) : <div className="text-xs text-white/40">Awaiting LiDAR fusion cycle…</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function LocalGrid({ positions, whiteout }: { positions:any[]; whiteout:boolean }) {
  const size=40, cell=5, W=size*cell;
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    cv.width = W*dpr; cv.height = W*dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, W);
    // grid lines (single canvas, replaces 1600 divs)
    ctx.strokeStyle = whiteout ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i=0;i<=size;i++) { ctx.moveTo(i*cell+.5,0); ctx.lineTo(i*cell+.5,W); ctx.moveTo(0,i*cell+.5); ctx.lineTo(W,i*cell+.5); }
    ctx.stroke();
    // origin
    ctx.fillStyle = '#FBBF24';
    ctx.beginPath(); ctx.arc(W/2, W/2, 4, 0, Math.PI*2); ctx.fill();
    // positions
    for (const p of positions) {
      const gx = Math.floor((p.x+40)/2), gy=Math.floor((p.y+40)/2);
      if (gx<0||gx>=size||gy<0||gy>=size) continue;
      const cx=gx*cell+cell/2, cy=(size-1-gy)*cell+cell/2;
      ctx.fillStyle = p.conf>0.6 ? '#2DD4BF' : '#FBBF24';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    }
  }, [positions, whiteout, W, size, cell]);
  return (
    <div className="rounded-xl border border-teal-400/20 bg-black/40 p-2">
      <div className="text-[10px] font-mono text-teal-300">Occupancy Grid 40x40 • 2m/cell • {whiteout?'WHITEOUT 0.8m — camera blind, LiDAR active (✓)':'Visibility 30m'}</div>
      <div className="relative mt-2 mx-auto" style={{width: W, height: W}}>
        <canvas ref={ref} style={{width: W, height: W}} role="img" aria-label="LiDAR occupancy grid with tracked assets" />
      </div>
    </div>
  );
}
