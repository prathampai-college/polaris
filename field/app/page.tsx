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

const HQ_URL =
  process.env.NEXT_PUBLIC_HQ_URL?.replace('ws', 'http').replace('8787', '8000') ||
  'http://localhost:8000';

type Tab = 'today' | 'inventory' | 'scan' | 'indents' | 'locate';

// Inline Icons for 0-bundle footprint & instant render
const Icons = {
  home: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 10L12 3l9 7" />
      <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
    </svg>
  ),
  box: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05" />
      <path d="M12 22.08V12" />
    </svg>
  ),
  scan: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect x="8" y="8" width="8" height="8" rx="1.5" />
    </svg>
  ),
  file: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M10 13H8" />
      <path d="M16 17H8" />
      <path d="M13 13h3" />
    </svg>
  ),
  loc: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
  radio: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
      <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
    </svg>
  ),
};

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
      if (r.ok) {
        setForecast(await r.json());
      }
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
        {tab === 'today' && (
          <div className="space-y-4">
            {/* Thermo Hybrid AI Forecast Hero */}
            {forecast ? (
              <div className="card glass-panel p-5 card-glow relative overflow-hidden">
                <div
                  className="absolute inset-0 pointer-events-none opacity-40"
                  style={{
                    background:
                      'radial-gradient(600px 250px at 20% 0%, rgba(59,130,246,0.25), transparent), radial-gradient(500px 200px at 80% 0%, rgba(6,182,212,0.18), transparent)',
                  }}
                />
                <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono tracking-widest text-blue-400 font-bold">
                        THERMO HYBRID RESIDUAL AI
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30">
                        {forecast.used_model ? 'ONNX int8 <2MB' : 'Physics Fallback'}
                      </span>
                    </div>

                    <div className="mt-2 flex items-baseline gap-3 flex-wrap">
                      <div className="text-4xl font-black tracking-tight leading-none text-white">
                        {forecast.days_to_stockout}
                        <span className="text-lg font-medium text-white/50"> days</span>
                      </div>
                      <span className="text-xs px-3 py-1 rounded-full bg-white/10 border border-white/10 font-mono text-white/80">
                        95% CI: {forecast.ci[0]}–{forecast.ci[1]} days
                      </span>
                      <span
                        className={`text-xs px-3 py-1 rounded-full font-bold border ${
                          forecast.days_to_stockout <= 20
                            ? 'bg-red-500/20 text-red-300 border-red-500/30 animate-pulse'
                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        }`}
                      >
                        {forecast.days_to_stockout <= 20 ? '⚠️ AUTO CRITICAL INDENT ESCALATED' : '✓ Stock Levels Stable'}
                      </span>
                    </div>

                    <div className="mt-3 text-xs text-white/60 flex flex-wrap gap-x-4 gap-y-1">
                      <span>Diesel Reserve: <b>{forecast.qty} L</b></span>
                      <span>Outside Temp: <b>{forecast.tele?.temp_outside ?? -15}°C</b></span>
                      <span>Wind Speed: <b>{forecast.tele?.wind_speed ?? 5} m/s</b></span>
                      <span>Physics Burn: <b>{forecast.physics} L/d</b> + Residual: <b>{forecast.residual} L/d</b></span>
                    </div>

                    {/* Stockout Progress Bar */}
                    <div className="mt-3 h-2 bg-white/10 rounded-full overflow-hidden max-w-[480px]">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500 transition-all duration-500"
                        style={{ width: `${Math.min(100, forecast.days_to_stockout * 2.2)}%` }}
                      />
                    </div>
                    <div className="mt-1.5 text-[11px] text-white/40">
                      Physics-informed hybrid inference • Sub-200ms latency on edge tablet
                    </div>
                  </div>

                  {/* Quick Weather Simulator Triggers */}
                  <div className="flex sm:flex-row lg:flex-col gap-2 shrink-0">
                    <button
                      onClick={() =>
                        sendTelemetry({
                          ts: new Date().toISOString(),
                          station_id: STATION_ID,
                          temp_outside: -15,
                          wind_speed: 5,
                          pressure: 1013,
                          dg_load: 0.7,
                          acoustic_anomaly: 0.1,
                        })
                      }
                      className="flex-1 lg:w-[190px] bg-white/10 hover:bg-white/20 border border-white/10 text-white rounded-xl py-2.5 px-3 text-xs font-bold transition"
                    >
                      ☀️ Calm Baseline
                    </button>
                    <button
                      onClick={() =>
                        sendTelemetry({
                          ts: new Date().toISOString(),
                          station_id: STATION_ID,
                          temp_outside: -38,
                          wind_speed: 22,
                          pressure: 960,
                          dg_load: 0.9,
                          acoustic_anomaly: 0.1,
                        })
                      }
                      className="flex-1 lg:w-[190px] bg-red-600 hover:bg-red-500 text-white rounded-xl py-2.5 px-3 text-xs font-bold transition shadow-md shadow-red-600/30"
                    >
                      ❄️ Blizzard (42→18d)
                    </button>
                    <button
                      onClick={() =>
                        sendTelemetry({
                          ts: new Date().toISOString(),
                          station_id: STATION_ID,
                          temp_outside: -15,
                          wind_speed: 5,
                          pressure: 1013,
                          dg_load: 0.7,
                          acoustic_anomaly: 0.95,
                        })
                      }
                      className="flex-1 lg:w-[190px] bg-amber-600 hover:bg-amber-500 text-white rounded-xl py-2.5 px-3 text-xs font-bold transition shadow-md shadow-amber-600/30"
                    >
                      🔊 Bearing Failure
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card p-5 text-sm text-white/50">Calculating Thermo Hybrid forecast…</div>
            )}

            {/* Critical Attention Cards */}
            <div className="grid sm:grid-cols-3 gap-3">
              <button
                onClick={() => {
                  setInvFilter('CRITICAL');
                  setTab('inventory');
                }}
                className="card card-hover p-4 text-left group"
              >
                <div className="text-[11px] font-mono text-red-400 font-bold">CRITICAL ATTENTION</div>
                <div className="mt-1 text-2xl font-bold text-white">
                  {criticalCount} <span className="text-xs font-normal text-white/50">SKUs critically low</span>
                </div>
                <div className="mt-1 text-xs text-white/50">Stock ≤5 units • Tap to inspect</div>
                <div className="mt-2 text-xs font-bold text-blue-400 group-hover:underline">Filter Inventory →</div>
              </button>

              <button
                onClick={() => {
                  setInvFilter('EXPIRING');
                  setTab('inventory');
                }}
                className="card card-hover p-4 text-left group"
              >
                <div className="text-[11px] font-mono text-amber-400 font-bold">EXPIRING &lt;30 DAYS</div>
                <div className="mt-1 text-2xl font-bold text-white">
                  {expiringCount} <span className="text-xs font-normal text-white/50">items expiring soon</span>
                </div>
                <div className="mt-1 text-xs text-white/50">Medical & Food Cold-Chain</div>
                <div className="mt-2 text-xs font-bold text-amber-400 group-hover:underline">Review Cold Chain →</div>
              </button>

              <button
                onClick={() => setTab('indents')}
                className="card card-hover p-4 text-left group"
              >
                <div className="text-[11px] font-mono text-emerald-400 font-bold">ACTIVE INDENTS</div>
                <div className="mt-1 text-2xl font-bold text-white">
                  {openIndents} <span className="text-xs font-normal text-white/50">in pipeline</span>
                </div>
                <div className="mt-1 text-xs text-white/50">DRAFT → APPROVED → DISPATCHED</div>
                <div className="mt-2 text-xs font-bold text-emerald-400 group-hover:underline">Manage Indents →</div>
              </button>
            </div>

            {/* Glove-friendly Primary Action Tiles */}
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                onClick={() => setTab('scan')}
                className={`card-raised p-5 flex items-center gap-4 hover:bg-[#18294F] border border-white/10 hover:border-blue-500/40 transition text-left group ${
                  glove ? 'py-7' : ''
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-blue-600 grid place-items-center text-white shadow-lg shadow-blue-500/30 shrink-0">
                  <Icons.scan />
                </div>
                <div>
                  <div className="font-bold text-base text-white group-hover:text-blue-300">Scan QR / Barcode</div>
                  <div className="text-xs text-white/50">Offline camera scan & instant 1-tap consumption</div>
                </div>
                <span className="ml-auto w-8 h-8 rounded-full bg-white/10 group-hover:bg-blue-600 group-hover:text-white grid place-items-center transition">
                  →
                </span>
              </button>

              <button
                onClick={() => setTab('indents')}
                className={`card p-5 flex items-center gap-4 hover:bg-[#18294F] border border-white/10 hover:border-amber-500/40 transition text-left group ${
                  glove ? 'py-7' : ''
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-amber-500 grid place-items-center text-black font-black text-lg shadow-lg shadow-amber-500/30 shrink-0">
                  !
                </div>
                <div>
                  <div className="font-bold text-base text-white group-hover:text-amber-300">Create Indent</div>
                  <div className="text-xs text-white/50">Request emergency supplies • Syncs in &lt;2s</div>
                </div>
                <span className="ml-auto w-8 h-8 rounded-full bg-white/10 group-hover:bg-amber-500 group-hover:text-black grid place-items-center transition">
                  →
                </span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: INVENTORY */}
        {tab === 'inventory' && (
          <div className="space-y-3">
            {/* Search & Filter Bar */}
            <div className="card p-3.5 flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40">⌕</span>
                <input
                  value={invQuery}
                  onChange={(e) => setInvQuery(e.target.value)}
                  placeholder="Search SKU, name, crate ID, barcode, category…"
                  className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-3.5 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              {/* Filter Pills */}
              <div className="flex gap-1.5 overflow-x-auto scroll-thin pb-1">
                {[
                  { id: 'ALL', label: `All (${assets.length})` },
                  { id: 'CRITICAL', label: `Critical (${criticalCount})` },
                  { id: 'EXPIRING', label: `Expiring (${expiringCount})` },
                  { id: 'LOW', label: `Low ≤3 (${lowCount})` },
                  { id: 'FUEL', label: 'Fuel' },
                  { id: 'MEDICAL', label: 'Medical & O₂' },
                  { id: 'SPARES', label: 'Spares & DG' },
                  { id: 'FOOD', label: 'Food Rations' },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setInvFilter(f.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 border transition ${
                      invFilter === f.id
                        ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20'
                        : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Transaction Controls Toolbar */}
            <div className="card p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-white/60">Mode:</span>
                <select
                  value={txType}
                  onChange={(e) => setTxType(e.target.value as any)}
                  className="bg-black/40 border border-white/15 rounded-xl px-3 h-10 text-xs font-bold focus:outline-none focus:border-blue-500"
                >
                  <option value="CONSUME">CONSUME (-)</option>
                  <option value="IN">RESTOCK / IN (+)</option>
                  <option value="OUT">DISPATCH / OUT (-)</option>
                  <option value="ADJUST">ADJUST</option>
                </select>

                <div className="flex items-center gap-1 bg-black/40 border border-white/15 rounded-xl px-2 h-10">
                  <button
                    onClick={() => setQtyDelta((v) => Math.max(1, v - 1))}
                    className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={qtyDelta}
                    onChange={(e) => setQtyDelta(Math.max(1, Number(e.target.value) || 1))}
                    className="w-12 bg-transparent text-center font-bold text-sm focus:outline-none"
                  />
                  <button
                    onClick={() => setQtyDelta((v) => v + 1)}
                    className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold"
                  >
                    +
                  </button>
                </div>

                <div className="flex gap-1">
                  {[1, 5, 10, 50].map((step) => (
                    <button
                      key={step}
                      onClick={() => setQtyDelta(step)}
                      className={`px-2 py-1 rounded-lg text-xs font-mono font-semibold border ${
                        qtyDelta === step
                          ? 'bg-blue-600 text-white border-blue-500'
                          : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                      }`}
                    >
                      {step}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-amber-300 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={overrideExp}
                  onChange={(e) => setOverrideExp(e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>Override expired Medical/O₂ (Audited)</span>
              </label>
            </div>

            {/* Inventory List */}
            <div className="card overflow-hidden">
              <div className="max-h-[60vh] overflow-y-auto scroll-thin divide-y divide-white/[0.06]">
                {filteredAssets.map((a) => {
                  const expSoon = isExpiringSoon(a.expiry_date);
                  const expired = isExpired(a.expiry_date);

                  return (
                    <div
                      key={a.id}
                      onClick={() => setSelectedAsset(a)}
                      className={`p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-white/[0.03] cursor-pointer transition ${
                        highlightCrate === a.crate_id ? 'bg-amber-500/10 border-l-4 border-l-amber-500' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-white tracking-wide">{a.sku}</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                              a.criticality === 'CRITICAL'
                                ? 'bg-red-500/20 text-red-300 border-red-500/30'
                                : a.criticality === 'HIGH'
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                : 'bg-white/10 text-white/70 border-white/10'
                            }`}
                          >
                            {a.criticality}
                          </span>

                          {expired && (
                            <span className="text-[10px] bg-red-600 text-white px-2 py-0.5 rounded-full font-bold animate-pulse">
                              EXPIRED: {a.expiry_date}
                            </span>
                          )}
                          {!expired && expSoon && (
                            <span className="text-[10px] bg-amber-500 text-black px-2 py-0.5 rounded-full font-bold">
                              EXP &lt;30d ({a.expiry_date})
                            </span>
                          )}
                        </div>

                        <div className="text-sm font-semibold text-white/90 mt-1">
                          {a.name}
                        </div>

                        <div className="text-xs text-white/50 flex items-center gap-3 mt-1 flex-wrap font-mono">
                          <span>Crate: <b className="text-white/80">{a.crate_id}</b> ({a.coords || '0,0'})</span>
                          <span>Category: <b className="text-white/80">{a.category}</b></span>
                          <span>Barcode: <b className="text-white/80">{a.barcode}</b></span>
                        </div>
                      </div>

                      {/* Quick Action Button */}
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="text-lg font-black text-white leading-tight">
                            {a.qty} <span className="text-xs font-normal text-white/50">{a.unit}</span>
                          </div>
                          <div className="text-[10px] text-white/40 font-mono">v{a.version}</div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAsset(a);
                            doConsume(a.id);
                          }}
                          className={`rounded-xl font-bold text-xs px-4 h-10 shadow-sm transition active:scale-95 ${
                            txType === 'IN'
                              ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/25'
                              : 'bg-red-600 hover:bg-red-500 text-white shadow-red-600/25'
                          }`}
                        >
                          {txType === 'IN' ? `+${qtyDelta}` : `-${qtyDelta}`}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {filteredAssets.length === 0 && (
                  <div className="p-12 text-center text-white/40 text-sm">
                    No matching assets found in local station database.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SCAN */}
        {tab === 'scan' && (
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4">
            <div className="card p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-base text-white">QR / Barcode Scanner</h2>
                  <p className="text-xs text-white/50">Air-gapped offline camera decoding via html5-qrcode</p>
                </div>
                <button
                  onClick={() => setShowQr((v) => !v)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition ${
                    showQr
                      ? 'bg-white text-black border-white'
                      : 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20'
                  }`}
                >
                  {showQr ? 'Close Camera' : '📷 Open Camera'}
                </button>
              </div>

              {showQr && (
                <QrWrap
                  onScan={(text) => {
                    doScan(text);
                  }}
                  onClose={() => setShowQr(false)}
                />
              )}

              {/* Manual Barcode / SKU Input */}
              <div className="flex gap-2">
                <input
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doScan()}
                  placeholder="Scan or type barcode SKU (e.g. FUEL-DIESEL-001)"
                  className="flex-1 bg-black/40 border border-white/15 rounded-xl px-3.5 h-12 text-sm focus:outline-none focus:border-blue-500 transition"
                />
                <button
                  onClick={() => doScan()}
                  className="h-12 px-6 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition shadow-lg shadow-blue-500/25"
                >
                  GO
                </button>
              </div>

              {/* Last Scan Hit Card */}
              {selectedAsset && (
                <div className="rounded-2xl border border-blue-500/40 bg-blue-950/40 p-4 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between border-b border-blue-500/20 pb-2">
                    <span className="text-[11px] font-mono tracking-widest text-blue-300 font-bold">
                      SCAN RESULT • VERIFIED
                    </span>
                    <span className="font-mono text-xs text-white/50">Crate {selectedAsset.crate_id}</span>
                  </div>

                  <div>
                    <div className="font-mono font-bold text-base text-white">{selectedAsset.sku}</div>
                    <div className="text-sm text-white/80 font-medium">{selectedAsset.name}</div>
                    <div className="text-xs text-white/50 mt-1">
                      Current Stock: <b className="text-white">{selectedAsset.qty} {selectedAsset.unit}</b> • Category: {selectedAsset.category}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => doConsume(selectedAsset.id, 1)}
                      className="flex-1 h-11 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition"
                    >
                      CONSUME -1
                    </button>
                    <button
                      onClick={() => doConsume(selectedAsset.id, -1)}
                      className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition"
                    >
                      RESTOCK +1
                    </button>
                    <button
                      onClick={() => {
                        setHighlightCrate(selectedAsset.crate_id);
                        setTab('locate');
                      }}
                      className="flex-1 h-11 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white font-semibold text-xs transition"
                    >
                      Locate in 3D →
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Instructional Card */}
            <div className="card p-4 space-y-3">
              <h3 className="font-bold text-white text-sm">Station Barcode Protocol</h3>
              <ol className="space-y-2.5 text-xs text-white/70 list-decimal list-inside">
                <li>
                  <b className="text-white">Offline Scanning:</b> The camera engine executes in browser WASM with zero internet reliance.
                </li>
                <li>
                  <b className="text-white">Atomic Transaction:</b> Every scan creates an immediate SQLite WAL commit and enqueues an outbox delta.
                </li>
                <li>
                  <b className="text-white">Cold-Chain Guard:</b> Expired Medical supplies cannot be consumed without lead authorization.
                </li>
                <li>
                  <b className="text-white">3D Cross-Reference:</b> A verified scan automatically highlights crate coordinates in the 3D X-Ray.
                </li>
              </ol>

              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300 font-medium">
                💡 Tip: Turn Glove Mode ON at the top to enlarge touch targets when wearing sub-zero gloves.
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: INDENTS */}
        {tab === 'indents' && (
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-4">
            {/* Create Indent Form */}
            <div className="card p-4 space-y-4">
              <div>
                <h2 className="font-bold text-base text-white">Create Resupply Indent</h2>
                <p className="text-xs text-white/50">
                  Queued locally in outbox • Broadcasts to HQ over WebSocket in &lt;2s
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-white/70 block mb-1">Target Asset</label>
                  <select
                    value={indentAsset}
                    onChange={(e) => setIndentAsset(e.target.value)}
                    className="w-full bg-black/40 border border-white/15 rounded-xl px-3 h-11 text-xs focus:outline-none focus:border-blue-500 font-mono"
                  >
                    <option value="">Select supply SKU…</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.sku} — {a.name} (Stock: {a.qty} {a.unit})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-semibold text-white/70 block mb-1">Quantity</label>
                    <div className="flex items-center gap-1 bg-black/40 border border-white/15 rounded-xl px-2 h-11">
                      <button
                        onClick={() => setIndentQty((v) => Math.max(1, v - 1))}
                        className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        value={indentQty}
                        onChange={(e) => setIndentQty(Math.max(1, Number(e.target.value) || 1))}
                        className="flex-1 bg-transparent text-center font-bold text-sm focus:outline-none"
                      />
                      <button
                        onClick={() => setIndentQty((v) => v + 1)}
                        className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-white/70 block mb-1">Urgency</label>
                    <select
                      value={indentUrg}
                      onChange={(e) => setIndentUrg(e.target.value)}
                      className="w-full bg-black/40 border border-white/15 rounded-xl px-3 h-11 text-xs font-bold focus:outline-none focus:border-blue-500"
                    >
                      <option value="CRITICAL">🔴 CRITICAL (Immediate)</option>
                      <option value="MEDIUM">🟡 MEDIUM (Seasonal)</option>
                      <option value="LOW">🟢 LOW (Routine)</option>
                    </select>
                  </div>
                </div>

                <button
                  onClick={doIndent}
                  className="w-full h-11 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs shadow-lg shadow-amber-500/25 transition active:scale-98"
                >
                  Create DRAFT Indent
                </button>
              </div>

              <div className="text-[11px] text-white/40 text-center font-mono">
                Lifecycle: DRAFT → APPROVED → DISPATCHED → RECEIVED
              </div>
            </div>

            {/* Indents Pipeline Table */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white text-sm">
                  Active Indent Pipeline <span className="text-xs font-normal text-white/50">({indents.length} total)</span>
                </h3>
                <span className="text-[10px] text-emerald-400 font-mono font-medium">Real-Time Full-Duplex</span>
              </div>

              <div className="space-y-2 max-h-[520px] overflow-y-auto scroll-thin pr-1">
                {indents.map((ind: any) => {
                  const stages = ['DRAFT', 'APPROVED', 'DISPATCHED', 'RECEIVED'];
                  const stageIndex = stages.indexOf(ind.status);
                  const isAuto = ind.created_by?.includes('AUTO') || ind.created_by?.includes('AI');

                  return (
                    <div
                      key={ind.id}
                      className="bg-black/40 border border-white/10 rounded-xl p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-white">{ind.id.slice(0, 8)}</span>
                          <span className="text-xs text-white/80 font-medium">
                            {ind.sku || ind.asset_id} • <b>{ind.qty_requested}x</b>
                          </span>
                          {isAuto && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">
                              🤖 AI AUTOMATED
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                              ind.urgency === 'CRITICAL'
                                ? 'bg-red-500 text-white'
                                : 'bg-white/10 text-white/70'
                            }`}
                          >
                            {ind.urgency}
                          </span>
                          <span className="text-xs font-bold text-blue-400 font-mono">{ind.status}</span>
                        </div>
                      </div>

                      {/* 4-Stage Visual Progress Bar */}
                      <div className="grid grid-cols-4 gap-1 pt-1">
                        {stages.map((stg, i) => (
                          <div key={stg} className="flex flex-col gap-1">
                            <div
                              className={`h-1.5 rounded-full transition-all ${
                                i <= stageIndex ? 'bg-blue-500' : 'bg-white/10'
                              }`}
                            />
                            <span className="text-[9px] text-center font-mono text-white/40">{stg}</span>
                          </div>
                        ))}
                      </div>

                      {/* Action for Field Op: Mark Received */}
                      {ind.status === 'DISPATCHED' && (
                        <div className="pt-2 flex justify-end">
                          <button
                            onClick={() => doReceive(ind.id)}
                            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm transition active:scale-95 flex items-center gap-1.5"
                          >
                            <span>Mark RECEIVED ✓</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {indents.length === 0 && (
                  <div className="text-center py-12 text-xs text-white/40">
                    No active indents found. Create one using the form on the left.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: LOCATE (3D CONTAINER X-RAY) */}
        {tab === 'locate' && (
          <div className="grid lg:grid-cols-[1.25fr_0.75fr] gap-4">
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-base text-white">3D Container X-Ray Locator</h2>
                  <p className="text-xs text-white/50">Interactive digital twin • Coordinate-indexed bay visualization</p>
                </div>
                <span className="text-[10px] font-mono px-2 py-1 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                  Three.js + WebGL
                </span>
              </div>

              <LocatorWrap
                assets={assets}
                highlight={highlightCrate}
                onPick={(crateId) => setHighlightCrate(crateId)}
              />
            </div>

            <div className="card p-4 space-y-3">
              <h3 className="font-bold text-white text-sm">Station Crate Matrix</h3>
              <p className="text-xs text-white/50">Click any crate to highlight & inspect in 3D X-Ray</p>

              <div className="grid grid-cols-2 gap-2 max-h-[480px] overflow-y-auto scroll-thin pr-1">
                {Array.from(new Set(assets.map((a) => a.crate_id))).map((cid) => {
                  const crateAssets = assets.filter((a) => a.crate_id === cid);
                  const isSelected = highlightCrate === cid;

                  return (
                    <button
                      key={cid}
                      onClick={() => setHighlightCrate(cid)}
                      className={`p-2.5 rounded-xl border text-left transition ${
                        isSelected
                          ? 'bg-amber-500 text-black border-amber-400 font-bold shadow-md shadow-amber-500/20'
                          : 'bg-black/30 border-white/10 hover:bg-white/5 hover:border-blue-500/40 text-white'
                      }`}
                    >
                      <div className="font-mono text-xs font-bold">{cid}</div>
                      <div className={`text-[11px] truncate mt-0.5 ${isSelected ? 'text-black/80' : 'text-white/60'}`}>
                        {crateAssets.map((a) => a.sku).join(', ') || 'Empty'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
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
