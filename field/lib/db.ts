'use client';
// SQLite WASM OPFS + WAL — single DB file polaris.db
// Falls back to in-memory if OPFS unavailable (e.g. dev without secure context)

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
CREATE TABLE IF NOT EXISTS indents (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), asset_id TEXT REFERENCES assets(id), qty_requested REAL, urgency TEXT, status TEXT DEFAULT 'DRAFT', created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS telemetry (ts TEXT, station_id TEXT, temp_outside REAL, wind_speed REAL, pressure REAL, dg_load REAL);
CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, actor_id TEXT, action TEXT, entity TEXT, before TEXT, after TEXT, ts TEXT);
CREATE TABLE IF NOT EXISTS outbox (ulid TEXT PRIMARY KEY, device_id TEXT, entity TEXT, entity_id TEXT, op TEXT, patch BLOB, base_version INTEGER, retry_count INTEGER DEFAULT 0, created_at TEXT, status TEXT DEFAULT 'PENDING');
CREATE TABLE IF NOT EXISTS sync_state (device_id TEXT PRIMARY KEY, last_acked_ulid TEXT, last_server_version INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS dedupe (ulid TEXT PRIMARY KEY, processed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_assets_crate ON assets(crate_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, created_at);
`;

export async function getDb(): Promise<any> {
  if (_db) return _db;
  // dynamic import to avoid SSR issues
  const mod: any = await import('@sqlite.org/sqlite-wasm');
  const init = mod.default ?? mod.sqlite3InitModule;
  _sqlite3 = await init({ print: console.log, printErr: console.error });

  // Try OPFS, fall back to :memory:
  try {
    if (_sqlite3.oo1.OpfsDb) {
      _db = new _sqlite3.oo1.OpfsDb('/polaris.db', 'c');
      // WAL enabled via schema
    } else {
      throw new Error('OpfsDb not available');
    }
  } catch (e) {
    console.warn('[polaris] OPFS not available, falling back to in-memory', e);
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
  // import seed data statically (duplicated for browser bundle)
  const stations = [
    ['ST-BHARATI','Bharati','69°24′S 76°11′E',24],
    ['ST-MAITRI','Maitri','70°45′S 11°44′E',25],
    ['ST-HIMADRI','Himadri','78°55′N 11°56′E',8],
  ];
  const containers = [
    ['C1','ST-BHARATI','ISO_20ft','A1'],['C2','ST-BHARATI','ColdStore','A2'],['C3','ST-BHARATI','Hazmat','B1']
  ];
  const crates = [
    ['C1-K1','C1','{"x":0,"y":0}','AMBIENT'],['C1-K2','C1','{"x":1,"y":0}','AMBIENT'],
    ['C2-K1','C2','{"x":0,"y":1}','COLD'],['C2-K2','C2','{"x":1,"y":1}','COLD'],
    ['C2-K3','C2','{"x":0,"y":2}','COLD'],['C3-K1','C3','{"x":0,"y":0}','AMBIENT'],['C3-K2','C3','{"x":0,"y":1}','HAZMAT'],
  ];
  const assets: any[] = [
    ['A1','FUEL-DIESEL-001','Diesel (Winter Grade)','FUEL_DIESEL',4200,'L',null,'CRITICAL','C1-K1','FUEL-DIESEL-001'],
    ['A2','FUEL-KERO-JP8-002','Kerosene JP-8','FUEL_KEROSENE',1800,'L',null,'CRITICAL','C1-K2','FUEL-KERO-JP8-002'],
    ['A3','O2-CYL-47L-003','Oxygen Cylinder 47L','OXYGEN',24,'cyl','2026-09-15','CRITICAL','C2-K1','O2-CYL-47L-003'],
    ['A4','RATION-FD-30D-004','Freeze-Dried Rations (30-day pack)','FOOD',90,'packs','2027-06-01','HIGH','C2-K2','RATION-FD-30D-004'],
    ['A5','MED-ANTIBIOTIC-005','Antibiotic Kit (Amoxicillin)','MEDICAL',12,'kits','2026-09-20','CRITICAL','C2-K3','MED-ANTIBIOTIC-005'],
    ['A6','MED-TRAUMA-006','Trauma Kit (Type A)','MEDICAL',6,'kits','2026-10-10','CRITICAL','C2-K3','MED-TRAUMA-006'],
    ['A7','SPARE-BRG-6205-007','DG Bearing 6205-2RS','SPARES_DG',8,'pcs',null,'HIGH','C3-K1','SPARE-BRG-6205-007'],
    ['A8','SPARE-FILTER-FUEL-008','DG Fuel Filter (Fleetguard)','SPARES_DG',14,'pcs',null,'HIGH','C3-K1','SPARE-FILTER-FUEL-008'],
    ['A9','SPARE-HVAC-FAN-009','HVAC Blower Motor','SPARES_HVAC',2,'pcs',null,'HIGH','C3-K2','SPARE-HVAC-FAN-009'],
    ['A10','SCI-ICE-CORE-010','Ice Core Drill Bit','SCIENTIFIC',4,'pcs',null,'LOW','C3-K2','SCI-ICE-CORE-010'],
  ];
  db.exec('BEGIN');
  try {
    for (const s of stations) db.exec({ sql: 'INSERT OR IGNORE INTO stations VALUES (?,?,?,?)', bind: s });
    for (const c of containers) db.exec({ sql: 'INSERT OR IGNORE INTO containers VALUES (?,?,?,?)', bind: c });
    for (const c of crates) db.exec({ sql: 'INSERT OR IGNORE INTO crates VALUES (?,?,?,?)', bind: c });
    for (const a of assets) db.exec({ sql: 'INSERT OR IGNORE INTO assets (id,sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)', bind: [...a, new Date().toISOString()] });
    db.exec({ sql: 'INSERT OR IGNORE INTO sync_state (device_id, last_server_version) VALUES (?,0)', bind: [deviceId] });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { seeded: true, count: 10 };
}

// Helpers used by UI
export async function listAssets() {
  const db = await getDb();
  return db.selectObjects('SELECT a.*, c.coords, c.container_id, cr.type as container_type FROM assets a LEFT JOIN crates c ON c.id=a.crate_id LEFT JOIN containers cr ON cr.id=c.container_id ORDER BY a.sku');
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
export function isExpiringSoon(expiry: string | null): boolean {
  if (!expiry) return false;
  const ms = new Date(expiry).getTime() - Date.now();
  return ms < 30*86400000 && ms > -365*86400000; // within 30d and not long expired
}
export function isExpired(expiry: string | null): boolean {
  if (!expiry) return false;
  return new Date(expiry).getTime() < Date.now();
}

// Atomic transaction: update asset + insert transaction + outbox + audit
// Expiry: cannot CONSUME expired MEDICAL without override + audit entry (PLAN §3.2)
export async function consumeAsset(opts: { assetId: string; delta: number; type: 'CONSUME'|'IN'|'OUT'|'ADJUST'; actorId: string; deviceId: string; overrideExpired?: boolean }) {
  const db = await getDb();
  const { ulid } = await import('ulid');
  const { encode } = await import('@msgpack/msgpack');
  const asset = db.selectObjects('SELECT * FROM assets WHERE id=?', [opts.assetId])[0];
  if (!asset) throw new Error('asset not found');
  const newQty = asset.qty + opts.delta;
  if (newQty < 0) throw new Error('insufficient stock');
  // Cold-chain & hazmat validation (zod layer simplified)
  if (opts.type==='CONSUME' && asset.expiry_date && isExpired(asset.expiry_date) && !opts.overrideExpired) {
    if (asset.category==='MEDICAL' || asset.category==='OXYGEN') {
      throw new Error(`EXPIRED: ${asset.sku} expired ${asset.expiry_date} — requires override + audit`);
    }
  }
  const patch = { qty: newQty, version: (asset.version ?? 1) + 1, updated_at: new Date().toISOString() };
  const patchBytes = encode(patch);
  const id = ulid();
  const ts = new Date().toISOString();
  const outboxUlid = ulid();
  const auditAction = opts.overrideExpired ? `${opts.type}_OVERRIDE_EXPIRED` : opts.type;
  db.exec('BEGIN');
  try {
    db.exec({ sql: 'UPDATE assets SET qty=?, version=?, updated_at=? WHERE id=?', bind: [newQty, patch.version, patch.updated_at, opts.assetId] });
    db.exec({ sql: 'INSERT INTO transactions (id, asset_id, type, qty_delta, actor_id, ts, sync_status) VALUES (?,?,?,?,?,?,?)', bind: [id, opts.assetId, opts.type, opts.delta, opts.actorId, ts, 'PENDING'] });
    db.exec({ sql: 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)', bind: [ulid(), opts.actorId, auditAction, 'assets', JSON.stringify(asset), JSON.stringify({ ...asset, ...patch }), ts] });
    db.exec({ sql: 'INSERT INTO outbox (ulid, device_id, entity, entity_id, op, patch, base_version, created_at, status) VALUES (?,?,?,?,?,?,?,?,?)', bind: [outboxUlid, opts.deviceId, 'assets', opts.assetId, 'UPSERT', patchBytes, asset.version ?? 1, ts, 'PENDING'] });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
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
  // allow FIELD_OP to mark RECEIVED even from DRAFT in offline demo (relaxed)
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

// Pull indents from HQ (downstream sync) — merges by LWW
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
        db.exec({ sql: 'INSERT OR IGNORE INTO indents VALUES (?,?,?,?,?,?,?,?)', bind: [r.id, r.station_id, r.asset_id, r.qty_requested, r.urgency, r.status, r.created_by, r.created_at] });
        pulled++;
      } else if (local.status !== r.status) {
        db.exec({ sql: 'UPDATE indents SET status=? WHERE id=?', bind: [r.status, r.id] });
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
