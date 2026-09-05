import os, sqlite3, pathlib, json

DATABASE_URL = os.getenv("DATABASE_URL", "")
USE_PG = DATABASE_URL.startswith("postgresql")

def _find_file(*subpaths):
    for sub in subpaths:
        for p in [
            pathlib.Path(__file__).parent / ".." / ".." / sub,
            pathlib.Path(__file__).parent / ".." / sub,
            pathlib.Path("/app") / sub,
            pathlib.Path(__file__).parent / pathlib.Path(sub).name,
            pathlib.Path(sub),
        ]:
            if p.exists():
                return p
    return None

_schema_file = _find_file("shared/sql/schema.sql", "sql/schema.sql", "schema.sql")
SCHEMA_SQL = _schema_file.read_text(encoding="utf-8") if _schema_file and _schema_file.exists() else ""

HQ_DB_PATH = pathlib.Path(__file__).parent / "hq.db"

def _load_seed():
    p = _find_file("shared/seed.json", "seed.json")
    if p and p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return None

_SEED = _load_seed()

def get_sqlite():
    conn = sqlite3.connect(str(HQ_DB_PATH), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn

_sqlite_conn = None

_PROCUREMENT_FALLBACK = [
    ("FUEL-DIESEL-001", 5000, 1200, "L", "30d before freeze"),
    ("O2-CYL-47L-003", 30, 200, "cyl", "30d before freeze"),
    ("SPARE-BRG-6205-007", 10, 80, "pcs", "30d before freeze"),
]
# Single source: shared/seed.json procurement_targets (fallback to hardcoded if missing)
PROCUREMENT_SEED = [tuple(r) for r in (_SEED.get("procurement_targets") if _SEED else None) or _PROCUREMENT_FALLBACK]

def _load_physics():
    p = _find_file("shared/src/physics.json", "shared/physics.json", "physics.json")
    if p and p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"T_INSIDE": 18, "BASE": 110, "K1": 0.012, "K2": 0.018, "K3": 0.08}

_PHYSICS = _load_physics()

def _pg_schema_sql():
    # strip PRAGMA lines which are SQLite-only and convert SQLite types to PG
    sql = "\n".join(l for l in SCHEMA_SQL.splitlines() if not l.strip().upper().startswith("PRAGMA"))
    # SQLite BLOB -> PG BYTEA
    sql = sql.replace(" BLOB", " BYTEA").replace("\tBLOB", "\tBYTEA")
    return sql

def _ensure_table_seeded(conn, table: str, create_sql: str, seed_fn):
    """Generic ensure: if table missing create it, if empty seed it."""
    try:
        cur = conn.execute(f"SELECT COUNT(*) FROM {table}")
        if cur.fetchone()[0] == 0:
            seed_fn(conn)
            conn.commit()
    except Exception as e:
        if "no such table" in str(e).lower():
            try:
                conn.executescript(create_sql)
                seed_fn(conn)
                conn.commit()
            except Exception:
                pass

def _ensure_procurement_targets_sqlite(conn):
    def _seed(c):
        for row in PROCUREMENT_SEED:
            c.execute("INSERT OR IGNORE INTO procurement_targets VALUES (?,?,?,?,?)", row)
    _ensure_table_seeded(conn, "procurement_targets",
        "CREATE TABLE IF NOT EXISTS procurement_targets (sku TEXT PRIMARY KEY, target_qty REAL NOT NULL, cost_per_unit REAL NOT NULL, unit TEXT NOT NULL, eta TEXT NOT NULL);", _seed)

