// ── POLARIS website data layer (independent copy — nothing imported from ../shared) ──
export type Station = {
  id: string; name: string; coord: string; crew: number;
  dieselL: number; oxygenCyl: number; bearings: number;
  color: string;
};

export const STATIONS: Station[] = [
  { id: 'ST-BHARATI', name: 'Bharati', coord: '69°24′S 76°11′E', crew: 24, dieselL: 4150, oxygenCyl: 24, bearings: 6, color: '#22f0d8' },
  { id: 'ST-MAITRI', name: 'Maitri', coord: '70°45′S 11°44′E', crew: 26, dieselL: 3800, oxygenCyl: 18, bearings: 4, color: '#ffb84d' },
  { id: 'ST-HIMADRI', name: 'Himadri', coord: '78°55′N 11°56′E', crew: 18, dieselL: 2900, oxygenCyl: 30, bearings: 9, color: '#8b8eff' },
];

export type InvRow = { sku: string; name: string; crate: string; qty: number; unit: string; status: 'CRITICAL' | 'LOW' | 'EXPIRING' | 'OK'; vc: string };
export const INVENTORY: InvRow[] = [
  { sku: 'FUEL-DIESEL-001', name: 'Diesel (bulk)', crate: 'C1-K1', qty: 4150, unit: 'L', status: 'CRITICAL', vc: '[3,1,2]' },
  { sku: 'O2-CYL-47L-003', name: 'Oxygen 47L', crate: 'C2-K1', qty: 24, unit: 'cyl', status: 'LOW', vc: '[2,2,1]' },
  { sku: 'BEARING-6205-010', name: 'DG bearing 6205', crate: 'C3-K2', qty: 2, unit: 'pcs', status: 'CRITICAL', vc: '[1,1,4]' },
  { sku: 'RATION-FD-014', name: 'Freeze-dried ration', crate: 'C4-K1', qty: 180, unit: 'packs', status: 'OK', vc: '[2,1,1]' },
  { sku: 'MED-AMOX-007', name: 'Amoxicillin 500mg', crate: 'C2-K3', qty: 42, unit: 'strips', status: 'EXPIRING', vc: '[1,3,1]' },
  { sku: 'FUEL-JET-A1-002', name: 'Jet A-1 (heli)', crate: 'C1-K2', qty: 860, unit: 'L', status: 'OK', vc: '[2,1,3]' },
  { sku: 'SPARE-FILTER-021', name: 'Fuel filter', crate: 'C3-K1', qty: 5, unit: 'pcs', status: 'LOW', vc: '[1,1,2]' },
  { sku: 'SCI-PROBE-033', name: 'CTD probe', crate: 'C5-K1', qty: 3, unit: 'pcs', status: 'OK', vc: '[1,2,2]' },
];

export type Vessel = { imo: string; name: string; sog: number; etaH: number; lat: number; lon: number; source: string; reason: string };
export const VESSELS: Vessel[] = [
  { imo: '9734567', name: 'SAGAR NIDHI', sog: 11.2, etaH: 14, lat: -62.4, lon: 48.2, source: 'MOCK SCHEDULE', reason: 'no_key' },
  { imo: '9788110', name: 'SAGAR KANYA', sog: 9.6, etaH: 62, lat: -54.1, lon: 32.8, source: 'MOCK SCHEDULE', reason: 'no_key' },
  { imo: '9799001', name: 'POLAR SUPPLY', sog: 12.4, etaH: 96, lat: -48.9, lon: 20.4, source: 'STALE · 3h', reason: '429' },
];

export const API_ROUTES: { method: string; path: string; note: string }[] = [
  { method: 'GET', path: '/health', note: '{status, db, ts}' },
  { method: 'POST', path: '/auth/login', note: 'PIN → JWT (FIELD_OP…NCPOR_ADMIN)' },
  { method: 'GET', path: '/assets', note: 'station_id + vector_clock join' },
  { method: 'GET', path: '/forecast/{station}', note: 'physics + residual + CI' },
  { method: 'GET', path: '/forecast/snn/{station}', note: 'event-gated LIF + watts' },
  { method: 'POST', path: '/sync/ingest', note: 'ULID + VC + LWW merge' },
  { method: 'POST', path: '/dtn/ingest_bulk', note: 'custody bundles → APPLIED' },
  { method: 'GET', path: '/vessels?station_id=', note: 'live AIS or mock schedule' },
  { method: 'POST', path: '/tracking/update', note: 'local [x,y,θ] no GPS' },
  { method: 'GET', path: '/telemetry/stream', note: 'SSE • 30s keepalive' },
];

export const TABS = ['Today', 'Inventory', 'Scan', 'Indents', 'Locate'] as const;
