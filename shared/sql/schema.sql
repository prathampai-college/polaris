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
  updated_at TEXT,
  vector_clock TEXT,
  local_coord TEXT
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

CREATE TABLE IF NOT EXISTS vessels (
  imo TEXT PRIMARY KEY,
  name TEXT,
  lat REAL,
  lon REAL,
  sog REAL,
  eta TEXT,
  station_id TEXT REFERENCES stations(id),
  last_seen TEXT
);

CREATE TABLE IF NOT EXISTS indents (
  id TEXT PRIMARY KEY,
  station_id TEXT REFERENCES stations(id),
  asset_id TEXT REFERENCES assets(id),
  qty_requested REAL,
  urgency TEXT CHECK(urgency IN ('LOW','MEDIUM','CRITICAL')),
  status TEXT CHECK(status IN ('DRAFT','APPROVED','DISPATCHED','RECEIVED')) DEFAULT 'DRAFT',
  created_by TEXT,
  created_at TEXT,
  vessel_imo TEXT REFERENCES vessels(imo)
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
  op TEXT CHECK(op IN ('UPSERT','DELETE','CONSUME','IN','OUT','ADJUST')),
  patch BLOB,
  base_version INTEGER,
  retry_count INTEGER DEFAULT 0,
  created_at TEXT,
  status TEXT CHECK(status IN ('PENDING','SENT','ACKED','FAILED','BUNDLED')) DEFAULT 'PENDING',
  vector_clock TEXT,
  local_coord TEXT
);

CREATE TABLE IF NOT EXISTS sync_state (
  device_id TEXT PRIMARY KEY,
  last_acked_ulid TEXT,
  last_server_version INTEGER DEFAULT 0,
  vector_clock TEXT
);