def _ensure_physics_params_sqlite(conn):
    def _seed(c):
        for sid in ["ST-BHARATI", "ST-MAITRI", "ST-HIMADRI"]:
            c.execute("INSERT OR IGNORE INTO physics_params (station_id, T_INSIDE, BASE, K1, K2, K3) VALUES (?,?,?,?,?,?)",
                      (sid, _PHYSICS["T_INSIDE"], _PHYSICS["BASE"], _PHYSICS["K1"], _PHYSICS["K2"], _PHYSICS["K3"]))
    _ensure_table_seeded(conn, "physics_params",
        "CREATE TABLE IF NOT EXISTS physics_params (station_id TEXT PRIMARY KEY REFERENCES stations(id), T_INSIDE REAL NOT NULL, BASE REAL NOT NULL, K1 REAL NOT NULL, K2 REAL NOT NULL, K3 REAL NOT NULL);", _seed)

def seed_physics_params(cur):
    for sid in ["ST-BHARATI", "ST-MAITRI", "ST-HIMADRI"]:
        try:
            cur.execute("INSERT INTO physics_params (station_id, T_INSIDE, BASE, K1, K2, K3) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                        (sid, _PHYSICS["T_INSIDE"], _PHYSICS["BASE"], _PHYSICS["K1"], _PHYSICS["K2"], _PHYSICS["K3"]))
        except Exception:
            cur.execute("INSERT OR IGNORE INTO physics_params VALUES (?,?,?,?,?,?)",
                        (sid, _PHYSICS["T_INSIDE"], _PHYSICS["BASE"], _PHYSICS["K1"], _PHYSICS["K2"], _PHYSICS["K3"]))

def _ensure_vessels_sqlite(conn):
    try:
        conn.execute("SELECT COUNT(*) FROM vessels").fetchone()
    except Exception as e:
        if "no such table" in str(e).lower():
            try:
                conn.executescript("CREATE TABLE IF NOT EXISTS vessels (imo TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, sog REAL, eta TEXT, station_id TEXT REFERENCES stations(id), last_seen TEXT); CREATE INDEX IF NOT EXISTS idx_vessels_station ON vessels(station_id);")
                conn.commit()
            except Exception:
                pass
    # ensure indents.vessel_imo column
    try:
        cur = conn.execute("PRAGMA table_info(indents)")
        cols = [r[1] for r in cur.fetchall()]
        if "vessel_imo" not in cols:
            conn.execute("ALTER TABLE indents ADD COLUMN vessel_imo TEXT REFERENCES vessels(imo)")
            conn.commit()
    except Exception:
        pass
    try:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vessels_station ON vessels(station_id)")
        conn.commit()
    except Exception:
        pass

def _ensure_dtn_sqlite(conn):
    try:
        conn.execute("SELECT COUNT(*) FROM dtn_bundles").fetchone()
    except Exception as e:
        if "no such table" in str(e).lower():
            try:
                conn.executescript("CREATE TABLE IF NOT EXISTS dtn_bundles (bundle_id TEXT PRIMARY KEY, src TEXT, dst_station TEXT, payload BLOB, vc TEXT, custody INTEGER DEFAULT 1, created_at TEXT, ttl INTEGER DEFAULT 86400); CREATE INDEX IF NOT EXISTS idx_dtn_bundles_dst ON dtn_bundles(dst_station, created_at); CREATE TABLE IF NOT EXISTS asset_positions (asset_id TEXT PRIMARY KEY, x REAL, y REAL, theta REAL, conf REAL, last_sensor_ts TEXT, station_id TEXT REFERENCES stations(id)); CREATE INDEX IF NOT EXISTS idx_asset_positions_station ON asset_positions(station_id); CREATE TABLE IF NOT EXISTS snn_state (device_id TEXT PRIMARY KEY, last_features TEXT, spike_count INTEGER DEFAULT 0, last_infer_ts TEXT, total_saved_mw REAL DEFAULT 0);")
                conn.commit()
            except Exception:
                pass
    # ensure vector_clock cols
    for tbl, col in [("assets","vector_clock"), ("outbox","vector_clock"), ("outbox","local_coord"), ("assets","local_coord")]:
        try:
            cur = conn.execute(f"PRAGMA table_info({tbl})")
            cols = [r[1] for r in cur.fetchall()]
            if col not in cols:
                conn.execute(f"ALTER TABLE {tbl} ADD COLUMN {col} TEXT")
                conn.commit()
        except Exception:
            pass
    # allow BUNDLED in outbox status
    try:
        # sqlite check constraint needs table rebuild; skip strict check — BUNDLED used via app logic
        pass
    except Exception:
        pass

def init_db():
    global _sqlite_conn
    if USE_PG:
        import psycopg
        with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
            with conn.cursor() as cur:
                try: cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb;")
                except Exception: pass
                # psycopg may not allow multi-statement execute; split and run one by one
                for stmt in [s.strip() for s in _pg_schema_sql().split(";") if s.strip()]:
                    try:
                        cur.execute(stmt)
                    except Exception as e:
                        # ignore "already exists" but raise others
                        if "already exists" not in str(e).lower():
                            raise
                cur.execute("SELECT COUNT(*) FROM stations")
                if cur.fetchone()[0] == 0:
                    seed(cur)
                else:
                    # ensure procurement_targets seeded even on existing DB (Phase 1 migration)
                    try:
                        cur.execute("SELECT COUNT(*) FROM procurement_targets")
                        if cur.fetchone()[0] == 0:
                            seed_procurement_targets(cur)
                    except Exception:
                        pass
                    try:
                        cur.execute("SELECT COUNT(*) FROM physics_params")
                        if cur.fetchone()[0] == 0:
                            seed_physics_params(cur)
                    except Exception:
                        pass
                    # Phase 4: vessels + indents.vessel_imo
                    try:
                        cur.execute("SELECT COUNT(*) FROM vessels")
                    except Exception as e:
                        if "does not exist" in str(e).lower() or "no such table" in str(e).lower():
                            cur.execute("CREATE TABLE IF NOT EXISTS vessels (imo TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, sog REAL, eta TEXT, station_id TEXT REFERENCES stations(id), last_seen TEXT)")
                            cur.execute("CREATE INDEX IF NOT EXISTS idx_vessels_station ON vessels(station_id)")
                    try:
                        cur.execute("SELECT vessel_imo FROM indents LIMIT 0")
                    except Exception as e:
                        if "does not exist" in str(e).lower() or "no such column" in str(e).lower() or "column" in str(e).lower():
                            try: cur.execute("ALTER TABLE indents ADD COLUMN vessel_imo TEXT REFERENCES vessels(imo)")
                            except Exception: pass
                    # DTN tables + VC cols
                    for ddl in [
                        "CREATE TABLE IF NOT EXISTS dtn_bundles (bundle_id TEXT PRIMARY KEY, src TEXT, dst_station TEXT, payload BYTEA, vc TEXT, custody INTEGER DEFAULT 1, created_at TEXT, ttl INTEGER DEFAULT 86400)",
                        "CREATE TABLE IF NOT EXISTS asset_positions (asset_id TEXT PRIMARY KEY, x DOUBLE PRECISION, y DOUBLE PRECISION, theta DOUBLE PRECISION, conf DOUBLE PRECISION, last_sensor_ts TEXT, station_id TEXT REFERENCES stations(id))",
                        "CREATE TABLE IF NOT EXISTS snn_state (device_id TEXT PRIMARY KEY, last_features TEXT, spike_count INTEGER DEFAULT 0, last_infer_ts TEXT, total_saved_mw DOUBLE PRECISION DEFAULT 0)",
                    ]:
                        try: cur.execute(ddl)
                        except Exception: pass
                    for alter in [
                        "ALTER TABLE assets ADD COLUMN IF NOT EXISTS vector_clock TEXT",
                        "ALTER TABLE assets ADD COLUMN IF NOT EXISTS local_coord TEXT",
                        "ALTER TABLE outbox ADD COLUMN IF NOT EXISTS vector_clock TEXT",
                        "ALTER TABLE outbox ADD COLUMN IF NOT EXISTS local_coord TEXT",
                    ]:
                        try: cur.execute(alter)
                        except Exception: pass
        print(f"[hq] Postgres init ok {DATABASE_URL.split('@')[-1]}")
    else:
        _sqlite_conn = get_sqlite()
        _sqlite_conn.executescript(SCHEMA_SQL)
        cur = _sqlite_conn.execute("SELECT COUNT(*) FROM stations")
        if cur.fetchone()[0] == 0:
            seed_sqlite(_sqlite_conn)
        else:
            _ensure_procurement_targets_sqlite(_sqlite_conn)
            _ensure_physics_params_sqlite(_sqlite_conn)
            _ensure_vessels_sqlite(_sqlite_conn)
            _ensure_dtn_sqlite(_sqlite_conn)
        print(f"[hq] SQLite init ok {HQ_DB_PATH} (fallback, no Docker)")

def seed_procurement_targets(cur):
    for row in PROCUREMENT_SEED:
        try:
            cur.execute("INSERT INTO procurement_targets VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", row)
        except Exception:
            cur.execute("INSERT OR IGNORE INTO procurement_targets VALUES (?,?,?,?,?)", row)

def seed(cur):
    s = _SEED
    if s:
        for r in s["stations"]: cur.execute("INSERT INTO stations VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING", r)
        for r in s["containers"]: cur.execute("INSERT INTO containers VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING", r)
        for r in s["crates"]: cur.execute("INSERT INTO crates VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING", r)
        for a in s["assets"]: cur.execute("INSERT INTO assets (id,sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode,version,updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,now()) ON CONFLICT (id) DO NOTHING", a)
        seed_procurement_targets(cur)
        seed_physics_params(cur)
        return
    # fallback (should not happen)
    for r in [("ST-BHARATI","Bharati","69°24′S 76°11′E",24)]: cur.execute("INSERT INTO stations VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING", r)
    seed_procurement_targets(cur)

def seed_sqlite(conn):
    s = _SEED
    if s:
        for r in s["stations"]: conn.execute("INSERT OR IGNORE INTO stations VALUES (?,?,?,?)", r)
        for r in s["containers"]: conn.execute("INSERT OR IGNORE INTO containers VALUES (?,?,?,?)", r)
        for r in s["crates"]: conn.execute("INSERT OR IGNORE INTO crates VALUES (?,?,?,?)", r)
        import datetime
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        for a in s["assets"]: conn.execute("INSERT OR IGNORE INTO assets (id,sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (*a, 1, now))
        for row in PROCUREMENT_SEED:
            conn.execute("INSERT OR IGNORE INTO procurement_targets VALUES (?,?,?,?,?)", row)
        for sid in ["ST-BHARATI", "ST-MAITRI", "ST-HIMADRI"]:
            conn.execute("INSERT OR IGNORE INTO physics_params VALUES (?,?,?,?,?,?)", (sid, _PHYSICS["T_INSIDE"], _PHYSICS["BASE"], _PHYSICS["K1"], _PHYSICS["K2"], _PHYSICS["K3"]))
        conn.commit()
        return
    # ensure procurement even without seed
    for row in PROCUREMENT_SEED:
        conn.execute("INSERT OR IGNORE INTO procurement_targets VALUES (?,?,?,?,?)", row)
    for sid in ["ST-BHARATI", "ST-MAITRI", "ST-HIMADRI"]:
        conn.execute("INSERT OR IGNORE INTO physics_params VALUES (?,?,?,?,?,?)", (sid, _PHYSICS["T_INSIDE"], _PHYSICS["BASE"], _PHYSICS["K1"], _PHYSICS["K2"], _PHYSICS["K3"]))
    conn.commit()

def get_conn():
    if USE_PG:
        import psycopg
        return psycopg.connect(DATABASE_URL)
    else:
        if _sqlite_conn is None:
            init_db()
        return _sqlite_conn
