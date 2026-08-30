'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { TrendChart, ProcurementTable } from '../components/TrendChart';

const HQ = process.env.NEXT_PUBLIC_HQ_URL || 'http://localhost:8000';

type Tab = 'overview' | 'forecast' | 'stations' | 'indents' | 'inventory' | 'audit' | 'locate';

const Icons = {
  grid: () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  thermo: () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
      <circle cx="12" cy="10" r="0.5" />
    </svg>
  ),
  map: () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M1 6l7-3 7 3 7-3v14l-7 3-7-3-7 3z" />
      <path d="M8 3v14" />
      <path d="M15 6v14" />
    </svg>
  ),
  file: () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M10 13H8" />
      <path d="M16 17H8" />
      <path d="M13 13h3" />
    </svg>
  ),
  box: () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </svg>
  ),
  log: () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M10 13H8" />
      <path d="M16 17H8" />
    </svg>
  ),
  cube: () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05" />
    </svg>
  ),
};

// Phase 1.2: STATION_CRATES removed — scoping now via asset.station_id from GET /assets join (fallback to legacy map if station_id missing)
const LEGACY_STATION_CRATES: Record<string, string[]> = {
  'ST-BHARATI': ['C1-K1', 'C1-K2', 'C2-K1', 'C2-K2', 'C2-K3', 'C3-K1', 'C3-K2'],
  'ST-MAITRI': ['C4-K1', 'C4-K2', 'C5-K1', 'C5-K2'],
  'ST-HIMADRI': ['C6-K1'],
};

