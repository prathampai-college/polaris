PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,
  name TEXT CHECK(name IN ('Bharati','Maitri','Himadri')),
  location TEXT,
  winter_crew_count INTEGER
);

CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,
  station_id TEXT REFERENCES stations(id),
  type TEXT CHECK(type IN ('ISO_20ft','ColdStore','Hazmat')),
  position_2d TEXT
);

CREATE TABLE IF NOT EXISTS crates (
  id TEXT PRIMARY KEY,
  container_id TEXT REFERENCES containers(id),
  coords TEXT,
  temp_zone TEXT
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  sku TEXT UNIQUE,
  name TEXT,
  category TEXT CHECK(category IN ('FUEL_DIESEL','FUEL_KEROSENE','OXYGEN','FOOD','MEDICAL','SPARES_DG','SPARES_HVAC','SCIENTIFIC')),
  qty REAL,
  unit TEXT,
  expiry_date TEXT,
  criticality TEXT CHECK(criticality IN ('CRITICAL','HIGH','LOW')),
  crate_id TEXT REFERENCES crates(id),
  barcode TEXT,
  version INTEGER DEFAULT 1,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES assets(id),
  type TEXT CHECK(type IN ('IN','OUT','CONSUME','ADJUST')),
  qty_delta REAL,
  actor_id TEXT,
  ts TEXT,
  sync_status TEXT CHECK(sync_status IN ('PENDING','SYNCED','FAILED')) DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS indents (
  id TEXT PRIMARY KEY,
  station_id TEXT REFERENCES stations(id),
  asset_id TEXT REFERENCES assets(id),
  qty_requested REAL,
  urgency TEXT CHECK(urgency IN ('LOW','MEDIUM','CRITICAL')),
  status TEXT CHECK(status IN ('DRAFT','APPROVED','DISPATCHED','RECEIVED')) DEFAULT 'DRAFT',
  created_by TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS telemetry (
  ts TEXT,
  station_id TEXT REFERENCES stations(id),
  temp_outside REAL,
  wind_speed REAL,
  pressure REAL,
  dg_load REAL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT,
  entity TEXT,
  before TEXT,
  after TEXT,
  ts TEXT
);

-- Sync plumbing (same DB, WAL guarantees atomicity)
CREATE TABLE IF NOT EXISTS outbox (
  ulid TEXT PRIMARY KEY,
  device_id TEXT,
  entity TEXT,
  entity_id TEXT,
  op TEXT CHECK(op IN ('UPSERT','DELETE')),
  patch BLOB,
  base_version INTEGER,
  retry_count INTEGER DEFAULT 0,
  created_at TEXT,
  status TEXT CHECK(status IN ('PENDING','SENT','ACKED','FAILED')) DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS sync_state (
  device_id TEXT PRIMARY KEY,
  last_acked_ulid TEXT,
  last_server_version INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dedupe (
  ulid TEXT PRIMARY KEY,
  processed_at TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_assets_crate ON assets(crate_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_asset ON transactions(asset_id);
