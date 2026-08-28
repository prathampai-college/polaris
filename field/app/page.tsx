'use client';
import { useEffect, useState } from 'react';
import { getDb, seedIfEmpty, listAssets, consumeAsset, outboxCount, getAssetByBarcode, createIndent, listIndents, updateIndentLocal, listTransactions, listAudit, isExpiringSoon, isExpired } from '../lib/db';
import { SyncWorker } from '../lib/sync';
import { MqttPublisher } from '../lib/mqtt';

const HQ_URL = process.env.NEXT_PUBLIC_HQ_URL?.replace('ws','http').replace('8787','8000') || 'http://localhost:8000';

export default function FieldPage() {
  const [assets, setAssets] = useState<any[]>([]);
  const [indents, setIndents] = useState<any[]>([]);
  const [txns, setTxns] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [outbox, setOutbox] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [scan, setScan] = useState('');
  const [syncStats, setSyncStats] = useState<any>({});
  const [glove, setGlove] = useState(false);
  const [fontLarge, setFontLarge] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [highlightCrate, setHighlightCrate] = useState<string | null>(null);
  const [indentAsset, setIndentAsset] = useState('');
  const [indentQty, setIndentQty] = useState(5);
  const [indentUrg, setIndentUrg] = useState('CRITICAL');
  const [qtyDelta, setQtyDelta] = useState(1);
  const [txType, setTxType] = useState<'CONSUME'|'IN'|'OUT'|'ADJUST'>('CONSUME');
  const [overrideExp, setOverrideExp] = useState(false);
  const [forecast, setForecast] = useState<any>(null);
  const [mqttLive, setMqttLive] = useState(false);

  const [loggedIn, setLoggedIn] = useState(false);
  const [loginStation, setLoginStation] = useState('ST-BHARATI');
  const [loginPin, setLoginPin] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [authToken, setAuthToken] = useState('');

  const STATION_ID = loginStation;
  const DEVICE_ID = deviceId;
  const ACTOR_ID = `FIELD_OP_${loginStation.replace('ST-','')}`;

  const mqttRef = useState(() => new MqttPublisher(loginStation))[0];

  async function doLogin() {
    try {
      const res = await fetch(`${HQ_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId || `TABLET-${loginStation}-${Date.now()}`, pin: loginPin, station_id: loginStation }),
      });
      if (!res.ok) { setLog([`LOGIN FAILED: ${await res.text()}`]); return; }
      const data = await res.json();
      setAuthToken(data.token);
      localStorage.setItem('polaris_token', data.token);
      localStorage.setItem('polaris_station', data.station_id);
      localStorage.setItem('polaris_device', data.device_id);
      setLoggedIn(true);
      setLog([`LOGIN OK — ${data.station_id} as ${data.role}`]);
    } catch (e: any) { setLog([`LOGIN ERR: ${e.message}`]); }
  }

  function doLogout() {
    localStorage.removeItem('polaris_token');
    localStorage.removeItem('polaris_station');
    localStorage.removeItem('polaris_device');
    setLoggedIn(false);
    setAuthToken('');
    mqttRef.disconnect();
  }

  async function refresh() {
    setAssets(await listAssets());
    setIndents(await listIndents());
    setTxns(await listTransactions(10));
    setAudit(await listAudit(10));
    setOutbox(await outboxCount());
    try {
      const headers: Record<string, string> = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
      const r = await fetch(`${HQ_URL}/forecast/${STATION_ID}`, { headers });
      if(r.ok) setForecast(await r.json());
    } catch {}
  }
  useEffect(()=>{
    const stored = localStorage.getItem('polaris_token');
    if (stored) {
      setAuthToken(stored);
      setLoginStation(localStorage.getItem('polaris_station') || 'ST-BHARATI');
      setDeviceId(localStorage.getItem('polaris_device') || '');
      setLoggedIn(true);
    }
  },[]);

  useEffect(()=>{
    if (!loggedIn) return;
    (async()=>{
      await getDb(); await seedIfEmpty(DEVICE_ID); await refresh();
      const w = new SyncWorker(DEVICE_ID, STATION_ID);
      w.onAck = (ack: any) => {
        setLog(l=>[`ACK ${String(ack.ulid).slice(0,8)} ${ack.status} v${ack.server_version??''}`, ...l].slice(0,20));
        refresh();
        setSyncStats({...w.stats});
      };
      w.onDownstreamDelta = (delta: any) => {
        if (delta.type === 'DOWNSTREAM_DELTA') {
          setLog(l=>[`⚡ PUSH ${delta.entity}/${delta.entity_id} (${delta.patch?.status || delta.op})`, ...l].slice(0,20));
        } else if (delta.type === 'SYNC_INIT_RESP') {
          setLog(l=>[`⚡ SYNC_INIT ${delta.indents?.length || 0} indents reconciled`, ...l].slice(0,20));
        }
        refresh();
        setSyncStats({...w.stats});
      };
      w.connect();
      mqttRef.connect().then(()=>setMqttLive(mqttRef.isConnected()));

      const refreshTimer = setInterval(refresh, 2000);
      const statsTimer = setInterval(()=>setSyncStats({...w.stats}), 1000);
      const mqttCheck = setInterval(()=>setMqttLive(mqttRef.isConnected()), 2000);
      (window as any).__polaris_drain = ()=>w.drain();

      return () => {
        clearInterval(refreshTimer);
        clearInterval(statsTimer);
        clearInterval(mqttCheck);
        w.disconnect();
        mqttRef.disconnect();
      };
    })();
  },[loggedIn]);


  async function sendTelemetry(payload: Record<string, any>) {
    const sent = mqttRef.publishTelemetry(payload);
    if (!sent) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      await fetch(`${HQ_URL}/telemetry`, { method:'POST', headers, body: JSON.stringify(payload) });
    }
    setLog(l=>[`telemetry ${sent?'mqtt':'http'} ${payload.temp_outside < -30 ? 'blizzard' : payload.acoustic_anomaly > 0.9 ? 'acoustic' : 'calm'}`, ...l].slice(0,20));
    setTimeout(refresh, 500);
  }

  async function doConsume(assetId: string) {
    const delta = txType==='CONSUME' ? -Math.abs(qtyDelta) : txType==='IN' ? Math.abs(qtyDelta) : txType==='OUT' ? -Math.abs(qtyDelta) : qtyDelta;
    try { await consumeAsset({ assetId, delta, type: txType, actorId: ACTOR_ID, deviceId: DEVICE_ID, overrideExpired: overrideExp }); setLog(l=>[`${txType} ${assetId} ${delta}${overrideExp?' (override)':''}`,...l].slice(0,20)); refresh(); }
    catch(e:any){ setLog(l=>[`ERR ${e.message}`,...l]); }
  }
  async function doScan() {
    if (!scan) return;
    const a = await getAssetByBarcode(scan.trim());
    if (!a) setLog(l=>[`SCAN miss ${scan}`,...l]);
    else { setLog(l=>[`SCAN hit ${a.sku} @ ${a.crate_id} qty ${a.qty}`,...l]); setHighlightCrate(a.crate_id); setTimeout(()=>setHighlightCrate(null), 3000); doConsume(a.id); }
    setScan('');
  }
  async function doIndent() {
    if (!indentAsset) return setLog(l=>['ERR select asset for indent',...l]);
    try { const r=await createIndent({ stationId: STATION_ID, assetId: indentAsset, qty: indentQty, urgency: indentUrg, createdBy: ACTOR_ID, deviceId: DEVICE_ID }); setLog(l=>[`INDENT DRAFT ${r.id.slice(0,8)} ${indentQty}x ${indentAsset}`,...l]); refresh(); } catch(e:any){ setLog(l=>[`ERR indent ${e.message}`,...l]); }
  }
  async function doReceive(id:string) {
    try { await updateIndentLocal({ indentId:id, status:'RECEIVED', actorId: ACTOR_ID, deviceId: DEVICE_ID }); setLog(l=>[`INDENT RECEIVED ${id.slice(0,8)}`,...l]); refresh(); } catch(e:any){ setLog(l=>[`ERR ${e.message}`,...l]); }
  }

  if (!loggedIn) {
    return (
      <div className="min-h-screen p-3 max-w-md mx-auto flex items-center justify-center">
        <div className="bg-polar-card rounded-xl p-6 border border-white/10 w-full space-y-4">
          <div className="text-center">
            <h1 className="text-2xl font-black">POLARIS FIELD</h1>
            <p className="text-xs text-white/50 mt-1">Station Login</p>
          </div>
          <select value={loginStation} onChange={e=>setLoginStation(e.target.value)} className="w-full bg-black/30 border border-white/10 rounded p-3 text-sm">
            <option value="ST-BHARATI">Bharati</option>
            <option value="ST-MAITRI">Maitri</option>
            <option value="ST-HIMADRI">Himadri</option>
          </select>
          <input value={deviceId} onChange={e=>setDeviceId(e.target.value)} placeholder="Device ID (auto if blank)" className="w-full bg-black/30 border border-white/10 rounded p-3 text-sm" />
          <input type="password" value={loginPin} onChange={e=>setLoginPin(e.target.value)} onKeyDown={e=>e.key==='Enter'&&doLogin()} placeholder="PIN" className="w-full bg-black/30 border border-white/10 rounded p-3 text-sm" />
          <button onClick={doLogin} className="w-full bg-polar-accent hover:opacity-90 py-3 rounded font-bold">Login</button>
          {log.length>0 && <div className="text-xs text-red-400">{log[0]}</div>}
          <p className="text-[10px] text-white/30 text-center">BHARATI-2024 / MAITRI-2024 / HIMADRI-2024</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${fontLarge?'text-lg':''} min-h-screen p-3 max-w-7xl mx-auto`}>
      <header className="flex flex-wrap gap-3 items-center justify-between bg-polar-card rounded-xl p-4 border border-white/10">
        <div>
          <h1 className="text-2xl font-black tracking-tight">POLARIS FIELD — {STATION_ID.replace('ST-','')}</h1>
          <p className="text-xs text-white/60">Offline-first • SQLite OPFS/WAL • {DEVICE_ID} • Station {STATION_ID} • PWA</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={()=>setGlove(v=>!v)} className={`glove-btn ${glove?'bg-polar-accent text-white':'bg-white/10'}`}>Glove {glove?'ON':'OFF'}</button>
          <button onClick={()=>setFontLarge(v=>!v)} className="glove-btn bg-white/10">A{fontLarge?'−':'＋'} 200%</button>
          <span className={`glove-btn ${outbox>0?'bg-amber-500 text-black':'bg-emerald-600 text-white'}`}>OUTBOX: {outbox} PENDING</span>
          <button onClick={doLogout} className="glove-btn bg-red-600/60">Logout</button>
        </div>
      </header>

      {syncStats.sent!==undefined && (
        <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
          <div className="bg-polar-card rounded p-2 border border-white/10">Sent: {syncStats.sent}<br/>Acked: {syncStats.acked??0}</div>
          <div className="bg-polar-card rounded p-2 border border-white/10">Deduped: {syncStats.deduped??0}<br/>Pending: {syncStats.pending??0}</div>
          <div className="bg-polar-card rounded p-2 border border-white/10">Saving: {syncStats.savingPct?.toFixed(1)??'—'}%<br/>Wire CRC+AES-GCM</div>
          <div className="bg-polar-card rounded p-2 border border-white/10">Duplex: Push &lt;50ms<br/>Recv: {syncStats.receivedDeltas??0} deltas</div>
        </div>
      )}

      {forecast && (
        <div className="mt-3 bg-gradient-to-r from-polar-card to-black/20 rounded-xl p-3 border border-polar-accent/30 flex flex-wrap justify-between gap-2">
          <div>
            <div className="text-xs text-white/50">Thermo forecast (ONNX {forecast.used_model?'ON':'fallback'} • physics {forecast.physics}+residual {forecast.residual})</div>
            <div className="text-xl font-black">{forecast.days_to_stockout} days <span className="text-xs font-normal text-white/60">95% CI {forecast.ci[0]}–{forecast.ci[1]} • pure physics {forecast.pure_physics_days}d</span></div>
            <div className="text-xs text-white/60">{forecast.qty}L diesel • {forecast.tele.temp_outside}°C {forecast.tele.wind_speed}m/s • {forecast.days_to_stockout<=20?'⚠ CRITICAL indent auto-created':''}</div>
          </div>
          <div className="flex gap-2 items-center">
            <button onClick={()=>sendTelemetry({ts:new Date().toISOString(), station_id:STATION_ID, temp_outside:-15, wind_speed:5, pressure:1013, dg_load:0.7, acoustic_anomaly:0.1})} className="bg-emerald-600 px-3 py-2 rounded text-xs">Calm</button>
            <button onClick={()=>sendTelemetry({ts:new Date().toISOString(), station_id:STATION_ID, temp_outside:-38, wind_speed:22, pressure:960, dg_load:0.9, acoustic_anomaly:0.1})} className="bg-red-600 px-3 py-2 rounded text-xs">Blizzard 42→18d</button>
            <button onClick={()=>sendTelemetry({ts:new Date().toISOString(), station_id:STATION_ID, temp_outside:-15, wind_speed:5, pressure:1013, dg_load:0.7, acoustic_anomaly:0.95})} className="bg-purple-600 px-3 py-2 rounded text-xs">Simulate Bearing Failure</button>
            <span className={`text-[10px] px-2 py-1 rounded ${mqttLive?'bg-emerald-600 text-white':'bg-white/10 text-white/40'}`}>{mqttLive?'MQTT LIVE':'HTTP fallback'}</span>
          </div>
        </div>
      )}

      <section className="mt-4 grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-polar-card rounded-xl p-4 border border-white/10">
            <h2 className="font-bold mb-3 flex items-center gap-2">Assets (SQLite) <span className="text-xs font-normal text-white/50">{assets.length} SKUs • tap to CONSUME/IN</span></h2>
            {/* Tx controls */}
            <div className="flex flex-wrap gap-2 mb-3 bg-black/20 rounded p-2 border border-white/5 text-sm">
              <select value={txType} onChange={e=>setTxType(e.target.value as any)} className="bg-black/40 border border-white/10 rounded px-2 py-2">
                <option value="CONSUME">CONSUME</option><option value="IN">IN</option><option value="OUT">OUT</option><option value="ADJUST">ADJUST</option>
              </select>
              <input type="number" value={qtyDelta} onChange={e=>setQtyDelta(Number(e.target.value))} className="w-20 bg-black/40 border border-white/10 rounded px-2 py-2" />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={overrideExp} onChange={e=>setOverrideExp(e.target.checked)} /> override expired</label>
              <span className="text-xs text-white/40 ml-auto">Offline → instant UI, WAL atomic</span>
            </div>
            <div className="grid gap-2 max-h-[420px] overflow-auto pr-1">
              {assets.map(a=>{
                const expSoon = isExpiringSoon(a.expiry_date);
                const expired = isExpired(a.expiry_date);
                return (
                  <div key={a.id} className={`flex flex-wrap items-center justify-between rounded-lg p-3 border ${highlightCrate===a.crate_id?'bg-amber-500/20 border-amber-500':'bg-black/20 border-white/5'}`}>
                    <div>
                      <div className="font-mono text-sm font-bold">{a.sku} <span className={`ml-1 text-xs px-2 py-0.5 rounded ${a.criticality==='CRITICAL'?'bg-red-600':a.criticality==='HIGH'?'bg-amber-500 text-black':'bg-white/20'}`}>{a.criticality}</span> {expSoon && !expired && <span className="ml-1 text-xs bg-amber-600 px-2 py-0.5 rounded">EXP &lt;30d</span>} {expired && <span className="ml-1 text-xs bg-red-600 px-2 py-0.5 rounded animate-pulse">EXPIRED {a.expiry_date}</span>}</div>
                      <div className="text-sm text-white/80">{a.name} — <b>{a.qty} {a.unit}</b> @ {a.crate_id} {a.coords} v{a.version} <span className="text-xs text-white/40">[{a.container_type}]</span></div>
                      <div className="text-xs text-white/40">barcode: {a.barcode} • cat: {a.category}{a.expiry_date?` • exp ${a.expiry_date}`:''}</div>
                    </div>
                    <div className={`flex gap-2 ${glove?'scale-105':''}`}>
                      <button onClick={()=>doConsume(a.id)} className={`glove-btn ${txType==='CONSUME'?'bg-red-600':'bg-blue-600'} hover:opacity-90`}>{txType} {txType==='IN'?'+':txType==='CONSUME'||txType==='OUT'?'-':''}{qtyDelta}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-polar-card rounded-xl p-4 border border-white/10">
            <h3 className="font-bold mb-2">2D Grid Locator — tap asset to highlight</h3>
            <LocatorWrap assets={assets} highlight={highlightCrate} onPick={setHighlightCrate} />
            <p className="text-xs text-white/30 mt-2">Coords {`{x,y}`} validated by zod at write time • out-of-bounds rejected.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-polar-card rounded-xl p-4 border border-white/10">
            <h3 className="font-bold mb-2 flex justify-between">QR / Barcode Scan <button onClick={()=>setShowQr(v=>!v)} className="text-xs bg-polar-accent px-3 py-1 rounded">{showQr?'Hide':'Scan QR'}</button></h3>
            {showQr && <div className="mb-3"><QrWrap onScan={(t)=>{ setScan(t); setTimeout(()=>{ const el=document.getElementById('scan-go'); el?.click(); },200); }} onClose={()=>setShowQr(false)} /></div>}
            <div className="flex gap-2">
              <input id="scan-input" value={scan} onChange={e=>setScan(e.target.value)} onKeyDown={e=>e.key==='Enter' && doScan()} placeholder="SKU e.g. FUEL-DIESEL-001" className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-3 text-sm" />
              <button id="scan-go" onClick={doScan} className="glove-btn bg-polar-accent">GO</button>
            </div>
            <p className="text-xs text-white/40 mt-2">html5-qrcode offline, no network. Text fallback always works.</p>
          </div>

          <div className="bg-polar-card rounded-xl p-4 border border-white/10">
            <h3 className="font-bold mb-2">Create Indent (offline → outbox → HQ)</h3>
            <div className="space-y-2">
              <select value={indentAsset} onChange={e=>setIndentAsset(e.target.value)} className="w-full bg-black/30 border border-white/10 rounded p-2 text-sm">
                <option value="">Select asset…</option>
                {assets.map(a=><option key={a.id} value={a.id}>{a.sku} — {a.qty} {a.unit}</option>)}
              </select>
              <div className="flex gap-2">
                <input type="number" value={indentQty} onChange={e=>setIndentQty(Number(e.target.value))} className="flex-1 bg-black/30 border border-white/10 rounded p-2 text-sm" />
                <select value={indentUrg} onChange={e=>setIndentUrg(e.target.value)} className="bg-black/30 border border-white/10 rounded p-2 text-sm">
                  <option>LOW</option><option>MEDIUM</option><option>CRITICAL</option>
                </select>
              </div>
              <button onClick={doIndent} className="w-full glove-btn bg-amber-600 hover:bg-amber-700">Create DRAFT indent</button>
            </div>
            <div className="mt-3 space-y-1 max-h-48 overflow-auto">
              {indents.map((ind:any)=>(
                <div key={ind.id} className="flex justify-between items-center bg-black/20 rounded p-2 border border-white/5 text-xs">
                  <span><span className="font-mono">{ind.id.slice(0,8)}</span> {ind.sku||ind.asset_id} {ind.qty_requested}x <span className={`px-1 rounded ${ind.urgency==='CRITICAL'?'bg-red-600':''}`}>{ind.urgency}</span> <span className={`px-1 rounded ${ind.status==='DRAFT'?'bg-white/20':ind.status==='APPROVED'?'bg-blue-600':ind.status==='DISPATCHED'?'bg-purple-600':'bg-emerald-600'}`}>{ind.status}</span></span>
                  {ind.status==='DISPATCHED' && <button onClick={()=>doReceive(ind.id)} className="bg-emerald-600 px-2 py-1 rounded text-xs">RECEIVED ✓</button>}
                </div>
              ))}
              {indents.length===0 && <div className="text-xs text-white/30">No indents yet</div>}
            </div>
          </div>

          <div className="bg-polar-card rounded-xl p-3 border border-white/10">
            <h3 className="font-bold text-sm mb-1">Transactions (SQLite, offline)</h3>
            <div className="space-y-1 max-h-32 overflow-auto font-mono text-xs">
              {txns.map((t:any)=><div key={t.id} className="text-white/70">{t.ts?.slice(11,19)} {t.type} {t.sku} {t.qty_delta} by {t.actor_id} <span className={t.sync_status==='PENDING'?'text-amber-400':'text-emerald-400'}>{t.sync_status}</span></div>)}
            </div>
          </div>

          <div className="bg-black/30 rounded-xl p-3 border border-white/10 h-40 overflow-auto font-mono text-xs">
            <div className="text-white/50 mb-1">— sync + audit —</div>
            {log.map((l,i)=><div key={i} className="text-white/80">{l}</div>)}
            <div className="mt-2 border-t border-white/10 pt-1 text-white/40">audit tail:</div>
            {audit.map((a:any,i:number)=><div key={i} className="text-white/50">{a.ts?.slice(11,19)} {a.action} {a.entity}</div>)}
          </div>
        </div>
      </section>

      <footer className="mt-6 text-xs text-white/30 text-center">M2: QR IN/OUT/CONSUME • expiry &lt;30d HIGH • indent DRAFT→APPROVED→DISPATCHED→RECEIVED • Glove Mode 48px • WAL + outbox → HQ</footer>
    </div>
  );
}

function QrWrap({ onScan, onClose }: { onScan:(t:string)=>void; onClose:()=>void }) {
  const [Comp, setComp]=useState<any>(null);
  useEffect(()=>{ import('../components/QrScanner').then(m=>setComp(()=>m.QrScanner)); },[]);
  if(!Comp) return <div className="text-xs text-white/30">Loading scanner…</div>;
  return <Comp onScan={onScan} onClose={onClose} />;
}

function LocatorWrap({ assets, highlight, onPick }: { assets:any[]; highlight:string|null; onPick:(id:string)=>void }) {
  const [Comp, setComp]=useState<any>(null);
  useEffect(()=>{ import('../components/Container3D').then(m=>setComp(()=>m.Container3D)); },[]);
  if(!Comp) return <div className="text-xs text-white/30 h-64 flex items-center justify-center bg-black/40 rounded-xl">Loading 3D X-Ray...</div>;
  return <Comp assets={assets} highlight={highlight} onPick={onPick} />;
}

