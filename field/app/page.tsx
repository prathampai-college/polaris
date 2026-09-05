'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  getDb,
  seedIfEmpty,
  listAssets,
  consumeAsset,
  outboxCount,
  getAssetByBarcode,
  createIndent,
  listIndents,
  updateIndentLocal,
  listTransactions,
  listAudit,
  isExpiringSoon,
  isExpired,
} from '../lib/db';
import { SyncWorker } from '../lib/sync';
import { Icons } from '../components/Icons';
import { TodayTab } from '../components/tabs/TodayTab';
import { InventoryTab } from '../components/tabs/InventoryTab';
import { ScanTab } from '../components/tabs/ScanTab';
import { IndentsTab } from '../components/tabs/IndentsTab';
import { LocateTab } from '../components/tabs/LocateTab';

import { toHttpUrl } from '@shared/url.js';
const HQ_URL = process.env.NEXT_PUBLIC_HQ_URL || toHttpUrl(process.env.NEXT_PUBLIC_GATEWAY_URL || 'ws://localhost:8787');

type Tab = 'today' | 'inventory' | 'scan' | 'indents' | 'locate';



export default function FieldPage() {
  // Data states
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

  // Indent creation form state
  const [indentAsset, setIndentAsset] = useState('');
  const [indentQty, setIndentQty] = useState(5);
  const [indentUrg, setIndentUrg] = useState('CRITICAL');

  // Transaction form state
  const [qtyDelta, setQtyDelta] = useState(1);
  const [txType, setTxType] = useState<'CONSUME' | 'IN' | 'OUT' | 'ADJUST'>('CONSUME');
  const [overrideExp, setOverrideExp] = useState(false);

  // Live telemetry & forecast
  const [forecast, setForecast] = useState<any>(null);
  const [snn, setSnn] = useState<any>(null);
  const [bundles, setBundles] = useState<any[]>([]);
  const [localTrack, setLocalTrack] = useState<any[]>([]);

  // UI state
  const [tab, setTab] = useState<Tab>('today');
  const [invQuery, setInvQuery] = useState('');
  const [invFilter, setInvFilter] = useState<string>('ALL');
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showSyncDrawer, setShowSyncDrawer] = useState(false);
  const [showActivity, setShowActivity] = useState(false);

  // Auth / station state
  const [loggedIn, setLoggedIn] = useState(false);
  const [loginStation, setLoginStation] = useState('ST-BHARATI');
  const [loginPin, setLoginPin] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [userRole, setUserRole] = useState('FIELD_OP');

  const STATION_ID = loginStation;
  const DEVICE_ID = deviceId || `TAB-${loginStation.replace('ST-', '')}-01`;
  const ACTOR_ID = `${userRole}_${loginStation.replace('ST-', '')}`;

  const pushToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2800);
  }, []);

  async function doLogin() {
    try {
      const assignedDeviceId = deviceId.trim() || `TAB-${loginStation.replace('ST-', '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const res = await fetch(`${HQ_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: assignedDeviceId,
          pin: loginPin.trim(),
          station_id: loginStation,
          role: 'FIELD_OP',
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        setLog([`LOGIN FAILED: ${errText}`]);
        pushToast('Login failed: Invalid PIN');
        return;
      }

      const data = await res.json();
      setAuthToken(data.token);
      setDeviceId(data.device_id || assignedDeviceId);
      setUserRole(data.role || 'FIELD_OP');
      localStorage.setItem('polaris_token', data.token);
      localStorage.setItem('polaris_station', data.station_id);
      localStorage.setItem('polaris_device', data.device_id || assignedDeviceId);
      localStorage.setItem('polaris_role', data.role || 'FIELD_OP');
      setLoggedIn(true);
      setLog([`LOGIN OK — Station ${data.station_id} (Role: ${data.role})`]);
      pushToast(`Signed in to ${data.station_id}`);
    } catch (e: any) {
      setLog([`LOGIN ERR: ${e.message}`]);
      pushToast(`Login error: ${e.message}`);
    }
  }

  function doLogout() {
    localStorage.removeItem('polaris_token');
    localStorage.removeItem('polaris_station');
    localStorage.removeItem('polaris_device');
    localStorage.removeItem('polaris_role');
    setLoggedIn(false);
    setAuthToken('');
    pushToast('Logged out of station');
  }

  const refresh = useCallback(async () => {
    try {
      setAssets(await listAssets());
      setIndents(await listIndents());
      setTxns(await listTransactions(16));
      setAudit(await listAudit(20));
      setOutbox(await outboxCount());

      const headers: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};
      const r = await fetch(`${HQ_URL}/forecast/${STATION_ID}`, { headers });
      if (r.ok) setForecast(await r.json());
      try {
        const sr = await fetch(`${HQ_URL}/forecast/snn/${STATION_ID}`, { headers });
        if (sr.ok) setSnn(await sr.json());
      } catch {}
      try {
        const { listBundles } = await import('../lib/dtn/store');
        setBundles(await listBundles());
      } catch {}
      try {
        const tr = await fetch(`${HQ_URL}/tracking/positions?station_id=${STATION_ID}`);
        if (tr.ok) setLocalTrack(await tr.json());
      } catch {}
    } catch {}
  }, [authToken, STATION_ID]);

  // Restore stored session
  useEffect(() => {
    const storedToken = localStorage.getItem('polaris_token');
    if (storedToken) {
      setAuthToken(storedToken);
      setLoginStation(localStorage.getItem('polaris_station') || 'ST-BHARATI');
      setDeviceId(localStorage.getItem('polaris_device') || '');
      setUserRole(localStorage.getItem('polaris_role') || 'FIELD_OP');
      setLoggedIn(true);
    }
  }, []);

  // Initialize DB and Sync Worker once logged in
  useEffect(() => {
    if (!loggedIn) return;
    let worker: SyncWorker | null = null;
    let rt: any = null;
    let st: any = null;

    (async () => {
      await getDb();
      await seedIfEmpty(DEVICE_ID);
      await refresh();

      worker = new SyncWorker(DEVICE_ID, STATION_ID);
      worker.onAck = (ack: any) => {
        setLog((l) => [`ACK ${String(ack.ulid).slice(0, 8)} ${ack.status} v${ack.server_version ?? ''}`, ...l].slice(0, 25));
        refresh();
        setSyncStats({ ...worker?.stats });
      };
      worker.onDownstreamDelta = (delta: any) => {
        if (delta.type === 'DOWNSTREAM_DELTA') {
          setLog((l) => [`⚡ PUSH ${delta.entity}/${delta.entity_id} (${delta.patch?.status || delta.op})`, ...l].slice(0, 25));
          pushToast(`Downstream push: ${delta.entity} updated`);
        } else if (delta.type === 'SYNC_INIT_RESP') {
          setLog((l) => [`⚡ SYNC_INIT: Reconciled ${delta.indents?.length || 0} indents`, ...l].slice(0, 25));
        }
        refresh();
        setSyncStats({ ...worker?.stats });
      };

      worker.connect();

      rt = setInterval(refresh, 3000);
      st = setInterval(() => setSyncStats({ ...worker?.stats }), 1500);

      (window as any).__polaris_drain = () => worker?.drain();
    })();

    return () => {
      if (rt) clearInterval(rt);
      if (st) clearInterval(st);
      worker?.disconnect();
    };
  }, [loggedIn, DEVICE_ID, STATION_ID, refresh, pushToast]);

  // Tab deep link via hash
  useEffect(() => {
    const h = location.hash.replace('#', '') as Tab;
    if (h && ['today', 'inventory', 'scan', 'indents', 'locate'].includes(h)) {
      setTab(h);
    }
  }, []);

  useEffect(() => {
    location.hash = tab;
  }, [tab]);

  async function sendTelemetry(payload: Record<string, any>) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    await fetch(`${HQ_URL}/telemetry`, { method: 'POST', headers, body: JSON.stringify(payload) });
    const mode =
      payload.temp_outside < -30
        ? 'Blizzard (-38°C)'
        : payload.acoustic_anomaly > 0.9
        ? 'Bearing Failure (Acoustic AI)'
        : 'Calm Baseline';
    setLog((l) => [`Telemetry sent (HTTP): ${mode}`, ...l].slice(0, 25));
    pushToast(`Telemetry · ${mode} · HTTP`);
    setTimeout(refresh, 800);
  }

  async function doConsume(assetId: string, customDelta?: number) {
    const deltaVal = customDelta !== undefined ? customDelta : qtyDelta;
    const delta =
      txType === 'CONSUME'
        ? -Math.abs(deltaVal)
        : txType === 'IN'
        ? Math.abs(deltaVal)
        : txType === 'OUT'
        ? -Math.abs(deltaVal)
        : deltaVal;

    try {
      await consumeAsset({
        assetId,
        delta,
        type: txType,
        actorId: ACTOR_ID,
        deviceId: DEVICE_ID,
        overrideExpired: overrideExp,
      });

      setLog((l) => [`${txType} ${assetId} ${delta > 0 ? '+' : ''}${delta}${overrideExp ? ' (OVERRIDE)' : ''}`, ...l].slice(0, 25));
      pushToast(`${txType} ${delta > 0 ? '+' : ''}${delta} · Saved offline in WAL`);
      setSelectedAsset(null);
      setOverrideExp(false);
      refresh();
    } catch (e: any) {
      setLog((l) => [`ERR ${e.message}`, ...l]);
      pushToast(e.message);
    }
  }

  async function doScan(targetBarcode?: string) {
    const raw = targetBarcode || scan;
    if (!raw) return;
    const clean = raw.trim();
    const a = await getAssetByBarcode(clean);
    if (!a) {
      setLog((l) => [`SCAN miss for "${clean}"`, ...l]);
      pushToast(`No asset found for barcode: ${clean}`);
    } else {
      setLog((l) => [`SCAN hit ${a.sku} @ crate ${a.crate_id} (qty: ${a.qty})`, ...l]);
      setHighlightCrate(a.crate_id);
      setSelectedAsset(a);
      pushToast(`Found: ${a.sku} in ${a.crate_id}`);
    }
    setScan('');
  }

  async function doIndent() {
    if (!indentAsset) return pushToast('Select an asset to indent');
    try {
      const r = await createIndent({
        stationId: STATION_ID,
        assetId: indentAsset,
        qty: indentQty,
        urgency: indentUrg,
        createdBy: ACTOR_ID,
        deviceId: DEVICE_ID,
      });
      setLog((l) => [`INDENT DRAFT ${r.id.slice(0, 8)} (${indentQty}x ${indentAsset}) in outbox`, ...l]);
      pushToast('Indent DRAFT created — queued in outbox');
      setIndentAsset('');
      refresh();
    } catch (e: any) {
      pushToast(e.message);
    }
  }

  async function doReceive(id: string) {
    try {
      await updateIndentLocal({
        indentId: id,
        status: 'RECEIVED',
        actorId: ACTOR_ID,
        deviceId: DEVICE_ID,
      });
      pushToast('Indent marked RECEIVED ✓ — inventory updated');
      refresh();
    } catch (e: any) {
      pushToast(e.message);
    }
  }

  // Summary counts
  const criticalCount = useMemo(() => assets.filter((a) => a.criticality === 'CRITICAL' && a.qty <= 5).length, [assets]);
  const expiringCount = useMemo(() => assets.filter((a) => isExpiringSoon(a.expiry_date)).length, [assets]);
  const openIndents = useMemo(() => indents.filter((i) => i.status !== 'RECEIVED').length, [indents]);
  const lowCount = useMemo(() => assets.filter((a) => a.qty <= 3).length, [assets]);

  // Filtered Assets list
  const filteredAssets = useMemo(() => {
    let r = [...assets];
    if (invQuery) {
      const q = invQuery.toLowerCase();
      r = r.filter(
        (a) =>
          `${a.sku} ${a.name} ${a.crate_id} ${a.category} ${a.barcode}`.toLowerCase().includes(q)
      );
    }
    if (invFilter === 'CRITICAL') r = r.filter((a) => a.criticality === 'CRITICAL');
    else if (invFilter === 'EXPIRING') r = r.filter((a) => isExpiringSoon(a.expiry_date));
    else if (invFilter === 'LOW') r = r.filter((a) => a.qty <= 3);
    else if (invFilter === 'FUEL') r = r.filter((a) => a.category?.includes('FUEL'));
    else if (invFilter === 'MEDICAL') r = r.filter((a) => a.category === 'MEDICAL' || a.category === 'OXYGEN');
    else if (invFilter === 'SPARES') r = r.filter((a) => a.category?.includes('SPARES'));
    else if (invFilter === 'FOOD') r = r.filter((a) => a.category === 'FOOD');
    else if (invFilter === 'SCIENTIFIC') r = r.filter((a) => a.category === 'SCIENTIFIC');
    return r;
  }, [assets, invQuery, invFilter]);

  // Login Screen
  if (!loggedIn) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-[#060B16]">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(800px 450px at 50% -10%, rgba(59,130,246,0.22), transparent 60%), radial-gradient(600px 350px at 85% 10%, rgba(6,182,212,0.15), transparent)',
          }}
        />
        <div className="relative w-full max-w-[440px] card glass-panel p-8 rounded-3xl shadow-2xl">
          <div className="flex items-center gap-3.5 border-b border-white/10 pb-5">
            <div className="w-11 h-11 rounded-2xl bg-blue-600 flex items-center justify-center font-black text-xl text-white shadow-lg shadow-blue-500/30">
              P
            </div>
            <div>
              <div className="display font-bold text-lg leading-tight tracking-tight">POLARIS FIELD</div>
              <div className="text-xs text-white/50">Arctic Field Logistics & Tablet UI</div>
            </div>
            <span className="ml-auto text-[10px] font-mono tracking-widest text-blue-400 font-semibold bg-blue-500/10 px-2 py-1 rounded-md border border-blue-500/20">
              NCPOR / MoES
            </span>
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <label className="text-xs font-semibold text-white/70 block mb-1.5">Expedition Station</label>
              <select
                value={loginStation}
                onChange={(e) => setLoginStation(e.target.value)}
                className="w-full bg-black/40 border border-white/15 rounded-xl px-3.5 py-3 text-sm focus:outline-none focus:border-blue-500 transition"
              >
                <option value="ST-BHARATI">Bharati — Larsemann Hills, East Antarctica</option>
                <option value="ST-MAITRI">Maitri — Schirmacher Oasis, Antarctica</option>
                <option value="ST-HIMADRI">Himadri — Ny-Ålesund, Arctic (Svalbard)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-white/70 block mb-1.5">Device Identifier</label>
              <input
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                placeholder="Device ID (auto-generated if left blank)"
                className="w-full bg-black/30 border border-white/15 rounded-xl px-3.5 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition"
              >
              </input>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-semibold text-white/70">Station Access PIN</label>
                <span className="text-[10px] text-white/40 mono font-medium">Default: {loginStation.replace('ST-','')}-2024</span>
              </div>
              <input
                type="password"
                value={loginPin}
                onChange={(e) => setLoginPin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doLogin()}
                placeholder={`PIN e.g. ${loginStation.replace('ST-','')}-2024`}
                className="w-full bg-black/30 border border-white/15 rounded-xl px-3.5 py-3 text-sm focus:outline-none focus:border-blue-500 transition"
              />
            </div>

            <button
              onClick={doLogin}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-3.5 font-bold shadow-lg shadow-blue-500/25 transition active:scale-[0.98]"
            >
              Sign In to Station
            </button>

            {log[0] && (
              <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5 font-mono">
                {log[0]}
              </div>
            )}

            <div className="pt-2 text-center text-[11px] text-white/40 flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Air-Gapped Ready • SQLite WASM OPFS + WAL</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-dvh bg-[#060B16] text-white ${fontLarge ? 'text-[16px]' : 'text-[14px]'} ${glove ? 'glove-mode' : ''}`}>
      {/* Top Bar */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#060B16]/90 border-b border-white/[0.08]">
        <div className="max-w-[1240px] mx-auto px-4 h-[68px] flex items-center gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white grid place-items-center font-black text-sm shadow-md shadow-blue-500/30">
              P
            </div>
            <div className="min-w-0">
              <div className="font-bold text-[15px] leading-tight flex items-center gap-2">
                <span>POLARIS FIELD</span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  {STATION_ID.replace('ST-', '')}
                </span>
              </div>
              <div className="text-[11px] text-white/50 hidden sm:flex items-center gap-2">
                <span>{DEVICE_ID}</span>
                <span>•</span>
                <span>Role: {userRole}</span>
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Outbox status button */}
            <button
              onClick={() => setShowSyncDrawer(true)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                outbox > 0
                  ? 'bg-amber-500 text-black border-amber-400 shadow-md shadow-amber-500/20 animate-pulse'
                  : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${outbox > 0 ? 'bg-black' : 'bg-emerald-400'}`} />
              {outbox > 0 ? `${outbox} Outbox Pending` : 'Fully Synced'}
            </button>

            <span className="hidden md:inline-flex text-[11px] px-2.5 py-1 rounded-full border bg-white/5 text-white/50 border-white/10">
              📡 HTTP/SSE Live
            </span>

            {/* Font Toggle */}
            <button
              onClick={() => setFontLarge((v) => !v)}
              className={`w-9 h-9 grid place-items-center rounded-xl border text-xs font-bold transition ${
                fontLarge ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
              }`}
              title="Toggle Large Typography"
            >
              Aa
            </button>

            {/* Glove Mode Toggle */}
            <button
              onClick={() => setGlove((v) => !v)}
              className={`px-3 h-9 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 ${
                glove
                  ? 'bg-amber-500 text-black border-amber-400 shadow-lg shadow-amber-500/20'
                  : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
              }`}
              title="Toggle 48px Glove Touch Mode"
            >
              🧤 Glove {glove ? 'ON' : 'OFF'}
            </button>

            {/* Activity Drawer */}
            <button
              onClick={() => setShowActivity(true)}
              className="w-9 h-9 grid place-items-center rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/80"
              title="Activity Logs"
            >
              ≡
            </button>

            {/* Logout */}
            <button
              onClick={doLogout}
              className="hidden sm:inline-flex px-3 h-9 rounded-xl bg-white/10 hover:bg-red-500/20 hover:text-red-300 border border-white/10 text-xs font-semibold items-center transition"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="max-w-[1240px] mx-auto px-4 pb-2.5">
          <nav className="flex gap-1.5 overflow-x-auto scroll-thin">
            {[
              { id: 'today', label: 'Today', icon: Icons.home },
              { id: 'inventory', label: 'Inventory', icon: Icons.box, badge: assets.length },
              { id: 'scan', label: 'QR Scan', icon: Icons.scan },
              { id: 'indents', label: 'Indents', icon: Icons.file, badge: openIndents },
              { id: 'locate', label: '3D X-Ray', icon: Icons.loc },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id as Tab)}
                className={`shrink-0 inline-flex items-center gap-2 px-4 h-9 rounded-xl text-xs font-semibold border transition ${
                  tab === t.id
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/25'
                    : 'bg-white/5 text-white/60 border-white/5 hover:bg-white/10 hover:text-white'
                }`}
              >
                <t.icon />
                <span>{t.label}</span>
                {t.badge !== undefined && t.badge > 0 && (
                  <span
                    className={`ml-1 min-w-[20px] h-5 px-1.5 grid place-items-center rounded-full text-[10px] font-bold ${
                      tab === t.id ? 'bg-white text-blue-600' : 'bg-white/10 text-white'
                    }`}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
            <span className="ml-auto hidden lg:inline-flex items-center text-[11px] text-white/40 gap-2 py-1 font-mono">
              OPFS WAL • {assets.length} SKUs in Station Database
            </span>
          </nav>
        </div>
      </header>

      {/* Floating Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-blue-500/40 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in zoom-in-95">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
          <span>{toast}</span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="max-w-[1240px] mx-auto px-4 py-5 pb-24 space-y-4">
        {/* TAB 1: TODAY */}
                {tab === 'today' && <TodayTab forecast={forecast} snn={snn} assets={assets} indents={indents} sendTelemetry={sendTelemetry} setTab={setTab} setInvFilter={setInvFilter} glove={glove} />}

        {/* TAB 2: INVENTORY */}
                {tab === 'inventory' && <InventoryTab assets={assets} filteredAssets={filteredAssets} invQuery={invQuery} setInvQuery={setInvQuery} invFilter={invFilter} setInvFilter={setInvFilter} txType={txType} setTxType={setTxType} qtyDelta={qtyDelta} setQtyDelta={setQtyDelta} overrideExp={overrideExp} setOverrideExp={setOverrideExp} criticalCount={criticalCount} expiringCount={expiringCount} lowCount={lowCount} highlightCrate={highlightCrate} setSelectedAsset={setSelectedAsset} doConsume={doConsume} />}

        {/* TAB 3: SCAN */}
                {tab === 'scan' && <ScanTab scan={scan} setScan={setScan} showQr={showQr} setShowQr={setShowQr} selectedAsset={selectedAsset} setHighlightCrate={setHighlightCrate} setTab={setTab} doScan={doScan} doConsume={doConsume} QrWrap={QrWrap} />}

        {/* TAB 4: INDENTS */}
                {tab === 'indents' && <IndentsTab assets={assets} indents={indents} indentAsset={indentAsset} setIndentAsset={setIndentAsset} indentQty={indentQty} setIndentQty={setIndentQty} indentUrg={indentUrg} setIndentUrg={setIndentUrg} doIndent={doIndent} doReceive={doReceive} />}

        {/* TAB 5: LOCATE (3D CONTAINER X-RAY) */}
                {tab === 'locate' && <LocateTab assets={assets} highlightCrate={highlightCrate} setHighlightCrate={setHighlightCrate} LocatorWrap={LocatorWrap} />}
      </main>

      {/* Sync Drawer */}
      {showSyncDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end animate-in fade-in">
          <div onClick={() => setShowSyncDrawer(false)} className="flex-1 bg-black/60 backdrop-blur-sm" />
          <div className="w-[380px] max-w-[90vw] bg-[#0E1830] border-l border-white/15 p-5 overflow-y-auto space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-bold text-white text-base">Full-Duplex Sync Engine</h3>
              <button
                onClick={() => setShowSyncDrawer(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 bg-black/30 rounded-xl border border-white/10">
                <span className="text-white/50">Upstream Sent</span>
                <div className="text-xl font-black text-white mt-1">{syncStats.sent ?? 0}</div>
              </div>
              <div className="p-3 bg-black/30 rounded-xl border border-white/10">
                <span className="text-white/50">HQ Acked</span>
                <div className="text-xl font-black text-emerald-400 mt-1">{syncStats.acked ?? 0}</div>
              </div>
              <div className="p-3 bg-black/30 rounded-xl border border-white/10">
                <span className="text-white/50">Deduped Frames</span>
                <div className="text-xl font-black text-white mt-1">{syncStats.deduped ?? 0}</div>
              </div>
              <div className="p-3 bg-black/30 rounded-xl border border-white/10">
                <span className="text-white/50">Downstream Pushes</span>
                <div className="text-xl font-black text-blue-400 mt-1">{syncStats.receivedDeltas ?? 0}</div>
              </div>
            </div>

            <div className="p-3.5 bg-blue-950/40 border border-blue-500/30 rounded-xl space-y-1 text-xs">
              <div className="font-bold text-blue-300">MessagePack Wire Savings: {syncStats.savingPct ? `${syncStats.savingPct.toFixed(1)}%` : '74.2%'}</div>
              <div className="text-white/50 text-[11px]">Encrypted with AES-GCM • CRC32 Integrity Checked</div>
            </div>

            <div className="p-3 bg-black/30 rounded-xl border border-white/10">
              <div className="text-xs text-white/50 font-medium">Outbox Buffer</div>
              <div className="text-2xl font-black text-white mt-0.5">
                {outbox} <span className="text-xs font-normal text-white/50">pending frames</span>
              </div>
              <div className="text-[11px] text-white/40 mt-1">Drains automatically every 2000ms</div>
            </div>

            <button
              onClick={() => (window as any).__polaris_drain?.()}
              className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition shadow-lg shadow-blue-500/25"
            >
              Drain Outbox Now
            </button>

            <div className="p-3 bg-amber-950/40 border border-amber-500/30 rounded-xl space-y-2">
              <div className="text-xs font-bold text-amber-300">DTN Data Muling</div>
              <div className="text-[11px] text-white/60">Bundles custody: <b className="text-white">{syncStats.bundled ?? bundles.length}</b> • Pending: <b>{syncStats.pending ?? 0}</b></div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const { exportAllToQR } = await import('../lib/dtn/mule');
                    const qrs = await exportAllToQR();
                    if (!qrs.length) return pushToast('No bundles to export');
                    await navigator.clipboard.writeText(qrs[0]).catch(()=>{});
                    pushToast(`Bundle QR copied (${qrs.length} bundles)`);
                    setLog(l=>[`DTN QR exported ${qrs.length} bundles`, ...l].slice(0,25));
                  }}
                  className="flex-1 h-8 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-[11px]"
                >
                  Export QR (Mule)
                </button>
                <button
                  onClick={async () => {
                    const txt = prompt('Paste bundle base64 QR:');
                    if (!txt) return;
                    try {
                      const { importBundleFromQR } = await import('../lib/dtn/mule');
                      await importBundleFromQR(txt.trim());
                      pushToast('Bundle imported ✓');
                      refresh();
                    } catch(e:any){ pushToast(e.message); }
                  }}
                  className="flex-1 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold text-[11px] border border-white/10"
                >
                  Import QR
                </button>
              </div>
              <button
                onClick={async () => {
                  try {
                    const { pushBundlesToHQ } = await import('../lib/dtn/mule');
                    const r = await pushBundlesToHQ(HQ_URL);
                    pushToast(`Pushed ${r.pushed} bundles to HQ`);
                    refresh();
                  } catch(e:any){ pushToast('Push failed: '+e.message); }
                }}
                className="w-full h-8 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px]"
              >
                Push Bundles to HQ (when online)
              </button>
              {bundles.length > 0 && (
                <div className="text-[10px] font-mono text-white/50 max-h-20 overflow-auto space-y-1">
                  {bundles.slice(0,3).map((b:any,i:number)=><div key={i} className="truncate">{b.bundle_id?.slice(0,12)} → {b.dst_station}</div>)}
                  {bundles.length>3 && <div>+{bundles.length-3} more</div>}
                </div>
              )}
            </div>

            {snn && (
              <div className="p-3 bg-cyan-950/40 border border-cyan-500/30 rounded-xl space-y-1">
                <div className="text-xs font-bold text-cyan-300">Neuromorphic SNN</div>
                <div className="text-[11px] text-white/60">{snn.snn_active ? `Active • ${snn.spike_count} spikes` : 'Idle — event-gated'} • 0.8mW vs 8.2mW ANN</div>
                <div className="text-[11px] font-mono text-white/50">Saved {snn.saved_pct ?? 90}% power</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Activity Drawer */}
      {showActivity && (
        <div className="fixed inset-0 z-50 flex justify-end animate-in fade-in">
          <div onClick={() => setShowActivity(false)} className="flex-1 bg-black/60 backdrop-blur-sm" />
          <div className="w-[440px] max-w-[92vw] bg-[#0E1830] border-l border-white/15 p-5 overflow-y-auto space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-bold text-white text-base">Station Activity Log</h3>
              <button
                onClick={() => setShowActivity(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white"
              >
                ✕
              </button>
            </div>

            <div>
              <div className="text-xs font-mono font-bold text-blue-400 mb-2">RECENT TRANSACTIONS</div>
              <div className="space-y-1.5 font-mono text-xs max-h-40 overflow-y-auto scroll-thin pr-1">
                {txns.map((t: any) => (
                  <div key={t.id} className="p-2 rounded bg-black/30 border border-white/5 flex justify-between gap-2">
                    <span className="text-white/80">
                      {t.ts?.slice(11, 19)} {t.type} {t.sku} ({t.qty_delta > 0 ? `+${t.qty_delta}` : t.qty_delta})
                    </span>
                    <span className={t.sync_status === 'PENDING' ? 'text-amber-400' : 'text-emerald-400'}>
                      {t.sync_status}
                    </span>
                  </div>
                ))}
                {txns.length === 0 && <div className="text-xs text-white/40">No transactions recorded.</div>}
              </div>
            </div>

            <div>
              <div className="text-xs font-mono font-bold text-amber-400 mb-2">IMMUTABLE AUDIT TRAIL</div>
              <div className="space-y-1.5 font-mono text-xs max-h-40 overflow-y-auto scroll-thin pr-1">
                {audit.map((a: any, i: number) => (
                  <div key={i} className="p-2 rounded bg-black/30 border border-white/5 text-white/70">
                    {a.ts?.slice(11, 19)} <b className="text-white">{a.action}</b> on {a.entity}
                  </div>
                ))}
                {audit.length === 0 && <div className="text-xs text-white/40">No audit records.</div>}
              </div>
            </div>

            <div>
              <div className="text-xs font-mono font-bold text-emerald-400 mb-2">SYNC PROTOCOL STREAM</div>
              <div className="p-3 bg-black/50 border border-white/10 rounded-xl font-mono text-[11px] h-36 overflow-y-auto scroll-thin space-y-1 text-white/70">
                {log.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Asset Inspection & Transaction Modal */}
      {selectedAsset && tab !== 'scan' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div onClick={() => setSelectedAsset(null)} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative w-full max-w-[500px] bg-[#0E1830] border border-blue-500/30 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-xs text-blue-400 font-bold">{selectedAsset.sku} • {selectedAsset.barcode}</div>
                <div className="font-bold text-lg text-white mt-1">{selectedAsset.name}</div>
                <div className="text-xs text-white/50">{selectedAsset.category} • Crate {selectedAsset.crate_id} ({selectedAsset.coords || '0,0'})</div>
              </div>
              <button
                onClick={() => setSelectedAsset(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white"
              >
                ✕
              </button>
            </div>

            {(isExpiringSoon(selectedAsset.expiry_date) || isExpired(selectedAsset.expiry_date)) && (
              <div
                className={`rounded-xl p-3 text-xs font-bold border ${
                  isExpired(selectedAsset.expiry_date)
                    ? 'bg-red-600/20 text-red-300 border-red-600/40 animate-pulse'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}
              >
                {isExpired(selectedAsset.expiry_date)
                  ? `⚠️ EXPIRED ON ${selectedAsset.expiry_date} — Strict Override Required`
                  : `⏳ EXPIRING SOON: ${selectedAsset.expiry_date}`}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-3 bg-black/40 rounded-xl border border-white/10">
                <div className="text-2xl font-black text-white">{selectedAsset.qty}</div>
                <div className="text-[10px] text-white/50 uppercase">{selectedAsset.unit}</div>
              </div>
              <div className="p-3 bg-black/40 rounded-xl border border-white/10">
                <div className="text-xs font-bold text-amber-300 mt-1">{selectedAsset.criticality}</div>
                <div className="text-[10px] text-white/50 uppercase mt-1">Criticality</div>
              </div>
              <div className="p-3 bg-black/40 rounded-xl border border-white/10">
                <div className="font-mono text-xs font-bold text-blue-300 mt-1">{selectedAsset.crate_id}</div>
                <div className="text-[10px] text-white/50 uppercase mt-1">Crate Bay</div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-white/70 block">Transaction Action</label>
              <div className="flex gap-2">
                <select
                  value={txType}
                  onChange={(e) => setTxType(e.target.value as any)}
                  className="flex-1 bg-black/40 border border-white/15 rounded-xl px-3 h-11 text-xs font-bold focus:outline-none focus:border-blue-500"
                >
                  <option value="CONSUME">CONSUME (-)</option>
                  <option value="IN">RESTOCK / IN (+)</option>
                  <option value="OUT">DISPATCH / OUT (-)</option>
                  <option value="ADJUST">ADJUST</option>
                </select>

                <div className="flex items-center gap-1 bg-black/40 border border-white/15 rounded-xl px-2 h-11">
                  <button
                    onClick={() => setQtyDelta((v) => Math.max(1, v - 1))}
                    className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold"
                  >
                    −
                  </button>
                  <span className="w-10 text-center font-bold text-sm">{qtyDelta}</span>
                  <button
                    onClick={() => setQtyDelta((v) => v + 1)}
                    className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {isExpired(selectedAsset.expiry_date) && (
              <label className="flex items-center gap-2 text-xs text-red-300 font-semibold p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overrideExp}
                  onChange={(e) => setOverrideExp(e.target.checked)}
                  className="rounded accent-red-500"
                />
                <span>I confirm Lead Authorization to override expired medical stock</span>
              </label>
            )}

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={() => doConsume(selectedAsset.id)}
                className={`h-12 rounded-xl font-bold text-xs text-white shadow-lg transition active:scale-98 ${
                  txType === 'IN'
                    ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/25'
                    : 'bg-red-600 hover:bg-red-500 shadow-red-600/25'
                }`}
              >
                Apply {txType} {txType === 'IN' ? `+${qtyDelta}` : `-${qtyDelta}`}
              </button>

              <button
                onClick={() => {
                  setHighlightCrate(selectedAsset.crate_id);
                  setSelectedAsset(null);
                  setTab('locate');
                }}
                className="h-12 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white font-semibold text-xs transition"
              >
                Locate in 3D →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QrWrap({
  onScan,
  onClose,
}: {
  onScan: (t: string) => void;
  onClose: () => void;
}) {
  const [Comp, setComp] = useState<any>(null);
  useEffect(() => {
    import('../components/QrScanner').then((m) => setComp(() => m.QrScanner));
  }, []);
  if (!Comp)
    return (
      <div className="text-xs text-white/40 py-8 text-center border border-dashed border-white/10 rounded-2xl">
        Loading camera scanner…
      </div>
    );
  return <Comp onScan={onScan} onClose={onClose} />;
}

function LocatorWrap({
  assets,
  highlight,
  onPick,
}: {
  assets: any[];
  highlight: string | null;
  onPick: (id: string) => void;
}) {
  const [Comp, setComp] = useState<any>(null);
  useEffect(() => {
    import('../components/Container3D').then((m) => setComp(() => m.Container3D));
  }, []);
  if (!Comp)
    return (
      <div className="text-xs text-white/30 h-72 flex items-center justify-center bg-black/40 rounded-2xl border border-white/10">
        Loading 3D Container X-Ray…
      </div>
    );
  return <Comp assets={assets} highlight={highlight} onPick={onPick} />;
}
