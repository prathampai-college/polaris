// Field tablet data core. Pure functions over a sqlite-wasm oo1.DB handle — runs
// inside the DB Web Worker in the browser and under plain Node in core.test.ts.
// No relative imports on purpose (Node type-stripping + webpack both resolve it).
import { encode, decode } from '@msgpack/msgpack';
import { factory } from 'ulid';

// ulid's auto-detected PRNG looks for `window.crypto` (absent in a Web Worker) and
// falls back to a stubbed Node crypto. WebCrypto exists in workers, pages and Node.
const ulid = factory(() => globalThis.crypto.getRandomValues(new Uint8Array(1))[0] / 256);
import { isExpired } from '@polaris/shared/expiry';
import { SEED_STATIONS, SEED_CONTAINERS, SEED_CRATES, SEED_ASSETS } from '@polaris/shared/seed';

export interface Sqlite {
  exec(sql: string | { sql: string; bind?: unknown[] }): unknown;
  selectObjects(sql: string, bind?: unknown[]): Record<string, any>[];
  selectValue(sql: string, bind?: unknown[]): any;
  changes(): number;
}
export interface Ctx { stationId: string; deviceId: string; actorId: string; drill?: boolean }
export type Row = Record<string, any>;

export const SCHEMA_SQL = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS down_seq (entity TEXT, entity_id TEXT, seq INTEGER, PRIMARY KEY (entity, entity_id));
CREATE TABLE IF NOT EXISTS stations (id TEXT PRIMARY KEY, name TEXT, location TEXT, winter_crew_count INTEGER);
CREATE TABLE IF NOT EXISTS containers (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), type TEXT, position_2d TEXT);
CREATE TABLE IF NOT EXISTS crates (id TEXT PRIMARY KEY, container_id TEXT REFERENCES containers(id), coords TEXT, temp_zone TEXT);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, sku TEXT UNIQUE, name TEXT, category TEXT, qty REAL, unit TEXT, expiry_date TEXT, criticality TEXT, crate_id TEXT REFERENCES crates(id), barcode TEXT, version INTEGER DEFAULT 1, updated_at TEXT, vector_clock TEXT);
CREATE TABLE IF NOT EXISTS lots (id TEXT PRIMARY KEY, asset_sku TEXT NOT NULL, lot_code TEXT UNIQUE NOT NULL, qty REAL NOT NULL, expiry_date TEXT, crate_id TEXT, received_ts TEXT);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, asset_id TEXT REFERENCES assets(id), type TEXT CHECK(type IN ('IN','OUT','CONSUME','ADJUST')), qty_delta REAL, actor_id TEXT, ts TEXT, sync_status TEXT DEFAULT 'PENDING', outbox_ulid TEXT, drill INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS vessels (imo TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, sog REAL, eta TEXT, station_id TEXT, last_seen TEXT);
CREATE TABLE IF NOT EXISTS indents (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), asset_id TEXT REFERENCES assets(id), qty_requested REAL, urgency TEXT, status TEXT DEFAULT 'DRAFT', created_by TEXT, created_at TEXT, vessel_imo TEXT REFERENCES vessels(imo));
CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, actor_id TEXT, action TEXT, entity TEXT, before TEXT, after TEXT, ts TEXT);
CREATE TABLE IF NOT EXISTS outbox (ulid TEXT PRIMARY KEY, device_id TEXT, entity TEXT, entity_id TEXT, op TEXT, patch BLOB, base_version INTEGER, retry_count INTEGER DEFAULT 0, created_at TEXT, status TEXT CHECK(status IN ('PENDING','SENT','ACKED','FAILED','BUNDLED')) DEFAULT 'PENDING', vector_clock TEXT, sent_at TEXT, next_attempt_at TEXT, last_error TEXT, acked_at TEXT);
CREATE TABLE IF NOT EXISTS dtn_bundles (bundle_id TEXT PRIMARY KEY, src TEXT, dst_station TEXT, payload BLOB, vc TEXT, custody INTEGER DEFAULT 1, created_at TEXT, ttl INTEGER DEFAULT 86400);
CREATE TABLE IF NOT EXISTS personnel (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), name TEXT, role TEXT, blood_group TEXT, emergency_contact TEXT, status TEXT DEFAULT 'ON_STATION', program TEXT);
CREATE TABLE IF NOT EXISTS field_sorties (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), lead_personnel_id TEXT REFERENCES personnel(id), destination TEXT, departure_time TEXT, expected_return_time TEXT, actual_return_time TEXT, safety_status TEXT DEFAULT 'ACTIVE', expedition_id TEXT, buddy_personnel_id TEXT REFERENCES personnel(id));
CREATE TABLE IF NOT EXISTS emergencies (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), type TEXT, reported_by TEXT, status TEXT DEFAULT 'ACTIVE', ts TEXT, location_coord TEXT, assignee TEXT, sortie_id TEXT, status_entered_ts TEXT);
CREATE TABLE IF NOT EXISTS expeditions (id TEXT PRIMARY KEY, program TEXT, name TEXT, season TEXT, status TEXT DEFAULT 'PLANNED', created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS voyage_legs (id TEXT PRIMARY KEY, expedition_id TEXT, seq INTEGER DEFAULT 0, from_point TEXT, to_point TEXT, mode TEXT, vessel_imo TEXT, eta_depart TEXT, eta_arrive TEXT, status TEXT DEFAULT 'PLANNED');
CREATE TABLE IF NOT EXISTS manifests (id TEXT PRIMARY KEY, expedition_id TEXT, owner_org TEXT, project_code TEXT, destination_station TEXT, sku TEXT, description TEXT, qty REAL, unit TEXT, weight_kg REAL, hazmat_class TEXT, temp_zone TEXT, customs_status TEXT, biosecurity_status TEXT, labelling_code TEXT, container_id TEXT, crate_id TEXT, stage TEXT DEFAULT 'GOA');
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_entity ON outbox(entity, entity_id, status);
CREATE INDEX IF NOT EXISTS idx_lots_sku ON lots(asset_sku, expiry_date);
CREATE INDEX IF NOT EXISTS idx_tx_asset ON transactions(asset_id, ts);
`;

// Same roster HQ seeds (hq/app/db.py DEFAULT_PERSONNEL) so ids line up on first sync.
const SEED_PERSONNEL = [
  ['PER-BHA-01', 'ST-BHARATI', 'Dr. Rajesh Sharma', 'Station Leader & Glaciologist', 'O+', '+91-9876543210'],
  ['PER-BHA-02', 'ST-BHARATI', 'Capt. Vikram Rao', 'Logistics & Field Ops Lead', 'A+', '+91-9876543211'],
  ['PER-BHA-03', 'ST-BHARATI', 'Dr. Ananya Sen', 'Medical Officer', 'B+', '+91-9876543212'],
  ['PER-BHA-04', 'ST-BHARATI', 'Sunil Gaikwad', 'HVAC & Power Tech', 'AB+', '+91-9876543213'],
  ['PER-BHA-05', 'ST-BHARATI', 'Priya Nambiar', 'Atmospheric Physicist', 'O-', '+91-9876543214'],
  ['PER-MAI-01', 'ST-MAITRI', 'Dr. Devendra Rathore', 'Station Leader', 'A+', '+91-9876543215'],
  ['PER-MAI-02', 'ST-MAITRI', 'Dr. Neha Verma', 'Medical Officer & Medic', 'O+', '+91-9876543216'],
  ['PER-MAI-03', 'ST-MAITRI', 'Harpreet Singh', 'Heavy Vehicle Tech', 'B+', '+91-9876543217'],
  ['PER-HIM-01', 'ST-HIMADRI', 'Dr. Arvind Joshi', 'Arctic Mission Leader', 'A-', '+91-9876543218'],
  ['PER-HIM-02', 'ST-HIMADRI', 'Meera Pillai', 'Marine Biologist', 'O+', '+91-9876543219'],
];

const now = () => new Date().toISOString();
const one = (db: Sqlite, sql: string, bind: unknown[] = []) => db.selectObjects(sql, bind)[0] as Row | undefined;
const run = (db: Sqlite, sql: string, bind: unknown[] = []) => db.exec({ sql, bind });

export function withTx<T>(db: Sqlite, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  }
}

export function initSchema(db: Sqlite) {
  db.exec(SCHEMA_SQL);
}

export function kvGet(db: Sqlite, key: string): string | null {
  return (one(db, 'SELECT value FROM kv WHERE key=?', [key])?.value as string) ?? null;
}
export function kvSet(db: Sqlite, key: string, value: string | null) {
  if (value === null) run(db, 'DELETE FROM kv WHERE key=?', [key]);
  else run(db, 'INSERT INTO kv (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
}

export function seedIfEmpty(db: Sqlite) {
  if (Number(db.selectValue('SELECT COUNT(*) FROM stations')) > 0) return false;
  withTx(db, () => {
    for (const s of SEED_STATIONS) run(db, 'INSERT INTO stations VALUES (?,?,?,?)', [s.id, s.name, s.location, s.winter_crew_count]);
    for (const c of SEED_CONTAINERS) run(db, 'INSERT INTO containers VALUES (?,?,?,?)', [c.id, c.station_id, c.type, c.position_2d]);
    for (const c of SEED_CRATES) run(db, 'INSERT INTO crates VALUES (?,?,?,?)', [c.id, c.container_id, c.coords, c.temp_zone]);
    const ts = now();
    for (const a of SEED_ASSETS) {
      run(db, 'INSERT INTO assets (id,sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)',
        [a.id, a.sku, a.name, a.category, a.qty, a.unit, a.expiry_date, a.criticality, a.crate_id, a.barcode, ts]);
      // Opening lot — identical id/code to HQ's seed so FEFO lot frames converge.
      run(db, 'INSERT INTO lots (id, asset_sku, lot_code, qty, expiry_date, crate_id, received_ts) VALUES (?,?,?,?,?,?,?)',
        [`LOT-${a.sku}-0`, a.sku, `${a.sku}-L0`, a.qty, a.expiry_date, a.crate_id, ts]);
    }
    for (const p of SEED_PERSONNEL) run(db, 'INSERT INTO personnel (id, station_id, name, role, blood_group, emergency_contact, status) VALUES (?,?,?,?,?,?,?)', [...p, 'ON_STATION']);
  });
  return true;
}

// ---------------------------------------------------------------- outbox writer

interface OutboxWrite { entity: string; entityId: string; op: string; patch: Row; baseVersion?: number; vc?: Record<string, number> }

/** Queue one frame for HQ. Every local write goes through here (inside the caller's txn). */
function queue(db: Sqlite, ctx: Ctx, w: OutboxWrite): string {
  const id = ulid();
  run(db, 'INSERT INTO outbox (ulid, device_id, entity, entity_id, op, patch, base_version, created_at, status, vector_clock) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, ctx.deviceId, w.entity, w.entityId, w.op, encode(w.patch), w.baseVersion ?? 0, now(), 'PENDING', w.vc ? JSON.stringify(w.vc) : null]);
  return id;
}

function audit(db: Sqlite, ctx: Ctx, action: string, entity: string, before: unknown, after: unknown) {
  run(db, 'INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)',
    [ulid(), ctx.actorId, ctx.drill ? `DRILL_${action}` : action, entity, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), now()]);
}

// ---------------------------------------------------------------- queries

const ASSET_SELECT = `SELECT a.*, k.coords, k.container_id, k.temp_zone, c.type AS container_type, c.station_id
  FROM assets a LEFT JOIN crates k ON k.id=a.crate_id LEFT JOIN containers c ON c.id=k.container_id`;

export const queries = {
  listAssets: (db: Sqlite, ctx: Ctx) => db.selectObjects(`${ASSET_SELECT} WHERE c.station_id=? ORDER BY a.criticality='CRITICAL' DESC, a.sku`, [ctx.stationId]),
  /** Barcode or SKU, any station (a crate can arrive at the wrong base) — caller flags station mismatch. */
  findByCode: (db: Sqlite, _ctx: Ctx, code: string) => one(db, `${ASSET_SELECT} WHERE a.barcode=? OR a.sku=? OR a.id=?`, [code, code, code]) ?? null,
  getAsset: (db: Sqlite, _ctx: Ctx, id: string) => {
    const asset = one(db, `${ASSET_SELECT} WHERE a.id=?`, [id]);
    if (!asset) return null;
    return {
      asset,
      lots: db.selectObjects("SELECT * FROM lots WHERE asset_sku=? ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date, received_ts", [asset.sku]),
      history: db.selectObjects('SELECT * FROM transactions WHERE asset_id=? ORDER BY ts DESC LIMIT 12', [id]),
      pending: Number(db.selectValue("SELECT COUNT(*) FROM outbox WHERE entity='assets' AND entity_id=? AND status IN ('PENDING','SENT','BUNDLED')", [id])),
    };
  },
  stationLots: (db: Sqlite, ctx: Ctx) => db.selectObjects(
    `SELECT l.*, a.id AS asset_id, a.name, a.unit FROM lots l JOIN assets a ON a.sku=l.asset_sku JOIN crates k ON k.id=a.crate_id JOIN containers c ON c.id=k.container_id
     WHERE c.station_id=? AND l.qty>0 ORDER BY CASE WHEN l.expiry_date IS NULL THEN 1 ELSE 0 END, l.expiry_date`, [ctx.stationId]),
  pendingByAsset: (db: Sqlite, _ctx: Ctx) => Object.fromEntries(db.selectObjects(
    "SELECT entity_id, COUNT(*) AS n FROM outbox WHERE entity='assets' AND status IN ('PENDING','SENT','BUNDLED') GROUP BY entity_id").map((r) => [r.entity_id, Number(r.n)])) as Record<string, number>,
  listTransactions: (db: Sqlite, ctx: Ctx, limit = 30) => db.selectObjects(
    `SELECT t.*, a.sku, a.name, a.unit FROM transactions t JOIN assets a ON a.id=t.asset_id JOIN crates k ON k.id=a.crate_id JOIN containers c ON c.id=k.container_id
     WHERE c.station_id=? ORDER BY t.ts DESC LIMIT ?`, [ctx.stationId, limit]),
  listAudit: (db: Sqlite, _ctx: Ctx, limit = 40) => db.selectObjects('SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?', [limit]),
  listIndents: (db: Sqlite, ctx: Ctx) => db.selectObjects(
    'SELECT i.*, a.sku, a.name, a.unit FROM indents i LEFT JOIN assets a ON a.id=i.asset_id WHERE i.station_id=? ORDER BY i.created_at DESC', [ctx.stationId]),
  listPersonnel: (db: Sqlite, ctx: Ctx) => db.selectObjects('SELECT * FROM personnel WHERE station_id=? ORDER BY name', [ctx.stationId]),
  listSorties: (db: Sqlite, ctx: Ctx) => db.selectObjects(
    `SELECT s.*, l.name AS lead_name, b.name AS buddy_name FROM field_sorties s
     LEFT JOIN personnel l ON l.id=s.lead_personnel_id LEFT JOIN personnel b ON b.id=s.buddy_personnel_id
     WHERE s.station_id=? ORDER BY s.departure_time DESC LIMIT 50`, [ctx.stationId]),
  listEmergencies: (db: Sqlite, ctx: Ctx) => db.selectObjects(
    `SELECT e.*, p.name AS assignee_name FROM emergencies e LEFT JOIN personnel p ON p.id=e.assignee
     WHERE e.station_id=? ORDER BY e.status='RESOLVED', e.ts DESC LIMIT 50`, [ctx.stationId]),
  listExpeditions: (db: Sqlite, _ctx: Ctx) => db.selectObjects('SELECT * FROM expeditions ORDER BY season DESC, name'),
  listManifests: (db: Sqlite, ctx: Ctx) => db.selectObjects(
    'SELECT m.*, e.name AS expedition_name FROM manifests m LEFT JOIN expeditions e ON e.id=m.expedition_id WHERE m.destination_station=? ORDER BY m.stage, m.labelling_code', [ctx.stationId]),
  stationMap: (db: Sqlite, ctx: Ctx) => ({
    containers: db.selectObjects('SELECT * FROM containers WHERE station_id=? ORDER BY id', [ctx.stationId]),
    crates: db.selectObjects('SELECT k.* FROM crates k JOIN containers c ON c.id=k.container_id WHERE c.station_id=? ORDER BY k.id', [ctx.stationId]),
  }),
  outboxBreakdown: (db: Sqlite, _ctx: Ctx) => {
    const m = { PENDING: 0, SENT: 0, BUNDLED: 0, FAILED: 0, ACKED: 0 };
    for (const r of db.selectObjects('SELECT status, COUNT(*) AS n FROM outbox GROUP BY status')) m[r.status as keyof typeof m] = Number(r.n);
    const last = one(db, 'SELECT MAX(acked_at) AS t FROM outbox')?.t ?? null;
    return { ...m, unsynced: m.PENDING + m.SENT + m.BUNDLED, lastAckAt: last as string | null };
  },
  listOutbox: (db: Sqlite, _ctx: Ctx, limit = 60) => db.selectObjects(
    `SELECT ulid, entity, entity_id, op, status, retry_count, created_at, sent_at, acked_at, last_error, patch FROM outbox
     ORDER BY CASE status WHEN 'FAILED' THEN 0 WHEN 'PENDING' THEN 1 WHEN 'BUNDLED' THEN 2 WHEN 'SENT' THEN 3 ELSE 4 END, created_at DESC LIMIT ?`, [limit],
  ).map((r): Row => ({ ...r, patch: safeDecode(r.patch) })),
  listBundles: (db: Sqlite, _ctx: Ctx) => db.selectObjects('SELECT bundle_id, src, dst_station, created_at, ttl FROM dtn_bundles ORDER BY created_at DESC LIMIT 100'),
};

function safeDecode(b: unknown): Row | null {
  try { return b instanceof Uint8Array ? (decode(b) as Row) : null; } catch { return null; }
}

// ---------------------------------------------------------------- stock (FEFO lots)

export type TxType = 'IN' | 'OUT' | 'CONSUME' | 'ADJUST';

/** qty is always positive except ADJUST, which is a signed correction. */
export function recordTx(db: Sqlite, ctx: Ctx, o: { assetId: string; type: TxType; qty: number; overrideExpired?: boolean; lotId?: string; reason?: string }) {
  const delta = o.type === 'IN' ? Math.abs(o.qty) : o.type === 'ADJUST' ? o.qty : -Math.abs(o.qty);
  if (!Number.isFinite(delta) || delta === 0) throw new Error('Quantity must be non-zero');
  return withTx(db, () => {
    const asset = one(db, 'SELECT * FROM assets WHERE id=?', [o.assetId]);
    if (!asset) throw new Error(`Asset ${o.assetId} not found`);
    const ts = now();
    const vc = { ...(safeJson(asset.vector_clock)), [ctx.deviceId]: (safeJson(asset.vector_clock)[ctx.deviceId] ?? 0) + 1 };
    // Frames carry `delta` so HQ adds rather than overwrites: two tablets consuming
    // from the same lot offline must both count (absolute qty would lose one).
    const lotFrames: Row[] = [];

    if (delta < 0) {
      let need = -delta;
      const lots = o.lotId
        ? db.selectObjects('SELECT * FROM lots WHERE id=? AND asset_sku=?', [o.lotId, asset.sku])
        : db.selectObjects('SELECT * FROM lots WHERE asset_sku=? AND qty>0 ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date, received_ts', [asset.sku]);
      // Only CONSUME is expiry-gated; OUT (transfer) and ADJUST (write-off) may move expired stock.
      const gate = (l: Row) => o.type !== 'CONSUME' || o.overrideExpired || !isExpired(l.expiry_date ?? null);
      const usable = lots.filter(gate).reduce((s, l) => s + Number(l.qty), 0);
      if (usable < need) {
        const expired = lots.filter((l) => !gate(l)).reduce((s, l) => s + Number(l.qty), 0);
        throw new Error(expired > 0
          ? `Only ${usable} ${asset.unit} usable — ${expired} ${asset.unit} is EXPIRED. Station-lead override required.`
          : `Insufficient stock: need ${need} ${asset.unit}, have ${usable}`);
      }
      for (const l of lots) {
        if (need <= 0) break;
        if (!gate(l)) continue;
        const take = Math.min(Number(l.qty), need);
        run(db, 'UPDATE lots SET qty=qty-? WHERE id=?', [take, l.id]);
        lotFrames.push({ id: l.id, patch: { asset_sku: asset.sku, lot_code: l.lot_code, qty: Number(l.qty) - take, delta: -take } });
        need -= take;
      }
    } else if (o.type === 'ADJUST') {
      // Found stock: fold into the opening lot rather than inventing a new lot identity.
      const lotId = ensureOpeningLot(db, asset);
      run(db, 'UPDATE lots SET qty=qty+? WHERE id=?', [delta, lotId]);
      const l = one(db, 'SELECT * FROM lots WHERE id=?', [lotId])!;
      lotFrames.push({ id: lotId, patch: { asset_sku: asset.sku, lot_code: l.lot_code, qty: l.qty, delta } });
    } else {
      const lotId = ulid();
      const lotCode = `${asset.sku}-L-${lotId.slice(-6)}`;
      run(db, 'INSERT INTO lots (id, asset_sku, lot_code, qty, expiry_date, crate_id, received_ts) VALUES (?,?,?,?,?,?,?)',
        [lotId, asset.sku, lotCode, delta, asset.expiry_date ?? null, asset.crate_id, ts]);
      lotFrames.push({ id: lotId, patch: { asset_sku: asset.sku, lot_code: lotCode, qty: delta, expiry_date: asset.expiry_date ?? null, crate_id: asset.crate_id, received_ts: ts } });
    }

    const newQty = Number(db.selectValue('SELECT COALESCE(SUM(qty),0) FROM lots WHERE asset_sku=?', [asset.sku]));
    const version = Number(asset.version ?? 1) + 1;
    run(db, 'UPDATE assets SET qty=?, version=?, updated_at=?, vector_clock=? WHERE id=?', [newQty, version, ts, JSON.stringify(vc), o.assetId]);
    for (const f of lotFrames) queue(db, ctx, { entity: 'lots', entityId: f.id, op: 'UPSERT', patch: f.patch });
    const obx = queue(db, ctx, { entity: 'assets', entityId: o.assetId, op: o.type, patch: { qty: newQty, delta, version, updated_at: ts }, baseVersion: asset.version, vc });
    run(db, 'INSERT INTO transactions (id, asset_id, type, qty_delta, actor_id, ts, sync_status, outbox_ulid, drill) VALUES (?,?,?,?,?,?,?,?,?)',
      [ulid(), o.assetId, o.type, delta, ctx.actorId, ts, 'PENDING', obx, ctx.drill ? 1 : 0]);
    audit(db, ctx, o.overrideExpired ? `${o.type}_OVERRIDE_EXPIRED` : o.type, 'assets', { qty: asset.qty }, { qty: newQty, delta, reason: o.reason ?? null });
    return { newQty, delta, unit: asset.unit as string, sku: asset.sku as string };
  });
}

function ensureOpeningLot(db: Sqlite, asset: Row): string {
  const id = `LOT-${asset.sku}-0`;
  if (!one(db, 'SELECT 1 FROM lots WHERE id=?', [id])) {
    run(db, 'INSERT INTO lots (id, asset_sku, lot_code, qty, expiry_date, crate_id, received_ts) VALUES (?,?,?,0,?,?,?)', [id, asset.sku, `${asset.sku}-L0`, asset.expiry_date ?? null, asset.crate_id, now()]);
  }
  return id;
}

function safeJson(s: unknown): Record<string, number> {
  try { return typeof s === 'string' && s ? JSON.parse(s) : {}; } catch { return {}; }
}

// ---------------------------------------------------------------- mutations

const INDENT_FLOW: Record<string, string> = { DRAFT: 'APPROVED', APPROVED: 'DISPATCHED', DISPATCHED: 'RECEIVED' };
const TRIAGE_FLOW: Record<string, string> = { ACTIVE: 'ACK', ACK: 'RESPONDING', RESPONDING: 'RESOLVED' };
import { MANIFEST_STAGES } from './stages.ts';
export { MANIFEST_STAGES };

export const mutations = {
  recordTx,

  createIndent(db: Sqlite, ctx: Ctx, o: { assetId: string; qty: number; urgency: 'LOW' | 'MEDIUM' | 'CRITICAL' }) {
    if (!(o.qty > 0)) throw new Error('Quantity must be > 0');
    return withTx(db, () => {
      const id = ulid();
      const row = { station_id: ctx.stationId, asset_id: o.assetId, qty_requested: o.qty, urgency: o.urgency, status: 'DRAFT', created_by: ctx.actorId, created_at: now() };
      run(db, 'INSERT INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', [id, ...Object.values(row)]);
      queue(db, ctx, { entity: 'indents', entityId: id, op: 'UPSERT', patch: row });
      audit(db, ctx, 'INDENT_CREATE', 'indents', null, { id, ...row });
      return { id };
    });
  },

  /** Field only closes the loop (DISPATCHED → RECEIVED) and books the stock in. Approval/dispatch are HQ's. */
  receiveIndent(db: Sqlite, ctx: Ctx, o: { indentId: string; receivedQty?: number }) {
    const ind = one(db, 'SELECT * FROM indents WHERE id=?', [o.indentId]);
    if (!ind) throw new Error('Indent not found');
    if (INDENT_FLOW[ind.status] !== 'RECEIVED') throw new Error(`Indent is ${ind.status} — only DISPATCHED indents can be received`);
    const qty = o.receivedQty ?? Number(ind.qty_requested);
    withTx(db, () => {
      run(db, "UPDATE indents SET status='RECEIVED' WHERE id=?", [o.indentId]);
      queue(db, ctx, { entity: 'indents', entityId: o.indentId, op: 'UPSERT', patch: { status: 'RECEIVED' } });
      audit(db, ctx, 'INDENT_RECEIVED', 'indents', { status: ind.status }, { status: 'RECEIVED', qty });
    });
    // Separate txn: receiving must succeed even if the asset row is missing locally.
    if (ind.asset_id && qty > 0 && one(db, 'SELECT 1 FROM assets WHERE id=?', [ind.asset_id])) {
      return recordTx(db, ctx, { assetId: ind.asset_id, type: 'IN', qty, reason: `indent ${o.indentId.slice(-6)}` });
    }
    return null;
  },

  setPersonnelStatus(db: Sqlite, ctx: Ctx, o: { id: string; status: 'ON_STATION' | 'IN_TRANSIT' | 'EVACUATED' }) {
    return withTx(db, () => {
      const p = one(db, 'SELECT * FROM personnel WHERE id=?', [o.id]);
      if (!p) throw new Error('Person not found');
      // Only block if a sortie on this tablet actually holds them; an orphaned FIELD_SORTIE
      // (sortie record never reached this tablet) must not strand the person forever.
      const onSortie = one(db, "SELECT 1 FROM field_sorties WHERE safety_status IN ('ACTIVE','OVERDUE','EMERGENCY') AND (lead_personnel_id=? OR buddy_personnel_id=?)", [o.id, o.id]);
      if (p.status === 'FIELD_SORTIE' && onSortie) throw new Error(`${p.name} is on a sortie — close the sortie to check them in`);
      run(db, 'UPDATE personnel SET status=? WHERE id=?', [o.status, o.id]);
      queue(db, ctx, { entity: 'personnel', entityId: o.id, op: 'UPSERT', patch: { status: o.status } });
      audit(db, ctx, `PERSONNEL_${o.status}`, 'personnel', { status: p.status }, { status: o.status });
    });
  },

  startSortie(db: Sqlite, ctx: Ctx, o: { leadId: string; buddyId?: string | null; destination: string; expectedReturn: string; soloOverride?: boolean; role?: string }) {
    if (!o.destination.trim()) throw new Error('Destination required');
    if (!o.buddyId && !o.soloOverride) throw new Error('Buddy required — two-person rule');
    if (!o.buddyId && o.role !== 'STATION_LEAD') throw new Error('Solo sortie needs a STATION_LEAD session');
    if (o.buddyId && o.buddyId === o.leadId) throw new Error('Buddy must be a different person');
    if (Date.parse(o.expectedReturn) <= Date.now()) throw new Error('Expected return must be in the future');
    return withTx(db, () => {
      for (const pid of [o.leadId, o.buddyId].filter(Boolean) as string[]) {
        const p = one(db, 'SELECT name, status FROM personnel WHERE id=?', [pid]);
        if (!p) throw new Error(`Person ${pid} not found`);
        if (p.status !== 'ON_STATION') throw new Error(`${p.name} is ${p.status.replace('_', ' ').toLowerCase()}`);
      }
      const id = ulid();
      const row = { station_id: ctx.stationId, lead_personnel_id: o.leadId, buddy_personnel_id: o.buddyId || null, destination: o.destination.trim(), departure_time: now(), expected_return_time: o.expectedReturn, safety_status: 'ACTIVE' };
      run(db, 'INSERT INTO field_sorties (id, station_id, lead_personnel_id, buddy_personnel_id, destination, departure_time, expected_return_time, safety_status) VALUES (?,?,?,?,?,?,?,?)', [id, ...Object.values(row)]);
      queue(db, ctx, { entity: 'field_sorties', entityId: id, op: 'UPSERT', patch: row });
      for (const pid of [o.leadId, o.buddyId].filter(Boolean) as string[]) {
        run(db, "UPDATE personnel SET status='FIELD_SORTIE' WHERE id=?", [pid]);
        queue(db, ctx, { entity: 'personnel', entityId: pid, op: 'UPSERT', patch: { status: 'FIELD_SORTIE' } });
      }
      audit(db, ctx, o.buddyId ? 'SORTIE_START' : 'SORTIE_SOLO_OVERRIDE', 'field_sorties', null, { id, ...row });
      return { id };
    });
  },

  closeSortie(db: Sqlite, ctx: Ctx, o: { id: string }) {
    return withTx(db, () => {
      const s = one(db, 'SELECT * FROM field_sorties WHERE id=?', [o.id]);
      if (!s) throw new Error('Sortie not found');
      if (s.safety_status === 'RETURNED') throw new Error('Sortie already closed');
      const ts = now();
      run(db, "UPDATE field_sorties SET safety_status='RETURNED', actual_return_time=? WHERE id=?", [ts, o.id]);
      queue(db, ctx, { entity: 'field_sorties', entityId: o.id, op: 'UPSERT', patch: { safety_status: 'RETURNED', actual_return_time: ts } });
      for (const pid of [s.lead_personnel_id, s.buddy_personnel_id].filter(Boolean)) {
        run(db, "UPDATE personnel SET status='ON_STATION' WHERE id=?", [pid]);
        queue(db, ctx, { entity: 'personnel', entityId: pid, op: 'UPSERT', patch: { status: 'ON_STATION' } });
      }
      audit(db, ctx, 'SORTIE_RETURNED', 'field_sorties', { safety_status: s.safety_status }, { safety_status: 'RETURNED' });
    });
  },

  raiseSOS(db: Sqlite, ctx: Ctx, o: { type: string; location: string; sortieId?: string | null }) {
    if (!o.location.trim()) throw new Error('Location required — pick one or choose LOCATION UNKNOWN');
    return withTx(db, () => {
      const id = ulid();
      const ts = now();
      const row = { station_id: ctx.stationId, type: o.type, reported_by: ctx.actorId, status: 'ACTIVE', ts, location_coord: o.location.trim(), sortie_id: o.sortieId ?? null, status_entered_ts: ts };
      run(db, 'INSERT INTO emergencies (id, station_id, type, reported_by, status, ts, location_coord, sortie_id, status_entered_ts) VALUES (?,?,?,?,?,?,?,?,?)', [id, ...Object.values(row)]);
      queue(db, ctx, { entity: 'emergencies', entityId: id, op: 'UPSERT', patch: row });
      audit(db, ctx, `SOS_${o.type}`, 'emergencies', null, { id, ...row });
      return { id };
    });
  },

  advanceEmergency(db: Sqlite, ctx: Ctx, o: { id: string; assignee?: string | null }) {
    return withTx(db, () => {
      const e = one(db, 'SELECT * FROM emergencies WHERE id=?', [o.id]);
      if (!e) throw new Error('Emergency not found');
      const next = TRIAGE_FLOW[e.status];
      if (!next) throw new Error('Emergency already resolved');
      const ts = now();
      const patch: Row = { status: next, status_entered_ts: ts };
      if (o.assignee) patch.assignee = o.assignee;
      run(db, `UPDATE emergencies SET ${Object.keys(patch).map((k) => `${k}=?`).join(', ')} WHERE id=?`, [...Object.values(patch), o.id]);
      queue(db, ctx, { entity: 'emergencies', entityId: o.id, op: 'UPSERT', patch });
      audit(db, ctx, `EMERGENCY_${next}`, 'emergencies', { status: e.status }, patch);
      return { status: next };
    });
  },

  advanceManifest(db: Sqlite, ctx: Ctx, o: { id: string }) {
    return withTx(db, () => {
      const m = one(db, 'SELECT * FROM manifests WHERE id=?', [o.id]);
      if (!m) throw new Error('Manifest not found');
      const at = MANIFEST_STAGES.indexOf(m.stage);
      if (at < 0) throw new Error(`Unknown custody stage "${m.stage}" — refresh plans from HQ`);
      const next = MANIFEST_STAGES[at + 1];
      if (!next) throw new Error('Manifest already at final stage');
      run(db, 'UPDATE manifests SET stage=? WHERE id=?', [next, o.id]);
      queue(db, ctx, { entity: 'manifests', entityId: o.id, op: 'UPSERT', patch: { stage: next } });
      audit(db, ctx, `MANIFEST_${next}`, 'manifests', { stage: m.stage }, { stage: next });
      return { stage: next };
    });
  },

  /** HQ is the source of truth for plans; merge without clobbering unsynced local edits. */
  mergeFromHQ(db: Sqlite, _ctx: Ctx, o: { entity: 'expeditions' | 'manifests' | 'assets' | 'personnel' | 'indents'; rows: Row[] }) {
    let applied = 0;
    let skipped = 0;
    for (const r of o.rows) {
      const ok = applyDownstream(db, o.entity, String(r.id ?? r.imo), r);
      if (ok) applied++; else skipped++;
    }
    return { applied, skipped };
  },

  /** Operator gives up on a frame HQ permanently rejected. Audited; local data is left as-is. */
  discardFailed(db: Sqlite, ctx: Ctx, id: string) {
    return withTx(db, () => {
      const r = one(db, "SELECT entity, entity_id, op, last_error FROM outbox WHERE ulid=? AND status='FAILED'", [id]);
      if (!r) throw new Error('Only FAILED frames can be discarded');
      run(db, 'DELETE FROM outbox WHERE ulid=?', [id]);
      run(db, 'DELETE FROM dtn_bundles WHERE bundle_id=?', [id]);
      audit(db, ctx, 'SYNC_FRAME_DISCARDED', r.entity, r, null);
      return true;
    });
  },

  retryOne(db: Sqlite, _ctx: Ctx, id: string) {
    run(db, "UPDATE outbox SET status='PENDING', next_attempt_at=NULL, last_error=NULL WHERE ulid=? AND status='FAILED'", [id]);
    return db.changes() > 0;
  },

  retryFailed(db: Sqlite, _ctx: Ctx) {
    run(db, "UPDATE outbox SET status='PENDING', next_attempt_at=NULL, last_error=NULL WHERE status='FAILED'");
    return db.changes();
  },
};

// ---------------------------------------------------------------- downstream (HQ → tablet)

// Columns HQ may set on this tablet, per entity. Mirrors hq/app/sync_apply.py ENTITIES.
const DOWN: Record<string, { cols: string[]; required: string[]; pk?: string }> = {
  indents: { cols: ['station_id', 'asset_id', 'qty_requested', 'urgency', 'status', 'created_by', 'created_at', 'vessel_imo'], required: ['station_id', 'asset_id'] },
  personnel: { cols: ['station_id', 'name', 'role', 'blood_group', 'emergency_contact', 'status', 'program'], required: ['station_id', 'name'] },
  field_sorties: { cols: ['station_id', 'lead_personnel_id', 'destination', 'departure_time', 'expected_return_time', 'actual_return_time', 'safety_status', 'expedition_id', 'buddy_personnel_id'], required: ['station_id', 'lead_personnel_id'] },
  emergencies: { cols: ['station_id', 'type', 'reported_by', 'status', 'ts', 'location_coord', 'assignee', 'sortie_id', 'status_entered_ts'], required: ['station_id', 'type'] },
  expeditions: { cols: ['program', 'name', 'season', 'status', 'created_by', 'created_at'], required: ['name'] },
  voyage_legs: { cols: ['expedition_id', 'seq', 'from_point', 'to_point', 'mode', 'vessel_imo', 'eta_depart', 'eta_arrive', 'status'], required: ['expedition_id'] },
  manifests: { cols: ['expedition_id', 'owner_org', 'project_code', 'destination_station', 'sku', 'description', 'qty', 'unit', 'weight_kg', 'hazmat_class', 'temp_zone', 'customs_status', 'biosecurity_status', 'labelling_code', 'container_id', 'crate_id', 'stage'], required: ['expedition_id'] },
  vessels: { cols: ['name', 'lat', 'lon', 'sog', 'eta', 'station_id', 'last_seen'], required: [], pk: 'imo' },
};

/**
 * Apply one server-side change. Rule: if this tablet still has unsynced writes for
 * the entity, local wins (they'll reach HQ and come back); otherwise the server wins.
 * Returns false when skipped. Never throws — one bad row must not block the rest.
 */
/** One HQ downstream delta. `seq` is HQ's change_log order: replayed and live
 *  deltas can interleave after a reconnect, so an older seq never overwrites a
 *  newer one for the same row. 'held' = local unsynced edits win for now; the
 *  caller must not advance its resume cursor past it. */
export function applyDownstreamDelta(db: Sqlite, entity: string, id: string, patch: Row, seq?: number): 'applied' | 'held' | 'stale' | 'noop' {
  if (Number(db.selectValue("SELECT COUNT(*) FROM outbox WHERE entity=? AND entity_id=? AND status IN ('PENDING','SENT','BUNDLED')", [entity, id])) > 0) return 'held';
  if (seq != null) {
    const last = db.selectValue('SELECT seq FROM down_seq WHERE entity=? AND entity_id=?', [entity, id]);
    if (last != null && Number(last) >= seq) return 'stale';
  }
  const ok = applyDownstream(db, entity, id, patch);
  if (seq != null) run(db, 'INSERT INTO down_seq (entity, entity_id, seq) VALUES (?,?,?) ON CONFLICT(entity, entity_id) DO UPDATE SET seq=excluded.seq', [entity, id, seq]);
  return ok ? 'applied' : 'noop';
}

export function applyDownstream(db: Sqlite, entity: string, id: string, patch: Row): boolean {
  try {
    const unsynced = Number(db.selectValue("SELECT COUNT(*) FROM outbox WHERE entity=? AND entity_id=? AND status IN ('PENDING','SENT','BUNDLED')", [entity, id]));
    if (unsynced > 0) return false;
    if (entity === 'assets') return applyAssetDown(db, id, patch);
    const spec = DOWN[entity];
    if (!spec) return false;
    const pk = spec.pk ?? 'id';
    const fields: Row = {};
    for (const c of spec.cols) if (c in patch && patch[c] !== undefined) fields[c] = patch[c];
    if (entity === 'indents' && fields.vessel_imo) {
      run(db, 'INSERT INTO vessels (imo) VALUES (?) ON CONFLICT(imo) DO NOTHING', [fields.vessel_imo]);
    }
    return withTx(db, () => {
      if (one(db, `SELECT 1 FROM ${entity} WHERE ${pk}=?`, [id])) {
        if (!Object.keys(fields).length) return false;
        run(db, `UPDATE ${entity} SET ${Object.keys(fields).map((k) => `${k}=?`).join(', ')} WHERE ${pk}=?`, [...Object.values(fields), id]);
      } else {
        if (spec.required.some((c) => fields[c] == null)) return false;
        const cols = [pk, ...Object.keys(fields)];
        run(db, `INSERT INTO ${entity} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, [id, ...Object.values(fields)]);
      }
      return true;
    });
  } catch {
    return false;
  }
}

