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
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, sku TEXT UNIQUE, name TEXT, category TEXT, qty REAL, unit TEXT, expiry_date TEXT, criticality TEXT, crate_id TEXT REFERENCES crates(id), barcode TEXT, version INTEGER DEFAULT 1, updated_at TEXT);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, asset_id TEXT REFERENCES assets(id), type TEXT CHECK(type IN ('IN','OUT','CONSUME','ADJUST')), qty_delta REAL, actor_id TEXT, ts TEXT, sync_status TEXT DEFAULT 'PENDING');
CREATE TABLE IF NOT EXISTS vessels (imo TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, sog REAL, eta TEXT, station_id TEXT REFERENCES stations(id), last_seen TEXT);
CREATE TABLE IF NOT EXISTS indents (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), asset_id TEXT REFERENCES assets(id), qty_requested REAL, urgency TEXT, status TEXT DEFAULT 'DRAFT', created_by TEXT, created_at TEXT, vessel_imo TEXT REFERENCES vessels(imo));
CREATE TABLE IF NOT EXISTS telemetry (ts TEXT, station_id TEXT, temp_outside REAL, wind_speed REAL, pressure REAL, dg_load REAL);
CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, actor_id TEXT, action TEXT, entity TEXT, before TEXT, after TEXT, ts TEXT);
CREATE TABLE IF NOT EXISTS procurement_targets (sku TEXT PRIMARY KEY, target_qty REAL NOT NULL, cost_per_unit REAL NOT NULL, unit TEXT NOT NULL, eta TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS physics_params (station_id TEXT PRIMARY KEY, T_INSIDE REAL NOT NULL, BASE REAL NOT NULL, K1 REAL NOT NULL, K2 REAL NOT NULL, K3 REAL NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (ulid TEXT PRIMARY KEY, device_id TEXT, entity TEXT, entity_id TEXT, op TEXT CHECK(op IN ('UPSERT','DELETE','CONSUME','IN','OUT','ADJUST')), patch BLOB, base_version INTEGER, retry_count INTEGER DEFAULT 0, created_at TEXT, status TEXT CHECK(status IN ('PENDING','SENT','ACKED','FAILED')) DEFAULT 'PENDING');
CREATE TABLE IF NOT EXISTS sync_state (device_id TEXT PRIMARY KEY, last_acked_ulid TEXT, last_server_version INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS dedupe (ulid TEXT PRIMARY KEY, processed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_assets_crate ON assets(crate_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_vessels_station ON vessels(station_id);
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
  // ensure WAL
  try { _db.exec('PRAGMA journal_mode=WAL;'); } catch {}

  return _db;
}

export async function seedIfEmpty(deviceId: string) {
  const db = await getDb();
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
  return db.selectObjects("SELECT * FROM outbox WHERE status='PENDING' ORDER BY created_at");
}
export async function outboxCount() { const db = await getDb(); return db.selectValue("SELECT COUNT(*) FROM outbox WHERE status='PENDING'"); }
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
  try {
    db.exec({ sql: 'UPDATE assets SET qty=?, version=?, updated_at=? WHERE id=?', bind: [newQty, patch.version, patch.updated_at, opts.assetId] });
    db.exec({ sql: 'INSERT INTO transactions (id, asset_id, type, qty_delta, actor_id, ts, sync_status) VALUES (?,?,?,?,?,?,?)', bind: [id, opts.assetId, opts.type, opts.delta, opts.actorId, ts, 'PENDING'] });
    db.exec({ sql: 'INSERT INTO outbox (ulid, device_id, entity, entity_id, op, patch, base_version, created_at) VALUES (?,?,?,?,?,?,?,?)', bind: [outboxUlid, opts.deviceId, 'assets', opts.assetId, opts.type, patchBytes, asset.version, ts] });
    db.exec({ sql: 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)', bind: [id, opts.actorId, auditAction, 'assets', JSON.stringify({ qty: asset.qty, version: asset.version }), JSON.stringify(patch), ts] });
    db.exec('COMMIT');
  } catch (e) {
 db.exec('ROLLBACK'); throw e; }
  return { newQty, outboxUlid, patch };
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
  db.exec('BEGIN');
  try {
    db.exec({ sql: 'INSERT INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', bind: [id, opts.stationId, opts.assetId, opts.qty, opts.urgency, 'DRAFT', opts.createdBy, ts] });
    db.exec({ sql: 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)', bind: [ulid(), opts.createdBy, 'INDENT_CREATE', 'indents', null, JSON.stringify(indent), ts] });
    db.exec({ sql: 'INSERT INTO outbox (ulid, device_id, entity, entity_id, op, patch, base_version, created_at, status) VALUES (?,?,?,?,?,?,?,?,?)', bind: [outboxUlid, opts.deviceId, 'indents', id, 'UPSERT', patchBytes, 0, ts, 'PENDING'] });
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
  db.exec('BEGIN');
  try {
    const newQty = patch.qty !== undefined ? patch.qty : existing.qty;
    const newVer = patch.version !== undefined ? patch.version : (existing.version || 1) + 1;
    db.exec({
      sql: 'UPDATE assets SET qty=?, version=?, updated_at=? WHERE id=?',
      bind: [newQty, newVer, now, assetId]
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

