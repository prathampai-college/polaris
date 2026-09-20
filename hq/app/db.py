import os, sqlite3, pathlib, json, datetime, threading

def utc_now() -> str:
    try:
        utc = datetime.UTC  # py3.11+
    except AttributeError:
        utc = datetime.timezone.utc
    return datetime.datetime.now(utc).isoformat()

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
_local = threading.local()
_initialized = False

def _ensure_sqlite_schema(conn):
    """Ensure a SQLite connection targets a fully-initialized DB file.

    Starlette TestClient runs endpoints in worker threads, each opening its
    own thread-local connection. If the DB file was (re)created after another
    thread cached its handle, a fresh connection can land on an empty file.
    This check makes every new connection self-healing: missing schema is
    created and seed data inserted (both idempotent).
    """
    try:
        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stations'")
        if cur.fetchone() is not None:
            return
    except Exception:
        pass
    if SCHEMA_SQL:
        conn.executescript(SCHEMA_SQL)
    try:
        cur = conn.execute("SELECT COUNT(*) FROM stations")
        if cur.fetchone()[0] == 0:
            seed_sqlite(conn)
        else:
            _ensure_procurement_targets_sqlite(conn)
            _ensure_physics_params_sqlite(conn)
            _ensure_vessels_sqlite(conn)
            _ensure_dtn_sqlite(conn)
            _ensure_personnel_sqlite(conn)
            _ensure_expedition_sqlite(conn)
    except Exception:
        try:
            seed_sqlite(conn)
        except Exception:
            pass

