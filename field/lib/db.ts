'use client';
// SQLite WASM OPFS + WAL — single DB file polaris.db
// Falls back to in-memory if OPFS unavailable (e.g. dev without secure context)
// ponytail: SCHEMA_SQL single source is shared/sql/schema.sql — inline mirror kept for browser bundle (webpack .sql loader planned)

let _db: any = null;
let _sqlite3: any = null;

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS stations (id TEXT PRIMARY KEY, name TEXT CHECK(name IN ('Bharati','Maitri','Himadri')), location TEXT, winter_crew_count INTEGER);
CREATE TABLE IF NOT EXISTS containers (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), type TEXT CHECK(type IN ('ISO_20ft','ColdStore','Hazmat')), position_2d TEXT);
CREATE TABLE IF NOT EXISTS crates (id TEXT PRIMARY KEY, container_id TEXT REFERENCES containers(id), coords TEXT, temp_zone TEXT);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, sku TEXT UNIQUE, name TEXT, category TEXT, qty REAL, unit TEXT, expiry_date TEXT, criticality TEXT, crate_id TEXT REFERENCES crates(id), barcode TEXT, version INTEGER DEFAULT 1, updated_at TEXT, vector_clock TEXT, local_coord TEXT);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, asset_id TEXT REFERENCES assets(id), type TEXT CHECK(type IN ('IN','OUT','CONSUME','ADJUST')), qty_delta REAL, actor_id TEXT, ts TEXT, sync_status TEXT DEFAULT 'PENDING');
CREATE TABLE IF NOT EXISTS vessels (imo TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, sog REAL, eta TEXT, station_id TEXT REFERENCES stations(id), last_seen TEXT);
CREATE TABLE IF NOT EXISTS indents (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), asset_id TEXT REFERENCES assets(id), qty_requested REAL, urgency TEXT, status TEXT DEFAULT 'DRAFT', created_by TEXT, created_at TEXT, vessel_imo TEXT REFERENCES vessels(imo));
CREATE TABLE IF NOT EXISTS telemetry (ts TEXT, station_id TEXT, temp_outside REAL, wind_speed REAL, pressure REAL, dg_load REAL);
CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, actor_id TEXT, action TEXT, entity TEXT, before TEXT, after TEXT, ts TEXT);
CREATE TABLE IF NOT EXISTS procurement_targets (sku TEXT PRIMARY KEY, target_qty REAL NOT NULL, cost_per_unit REAL NOT NULL, unit TEXT NOT NULL, eta TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS physics_params (station_id TEXT PRIMARY KEY, T_INSIDE REAL NOT NULL, BASE REAL NOT NULL, K1 REAL NOT NULL, K2 REAL NOT NULL, K3 REAL NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (ulid TEXT PRIMARY KEY, device_id TEXT, entity TEXT, entity_id TEXT, op TEXT CHECK(op IN ('UPSERT','DELETE','CONSUME','IN','OUT','ADJUST')), patch BLOB, base_version INTEGER, retry_count INTEGER DEFAULT 0, created_at TEXT, status TEXT CHECK(status IN ('PENDING','SENT','ACKED','FAILED','BUNDLED')) DEFAULT 'PENDING', vector_clock TEXT, local_coord TEXT);
CREATE TABLE IF NOT EXISTS sync_state (device_id TEXT PRIMARY KEY, last_acked_ulid TEXT, last_server_version INTEGER DEFAULT 0, vector_clock TEXT);
CREATE TABLE IF NOT EXISTS dedupe (ulid TEXT PRIMARY KEY, processed_at TEXT);
CREATE TABLE IF NOT EXISTS dtn_bundles (bundle_id TEXT PRIMARY KEY, src TEXT, dst_station TEXT, payload BLOB, vc TEXT, custody INTEGER DEFAULT 1, created_at TEXT, ttl INTEGER DEFAULT 86400);
CREATE TABLE IF NOT EXISTS asset_positions (asset_id TEXT PRIMARY KEY, x REAL, y REAL, theta REAL, conf REAL, last_sensor_ts TEXT, station_id TEXT REFERENCES stations(id));
CREATE TABLE IF NOT EXISTS snn_state (device_id TEXT PRIMARY KEY, last_features TEXT, spike_count INTEGER DEFAULT 0, last_infer_ts TEXT, total_saved_mw REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS personnel (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), name TEXT, role TEXT, blood_group TEXT, emergency_contact TEXT, status TEXT CHECK(status IN ('ON_STATION','FIELD_SORTIE','IN_TRANSIT','EVACUATED')) DEFAULT 'ON_STATION');
CREATE TABLE IF NOT EXISTS field_sorties (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), lead_personnel_id TEXT REFERENCES personnel(id), destination TEXT, departure_time TEXT, expected_return_time TEXT, actual_return_time TEXT, safety_status TEXT CHECK(safety_status IN ('PLANNED','ACTIVE','RETURNED','OVERDUE','EMERGENCY')) DEFAULT 'PLANNED');
CREATE TABLE IF NOT EXISTS emergencies (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), type TEXT CHECK(type IN ('SOS_MEDICAL','SOS_FIRE','SOS_WHITEOUT','SOS_POWER','SOS_VEHICLE')), reported_by TEXT, status TEXT CHECK(status IN ('ACTIVE','RESOLVED')) DEFAULT 'ACTIVE', ts TEXT, location_coord TEXT);
CREATE INDEX IF NOT EXISTS idx_assets_crate ON assets(crate_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_vessels_station ON vessels(station_id);
CREATE INDEX IF NOT EXISTS idx_dtn_bundles_dst ON dtn_bundles(dst_station, created_at);
CREATE INDEX IF NOT EXISTS idx_asset_positions_station ON asset_positions(station_id);
CREATE INDEX IF NOT EXISTS idx_personnel_station ON personnel(station_id);
CREATE INDEX IF NOT EXISTS idx_sorties_station ON field_sorties(station_id);
CREATE INDEX IF NOT EXISTS idx_emergencies_station ON emergencies(station_id, status);
`;

export async function getDb(): Promise<any> {
  if (_db) return _db;
  // dynamic import to avoid SSR issues
  const mod: any = await import('@sqlite.org/sqlite-wasm');
  const init = mod.default ?? mod.sqlite3InitModule;
  _sqlite3 = await init({ print: console.log, printErr: console.error });

  // Try OPFS, fall back to :memory: (data loss on refresh — warn user)
  try {
    if (_sqlite3.oo1.OpfsDb) {
      _db = new _sqlite3.oo1.OpfsDb('/polaris.db', 'c');
    } else {
      throw new Error('OpfsDb not available');
    }
  } catch (e) {
    console.error('[polaris] OPFS unavailable — falling back to ephemeral :memory: (offline writes will be lost on refresh)', e);
    if (typeof window !== 'undefined') (window as any).__polaris_ephemeral = true;
    _db = new _sqlite3.oo1.DB(':memory:', 'c');
  }
  _db.exec(SCHEMA_SQL);
  // BUGFIX: migrate existing OPFS DBs missing vector_clock column on sync_state (old SCHEMA)
  try { _db.exec("ALTER TABLE sync_state ADD COLUMN vector_clock TEXT"); } catch {}
  // ensure WAL
  try { _db.exec('PRAGMA journal_mode=WAL;'); } catch {}

  return _db;
}

const SEED_PERSONNEL = [
  ['PER-BHA-01', 'ST-BHARATI', 'Dr. Rajesh Sharma', 'Station Leader & Glaciologist', 'O+', '+91-9876543210', 'ON_STATION'],
  ['PER-BHA-02', 'ST-BHARATI', 'Capt. Vikram Rao', 'Logistics & Field Ops Lead', 'A+', '+91-9876543211', 'ON_STATION'],
  ['PER-BHA-03', 'ST-BHARATI', 'Dr. Ananya Sen', 'Medical Officer', 'B+', '+91-9876543212', 'ON_STATION'],
  ['PER-BHA-04', 'ST-BHARATI', 'Sunil Gaikwad', 'HVAC & Power Tech', 'AB+', '+91-9876543213', 'ON_STATION'],
  ['PER-BHA-05', 'ST-BHARATI', 'Priya Nambiar', 'Atmospheric Physicist', 'O-', '+91-9876543214', 'ON_STATION'],
  ['PER-MAI-01', 'ST-MAITRI', 'Dr. Devendra Rathore', 'Station Leader', 'A+', '+91-9876543215', 'ON_STATION'],
  ['PER-MAI-02', 'ST-MAITRI', 'Dr. Neha Verma', 'Medical Officer & Medic', 'O+', '+91-9876543216', 'ON_STATION'],
  ['PER-MAI-03', 'ST-MAITRI', 'Harpreet Singh', 'Heavy Vehicle Tech', 'B+', '+91-9876543217', 'ON_STATION'],
  ['PER-HIM-01', 'ST-HIMADRI', 'Dr. Arvind Joshi', 'Arctic Mission Leader', 'A-', '+91-9876543218', 'ON_STATION'],
  ['PER-HIM-02', 'ST-HIMADRI', 'Meera Pillai', 'Marine Biologist', 'O+', '+91-9876543219', 'ON_STATION']
];

export async function seedIfEmpty(deviceId: string) {
  const db = await getDb();
  // Check and seed personnel even if assets exist
  try {
    const pCnt = db.selectValue('SELECT COUNT(*) FROM personnel');
    if (pCnt === 0) {
      for (const p of SEED_PERSONNEL) {
        db.exec({ sql: 'INSERT OR IGNORE INTO personnel (id, station_id, name, role, blood_group, emergency_contact, status) VALUES (?,?,?,?,?,?,?)', bind: p });
      }
    }
  } catch {}

  const cnt = db.selectValue('SELECT COUNT(*) FROM assets');
  if (cnt > 0) return { seeded: false, count: cnt };
  const { SEED_STATIONS, SEED_CONTAINERS, SEED_CRATES, SEED_ASSETS } = await import('@shared/seed.js');
  const stations = (SEED_STATIONS as readonly { id: string; name: string; location: string; winter_crew_count: number }[]).map(s => [s.id, s.name, s.location, s.winter_crew_count]);
  const containers = (SEED_CONTAINERS as readonly { id: string; station_id: string; type: string; position_2d: string }[]).map(c => [c.id, c.station_id, c.type, c.position_2d]);
  const crates = (SEED_CRATES as readonly { id: string; container_id: string; coords: string; temp_zone: string }[]).map(c => [c.id, c.container_id, c.coords, c.temp_zone]);
  const assets: unknown[] = (SEED_ASSETS as readonly { id: string; sku: string; name: string; category: string; qty: number; unit: string; expiry_date: string | null; criticality: string; crate_id: string; barcode: string }[]).map(a => [a.id, a.sku, a.name, a.category, a.qty, a.unit, a.expiry_date, a.criticality, a.crate_id, a.barcode]);
  db.exec('BEGIN');
  try {
    for (const s of stations) db.exec({ sql: 'INSERT OR IGNORE INTO stations VALUES (?,?,?,?)', bind: s });
    for (const c of containers) db.exec({ sql: 'INSERT OR IGNORE INTO containers VALUES (?,?,?,?)', bind: c });
    for (const c of crates) db.exec({ sql: 'INSERT OR IGNORE INTO crates VALUES (?,?,?,?)', bind: c });
    for (const a of assets) db.exec({ sql: 'INSERT OR IGNORE INTO assets (id,sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)', bind: [...(a as unknown[]), new Date().toISOString()] });
    for (const p of SEED_PERSONNEL) db.exec({ sql: 'INSERT OR IGNORE INTO personnel (id, station_id, name, role, blood_group, emergency_contact, status) VALUES (?,?,?,?,?,?,?)', bind: p });
    db.exec({ sql: 'INSERT OR IGNORE INTO sync_state (device_id, last_server_version) VALUES (?,0)', bind: [deviceId] });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { seeded: true, count: 10 };
}

// Helpers used by UI
export async function listAssets() {
  const db = await getDb();
  // Include station_id for parity with HQ GET /assets (Phase 1.2) — c is crates, cr is containers
  return db.selectObjects('SELECT a.*, c.coords, c.container_id, cr.type as container_type, cr.station_id FROM assets a LEFT JOIN crates c ON c.id=a.crate_id LEFT JOIN containers cr ON cr.id=c.container_id ORDER BY a.sku');
}
export async function getAssetByBarcode(barcode: string) {
  const db = await getDb();
  const rows = db.selectObjects('SELECT * FROM assets WHERE barcode=?', [barcode]);
  return rows[0] ?? null;
}
export async function outboxPending() {
  const db = await getDb();
  return db.selectObjects("SELECT * FROM outbox WHERE status IN ('PENDING','SENT','BUNDLED') ORDER BY created_at");
}
// Unacked frames = anything not yet ACKED/FAILED. BUNDLED rows are still
// unsynced (local DTN custody only) and MUST count as pending — otherwise the
// UI flips to "Fully Synced" the moment the link drops.
export async function outboxCount() { const db = await getDb(); return db.selectValue("SELECT COUNT(*) FROM outbox WHERE status IN ('PENDING','SENT','BUNDLED')"); }
export async function outboxBreakdown() {
  const db = await getDb();
  const rows = db.selectObjects("SELECT status, COUNT(*) as n FROM outbox WHERE status IN ('PENDING','SENT','BUNDLED','FAILED') GROUP BY status") as Array<{ status: string; n: number }>;
  const m: Record<string, number> = { PENDING: 0, SENT: 0, BUNDLED: 0, FAILED: 0 };
  for (const r of rows) m[r.status] = Number(r.n) || 0;
  return { ...m, total: m.PENDING + m.SENT + m.BUNDLED };
}
export async function listTransactions(limit=20) {
  const db = await getDb();
  return db.selectObjects('SELECT t.*, a.sku, a.name FROM transactions t LEFT JOIN assets a ON a.id=t.asset_id ORDER BY t.ts DESC LIMIT ?', [limit]);
}
export async function listAudit(limit=30) {
  const db = await getDb();
  return db.selectObjects('SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?', [limit]);
}
export async function listIndents() {
  const db = await getDb();
  return db.selectObjects('SELECT i.*, a.sku, a.name, a.unit FROM indents i LEFT JOIN assets a ON a.id=i.asset_id ORDER BY i.created_at DESC');
}
export { isExpiringSoon, isExpired } from '@shared/expiry.js';
import { isExpired as _isExpired } from '@shared/expiry.js';

// ——— Phase 0: Vector Clock helpers ———
export function getVC(deviceId: string): Record<string, number> {
  try {
    const db = _db; if (!db) return {};
    const row = db.selectObjects('SELECT vector_clock FROM sync_state WHERE device_id=?', [deviceId])[0];
    if (row?.vector_clock) return JSON.parse(row.vector_clock);
  } catch {}
  return {};
}
export function bumpVC(deviceId: string, vc: Record<string, number>): Record<string, number> {
  const next = { ...vc, [deviceId]: (vc[deviceId] ?? 0) + 1 };
  try { const db = _db; db?.exec({ sql: "UPDATE sync_state SET vector_clock=? WHERE device_id=?", bind: [JSON.stringify(next), deviceId] }); } catch {}
  return next;
}

// Atomic transaction: update asset + insert transaction + outbox + audit
// Expiry: cannot CONSUME expired MEDICAL without override + audit entry (PLAN §3.2)
export async function consumeAsset(opts: { assetId: string; delta: number; type: 'CONSUME'|'IN'|'OUT'|'ADJUST'; actorId: string; deviceId: string; overrideExpired?: boolean }) {
  const db = await getDb();
  const { ulid } = await import('ulid');
  const { encode } = await import('@msgpack/msgpack');
  // ponytail: BEGIN IMMEDIATE before read to avoid TOCTOU on concurrent tabs
  db.exec('BEGIN IMMEDIATE');
  let asset: any;
  try {
    asset = db.selectObjects('SELECT * FROM assets WHERE id=?', [opts.assetId])[0];
    if (!asset) throw new Error('asset not found');
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  const newQty = asset.qty + opts.delta;
  if (newQty < 0) { try { db.exec('ROLLBACK'); } catch {} throw new Error('insufficient stock'); }
  // Expired guard: block any expired stock from CONSUME without override (covers MEDICAL/OXYGEN/FOOD)
  if (opts.type==='CONSUME' && asset.expiry_date && _isExpired(asset.expiry_date) && !opts.overrideExpired) {
    db.exec('ROLLBACK');
    throw new Error(`EXPIRED: ${asset.sku} expired ${asset.expiry_date} — requires override + audit`);
  }
  const patch = { qty: newQty, version: (asset.version ?? 1) + 1, updated_at: new Date().toISOString() };
  const patchBytes = encode(patch);
  const id = ulid();
  const ts = new Date().toISOString();
  const outboxUlid = ulid();
  const auditAction = opts.overrideExpired ? `${opts.type}_OVERRIDE_EXPIRED` : opts.type;
  // VC stamp
  let vc: Record<string, number> = {};
  try { const row = db.selectObjects('SELECT vector_clock FROM assets WHERE id=?', [opts.assetId])[0]; if (row?.vector_clock) vc = JSON.parse(row.vector_clock); } catch {}
  vc[opts.deviceId] = (vc[opts.deviceId] ?? 0) + 1;
  const vcStr = JSON.stringify(vc);
  try {
    db.exec({ sql: 'UPDATE assets SET qty=?, version=?, updated_at=?, vector_clock=? WHERE id=?', bind: [newQty, patch.version, patch.updated_at, vcStr, opts.assetId] });
    db.exec({ sql: 'INSERT INTO transactions (id, asset_id, type, qty_delta, actor_id, ts, sync_status) VALUES (?,?,?,?,?,?,?)', bind: [id, opts.assetId, opts.type, opts.delta, opts.actorId, ts, 'PENDING'] });
    db.exec({ sql: 'INSERT INTO outbox (ulid, device_id, entity, entity_id, op, patch, base_version, created_at, vector_clock) VALUES (?,?,?,?,?,?,?,?,?)', bind: [outboxUlid, opts.deviceId, 'assets', opts.assetId, opts.type, patchBytes, asset.version, ts, vcStr] });
    db.exec({ sql: 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)', bind: [id, opts.actorId, auditAction, 'assets', JSON.stringify({ qty: asset.qty, version: asset.version }), JSON.stringify(patch), ts] });
    db.exec('COMMIT');
  } catch (e) {
 db.exec('ROLLBACK'); throw e; }
  return { newQty, outboxUlid, patch, vector_clock: vc };
}

export async function createIndent(opts: { stationId: string; assetId: string; qty: number; urgency: string; createdBy: string; deviceId: string; }) {
  const db = await getDb();
  const { ulid } = await import('ulid');
  const { encode } = await import('@msgpack/msgpack');
  if (opts.qty <=0) throw new Error('qty must be >0');
  const id = ulid();
  const ts = new Date().toISOString();
  const outboxUlid = ulid();
  const indent = { id, station_id: opts.stationId, asset_id: opts.assetId, qty_requested: opts.qty, urgency: opts.urgency, status: 'DRAFT', created_by: opts.createdBy, created_at: ts };
  const patch = indent; // full row for indents
  const patchBytes = encode(patch);
  const vc: Record<string, number> = { [opts.deviceId]: 1 };
  db.exec('BEGIN');
  try {
    db.exec({ sql: 'INSERT INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', bind: [id, opts.stationId, opts.assetId, opts.qty, opts.urgency, 'DRAFT', opts.createdBy, ts] });
    db.exec({ sql: 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)', bind: [ulid(), opts.createdBy, 'INDENT_CREATE', 'indents', null, JSON.stringify(indent), ts] });
    db.exec({ sql: 'INSERT INTO outbox (ulid, device_id, entity, entity_id, op, patch, base_version, created_at, status, vector_clock) VALUES (?,?,?,?,?,?,?,?,?,?)', bind: [outboxUlid, opts.deviceId, 'indents', id, 'UPSERT', patchBytes, 0, ts, 'PENDING', JSON.stringify(vc)] });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { id, outboxUlid };
}

export async function updateIndentLocal(opts: { indentId: string; status: string; actorId: string; deviceId: string; }) {
  const db = await getDb();
  const { ulid } = await import('ulid');
  const { encode } = await import('@msgpack/msgpack');
  const row = db.selectObjects('SELECT * FROM indents WHERE id=?', [opts.indentId])[0];
  if (!row) throw new Error('indent not found');
  const valid: Record<string,string[]> = { DRAFT:['APPROVED'], APPROVED:['DISPATCHED'], DISPATCHED:['RECEIVED'] };
  if (!valid[row.status]?.includes(opts.status)) throw new Error(`invalid transition ${row.status}->${opts.status}`);
  const patch = { status: opts.status, updated_at: new Date().toISOString() };
  const patchBytes = encode({ ...patch, id: opts.indentId });
  const ts = new Date().toISOString();
  const outboxUlid = ulid();
  db.exec('BEGIN');
  try {
    db.exec({ sql: 'UPDATE indents SET status=? WHERE id=?', bind: [opts.status, opts.indentId] });
    db.exec({ sql: 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)', bind: [ulid(), opts.actorId, `INDENT_${opts.status}`, 'indents', JSON.stringify(row), JSON.stringify({ ...row, ...patch }), ts] });
    db.exec({ sql: 'INSERT INTO outbox (ulid, device_id, entity, entity_id, op, patch, base_version, created_at, status) VALUES (?,?,?,?,?,?,?,?,?)', bind: [outboxUlid, opts.deviceId, 'indents', opts.indentId, 'UPSERT', patchBytes, 0, ts, 'PENDING'] });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { outboxUlid };
}

function withTx(db: any, fn: () => void) {
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

// Downstream Delta Handlers (Full-Duplex Encrypted WebSocket push)
export async function applyDownstreamIndent(indentId: string, patch: Record<string, any>) {
  const db = await getDb();
  const { ulid } = await import('ulid');
  const now = new Date().toISOString();
  const existing = db.selectObjects('SELECT * FROM indents WHERE id=?', [indentId])[0];
  db.exec('BEGIN');
  try {
    if (!existing) {
      db.exec({
        sql: 'INSERT OR IGNORE INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at, vessel_imo) VALUES (?,?,?,?,?,?,?,?,?)',
        bind: [indentId, patch.station_id || 'ST-BHARATI', patch.asset_id || 'A1', patch.qty_requested || 1, patch.urgency || 'MEDIUM', patch.status || 'DRAFT', patch.created_by || 'HQ', patch.created_at || now, patch.vessel_imo || null]
      });
      db.exec({
        sql: 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)',
        bind: [ulid(), 'HQ_PUSH', 'DOWNSTREAM_INDENT_INSERT', 'indents', null, JSON.stringify(patch), now]
      });
    } else if ((patch.status && existing.status !== patch.status) || (patch.vessel_imo && existing.vessel_imo !== patch.vessel_imo)) {
      const newStatus = patch.status || existing.status;
      const newVessel = patch.vessel_imo !== undefined ? patch.vessel_imo : existing.vessel_imo;
      db.exec({
        sql: 'UPDATE indents SET status=?, vessel_imo=? WHERE id=?',
        bind: [newStatus, newVessel, indentId]
      });
      db.exec({
        sql: 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)',
        bind: [ulid(), 'HQ_PUSH', `DOWNSTREAM_INDENT_${patch.status || existing.status}`, 'indents', JSON.stringify(existing), JSON.stringify({ ...existing, ...patch }), now]
      });
    }
    db.exec('COMMIT');
    return { applied: true, id: indentId };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function applyDownstreamSyncInit(indents: any[]) {
  const db = await getDb();
  if (!Array.isArray(indents) || indents.length === 0) return { reconciled: 0 };
  let count = 0;
  db.exec('BEGIN');
  try {
    for (const r of indents) {
      const local = db.selectObjects('SELECT * FROM indents WHERE id=?', [r.id])[0];
      if (!local) {
        db.exec({
          sql: 'INSERT OR IGNORE INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at, vessel_imo) VALUES (?,?,?,?,?,?,?,?,?)',
          bind: [r.id, r.station_id, r.asset_id, r.qty_requested, r.urgency, r.status, r.created_by, r.created_at, r.vessel_imo || null]
        });
        count++;
      } else if (local.status !== r.status || local.vessel_imo !== r.vessel_imo) {
        db.exec({
          sql: 'UPDATE indents SET status=?, vessel_imo=? WHERE id=?',
          bind: [r.status || local.status, r.vessel_imo !== undefined ? r.vessel_imo : local.vessel_imo, r.id]
        });
        count++;
      }
    }
    db.exec('COMMIT');
    return { reconciled: count };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function applyDownstreamAsset(assetId: string, patch: Record<string, any>) {
  const db = await getDb();
  const now = new Date().toISOString();
  const existing = db.selectObjects('SELECT * FROM assets WHERE id=?', [assetId])[0];
  if (!existing) return { applied: false };
  // LWW+VC check if vector_clock present
  if (patch.vector_clock || existing.vector_clock) {
    try {
      const { compare } = await import('@shared/dtn/vector_clock.js');
      const localVC = existing.vector_clock ? JSON.parse(existing.vector_clock) : {};
      const remoteVC = typeof patch.vector_clock === 'string' ? JSON.parse(patch.vector_clock) : (patch.vector_clock || {});
      const c = compare(localVC, remoteVC);
      if (c === 'gt') { return { applied: false, reason: 'vc_local_newer' }; }
      if (c === 'equal') { /* allow */ }
      // concurrent -> LWW ts wins: if remote ts older, skip
      if (c === 'concurrent' && patch.updated_at && existing.updated_at && patch.updated_at <= existing.updated_at) {
        return { applied: false, reason: 'lww_local_newer' };
      }
      const merged = { ...localVC }; for (const [k,v] of Object.entries(remoteVC as Record<string,number>)) merged[k]=Math.max(merged[k]??0, v as number);
      patch._mergedVC = merged;
    } catch {}
  }
  db.exec('BEGIN');
  try {
    const newQty = patch.qty !== undefined ? patch.qty : existing.qty;
    const newVer = patch.version !== undefined ? patch.version : (existing.version || 1) + 1;
    const vcStr = (patch as any)._mergedVC ? JSON.stringify((patch as any)._mergedVC) : existing.vector_clock;
    db.exec({
      sql: 'UPDATE assets SET qty=?, version=?, updated_at=?, vector_clock=? WHERE id=?',
      bind: [newQty, newVer, now, vcStr, assetId]
    });
    db.exec('COMMIT');
    return { applied: true, assetId, qty: newQty };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function applyDownstreamVessel(imo: string, patch: Record<string, any>) {
  const db = await getDb();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.exec({
      sql: 'INSERT INTO vessels (imo, name, lat, lon, sog, eta, station_id, last_seen) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(imo) DO UPDATE SET name=excluded.name, lat=excluded.lat, lon=excluded.lon, sog=excluded.sog, eta=excluded.eta, station_id=excluded.station_id, last_seen=excluded.last_seen',
      bind: [imo, patch.name || 'Unknown', patch.lat ?? 0, patch.lon ?? 0, patch.sog ?? 10, patch.eta || '', patch.station_id || 'ST-BHARATI', patch.last_seen || now],
    });
    db.exec('COMMIT');
    return { applied: true, imo };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function listVessels(stationId?: string) {
  const db = await getDb();
  if (stationId) return db.selectObjects('SELECT * FROM vessels WHERE station_id=? ORDER BY last_seen DESC', [stationId]);
  return db.selectObjects('SELECT * FROM vessels ORDER BY last_seen DESC');
}

// Pull indents from HQ (fallback legacy sync)
export async function pullIndentsFromHQ(hqUrl: string) {
  const db = await getDb();
  try {
    const res = await fetch(`${hqUrl}/indents`);
    if (!res.ok) return { pulled:0, error: res.statusText };
    const remote: any[] = await res.json();
    let pulled=0;
    for (const r of remote) {
      const local = db.selectObjects('SELECT * FROM indents WHERE id=?', [r.id])[0];
      if (!local) {
        db.exec({ sql: 'INSERT OR IGNORE INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at, vessel_imo) VALUES (?,?,?,?,?,?,?,?,?)', bind: [r.id, r.station_id, r.asset_id, r.qty_requested, r.urgency, r.status, r.created_by, r.created_at, r.vessel_imo || null] });
        pulled++;
      } else if (local.status !== r.status || local.vessel_imo !== r.vessel_imo) {
        db.exec({ sql: 'UPDATE indents SET status=?, vessel_imo=? WHERE id=?', bind: [r.status, r.vessel_imo || local.vessel_imo || null, r.id] });
        pulled++;
      }
    }
    return { pulled };
  } catch (e:any) { return { pulled:0, error:e.message } }
}

export async function listCratesWithAssets() {
  const db = await getDb();
  return db.selectObjects('SELECT crates.id as crate_id, crates.coords, crates.container_id, containers.position_2d, assets.sku, assets.name, assets.qty, assets.unit FROM crates LEFT JOIN assets ON assets.crate_id=crates.id LEFT JOIN containers ON containers.id=crates.container_id ORDER BY crates.id');
}

// --- Pillar 4 & 5: Personnel Roster, Field Sorties & Emergency SOS ---

export async function listPersonnel(stationId?: string) {
  const db = await getDb();
  if (stationId) return db.selectObjects('SELECT * FROM personnel WHERE station_id=? ORDER BY name', [stationId]);
  return db.selectObjects('SELECT * FROM personnel ORDER BY name');
}

export async function updatePersonnelStatus(opts: { id: string; status: string; actorId: string; deviceId: string; stationId?: string }) {
  const db = await getDb();
  const { ulid } = await import('ulid');
  const { encode } = await import('@msgpack/msgpack');
  const ts = new Date().toISOString();
  const outboxUlid = ulid();
  const patch = { id: opts.id, status: opts.status, station_id: opts.stationId, updated_at: ts };
  const patchBytes = encode(patch);
  db.exec('BEGIN');
  try {
    db.exec({ sql: 'UPDATE personnel SET status=? WHERE id=?', bind: [opts.status, opts.id] });
    db.exec({ sql: 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)', bind: [ulid(), opts.actorId, `PERSONNEL_STATUS_${opts.status}`, 'personnel', null, JSON.stringify(patch), ts] });
    db.exec({ sql: 'INSERT INTO outbox (ulid, device_id, entity, entity_id, op, patch, base_version, created_at, status) VALUES (?,?,?,?,?,?,?,?,?)', bind: [outboxUlid, opts.deviceId, 'personnel', opts.id, 'UPSERT', patchBytes, 0, ts, 'PENDING'] });
    db.exec('COMMIT');
    return { success: true, outboxUlid };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function listSorties(stationId?: string) {
  const db = await getDb();
  if (stationId) {
    return db.selectObjects(`SELECT s.*, p.name as lead_name, p.role as lead_role FROM field_sorties s LEFT JOIN personnel p ON p.id=s.lead_personnel_id WHERE s.station_id=? ORDER BY s.departure_time DESC`, [stationId]);
  }
  return db.selectObjects(`SELECT s.*, p.name as lead_name, p.role as lead_role FROM field_sorties s LEFT JOIN personnel p ON p.id=s.lead_personnel_id ORDER BY s.departure_time DESC`);
}

export async function createSortie(opts: { stationId: string; leadPersonnelId: string; destination: string; expectedReturnTime: string; createdBy: string; deviceId: string }) {
  const db = await getDb();
  const { ulid } = await import('ulid');
  const { encode } = await import('@msgpack/msgpack');
  const id = ulid();
  const ts = new Date().toISOString();
  const outboxUlid = ulid();
  const sortie = {
    id,
    station_id: opts.stationId,
    lead_personnel_id: opts.leadPersonnelId,
    destination: opts.destination,
    departure_time: ts,
    expected_return_time: opts.expectedReturnTime,
    safety_status: 'ACTIVE'
  };
  const patchBytes = encode(sortie);
  db.exec('BEGIN');
  try {
    db.exec({
      sql: 'INSERT INTO field_sorties (id, station_id, lead_personnel_id, destination, departure_time, expected_return_time, safety_status) VALUES (?,?,?,?,?,?,?)',
      bind: [id, opts.stationId, opts.leadPersonnelId, opts.destination, ts, opts.expectedReturnTime, 'ACTIVE']
    });
    db.exec({ sql: 'UPDATE personnel SET status=? WHERE id=?', bind: ['FIELD_SORTIE', opts.leadPersonnelId] });
    db.exec({ sql: 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)', bind: [ulid(), opts.createdBy, 'SORTIE_START', 'field_sorties', null, JSON.stringify(sortie), ts] });
    db.exec({ sql: 'INSERT INTO outbox (ulid, device_id, entity, entity_id, op, patch, base_version, created_at, status) VALUES (?,?,?,?,?,?,?,?,?)', bind: [outboxUlid, opts.deviceId, 'field_sorties', id, 'UPSERT', patchBytes, 0, ts, 'PENDING'] });
    db.exec('COMMIT');
    return { sortie, outboxUlid };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function updateSortieStatus(opts: { sortieId: string; safetyStatus: string; actorId: string; deviceId: string; stationId?: string }) {
  const db = await getDb();
  const { ulid } = await import('ulid');
  const { encode } = await import('@msgpack/msgpack');
  const ts = new Date().toISOString();
  const outboxUlid = ulid();
  const patch: any = { id: opts.sortieId, safety_status: opts.safetyStatus, station_id: opts.stationId, updated_at: ts };
  if (opts.safetyStatus === 'RETURNED') {
    patch.actual_return_time = ts;
  }
  const patchBytes = encode(patch);
  db.exec('BEGIN');
  try {
    if (opts.safetyStatus === 'RETURNED') {
      const s = db.selectObjects('SELECT lead_personnel_id FROM field_sorties WHERE id=?', [opts.sortieId])[0];
      db.exec({ sql: 'UPDATE field_sorties SET safety_status=?, actual_return_time=? WHERE id=?', bind: [opts.safetyStatus, ts, opts.sortieId] });
      if (s?.lead_personnel_id) {
        db.exec({ sql: 'UPDATE personnel SET status=? WHERE id=?', bind: ['ON_STATION', s.lead_personnel_id] });
      }
    } else {
      db.exec({ sql: 'UPDATE field_sorties SET safety_status=? WHERE id=?', bind: [opts.safetyStatus, opts.sortieId] });
    }
    db.exec({ sql: 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)', bind: [ulid(), opts.actorId, `SORTIE_${opts.safetyStatus}`, 'field_sorties', null, JSON.stringify(patch), ts] });
    db.exec({ sql: 'INSERT INTO outbox (ulid, device_id, entity, entity_id, op, patch, base_version, created_at, status) VALUES (?,?,?,?,?,?,?,?,?)', bind: [outboxUlid, opts.deviceId, 'field_sorties', opts.sortieId, 'UPSERT', patchBytes, 0, ts, 'PENDING'] });
    db.exec('COMMIT');
    return { success: true, outboxUlid };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function listEmergencies(stationId?: string) {
  const db = await getDb();
  if (stationId) return db.selectObjects('SELECT * FROM emergencies WHERE station_id=? ORDER BY ts DESC', [stationId]);
  return db.selectObjects('SELECT * FROM emergencies ORDER BY ts DESC');
}

export async function createEmergencySOS(opts: { stationId: string; type: string; reportedBy: string; locationCoord?: string | null; deviceId: string }) {
  const db = await getDb();
  const { ulid } = await import('ulid');
  const { encode } = await import('@msgpack/msgpack');
  const id = ulid();
  const ts = new Date().toISOString();
  const outboxUlid = ulid();
  const emergency = {
    id,
    station_id: opts.stationId,
    type: opts.type,
    reported_by: opts.reportedBy,
    status: 'ACTIVE',
    ts,
    location_coord: opts.locationCoord || null
  };
  const patchBytes = encode(emergency);
  db.exec('BEGIN');
  try {
    db.exec({
      sql: 'INSERT INTO emergencies (id, station_id, type, reported_by, status, ts, location_coord) VALUES (?,?,?,?,?,?,?)',
      bind: [id, opts.stationId, opts.type, opts.reportedBy, 'ACTIVE', ts, opts.locationCoord || null]
    });
    db.exec({ sql: 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)', bind: [ulid(), opts.reportedBy, `EMERGENCY_SOS_${opts.type}`, 'emergencies', null, JSON.stringify(emergency), ts] });
    db.exec({ sql: 'INSERT INTO outbox (ulid, device_id, entity, entity_id, op, patch, base_version, created_at, status) VALUES (?,?,?,?,?,?,?,?,?)', bind: [outboxUlid, opts.deviceId, 'emergencies', id, 'UPSERT', patchBytes, 0, ts, 'PENDING'] });
    db.exec('COMMIT');
    return { emergency, outboxUlid };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function resolveEmergency(opts: { emergencyId: string; actorId: string; deviceId: string; stationId?: string }) {
  const db = await getDb();
  const { ulid } = await import('ulid');
  const { encode } = await import('@msgpack/msgpack');
  const ts = new Date().toISOString();
  const outboxUlid = ulid();
  const patch = { id: opts.emergencyId, status: 'RESOLVED', station_id: opts.stationId, resolved_at: ts, resolved_by: opts.actorId };
  const patchBytes = encode(patch);
  db.exec('BEGIN');
  try {
    db.exec({ sql: 'UPDATE emergencies SET status=? WHERE id=?', bind: ['RESOLVED', opts.emergencyId] });
    db.exec({ sql: 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)', bind: [ulid(), opts.actorId, 'EMERGENCY_RESOLVE', 'emergencies', null, JSON.stringify(patch), ts] });
    db.exec({ sql: 'INSERT INTO outbox (ulid, device_id, entity, entity_id, op, patch, base_version, created_at, status) VALUES (?,?,?,?,?,?,?,?,?)', bind: [outboxUlid, opts.deviceId, 'emergencies', opts.emergencyId, 'UPSERT', patchBytes, 0, ts, 'PENDING'] });
    db.exec('COMMIT');
    return { success: true, outboxUlid };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function applyDownstreamPersonnel(personnelId: string, patch: Record<string, any>) {
  const db = await getDb();
  db.exec('BEGIN');
  try {
    db.exec({
      sql: 'INSERT INTO personnel (id, station_id, name, role, blood_group, emergency_contact, status) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, name=coalesce(excluded.name, personnel.name), role=coalesce(excluded.role, personnel.role)',
      bind: [personnelId, patch.station_id || 'ST-BHARATI', patch.name || 'Expeditioner', patch.role || 'Field Op', patch.blood_group || 'O+', patch.emergency_contact || '', patch.status || 'ON_STATION']
    });
    db.exec('COMMIT');
    return { applied: true, personnelId };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function applyDownstreamSortie(sortieId: string, patch: Record<string, any>) {
  const db = await getDb();
  db.exec('BEGIN');
  try {
    db.exec({
      sql: 'INSERT INTO field_sorties (id, station_id, lead_personnel_id, destination, departure_time, expected_return_time, actual_return_time, safety_status) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET safety_status=excluded.safety_status, actual_return_time=excluded.actual_return_time',
      bind: [sortieId, patch.station_id || 'ST-BHARATI', patch.lead_personnel_id || '', patch.destination || 'Field Work', patch.departure_time || new Date().toISOString(), patch.expected_return_time || '', patch.actual_return_time || null, patch.safety_status || 'ACTIVE']
    });
    db.exec('COMMIT');
    return { applied: true, sortieId };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function applyDownstreamEmergency(emergencyId: string, patch: Record<string, any>) {
  const db = await getDb();
  db.exec('BEGIN');
  try {
    db.exec({
      sql: 'INSERT INTO emergencies (id, station_id, type, reported_by, status, ts, location_coord) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status',
      bind: [emergencyId, patch.station_id || 'ST-BHARATI', patch.type || 'SOS_MEDICAL', patch.reported_by || 'UNKNOWN', patch.status || 'ACTIVE', patch.ts || new Date().toISOString(), patch.location_coord || null]
    });
    db.exec('COMMIT');
    return { applied: true, emergencyId };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}