CREATE TABLE IF NOT EXISTS dedupe (
  ulid TEXT PRIMARY KEY,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS procurement_targets (
  sku TEXT PRIMARY KEY,
  target_qty REAL NOT NULL,
  cost_per_unit REAL NOT NULL,
  unit TEXT NOT NULL,
  eta TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS physics_params (
  station_id TEXT PRIMARY KEY REFERENCES stations(id),
  T_INSIDE REAL NOT NULL,
  BASE REAL NOT NULL,
  K1 REAL NOT NULL,
  K2 REAL NOT NULL,
  K3 REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS dtn_bundles (
  bundle_id TEXT PRIMARY KEY,
  src TEXT,
  dst_station TEXT,
  payload BLOB,
  vc TEXT,
  custody INTEGER DEFAULT 1,
  created_at TEXT,
  ttl INTEGER DEFAULT 86400
);

CREATE TABLE IF NOT EXISTS asset_positions (
  asset_id TEXT PRIMARY KEY,
  x REAL,
  y REAL,
  theta REAL,
  conf REAL,
  last_sensor_ts TEXT,
  station_id TEXT REFERENCES stations(id)
);

CREATE TABLE IF NOT EXISTS snn_state (
  device_id TEXT PRIMARY KEY,
  last_features TEXT,
  spike_count INTEGER DEFAULT 0,
  last_infer_ts TEXT,
  total_saved_mw REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS personnel (
  id TEXT PRIMARY KEY,
  station_id TEXT REFERENCES stations(id),
  name TEXT,
  role TEXT,
  blood_group TEXT,
  emergency_contact TEXT,
  status TEXT CHECK(status IN ('ON_STATION','FIELD_SORTIE','IN_TRANSIT','EVACUATED')) DEFAULT 'ON_STATION'
);

CREATE TABLE IF NOT EXISTS field_sorties (
  id TEXT PRIMARY KEY,
  station_id TEXT REFERENCES stations(id),
  lead_personnel_id TEXT REFERENCES personnel(id),
  destination TEXT,
  departure_time TEXT,
  expected_return_time TEXT,
  actual_return_time TEXT,
  safety_status TEXT CHECK(safety_status IN ('PLANNED','ACTIVE','RETURNED','OVERDUE','EMERGENCY')) DEFAULT 'PLANNED'
);

CREATE TABLE IF NOT EXISTS emergencies (
  id TEXT PRIMARY KEY,
  station_id TEXT REFERENCES stations(id),
  type TEXT CHECK(type IN ('SOS_MEDICAL','SOS_FIRE','SOS_WHITEOUT','SOS_POWER','SOS_VEHICLE')),
  reported_by TEXT,
  status TEXT CHECK(status IN ('ACTIVE','ACK','RESPONDING','RESOLVED')) DEFAULT 'ACTIVE',
  ts TEXT,
  location_coord TEXT,
  assignee TEXT,
  sortie_id TEXT REFERENCES field_sorties(id)
);

-- Expedition planning (ISEA Antarctic + Himadri Arctic programs)
CREATE TABLE IF NOT EXISTS expeditions (
  id TEXT PRIMARY KEY,
  program TEXT CHECK(program IN ('ANTARCTIC','ARCTIC')) DEFAULT 'ANTARCTIC',
  name TEXT,
  season TEXT,
  status TEXT CHECK(status IN ('PLANNED','STUFFING','IN_TRANSIT','DELIVERED','WINTER_OVER','COMPLETE')) DEFAULT 'PLANNED',
  created_by TEXT,
  created_at TEXT,
  vector_clock TEXT
);

CREATE TABLE IF NOT EXISTS voyage_legs (
  id TEXT PRIMARY KEY,
  expedition_id TEXT REFERENCES expeditions(id),
  seq INTEGER DEFAULT 0,
  from_point TEXT,
  to_point TEXT,
  mode TEXT CHECK(mode IN ('SEA','AIR','TRAVERSE')) DEFAULT 'SEA',
  vessel_imo TEXT REFERENCES vessels(imo),
  eta_depart TEXT,
  eta_arrive TEXT,
  status TEXT CHECK(status IN ('PLANNED','DEPARTED','ARRIVED','DELAYED')) DEFAULT 'PLANNED'
);

CREATE TABLE IF NOT EXISTS manifests (
  id TEXT PRIMARY KEY,
  expedition_id TEXT REFERENCES expeditions(id),
  owner_org TEXT,
  project_code TEXT,
  destination_station TEXT REFERENCES stations(id),
  sku TEXT,
  description TEXT,
  qty REAL,
  unit TEXT,
  weight_kg REAL,
  hazmat_class TEXT,
  temp_zone TEXT CHECK(temp_zone IN ('AMBIENT','COLD','HAZMAT')) DEFAULT 'AMBIENT',
  customs_status TEXT CHECK(customs_status IN ('PENDING','CLEARED','EXEMPT')) DEFAULT 'PENDING',
  biosecurity_status TEXT CHECK(biosecurity_status IN ('PENDING','CLEARED','EXEMPT')) DEFAULT 'PENDING',
  labelling_code TEXT UNIQUE,
  container_id TEXT REFERENCES containers(id),
  crate_id TEXT REFERENCES crates(id),
  stage TEXT CHECK(stage IN ('GOA','MUMBAI','CAPETOWN','VESSEL','STATION','CRATE')) DEFAULT 'GOA',
  vector_clock TEXT
);

CREATE TABLE IF NOT EXISTS decision_overrides (
  id TEXT PRIMARY KEY,
  ref_type TEXT CHECK(ref_type IN ('EMERGENCY','INDENT','SORTIE')) DEFAULT 'EMERGENCY',
  ref_id TEXT,
  station_id TEXT REFERENCES stations(id),
  actor_id TEXT,
  stated_risk TEXT,
  action TEXT,
  ts TEXT
);

CREATE TABLE IF NOT EXISTS personnel_positions (
  personnel_id TEXT PRIMARY KEY REFERENCES personnel(id),
  x REAL,
  y REAL,
  theta REAL,
  conf REAL,
  last_sensor_ts TEXT,
  station_id TEXT REFERENCES stations(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_assets_crate ON assets(crate_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_asset ON transactions(asset_id);
CREATE INDEX IF NOT EXISTS idx_vessels_station ON vessels(station_id);
CREATE INDEX IF NOT EXISTS idx_dtn_bundles_dst ON dtn_bundles(dst_station, created_at);
CREATE INDEX IF NOT EXISTS idx_asset_positions_station ON asset_positions(station_id);
CREATE INDEX IF NOT EXISTS idx_personnel_station ON personnel(station_id);
CREATE INDEX IF NOT EXISTS idx_sorties_station ON field_sorties(station_id);
CREATE INDEX IF NOT EXISTS idx_emergencies_station ON emergencies(station_id, status);
CREATE INDEX IF NOT EXISTS idx_expeditions_program ON expeditions(program, status);
CREATE INDEX IF NOT EXISTS idx_legs_expedition ON voyage_legs(expedition_id, seq);
CREATE INDEX IF NOT EXISTS idx_manifests_expedition ON manifests(expedition_id, destination_station, stage);
CREATE INDEX IF NOT EXISTS idx_overrides_station ON decision_overrides(station_id, ts);
CREATE INDEX IF NOT EXISTS idx_personnel_positions_station ON personnel_positions(station_id);