def get_sqlite():
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(str(HQ_DB_PATH), timeout=15.0, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.execute("PRAGMA busy_timeout=15000;")
        _local.conn = conn
        # New handle (e.g. TestClient worker thread) may target an empty or
        # freshly-created file — ensure schema + seed before use.
        _ensure_sqlite_schema(conn)
    else:
        # Detect stale handle: DB file unlinked/recreated after this handle
        # was cached (e.g. a test deleted hq.db mid-run). If the file is gone
        # or the handle no longer sees the schema, reopen fresh.
        try:
            if not HQ_DB_PATH.exists():
                raise sqlite3.OperationalError("db file removed")
            conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stations'").fetchone()
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
            _local.conn = None
            return get_sqlite()
    return conn

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
    # ensure vector_clock cols (incl. sync_state for offline VC resume)
    for tbl, col in [("assets","vector_clock"), ("outbox","vector_clock"), ("outbox","local_coord"), ("assets","local_coord"), ("sync_state","vector_clock")]: 
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

DEFAULT_PERSONNEL = [
    ("PER-BHA-01", "ST-BHARATI", "Dr. Rajesh Sharma", "Station Leader & Glaciologist", "O+", "+91-9876543210", "ON_STATION"),
    ("PER-BHA-02", "ST-BHARATI", "Capt. Vikram Rao", "Logistics & Field Ops Lead", "A+", "+91-9876543211", "ON_STATION"),
    ("PER-BHA-03", "ST-BHARATI", "Dr. Ananya Sen", "Medical Officer", "B+", "+91-9876543212", "ON_STATION"),
    ("PER-BHA-04", "ST-BHARATI", "Sunil Gaikwad", "HVAC & Power Tech", "AB+", "+91-9876543213", "ON_STATION"),
    ("PER-BHA-05", "ST-BHARATI", "Priya Nambiar", "Atmospheric Physicist", "O-", "+91-9876543214", "ON_STATION"),
    ("PER-MAI-01", "ST-MAITRI", "Dr. Devendra Rathore", "Station Leader", "A+", "+91-9876543215", "ON_STATION"),
    ("PER-MAI-02", "ST-MAITRI", "Dr. Neha Verma", "Medical Officer & Medic", "O+", "+91-9876543216", "ON_STATION"),
    ("PER-MAI-03", "ST-MAITRI", "Harpreet Singh", "Heavy Vehicle Tech", "B+", "+91-9876543217", "ON_STATION"),
    ("PER-HIM-01", "ST-HIMADRI", "Dr. Arvind Joshi", "Arctic Mission Leader", "A-", "+91-9876543218", "ON_STATION"),
    ("PER-HIM-02", "ST-HIMADRI", "Meera Pillai", "Marine Biologist", "O+", "+91-9876543219", "ON_STATION")
]

DEFAULT_EXPEDITIONS = [
    ("EXP-ANT-46", "ANTARCTIC", "46th Indian Scientific Expedition to Antarctica", "46-ISEA-2026", "STUFFING", "NCPOR-AO", None),
    ("EXP-ARC-26", "ARCTIC", "Himadri Arctic Summer Program", "HIM-2026", "PLANNED", "NCPOR-AO", None),
]

DEFAULT_LEGS = [
    ("LEG-ANT-01", "EXP-ANT-46", 1, "GOA", "MUMBAI", "SEA", None, None, None, "PLANNED"),
    ("LEG-ANT-02", "EXP-ANT-46", 2, "MUMBAI", "CAPETOWN", "SEA", None, None, None, "PLANNED"),
    ("LEG-ANT-03", "EXP-ANT-46", 3, "CAPETOWN", "MAITRI", "SEA", None, None, None, "PLANNED"),
    ("LEG-ANT-04", "EXP-ANT-46", 4, "MAITRI", "BHARATI", "TRAVERSE", None, None, None, "PLANNED"),
    ("LEG-ARC-01", "EXP-ARC-26", 1, "GOA", "HIMADRI", "AIR", None, None, None, "PLANNED"),
]

def _ensure_expedition_sqlite(conn):
    try:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS expeditions (
            id TEXT PRIMARY KEY, program TEXT CHECK(program IN ('ANTARCTIC','ARCTIC')) DEFAULT 'ANTARCTIC',
            name TEXT, season TEXT,
            status TEXT CHECK(status IN ('PLANNED','STUFFING','IN_TRANSIT','DELIVERED','WINTER_OVER','COMPLETE')) DEFAULT 'PLANNED',
            created_by TEXT, created_at TEXT, vector_clock TEXT);
        CREATE TABLE IF NOT EXISTS voyage_legs (
            id TEXT PRIMARY KEY, expedition_id TEXT REFERENCES expeditions(id), seq INTEGER DEFAULT 0,
            from_point TEXT, to_point TEXT, mode TEXT CHECK(mode IN ('SEA','AIR','TRAVERSE')) DEFAULT 'SEA',
            vessel_imo TEXT, eta_depart TEXT, eta_arrive TEXT,
            status TEXT CHECK(status IN ('PLANNED','DEPARTED','ARRIVED','DELAYED')) DEFAULT 'PLANNED');
        CREATE TABLE IF NOT EXISTS manifests (
            id TEXT PRIMARY KEY, expedition_id TEXT REFERENCES expeditions(id),
            owner_org TEXT, project_code TEXT, destination_station TEXT,
            sku TEXT, description TEXT, qty REAL, unit TEXT, weight_kg REAL, hazmat_class TEXT,
            temp_zone TEXT CHECK(temp_zone IN ('AMBIENT','COLD','HAZMAT')) DEFAULT 'AMBIENT',
            customs_status TEXT CHECK(customs_status IN ('PENDING','CLEARED','EXEMPT')) DEFAULT 'PENDING',
            biosecurity_status TEXT CHECK(biosecurity_status IN ('PENDING','CLEARED','EXEMPT')) DEFAULT 'PENDING',
            labelling_code TEXT UNIQUE, container_id TEXT, crate_id TEXT,
            stage TEXT CHECK(stage IN ('GOA','MUMBAI','CAPETOWN','VESSEL','STATION','CRATE')) DEFAULT 'GOA',
            vector_clock TEXT);
        CREATE TABLE IF NOT EXISTS decision_overrides (
            id TEXT PRIMARY KEY, ref_type TEXT, ref_id TEXT, station_id TEXT,
            actor_id TEXT, stated_risk TEXT, action TEXT, ts TEXT);
        CREATE TABLE IF NOT EXISTS personnel_positions (
            personnel_id TEXT PRIMARY KEY, x REAL, y REAL, theta REAL, conf REAL,
            last_sensor_ts TEXT, station_id TEXT);
        CREATE INDEX IF NOT EXISTS idx_expeditions_program ON expeditions(program, status);
        CREATE INDEX IF NOT EXISTS idx_legs_expedition ON voyage_legs(expedition_id, seq);
        CREATE INDEX IF NOT EXISTS idx_manifests_expedition ON manifests(expedition_id, destination_station, stage);
        CREATE INDEX IF NOT EXISTS idx_overrides_station ON decision_overrides(station_id, ts);
        CREATE INDEX IF NOT EXISTS idx_personnel_positions_station ON personnel_positions(station_id);
        """)
        conn.commit()
    except Exception:
        pass
    # triage migration: rebuild emergencies if old CHECK without ACK
    try:
        row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='emergencies'").fetchone()
        sql = (row[0] if row else "") or ""
        if "ACK" not in sql:
            conn.executescript("""
            ALTER TABLE emergencies RENAME TO emergencies_old;
            CREATE TABLE emergencies (
                id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id),
                type TEXT CHECK(type IN ('SOS_MEDICAL','SOS_FIRE','SOS_WHITEOUT','SOS_POWER','SOS_VEHICLE')),
                reported_by TEXT,
                status TEXT CHECK(status IN ('ACTIVE','ACK','RESPONDING','RESOLVED')) DEFAULT 'ACTIVE',
                ts TEXT, location_coord TEXT, assignee TEXT, sortie_id TEXT REFERENCES field_sorties(id));
            INSERT OR IGNORE INTO emergencies (id, station_id, type, reported_by, status, ts, location_coord)
                SELECT id, station_id, type, reported_by, status, ts, location_coord FROM emergencies_old;
            DROP TABLE emergencies_old;
            CREATE INDEX IF NOT EXISTS idx_emergencies_station ON emergencies(station_id, status);
            """)
            conn.commit()
    except Exception:
        pass
    # assignee/sortie_id columns on pre-migration DBs
    for col in ["assignee", "sortie_id"]:
        try:
            cols = [r[1] for r in conn.execute("PRAGMA table_info(emergencies)").fetchall()]
            if col not in cols:
                conn.execute(f"ALTER TABLE emergencies ADD COLUMN {col} TEXT")
                conn.commit()
        except Exception:
            pass
    for col, ddl in [
        ("expedition_id", "ALTER TABLE field_sorties ADD COLUMN expedition_id TEXT"),
        ("buddy_personnel_id", "ALTER TABLE field_sorties ADD COLUMN buddy_personnel_id TEXT"),
        ("program", "ALTER TABLE personnel ADD COLUMN program TEXT DEFAULT 'BOTH'"),
    ]:
        try:
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({col == 'program' and 'personnel' or 'field_sorties'})").fetchall()]
            if col not in cols:
                conn.execute(ddl)
                conn.commit()
        except Exception:
            pass
    # triage_sla + freight_rates + lots
    try:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS triage_sla (from_status TEXT, to_status TEXT, due_minutes INTEGER NOT NULL, PRIMARY KEY (from_status, to_status));
        CREATE TABLE IF NOT EXISTS freight_rates (mode TEXT PRIMARY KEY, cost_per_kg REAL NOT NULL, base_cost REAL NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS lots (id TEXT PRIMARY KEY, asset_sku TEXT NOT NULL, lot_code TEXT UNIQUE NOT NULL, qty REAL NOT NULL, expiry_date TEXT, crate_id TEXT, received_ts TEXT, vector_clock TEXT);
        CREATE INDEX IF NOT EXISTS idx_lots_sku ON lots(asset_sku, expiry_date);
        CREATE INDEX IF NOT EXISTS idx_sorties_buddy ON field_sorties(buddy_personnel_id);
        """)
        conn.commit()
    except Exception:
        pass
    try:
        cur = conn.execute("SELECT COUNT(*) FROM triage_sla")
        if cur.fetchone()[0] == 0:
            for r in [("ACTIVE","ACK",15),("ACK","RESPONDING",30),("RESPONDING","RESOLVED",240)]:
                conn.execute("INSERT OR IGNORE INTO triage_sla VALUES (?,?,?)", r)
            conn.commit()
    except Exception:
        pass
    try:
        cur = conn.execute("SELECT COUNT(*) FROM freight_rates")
        if cur.fetchone()[0] == 0:
            for r in [("SEA", 2.5, 5000), ("AIR", 18.0, 12000), ("TRAVERSE", 1.2, 2000)]:
                conn.execute("INSERT OR IGNORE INTO freight_rates VALUES (?,?,?)", r)
            conn.commit()
    except Exception:
        pass
    try:
        cur = conn.execute("SELECT COUNT(*) FROM lots")
        if cur.fetchone()[0] == 0:
            for a in conn.execute("SELECT sku, qty, expiry_date, crate_id FROM assets").fetchall():
                sku, qty, exp, crate = a[0], a[1], a[2], a[3]
                conn.execute("INSERT OR IGNORE INTO lots VALUES (?,?,?,?,?,?,?,?)", (f"LOT-{sku}-0", sku, f"{sku}-L0", qty, exp, crate, conn.execute("SELECT datetime('now')").fetchone()[0], None))
            conn.commit()
    except Exception:
        pass
    # seed expeditions + legs idempotently
    try:
        cur = conn.execute("SELECT COUNT(*) FROM expeditions")
        if cur.fetchone()[0] == 0:
            for r in DEFAULT_EXPEDITIONS:
                conn.execute("INSERT OR IGNORE INTO expeditions VALUES (?,?,?,?,?,?,?,?)", (*r, None))
            for r in DEFAULT_LEGS:
                conn.execute("INSERT OR IGNORE INTO voyage_legs VALUES (?,?,?,?,?,?,?,?,?,?)", r)
            conn.commit()
    except Exception:
        pass