export default function HQPage() {
  const [stations, setStations] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [indents, setIndents] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [forecast, setForecast] = useState<any>(null);
  const [tele, setTele] = useState<any>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [mlOn, setMlOn] = useState(true);
  const [msg, setMsg] = useState('');
  const [sseStatus, setSseStatus] = useState<'connecting' | 'live' | 'polling'>('connecting');
  const [selectedStation, setSelectedStation] = useState('ST-BHARATI');
  const [authToken, setAuthToken] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [loginPin, setLoginPin] = useState('');
  const [procurement, setProcurement] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [indentFilter, setIndentFilter] = useState<string>('ALL');
  const [stationQ, setStationQ] = useState('');
  const [assetQ, setAssetQ] = useState('');
  const [onlyCurrentStation, setOnlyCurrentStation] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // New Indent Modal in HQ
  const [showNewIndentModal, setShowNewIndentModal] = useState(false);
  const [newIndentAsset, setNewIndentAsset] = useState('');
  const [newIndentQty, setNewIndentQty] = useState(500);
  const [newIndentUrg, setNewIndentUrg] = useState('CRITICAL');

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (authToken) h['Authorization'] = `Bearer ${authToken}`;
    return h;
  }, [authToken]);

  const pushToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  }, []);

  async function doLogin() {
    try {
      const res = await fetch(`${HQ}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: `HQ-COMMAND-${Date.now().toString().slice(-4)}`,
          pin: loginPin.trim() || 'BHARATI-2024',
          station_id: selectedStation,
          role: 'NCPOR_ADMIN', // Crucial fix: Authenticate with highest role for patch_indent permission
        }),
      });

      if (!res.ok) {
        setMsg('Login failed');
        pushToast('Login failed: Invalid PIN');
        return;
      }

      const data = await res.json();
      setAuthToken(data.token);
      localStorage.setItem('polaris_hq_token', data.token);
      setLoggedIn(true);
      pushToast('Authenticated as NCPOR Command Lead');
      load();
    } catch {
      setMsg('Login error');
      pushToast('Login network error');
    }
  }

  const load = useCallback(async () => {
    try {
      const h = headers();
      const [s, a, ind, au, fc, tl, tr, pr] = await Promise.all([
        fetch(`${HQ}/stations/overview`, { headers: h }).then((r) => r.json()).catch(() => []),
        fetch(`${HQ}/assets`, { headers: h }).then((r) => r.json()).catch(() => []),
        fetch(`${HQ}/indents?station_id=${selectedStation}`, { headers: h }).then((r) => r.json()).catch(() => []),
        fetch(`${HQ}/audit?limit=30`, { headers: h }).then((r) => r.json()).catch(() => []),
        fetch(`${HQ}/forecast/${selectedStation}`, { headers: h }).then((r) => r.json()).catch(() => null),
        fetch(`${HQ}/telemetry/latest?station_id=${selectedStation}`, { headers: h }).then((r) => r.json()).catch(() => null),
        fetch(`${HQ}/telemetry/history?station_id=${selectedStation}&days=7`, { headers: h }).then((r) => r.json()).catch(() => []),
        fetch(`${HQ}/procurement/${selectedStation}`, { headers: h }).then((r) => r.json()).catch(() => []),
      ]);

      setStations(s || []);
      setAssets(a || []);
      setIndents(ind || []);
      setAudit(au || []);
      setForecast(fc);
      setTele(tl?.temp_outside ? tl : fc?.tele);
      if (tr && tr.length) setTrend(tr);
      if (pr && pr.length) setProcurement(pr);
    } catch (e: any) {
      setMsg(e.message);
    }
  }, [headers, selectedStation]);

  // Restore stored session
  useEffect(() => {
    const stored = localStorage.getItem('polaris_hq_token');
    if (stored) {
      setAuthToken(stored);
      setLoggedIn(true);
    }
  }, []);

  // Poll & SSE Live Stream
  useEffect(() => {
    load();
    const poll = setInterval(load, 8000);
    let es: EventSource | null = null;

    try {
      es = new EventSource(`${HQ}/telemetry/stream`);
      es.onopen = () => setSseStatus('live');
      es.addEventListener('telemetry', ((ev: MessageEvent) => {
        try {
          const t = JSON.parse(ev.data);
          if (t.station_id === selectedStation) {
            setTele(t);
            setTrend((prev) => {
              const nxt = [
                ...prev,
                {
                  day: t.ts?.slice(11, 16) || 'live',
                  qty: t.qty || prev[prev.length - 1]?.qty || 4200,
                  forecast: t.forecast,
                  avg_temp: t.temp_outside,
                  avg_load: t.dg_load,
                  wind_speed: t.wind_speed,
                },
              ];
              return nxt.length > 14 ? nxt.slice(-14) : nxt;
            });
          }
        } catch {}
      }) as EventListener);

      es.onerror = () => {
        setSseStatus('polling');
        es?.close();
      };
    } catch {
      setSseStatus('polling');
    }

    return () => {
      clearInterval(poll);
      es?.close();
    };
  }, [selectedStation, load]);

  // Tab deep link via hash
  useEffect(() => {
    const h = location.hash.replace('#', '') as Tab;
    if (h && ['overview', 'forecast', 'stations', 'indents', 'inventory', 'audit', 'locate'].includes(h)) {
      setTab(h);
    }
  }, []);

  useEffect(() => {
    location.hash = tab;
  }, [tab]);

  async function sendTelemetry(mode: 'calm' | 'blizzard' | 'acoustic') {
    const payload =
      mode === 'blizzard'
        ? { ts: new Date().toISOString(), station_id: selectedStation, temp_outside: -38, wind_speed: 22, pressure: 960, dg_load: 0.9, acoustic_anomaly: 0.1 }
        : mode === 'acoustic'
        ? { ts: new Date().toISOString(), station_id: selectedStation, temp_outside: -15, wind_speed: 5, pressure: 1013, dg_load: 0.7, acoustic_anomaly: 0.95 }
        : { ts: new Date().toISOString(), station_id: selectedStation, temp_outside: -15, wind_speed: 5, pressure: 1013, dg_load: 0.7, acoustic_anomaly: 0.1 };

    await fetch(`${HQ}/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers() },
      body: JSON.stringify(payload),
    });

    pushToast(`Telemetry trigger: ${mode.toUpperCase()}`);
    setTimeout(load, 600);
  }

  async function updateIndent(id: string, status: string) {
    try {
      let vessel_imo: string | undefined;
      if (status === 'DISPATCHED') {
        try {
          const vr = await fetch(`${HQ}/vessels?station_id=${selectedStation}`, { headers: headers() });
          const vlist = await vr.json();
          if (Array.isArray(vlist) && vlist.length) vessel_imo = vlist[0].imo;
        } catch {}
      }
      const body: any = { status, actor_id: 'NCPOR_ADMIN' };
      if (vessel_imo) body.vessel_imo = vessel_imo;
      const res = await fetch(`${HQ}/indents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        pushToast(`Error updating indent: ${text}`);
        return;
      }

      const j = await res.json();
      pushToast(`Indent updated: ${status} (${j.id?.slice(0, 8)})`);
      load();
    } catch (e: any) {
      pushToast(`Error: ${e.message}`);
    }
  }

  async function handleCreateHQIndent() {
    if (!newIndentAsset) return pushToast('Select asset');
    try {
      const res = await fetch(`${HQ}/indents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({
          station_id: selectedStation,
          asset_id: newIndentAsset,
          qty_requested: Number(newIndentQty) || 10,
          urgency: newIndentUrg,
          created_by: 'HQ_COMMAND',
          status: 'APPROVED',
        }),
      });

      if (res.ok) {
        pushToast('Emergency Resupply Indent Created & Approved');
        setShowNewIndentModal(false);
        setNewIndentAsset('');
        load();
      }
    } catch (e: any) {
      pushToast(e.message);
    }
  }

  // Station-scoped Assets vs All Assets (Phase 1.2: prefer server station_id, fallback to legacy crate map)
  const currentStationAssets = useMemo(() => {
    const hasStationId = assets.some((a: any) => a.station_id);
    if (hasStationId) return assets.filter((a: any) => a.station_id === selectedStation);
    const crates = LEGACY_STATION_CRATES[selectedStation] || [];
    return assets.filter((a: any) => crates.includes(a.crate_id));
  }, [assets, selectedStation]);

  const displayedAssets = useMemo(() => {
    let list = onlyCurrentStation ? currentStationAssets : assets;
    if (assetQ) {
      const q = assetQ.toLowerCase();
      list = list.filter((a: any) => `${a.sku} ${a.name} ${a.crate_id} ${a.category}`.toLowerCase().includes(q));
    }
    return list;
  }, [assets, currentStationAssets, onlyCurrentStation, assetQ]);

  const expiring = useMemo(
    () => assets.filter((a: any) => a.expiry_date && new Date(a.expiry_date).getTime() - Date.now() < 30 * 86400000),
    [assets]
  );

  const filteredIndents = useMemo(() => {
    if (indentFilter === 'ALL') return indents;
    if (indentFilter === 'CRITICAL') return indents.filter((i: any) => i.urgency === 'CRITICAL');
    return indents.filter((i: any) => i.status === indentFilter);
  }, [indents, indentFilter]);

  const kpi = useMemo(
    () => ({
      stations: stations.length || 3,
      skus: assets.length,
      critical: stations.reduce((s: any, x: any) => s + (x.critical_low || 0), 0),
      open: stations.reduce((s: any, x: any) => s + (x.open_indents || 0), 0),
      expiring: expiring.length,
    }),
    [stations, assets, expiring]
  );

  const stationNameMap: Record<string, string> = {
    'ST-BHARATI': 'Bharati (East Antarctica)',
    'ST-MAITRI': 'Maitri (Antarctica)',
    'ST-HIMADRI': 'Himadri (Arctic)',
  };

  return (
    <div className="min-h-dvh bg-[#050914] text-white">
      {/* Header */}
      <header
        className="sticky top-0 z-40 border-b border-white/[0.08]"
        style={{
          background: 'linear-gradient(180deg, rgba(12,21,46,0.92), rgba(5,9,20,0.94))',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div className="max-w-[1400px] mx-auto px-4 h-[68px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white grid place-items-center font-black shadow-lg shadow-blue-500/30">
              ◈
            </div>
            <div>
              <div className="display font-bold text-base leading-tight tracking-tight flex items-center gap-2">
                <span>POLARIS HQ</span>
                <span className="text-xs font-normal text-white/50 hidden sm:inline">
                  • NCPOR / MoES Fleet Command
                </span>
              </div>
              <div className="text-[11px] text-white/40 hidden md:block">
                Fleet Management • Thermo Hybrid AI • Real-Time Indent Dispatch
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Station Selector */}
            <select
              value={selectedStation}
              onChange={(e) => setSelectedStation(e.target.value)}
              className="bg-black/40 border border-white/15 rounded-xl px-3.5 h-10 text-xs font-semibold focus:outline-none focus:border-blue-500"
            >
              <option value="ST-BHARATI">🇮🇳 Bharati — Antarctica</option>
              <option value="ST-MAITRI">🇮🇳 Maitri — Antarctica</option>
              <option value="ST-HIMADRI">🇮🇳 Himadri — Arctic</option>
            </select>

            {/* Live SSE status */}
            <span
              className={`hidden sm:inline-flex items-center gap-1.5 text-xs px-3 h-8 rounded-full border ${
                sseStatus === 'live'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/25'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${sseStatus === 'live' ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
              {sseStatus === 'live' ? 'LIVE SATELLITE SSE' : 'POLLING 8s'}
            </span>

            {/* Auth status / Login */}
            {loggedIn ? (
              <div className="flex items-center gap-2">
                <span className="hidden lg:inline-flex text-[11px] px-2.5 py-1 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 font-mono">
                  NCPOR_ADMIN
                </span>
                <button
                  onClick={() => {
                    setLoggedIn(false);
                    setAuthToken('');
                    localStorage.removeItem('polaris_hq_token');
                    pushToast('Logged out');
                  }}
                  className="h-9 px-3.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold transition"
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="password"
                  value={loginPin}
                  onChange={(e) => setLoginPin(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doLogin()}
                  placeholder="PIN"
                  className="w-24 bg-black/40 border border-white/15 rounded-xl px-2.5 h-9 text-xs"
                />
                <button
                  onClick={doLogin}
                  className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-md shadow-blue-500/25"
                >
                  Login
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Grid Layout */}
      <div className="max-w-[1400px] mx-auto px-4 py-4 flex gap-4">
        {/* Left Sidebar Menu */}
        <aside className="hidden lg:block w-[230px] shrink-0 sticky top-[84px] h-fit space-y-3">
          <div className="card p-2 space-y-1">
            {[
              { id: 'overview', label: 'Fleet Overview', icon: Icons.grid, desc: '3 Polar Stations' },
              { id: 'forecast', label: 'Thermo AI Forecast', icon: Icons.thermo, desc: 'Physics + ML Model' },
              { id: 'stations', label: 'Station Assets', icon: Icons.map, desc: 'Containers & Crates' },
              { id: 'indents', label: 'Indent Workbench', icon: Icons.file, desc: `${indents.length} active indents` },
              { id: 'inventory', label: 'Fleet Inventory', icon: Icons.box, desc: `${assets.length} total SKUs` },
              { id: 'audit', label: 'Audit Trail', icon: Icons.log, desc: 'Immutable Log' },
              { id: 'locate', label: '3D Digital Twin', icon: Icons.cube, desc: 'Container Twin' },
            ].map((it) => (
              <button
                key={it.id}
                onClick={() => setTab(it.id as Tab)}
                className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition ${
                  tab === it.id
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className={`w-8 h-8 rounded-lg grid place-items-center ${tab === it.id ? 'bg-white/20' : 'bg-white/5'}`}>
                  <it.icon />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-bold leading-tight">{it.label}</div>
                  <div className={`text-[10px] truncate ${tab === it.id ? 'text-white/80' : 'text-white/40'}`}>{it.desc}</div>
                </div>
              </button>
            ))}

            <div className="mt-3 mx-1 p-3 rounded-xl bg-gradient-to-br from-blue-900/50 to-cyan-900/50 border border-blue-500/30 text-white space-y-1">
              <div className="text-xs font-bold text-blue-300">NCPOR Central Command</div>
              <div className="text-[10px] text-white/70">Encrypted WebSocket Delta Gateway</div>
              <div className="text-[10px] text-emerald-400 font-mono">Air-Gap Ready • Sub-50ms push</div>
            </div>
          </div>

          {/* Quick Stats Pill */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="card p-2.5">
              <div className="text-lg font-black text-red-400">{kpi.critical}</div>
              <div className="text-[10px] text-white/40">Critical</div>
            </div>
            <div className="card p-2.5">
              <div className="text-lg font-black text-amber-400">{kpi.open}</div>
              <div className="text-[10px] text-white/40">Open Indents</div>
            </div>
            <div className="card p-2.5">
              <div className="text-lg font-black text-blue-400">{kpi.expiring}</div>
              <div className="text-[10px] text-white/40">Expiring</div>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 pb-16 lg:pb-0 space-y-4">
          {/* Toast Notification */}
          {toast && (
            <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-blue-500/40 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in zoom-in-95">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
              <span>{toast}</span>
            </div>
          )}

          {/* Top KPI Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            <div className="card p-3.5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 grid place-items-center text-blue-400">
                <Icons.map />
              </div>
              <div>
                <div className="text-[10px] font-mono tracking-wider text-white/40 font-bold">POLAR FLEET</div>
                <div className="text-base font-black text-white">{kpi.stations} Stations</div>
                <div className="text-[11px] text-white/50">{kpi.skus} Total SKUs</div>
              </div>
            </div>

            <div className="card p-3.5">
              <div className="text-[10px] font-mono tracking-wider text-white/40 font-bold">STOCKOUT HORIZON</div>
              <div className="text-base font-black text-white mt-0.5 flex items-baseline gap-2">
                <span>{forecast?.days_to_stockout ?? '—'} days</span>
                <span
                  className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                    forecast?.days_to_stockout <= 20 ? 'bg-red-500 text-white animate-pulse' : 'bg-emerald-500/20 text-emerald-300'
                  }`}
                >
                  {forecast?.days_to_stockout <= 20 ? 'CRITICAL' : 'STABLE'}
                </span>
              </div>
              <div className="w-full h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-red-500"
                  style={{ width: `${Math.min(100, (forecast?.days_to_stockout || 40) * 2.2)}%` }}
                />
              </div>
            </div>

            <div className="card p-3.5">
              <div className="text-[10px] font-mono tracking-wider text-white/40 font-bold">TELEMETRY SENSORS</div>
              <div className="text-sm font-bold text-white mt-0.5">
                {tele?.temp_outside ?? -15}°C • {tele?.wind_speed ?? 5} m/s
              </div>
              <div className="text-[11px] text-white/50">
                {tele?.pressure ?? 1013} hPa • DG Load: {Math.round((tele?.dg_load ?? 0.7) * 100)}%
              </div>
            </div>

            <div className="card p-3.5">
              <div className="text-[10px] font-mono tracking-wider text-white/40 font-bold">INDENT PIPELINE</div>
              <div className="text-base font-black text-white mt-0.5">{indents.length} Orders</div>
              <div className="text-[11px] text-white/50">
                {indents.filter((i: any) => i.status === 'DRAFT').length} Draft • {indents.filter((i: any) => i.status === 'APPROVED').length} Approved
              </div>
            </div>

            <div className="card p-3.5 col-span-2 sm:col-span-1">
              <div className="text-[10px] font-mono tracking-wider text-white/40 font-bold">PRE-WINTER PROCUREMENT</div>
              <div className="text-sm font-bold text-white mt-0.5">{procurement.length} Urgent Needs</div>
              <div className="text-[11px] text-amber-400 font-semibold">Auto-Resupply Prioritized</div>
            </div>
          </div>

          {/* TAB 1: FLEET OVERVIEW */}
          {tab === 'overview' && (
            <div className="space-y-4">
              {/* Thermo Hybrid AI Hero Banner */}
              {forecast && (
                <div className="card card-glow p-5 relative overflow-hidden bg-gradient-to-br from-[#0C1733] to-[#0A1124]">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                    <div className="space-y-2 max-w-2xl">
                      <div className="flex items-center gap-2">
                        <h2 className="display font-bold text-lg text-white">Thermo Hybrid AI Prognostics</h2>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30">
                          {forecast.used_model ? 'ONNX int8 <2MB' : 'Physics Fallback'}
                        </span>
                      </div>

                      <div className="text-xs text-white/60">
                        Station: <b>{stationNameMap[selectedStation] || selectedStation}</b> • Diesel Stock: <b>{forecast.qty} L</b>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          onClick={() => sendTelemetry('calm')}
                          className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold transition border border-white/10"
                        >
                          ☀️ Calm Baseline
                        </button>
                        <button
                          onClick={() => sendTelemetry('blizzard')}
                          className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition shadow-md shadow-red-600/30 animate-pulse"
                        >
                          ❄️ Blizzard (42→18d)
                        </button>
                        <button
                          onClick={() => sendTelemetry('acoustic')}
                          className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition shadow-md shadow-amber-600/30"
                        >
                          🔊 Bearing Failure AI
                        </button>
                        <button
                          onClick={() => setMlOn((v) => !v)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                            mlOn ? 'bg-blue-600 text-white border-blue-500' : 'bg-white/5 text-white/50 border-white/10'
                          }`}
                        >
                          ML Residual {mlOn ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      <div className="text-[11px] text-white/50 font-mono">
                        Formula: Physics {forecast.physics} L/d + ML Residual {forecast.residual} L/d = <b>{forecast.total_per_day} L/d Total Burn</b> (95% CI: {forecast.ci[0]}–{forecast.ci[1]}d)
                      </div>
                    </div>

                    {/* Stockout Counter & Gauge */}
                    <div className="bg-black/40 border border-white/10 rounded-2xl p-4 min-w-[260px] text-left lg:text-right space-y-1">
                      <div className="text-[10px] font-mono text-white/40 tracking-wider font-bold">DAYS TO DIESEL STOCKOUT</div>
                      <div className="text-4xl font-black text-white">
                        {forecast.days_to_stockout} <span className="text-sm font-normal text-white/50">days</span>
                      </div>
                      <div className="text-xs text-amber-400 font-semibold">
                        {forecast.days_to_stockout <= 20 ? '⚠️ Critical Stockout Risk' : '✓ Safe Buffer'}
                      </div>
                      <div className="w-full h-2 bg-white/10 rounded-full mt-2 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500"
                          style={{ width: `${Math.min(100, forecast.days_to_stockout * 2.2)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 3 Polar Station Summary Cards */}
              <div className="grid md:grid-cols-3 gap-3">
                {stations.map((s: any) => {
                  const isCurrent = s.id === selectedStation;
                  return (
                    <div
                      key={s.id}
                      onClick={() => setSelectedStation(s.id)}
                      className={`card p-4.5 cursor-pointer transition relative ${
                        isCurrent ? 'border-blue-500 bg-[#0E1A38] shadow-xl shadow-blue-500/10' : 'hover:border-white/20'
                      }`}
                    >
                      {isCurrent && (
                        <span className="absolute top-3 right-3 text-[9px] px-2 py-0.5 rounded-full bg-blue-500 text-white font-bold">
                          SELECTED
                        </span>
                      )}

                      <div className="font-bold text-base text-white">{s.name} Station</div>
                      <div className="text-xs text-white/50 font-mono mt-0.5">{s.id}</div>

                      <div className="grid grid-cols-3 gap-2 text-center mt-3 pt-3 border-t border-white/10">
                        <div className="p-2 bg-black/30 rounded-xl border border-white/5">
                          <div className="text-base font-black text-white">{s.containers ?? 2}</div>
                          <div className="text-[10px] text-white/40 uppercase">Bays</div>
                        </div>
                        <div className="p-2 bg-black/30 rounded-xl border border-white/5">
                          <div className="text-base font-black text-white">{s.assets ?? 10}</div>
                          <div className="text-[10px] text-white/40 uppercase">SKUs</div>
                        </div>
                        <div className="p-2 bg-black/30 rounded-xl border border-white/5">
                          <div className="text-base font-black text-white">{s.winter_crew_count}</div>
                          <div className="text-[10px] text-white/40 uppercase">Crew</div>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between text-xs pt-1">
                        <span className="text-white/60">Stockout Forecast:</span>
                        <span className="font-bold text-white font-mono">
                          {s.days_to_stockout ?? forecast?.days_to_stockout ?? '38'} days
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Telemetry Chart & Procurement Planner */}
              <div className="grid lg:grid-cols-2 gap-4">
                <TrendChart data={trend} stationName={stationNameMap[selectedStation] || selectedStation} />
                <ProcurementTable
                  rows={procurement}
                  onCreateIndent={(sku, need) => {
                    setNewIndentAsset(sku);
                    setNewIndentQty(need);
                    setShowNewIndentModal(true);
                  }}
                />
              </div>
            </div>
          )}

          {/* TAB 2: FORECAST & AI */}
          {tab === 'forecast' && (
            <div className="space-y-4">
              <div className="card p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h2 className="display font-bold text-lg text-white">Thermo Hybrid Inference Engine</h2>
                    <p className="text-xs text-white/50">Physics First-Principles + ML Neural Network Residual Model</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => sendTelemetry('calm')}
                      className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold transition border border-white/10"
                    >
                      ☀️ Calm
                    </button>
                    <button
                      onClick={() => sendTelemetry('blizzard')}
                      className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition shadow-md shadow-red-600/25"
                    >
                      ❄️ Blizzard (42→18d)
                    </button>
                    <button
                      onClick={() => sendTelemetry('acoustic')}
                      className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition shadow-md shadow-amber-600/25"
                    >
                      🔊 Bearing Anomaly
                    </button>
                  </div>
                </div>

                {forecast && (
                  <div className="grid lg:grid-cols-3 gap-3">
                    <div className="p-4 bg-black/40 border border-white/10 rounded-2xl space-y-1">
                      <div className="text-xs text-white/50 font-medium">Physics Burn Rate</div>
                      <div className="text-2xl font-black text-white">{forecast.physics} <span className="text-xs font-normal text-white/50">L/day</span></div>
                      <div className="text-[11px] text-white/40 font-mono">110 × (1 + 0.012ΔT + 0.018W) + 0.08ΔP</div>
                    </div>

                    <div className="p-4 bg-black/40 border border-white/10 rounded-2xl space-y-1">
                      <div className="text-xs text-white/50 font-medium">ML Neural Residual</div>
                      <div className="text-2xl font-black text-cyan-400">+{forecast.residual} <span className="text-xs font-normal text-white/50">L/day</span></div>
                      <div className="text-[11px] text-white/40 font-mono">Tiny MLP 5→16→8→1 (1.3KB ONNX)</div>
                    </div>

                    <div className="p-4 bg-black/40 border border-white/10 rounded-2xl space-y-1">
                      <div className="text-xs text-white/50 font-medium">Days to Zero Fuel</div>
                      <div className="text-2xl font-black text-amber-400">{forecast.days_to_stockout} <span className="text-xs font-normal text-white/50">days</span></div>
                      <div className="text-[11px] text-white/40 font-mono">95% CI: {forecast.ci[0]}–{forecast.ci[1]} days</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                <TrendChart data={trend} stationName={stationNameMap[selectedStation] || selectedStation} />
                <ProcurementTable rows={procurement} />
              </div>
            </div>
          )}

          {/* TAB 3: STATIONS */}
          {tab === 'stations' && (
            <div className="space-y-4">
              <div className="card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-base text-white">Station Digital Twin & Containers</h2>
                    <p className="text-xs text-white/50">View coordinate-indexed supply bays across polar stations</p>
                  </div>
                  <span className="text-xs font-mono text-blue-400">{stationNameMap[selectedStation] || selectedStation}</span>
                </div>

                <LocatorWrap assets={assets} highlight={null} />
              </div>
            </div>
          )}

          {/* TAB 4: INDENTS WORKBENCH */}
          {tab === 'indents' && (
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="display font-bold text-base text-white">Indent Operations Workbench</h2>
                  <p className="text-xs text-white/50">
                    Real-time state machine: DRAFT → APPROVED → DISPATCHED → RECEIVED
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex gap-1 overflow-x-auto scroll-thin">
                    {['ALL', 'DRAFT', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'CRITICAL'].map((k) => (
                      <button
                        key={k}
                        onClick={() => setIndentFilter(k)}
                        className={`px-3 py-1 rounded-xl text-xs font-semibold border transition ${
                          indentFilter === k
                            ? 'bg-blue-600 text-white border-blue-500'
                            : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => setShowNewIndentModal(true)}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition shadow-md shadow-amber-500/20"
                  >
                    + New HQ Indent
                  </button>
                </div>
              </div>

              {/* Indents Table */}
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-white/40 text-left">
                      <th className="py-2.5 px-2">Indent ID</th>
                      <th className="py-2.5 px-2">Station</th>
                      <th className="py-2.5 px-2">Supply SKU</th>
                      <th className="py-2.5 px-2 text-center">Qty</th>
                      <th className="py-2.5 px-2 text-center">Urgency</th>
                      <th className="py-2.5 px-2 text-center">Status</th>
                      <th className="py-2.5 px-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIndents.map((ind: any) => (
                      <tr key={ind.id} className="border-b border-white/5 hover:bg-white/[0.03] transition">
                        <td className="py-3 px-2 font-mono font-bold text-white">{ind.id.slice(0, 8)}</td>
                        <td className="py-3 px-2 text-white/70">{ind.station_id || selectedStation}</td>
                        <td className="py-3 px-2">
                          <div className="font-mono font-bold text-white">{ind.sku || ind.asset_id}</div>
                          <div className="text-[10px] text-white/40">Created by {ind.created_by}</div>
                        </td>
                        <td className="py-3 px-2 text-center font-bold text-white text-sm">{ind.qty_requested}</td>
                        <td className="py-3 px-2 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold ${
                              ind.urgency === 'CRITICAL' ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-white/10 text-white/70'
                            }`}
                          >
                            {ind.urgency}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-center">
                          <span
                            className={`px-2.5 py-0.5 rounded-full font-bold font-mono ${
                              ind.status === 'DRAFT'
                                ? 'bg-amber-500 text-black'
                                : ind.status === 'APPROVED'
                                ? 'bg-blue-600 text-white'
                                : ind.status === 'DISPATCHED'
                                ? 'bg-purple-600 text-white'
                                : 'bg-emerald-600 text-white'
                            }`}
                          >
                            {ind.status}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right">
                          <div className="flex gap-1.5 justify-end">
                            {ind.status === 'DRAFT' && (
                              <button
                                onClick={() => updateIndent(ind.id, 'APPROVED')}
                                className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-sm transition"
                              >
                                Approve →
                              </button>
                            )}
                            {ind.status === 'APPROVED' && (
                              <button
                                onClick={() => updateIndent(ind.id, 'DISPATCHED')}
                                className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-sm transition"
                              >
                                Dispatch 🚢
                              </button>
                            )}
                            {ind.status === 'DISPATCHED' && (
                              <button
                                onClick={() => updateIndent(ind.id, 'RECEIVED')}
                                className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm transition"
                              >
                                Mark Received ✓
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredIndents.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-white/40">
                          No indents match this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: FLEET INVENTORY */}
          {tab === 'inventory' && (
            <div className="space-y-3">
              <div className="card p-3.5 flex flex-col sm:flex-row justify-between gap-3">
                <div className="flex-1 relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40">⌕</span>
                  <input
                    value={assetQ}
                    onChange={(e) => setAssetQ(e.target.value)}
                    placeholder="Search SKU, item name, crate bay, category…"
                    className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-3.5 py-2 text-xs placeholder:text-white/30 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOnlyCurrentStation((v) => !v)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                      onlyCurrentStation
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    {onlyCurrentStation ? `Scoped to ${selectedStation}` : 'Showing All Stations'}
                  </button>
                </div>
              </div>

              <div className="card overflow-hidden">
                <div className="max-h-[64vh] overflow-y-auto scroll-thin divide-y divide-white/[0.06]">
                  {displayedAssets.map((a: any) => (
                    <div key={a.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-white">{a.sku}</span>
                          <span
                            className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                              a.criticality === 'CRITICAL'
                                ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                : 'bg-white/10 text-white/70'
                            }`}
                          >
                            {a.criticality}
                          </span>
                          {a.expiry_date && (
                            <span className="text-[10px] text-amber-400 font-mono">exp {a.expiry_date}</span>
                          )}
                        </div>
                        <div className="text-sm font-semibold text-white/90 mt-0.5">{a.name}</div>
                        <div className="text-xs text-white/50 font-mono mt-0.5">
                          Crate {a.crate_id} • Barcode: {a.barcode} • Cat: {a.category}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-lg font-black text-white">
                          {a.qty} <span className="text-xs font-normal text-white/50">{a.unit}</span>
                        </div>
                        <div className="text-[10px] text-white/40 font-mono">v{a.version}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: AUDIT TRAIL */}
          {tab === 'audit' && (
            <div className="card p-5 space-y-4">
              <div>
                <h2 className="display font-bold text-base text-white">Immutable Compliance & Audit Trail</h2>
                <p className="text-xs text-white/50">Append-only cryptographic audit records across all expedition stations</p>
              </div>

              <div className="space-y-2 max-h-[560px] overflow-y-auto scroll-thin pr-1">
                {audit.map((a: any, i: number) => (
                  <div key={i} className="p-3 bg-black/40 border border-white/10 rounded-xl flex items-start gap-3">
                    <span className="font-mono text-xs text-blue-400 shrink-0 mt-0.5">
                      {a.ts?.slice(11, 19) || a.ts?.slice(0, 19)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span>{a.action}</span>
                        <span className="text-white/40 font-normal">• {a.entity}</span>
                        <span className="text-xs text-amber-400 font-mono ml-auto">Actor: {a.actor_id}</span>
                      </div>
                      {a.after && (
                        <div className="text-[11px] font-mono text-white/60 truncate mt-1 bg-black/30 p-1.5 rounded">
                          {typeof a.after === 'string' ? a.after : JSON.stringify(a.after)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 7: 3D CONTAINER TWIN + Phase 4 Vessel Tracker */}
          {tab === 'locate' && (
            <div className="space-y-4">
              <div className="card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="display font-bold text-base text-white">Vessel Tracker — Live AIS + Mock Fallback</h2>
                    <p className="text-xs text-white/50">Adaptive AISHub (live lat/lon/sog/eta) → 429/no key → vessel_schedule.json mock — sync-gateway DOWNSTREAM_DELTA to field</p>
                  </div>
                  <span className="text-xs font-mono text-blue-400">{stationNameMap[selectedStation] || selectedStation}</span>
                </div>
                <VesselMapWrap stationId={selectedStation} />
              </div>

              <div className="card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="display font-bold text-base text-white">3D Digital Twin — Fleet Container Bay</h2>
                    <p className="text-xs text-white/50">Real-time crate synchronization mirroring field operations</p>
                  </div>
                  <span className="text-xs font-mono text-blue-400">{stationNameMap[selectedStation] || selectedStation}</span>
                </div>

                <LocatorWrap assets={assets} highlight={null} stationId={selectedStation} />
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Emergency HQ Indent Modal */}
      {showNewIndentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div onClick={() => setShowNewIndentModal(false)} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative w-full max-w-[460px] bg-[#0E1830] border border-blue-500/30 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-base text-white">Issue Emergency Resupply Indent</h3>
                <p className="text-xs text-white/50">Dispatch directly from NCPOR Central Logistics</p>
              </div>
              <button
                onClick={() => setShowNewIndentModal(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1">Target Station</label>
                <div className="p-2.5 rounded-xl bg-black/40 border border-white/15 font-bold text-xs text-white">
                  {stationNameMap[selectedStation] || selectedStation}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1">Supply SKU</label>
                <select
                  value={newIndentAsset}
                  onChange={(e) => setNewIndentAsset(e.target.value)}
                  className="w-full bg-black/40 border border-white/15 rounded-xl px-3 h-11 text-xs font-mono focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select supply SKU…</option>
                  {assets.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.sku} — {a.name} ({a.qty} {a.unit} current)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-white/70 block mb-1">Dispatch Quantity</label>
                  <input
                    type="number"
                    value={newIndentQty}
                    onChange={(e) => setNewIndentQty(Number(e.target.value) || 1)}
                    className="w-full bg-black/40 border border-white/15 rounded-xl px-3 h-11 text-sm font-bold focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-white/70 block mb-1">Priority</label>
                  <select
                    value={newIndentUrg}
                    onChange={(e) => setNewIndentUrg(e.target.value)}
                    className="w-full bg-black/40 border border-white/15 rounded-xl px-3 h-11 text-xs font-bold focus:outline-none focus:border-blue-500"
                  >
                    <option value="CRITICAL">🔴 CRITICAL</option>
                    <option value="MEDIUM">🟡 MEDIUM</option>
                    <option value="LOW">🟢 LOW</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleCreateHQIndent}
                className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-500/25 transition active:scale-98"
              >
                Approve & Dispatch Indent
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LocatorWrap({ assets, highlight, stationId }: { assets: any[]; highlight: string | null; stationId?: string }) {
  const [Comp, setComp] = useState<any>(null);
  useEffect(() => {
    import('../components/Container3D').then((m) => setComp(() => m.Container3D));
  }, []);
  if (!Comp)
    return (
      <div className="text-xs text-white/30 h-72 flex items-center justify-center bg-black/40 rounded-2xl border border-white/10">
        Loading 3D Digital Twin…
      </div>
    );
  return <Comp assets={assets} highlight={highlight} stationId={stationId} />;
}

function VesselMapWrap({ stationId }: { stationId: string }) {
  const [Comp, setComp] = useState<any>(null);
  useEffect(() => {
    import('../components/VesselMap').then((m) => setComp(() => m.VesselMap));
  }, []);
  if (!Comp) return <div className="text-xs text-white/30 h-48 flex items-center justify-center bg-black/40 rounded-2xl border border-white/10">Loading vessel tracker…</div>;
  return <Comp stationId={stationId} />;
}