function applyAssetDown(db: Sqlite, id: string, patch: Row): boolean {
  const a = one(db, 'SELECT * FROM assets WHERE id=?', [id]);
  if (!a) {
    if (!patch.sku || !patch.crate_id || !one(db, 'SELECT 1 FROM crates WHERE id=?', [patch.crate_id])) return false;
    return withTx(db, () => {
      run(db, 'INSERT INTO assets (id, sku, name, category, qty, unit, expiry_date, criticality, crate_id, barcode, version, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, patch.sku, patch.name ?? patch.sku, patch.category ?? null, Number(patch.qty ?? 0), patch.unit ?? null, patch.expiry_date ?? null, patch.criticality ?? null, patch.crate_id, patch.barcode ?? patch.sku, patch.version ?? 1, now()]);
      run(db, 'INSERT INTO lots (id, asset_sku, lot_code, qty, expiry_date, crate_id, received_ts) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
        [`LOT-${patch.sku}-0`, patch.sku, `${patch.sku}-L0`, Number(patch.qty ?? 0), patch.expiry_date ?? null, patch.crate_id, now()]);
      return true;
    });
  }
  if (patch.qty === undefined) return false;
  return withTx(db, () => {
    // HQ sends absolute qty (stock-take / bulk import). Keep lots summing to it.
    const sum = Number(db.selectValue('SELECT COALESCE(SUM(qty),0) FROM lots WHERE asset_sku=?', [a.sku]));
    const diff = Number(patch.qty) - sum;
    if (diff > 0) {
      // Surplus found: fold into the opening lot rather than inventing a lot identity.
      const lotId = ensureOpeningLot(db, a);
      run(db, 'UPDATE lots SET qty=qty+? WHERE id=?', [diff, lotId]);
    } else if (diff < 0) {
      // Write-off: draw down FEFO-first (earliest expiry, then opening lot) so a
      // reduction bigger than any single lot is spread across lots instead of being
      // silently dropped once the opening lot alone hits its MAX(0,…) floor.
      let need = -diff;
      const lots = db.selectObjects(
        'SELECT * FROM lots WHERE asset_sku=? AND qty>0 ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date, received_ts',
        [a.sku],
      );
      for (const l of lots) {
        if (need <= 0) break;
        const take = Math.min(Number(l.qty), need);
        run(db, 'UPDATE lots SET qty=qty-? WHERE id=?', [take, l.id]);
        need -= take;
      }
    }
    const qty = Number(db.selectValue('SELECT COALESCE(SUM(qty),0) FROM lots WHERE asset_sku=?', [a.sku]));
    run(db, 'UPDATE assets SET qty=?, version=?, updated_at=? WHERE id=?', [qty, patch.version ?? Number(a.version ?? 1) + 1, now(), id]);
    return true;
  });
}

// ---------------------------------------------------------------- sync bookkeeping (used by the engine)

export const RESEND_AFTER_MS = 15_000;

// SOS first: an emergency must never wait behind a stock-movement backlog.
export function nextFrames(db: Sqlite, limit: number) {
  const t = now();
  const stale = new Date(Date.now() - RESEND_AFTER_MS).toISOString();
  return db.selectObjects(
    `SELECT * FROM outbox WHERE (status IN ('PENDING','BUNDLED') OR (status='SENT' AND sent_at < ?))
     AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY (entity='emergencies') DESC, created_at LIMIT ?`, [stale, t, limit],
  ).map((r): Row => ({ ...r, patch: safeDecode(r.patch) ?? {} }));
}

export function markSent(db: Sqlite, id: string) {
  run(db, "UPDATE outbox SET status='SENT', sent_at=?, retry_count=retry_count+1 WHERE ulid=? AND status!='ACKED'", [now(), id]);
}

/** Returns true if the row changed. ACKED is terminal — a late FAILED/RETRY never downgrades it. */
export function applyAck(db: Sqlite, a: { ulid: string; status: string; message?: string }): boolean {
  const row = one(db, 'SELECT status, retry_count FROM outbox WHERE ulid=?', [a.ulid]);
  if (!row || row.status === 'ACKED') return false;
  if (a.status === 'APPLIED' || a.status === 'DEDUPED' || a.status === 'APPLIED_LOCAL_WINS') {
    withTx(db, () => {
      run(db, "UPDATE outbox SET status='ACKED', acked_at=?, last_error=NULL WHERE ulid=?", [now(), a.ulid]);
      run(db, "UPDATE transactions SET sync_status='SYNCED' WHERE outbox_ulid=?", [a.ulid]);
      run(db, 'DELETE FROM dtn_bundles WHERE bundle_id=?', [a.ulid]);
    });
  } else if (a.status === 'RETRY') {
    const backoff = Math.min(120_000, 2_000 * 2 ** Math.min(6, Number(row.retry_count)));
    run(db, "UPDATE outbox SET status='PENDING', next_attempt_at=?, last_error=? WHERE ulid=?", [new Date(Date.now() + backoff).toISOString(), a.message ?? 'HQ busy — retrying', a.ulid]);
  } else {
    withTx(db, () => {
      run(db, "UPDATE outbox SET status='FAILED', last_error=? WHERE ulid=?", [a.message ?? a.status, a.ulid]);
      run(db, "UPDATE transactions SET sync_status='FAILED' WHERE outbox_ulid=?", [a.ulid]);
      // A permanently-rejected frame must stop circulating via DTN mesh/QR mules too.
      run(db, 'DELETE FROM dtn_bundles WHERE bundle_id=?', [a.ulid]);
    });
  }
  return true;
}

/** Offline: take DTN custody of every unsent row. Bundle id == outbox ULID so HQ dedupes across channels. */
export function bundleOffline(db: Sqlite, stationId: string): Row[] {
  const rows = db.selectObjects("SELECT * FROM outbox WHERE status IN ('PENDING','SENT') ORDER BY (entity='emergencies') DESC, created_at LIMIT 50");
  const out: Row[] = [];
  for (const r of rows) {
    const bundle = {
      bundleId: r.ulid, src: r.device_id, dstStation: stationId, ttlSec: 7 * 86400, createdAt: r.created_at,
      vectorClock: safeJson(r.vector_clock), custody: true,
      payload: { entity: r.entity, entity_id: r.entity_id, op: r.op, patch: safeDecode(r.patch) ?? {}, base_version: r.base_version },
    };
    withTx(db, () => {
      run(db, 'INSERT INTO dtn_bundles (bundle_id, src, dst_station, payload, vc, custody, created_at, ttl) VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(bundle_id) DO NOTHING',
        [bundle.bundleId, bundle.src, stationId, encode(bundle), r.vector_clock, bundle.createdAt, bundle.ttlSec]);
      run(db, "UPDATE outbox SET status='BUNDLED' WHERE ulid=?", [r.ulid]);
    });
    out.push(bundle);
  }
  return out;
}

/** Bundles this tablet carries for OTHER devices (peer/QR mule) — forwarded via gateway /dtn/exchange. */
export function foreignBundles(db: Sqlite, deviceId: string): Row[] {
  const t = Date.now();
  const rows = db.selectObjects('SELECT * FROM dtn_bundles WHERE src != ?', [deviceId]);
  const live: Row[] = [];
  for (const r of rows) {
    if (t - Date.parse(r.created_at) > Number(r.ttl) * 1000) { run(db, 'DELETE FROM dtn_bundles WHERE bundle_id=?', [r.bundle_id]); continue; }
    const b = safeDecode(r.payload);
    if (b) live.push(b);
  }
  return live;
}

export function saveForeignBundle(db: Sqlite, deviceId: string, b: Row): boolean {
  if (!b?.bundleId || !b.payload || b.src === deviceId) return false;
  run(db, 'INSERT INTO dtn_bundles (bundle_id, src, dst_station, payload, vc, custody, created_at, ttl) VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(bundle_id) DO NOTHING',
    [b.bundleId, b.src, b.dstStation ?? null, encode(b), JSON.stringify(b.vectorClock ?? {}), b.createdAt ?? now(), b.ttlSec ?? 86400]);
  return db.changes() > 0;
}

export function exportOwnBundles(db: Sqlite, deviceId: string): Row[] {
  return db.selectObjects('SELECT payload FROM dtn_bundles WHERE src=? ORDER BY created_at', [deviceId]).map((r) => safeDecode(r.payload)).filter(Boolean) as Row[];
}

export function dropBundle(db: Sqlite, id: string) {
  run(db, 'DELETE FROM dtn_bundles WHERE bundle_id=?', [id]);
}