def _ensure_personnel_sqlite(conn):
    try:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS personnel (
            id TEXT PRIMARY KEY,
            station_id TEXT REFERENCES stations(id),
            name TEXT,
            role TEXT,
            blood_group TEXT,
            emergency_contact TEXT,
            status TEXT CHECK(status IN ('ON_STATION','FIELD_SORTIE','IN_TRANSIT','EVACUATED')) DEFAULT 'ON_STATION',
            program TEXT DEFAULT 'BOTH'
        );
        CREATE TABLE IF NOT EXISTS field_sorties (
            id TEXT PRIMARY KEY,
            station_id TEXT REFERENCES stations(id),
            lead_personnel_id TEXT REFERENCES personnel(id),
            destination TEXT,
            departure_time TEXT,
            expected_return_time TEXT,
            actual_return_time TEXT,
            safety_status TEXT CHECK(safety_status IN ('PLANNED','ACTIVE','RETURNED','OVERDUE','EMERGENCY')) DEFAULT 'PLANNED',
            expedition_id TEXT,
            buddy_personnel_id TEXT REFERENCES personnel(id)
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
            sortie_id TEXT,
            status_entered_ts TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_personnel_station ON personnel(station_id);
        CREATE INDEX IF NOT EXISTS idx_sorties_station ON field_sorties(station_id);
        CREATE INDEX IF NOT EXISTS idx_emergencies_station ON emergencies(station_id, status);
        """)
        conn.commit()
    except Exception:
        pass
    try:
        cur = conn.execute("SELECT COUNT(*) FROM personnel")
        if cur.fetchone()[0] == 0:
            for p in DEFAULT_PERSONNEL:
                conn.execute("INSERT OR IGNORE INTO personnel VALUES (?,?,?,?,?,?,?)", p)
            conn.commit()
    except Exception:
        pass

def init_db():
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
                        "CREATE TABLE IF NOT EXISTS personnel (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), name TEXT, role TEXT, blood_group TEXT, emergency_contact TEXT, status TEXT DEFAULT 'ON_STATION')",
                        "CREATE TABLE IF NOT EXISTS field_sorties (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), lead_personnel_id TEXT, destination TEXT, departure_time TEXT, expected_return_time TEXT, actual_return_time TEXT, safety_status TEXT DEFAULT 'PLANNED', expedition_id TEXT)",
                        "CREATE TABLE IF NOT EXISTS emergencies (id TEXT PRIMARY KEY, station_id TEXT REFERENCES stations(id), type TEXT, reported_by TEXT, status TEXT DEFAULT 'ACTIVE', ts TEXT, location_coord TEXT, assignee TEXT, sortie_id TEXT)",
                        "CREATE TABLE IF NOT EXISTS expeditions (id TEXT PRIMARY KEY, program TEXT DEFAULT 'ANTARCTIC', name TEXT, season TEXT, status TEXT DEFAULT 'PLANNED', created_by TEXT, created_at TEXT, vector_clock TEXT)",
                        "CREATE TABLE IF NOT EXISTS voyage_legs (id TEXT PRIMARY KEY, expedition_id TEXT REFERENCES expeditions(id), seq INTEGER DEFAULT 0, from_point TEXT, to_point TEXT, mode TEXT DEFAULT 'SEA', vessel_imo TEXT, eta_depart TEXT, eta_arrive TEXT, status TEXT DEFAULT 'PLANNED')",
                        "CREATE TABLE IF NOT EXISTS manifests (id TEXT PRIMARY KEY, expedition_id TEXT REFERENCES expeditions(id), owner_org TEXT, project_code TEXT, destination_station TEXT, sku TEXT, description TEXT, qty DOUBLE PRECISION, unit TEXT, weight_kg DOUBLE PRECISION, hazmat_class TEXT, temp_zone TEXT DEFAULT 'AMBIENT', customs_status TEXT DEFAULT 'PENDING', biosecurity_status TEXT DEFAULT 'PENDING', labelling_code TEXT UNIQUE, container_id TEXT, crate_id TEXT, stage TEXT DEFAULT 'GOA', vector_clock TEXT)",
                        "CREATE TABLE IF NOT EXISTS decision_overrides (id TEXT PRIMARY KEY, ref_type TEXT, ref_id TEXT, station_id TEXT, actor_id TEXT, stated_risk TEXT, action TEXT, ts TEXT)",
                        "CREATE TABLE IF NOT EXISTS personnel_positions (personnel_id TEXT PRIMARY KEY, x DOUBLE PRECISION, y DOUBLE PRECISION, theta DOUBLE PRECISION, conf DOUBLE PRECISION, last_sensor_ts TEXT, station_id TEXT)",
                    ]:
                        try: cur.execute(ddl)
                        except Exception: pass
                    for alter in [
                        "ALTER TABLE assets ADD COLUMN IF NOT EXISTS vector_clock TEXT",
                        "ALTER TABLE assets ADD COLUMN IF NOT EXISTS local_coord TEXT",
                        "ALTER TABLE outbox ADD COLUMN IF NOT EXISTS vector_clock TEXT",
                        "ALTER TABLE outbox ADD COLUMN IF NOT EXISTS local_coord TEXT",
                        "ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS vector_clock TEXT",
                        "ALTER TABLE emergencies ADD COLUMN IF NOT EXISTS assignee TEXT",
                        "ALTER TABLE emergencies ADD COLUMN IF NOT EXISTS sortie_id TEXT",
                        "ALTER TABLE field_sorties ADD COLUMN IF NOT EXISTS expedition_id TEXT",
                    ]:
                        try: cur.execute(alter)
                        except Exception: pass
                    # seed expeditions on PG when empty
                    try:
                        cur.execute("SELECT COUNT(*) FROM expeditions")
                        if cur.fetchone()[0] == 0:
                            for r in DEFAULT_EXPEDITIONS:
                                try: cur.execute("INSERT INTO expeditions VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", (*r, None))
                                except Exception: pass
                            for r in DEFAULT_LEGS:
                                try: cur.execute("INSERT INTO voyage_legs VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", r)
                                except Exception: pass
                    except Exception:
                        pass
        print(f"[hq] Postgres init ok {DATABASE_URL.split('@')[-1]}")
    else:
        # Drop any cached handle first: it may point at an unlinked inode if
        # the DB file was removed between runs. get_sqlite() then reopens the
        # current file and self-heals schema + seed.
        try:
            old = getattr(_local, "conn", None)
            if old is not None:
                try:
                    old.close()
                except Exception:
                    pass
                _local.conn = None
        except Exception:
            pass
        conn = get_sqlite()
        if SCHEMA_SQL:
            conn.executescript(SCHEMA_SQL)
        cur = conn.execute("SELECT COUNT(*) FROM stations")
        if cur.fetchone()[0] == 0:
            seed_sqlite(conn)
        else:
            _ensure_procurement_targets_sqlite(conn)
            _ensure_physics_params_sqlite(conn)
            _ensure_vessels_sqlite(conn)
            _ensure_dtn_sqlite(conn)
        _ensure_personnel_sqlite(conn)
        _ensure_expedition_sqlite(conn)
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
        _ensure_personnel_sqlite(conn)
        _ensure_expedition_sqlite(conn)
        conn.commit()
        return
    # ensure procurement even without seed
    for row in PROCUREMENT_SEED:
        conn.execute("INSERT OR IGNORE INTO procurement_targets VALUES (?,?,?,?,?)", row)
    for sid in ["ST-BHARATI", "ST-MAITRI", "ST-HIMADRI"]:
        conn.execute("INSERT OR IGNORE INTO physics_params VALUES (?,?,?,?,?,?)", (sid, _PHYSICS["T_INSIDE"], _PHYSICS["BASE"], _PHYSICS["K1"], _PHYSICS["K2"], _PHYSICS["K3"]))
    conn.commit()

_pool = None  # type: ignore
_pool_failed = False

def _get_pool():
    global _pool, _pool_failed
    if _pool is not None or _pool_failed:
        return _pool
    if not USE_PG:
        return None
    try:
        from psycopg_pool import ConnectionPool  # type: ignore
        _pool = ConnectionPool(conninfo=DATABASE_URL, min_size=4, max_size=20, timeout=10, open=True)
        logger.info(f"[hq] PG pool 4/20 open {DATABASE_URL.split('@')[-1]}")
    except Exception as e:
        logger.warning(f"[hq] psycopg_pool unavailable ({e}), falling back to per-request connect")
        _pool_failed = True
        _pool = None
    return _pool

def get_conn():
    global _initialized
    if USE_PG:
        pool = _get_pool()
        if pool is not None:
            return pool.getconn()
        import psycopg
        return psycopg.connect(DATABASE_URL)
    else:
        if not _initialized:
            init_db()
            _initialized = True
        return get_sqlite()

def release_conn(conn):
    """Return PG pooled conn or close direct conn. No-op for SQLite."""
    if USE_PG:
        pool = _get_pool()
        if pool is not None:
            try:
                pool.putconn(conn)
                return
            except Exception:
                pass
        try:
            conn.close()
        except Exception:
            pass
