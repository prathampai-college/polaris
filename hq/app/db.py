import os, sqlite3, pathlib, json, datetime, threading, logging, hashlib

logger = logging.getLogger("polaris.hq.db")

def utc_now() -> str:
    try:
        utc = datetime.UTC  # py3.11+
    except AttributeError:
        utc = datetime.timezone.utc
    return datetime.datetime.now(utc).isoformat()

DATABASE_URL = os.getenv("DATABASE_URL", "")
USE_PG = DATABASE_URL.startswith("postgresql")

def q(sql: str) -> str:
    """The one PG/SQLite placeholder helper: write `?`, get `%s` on Postgres."""
    return sql.replace("?", "%s") if USE_PG else sql

def audit_hash(prev_hash: str, id: str, actor_id, action, entity, before, after, ts) -> str:
    payload = "|".join("" if x is None else str(x) for x in (prev_hash, id, actor_id, action, entity, before, after, ts))
    return hashlib.sha256(payload.encode()).hexdigest()

def write_audit(cur, id, actor_id, action, entity, before, after, ts):
    """The one place that inserts into audit_log — chains each row's hash to the
    previous row's, so /audit/verify can detect a row that was edited or deleted
    out from under the log. Ordered by ts: good enough to catch tampering in a
    single-writer demo, not a substitute for a real append-only ledger under
    heavy concurrent writes (ties on ts within the same millisecond aren't
    ordered deterministically)."""
    prev = cur.execute(q("SELECT hash FROM audit_log ORDER BY ts DESC LIMIT 1")).fetchone()
    prev_hash = (prev[0] if prev else None) or "GENESIS"
    h = audit_hash(prev_hash, id, actor_id, action, entity, before, after, ts)
    cur.execute(q("INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts, hash) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING"), (id, actor_id, action, entity, before, after, ts, h))

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

def _load_physics():
    p = _find_file("shared/src/physics.json", "shared/physics.json", "physics.json")
    if p and p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"T_INSIDE": 18, "BASE": 110, "K1": 0.012, "K2": 0.018, "K3": 0.08}

_PHYSICS = _load_physics()

_PROCUREMENT_FALLBACK = [
    ("FUEL-DIESEL-001", 5000, 1200, "L", "30d before freeze"),
    ("O2-CYL-47L-003", 30, 200, "cyl", "30d before freeze"),
    ("SPARE-BRG-6205-007", 10, 80, "pcs", "30d before freeze"),
]
# Single source: shared/seed.json procurement_targets (fallback to hardcoded if missing)
PROCUREMENT_SEED = [tuple(r) for r in (_SEED.get("procurement_targets") if _SEED else None) or _PROCUREMENT_FALLBACK]

STATIONS = ["ST-BHARATI", "ST-MAITRI", "ST-HIMADRI"]

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
    ("PER-HIM-02", "ST-HIMADRI", "Meera Pillai", "Marine Biologist", "O+", "+91-9876543219", "ON_STATION"),
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

DEFAULT_TRIAGE_SLA = [("ACTIVE", "ACK", 15), ("ACK", "RESPONDING", 30), ("RESPONDING", "RESOLVED", 240)]
DEFAULT_FREIGHT_RATES = [("SEA", 2.5, 5000), ("AIR", 18.0, 12000), ("TRAVERSE", 1.2, 2000)]

# Columns added to a table after its CREATE TABLE first shipped. shared/sql/schema.sql
# already declares them for a brand-new database; these ALTERs backfill one created
# from an older revision of that file (dev machines, an existing PG deployment).
_MIGRATIONS = [
    ("assets", "vector_clock", "TEXT"),
    ("assets", "local_coord", "TEXT"),
    ("outbox", "vector_clock", "TEXT"),
    ("outbox", "local_coord", "TEXT"),
    ("sync_state", "vector_clock", "TEXT"),
    ("emergencies", "assignee", "TEXT"),
    ("emergencies", "sortie_id", "TEXT"),
    ("emergencies", "status_entered_ts", "TEXT"),
    ("field_sorties", "expedition_id", "TEXT"),
    ("field_sorties", "buddy_personnel_id", "TEXT"),
    ("personnel", "program", "TEXT DEFAULT 'BOTH'"),
    ("indents", "vessel_imo", "TEXT"),
    ("audit_log", "hash", "TEXT"),
]

def _pg_schema_sql():
    # PRAGMA lines are SQLite-only; BLOB has no PG equivalent (use BYTEA).
    sql = "\n".join(l for l in SCHEMA_SQL.splitlines() if not l.strip().upper().startswith("PRAGMA"))
    return sql.replace(" BLOB", " BYTEA").replace("\tBLOB", "\tBYTEA")

def _run_schema(execute_one, is_pg: bool):
    """Apply shared/sql/schema.sql. Every CREATE is IF NOT EXISTS, so this is safe
    to re-run against an existing database — it only ever adds what's missing."""
    if not is_pg:
        execute_one.executescript(SCHEMA_SQL)  # sqlite3 supports multi-statement scripts
        return
    # psycopg won't reliably run a multi-statement string, so split and execute one at
    # a time. Two-pass: a forward FK reference (e.g. field_sorties -> expeditions,
    # declared before expeditions in the file) fails on the first pass in table
    # creation order — retry failures once after every CREATE has had a chance to run.
    stmts = [s.strip() for s in _pg_schema_sql().split(";") if s.strip()]
    deferred = []
    for stmt in stmts:
        try:
            execute_one.execute(stmt)
        except Exception as e:
            if "already exists" not in str(e).lower():
                deferred.append((stmt, e))
    for stmt, first_err in deferred:
        try:
            execute_one.execute(stmt)
        except Exception as e:
            if "already exists" not in str(e).lower():
                logger.warning(f"[hq] PG schema stmt failed (non-fatal): {first_err} / retry: {e} :: {stmt[:120]}")

def _run_migrations(cur, is_pg: bool):
    for table, col, coltype in _MIGRATIONS:
        try:
            if is_pg:
                cur.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {coltype}")
            else:
                cols = [r[1] for r in cur.execute(f"PRAGMA table_info({table})").fetchall()]
                if col not in cols:
                    cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {coltype}")
        except Exception as e:
            logger.debug(f"[hq] migration {table}.{col} skipped: {e}")

def _seed_if_empty(cur, is_pg: bool):
    """Idempotent: every insert is ON CONFLICT DO NOTHING and every table is only
    seeded while it's empty, so this runs safely on every boot."""
    def count(table):
        return cur.execute(q(f"SELECT COUNT(*) FROM {table}")).fetchone()[0]
    def run(sql, params=()):
        cur.execute(q(sql), params)

    if count("stations") == 0:
        s = _SEED or {"stations": [("ST-BHARATI", "Bharati", "69°24′S 76°11′E", 24)], "containers": [], "crates": [], "assets": []}
        for r in s["stations"]: run("INSERT INTO stations VALUES (?,?,?,?) ON CONFLICT DO NOTHING", r)
        for r in s["containers"]: run("INSERT INTO containers VALUES (?,?,?,?) ON CONFLICT DO NOTHING", r)
        for r in s["crates"]: run("INSERT INTO crates VALUES (?,?,?,?) ON CONFLICT DO NOTHING", r)
        now = utc_now()
        for a in s["assets"]:
            run("INSERT INTO assets (id,sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT (id) DO NOTHING", (*a, now))
    if count("procurement_targets") == 0:
        for row in PROCUREMENT_SEED:
            run("INSERT INTO procurement_targets VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING", row)
    if count("physics_params") == 0:
        for sid in STATIONS:
            run("INSERT INTO physics_params (station_id, T_INSIDE, BASE, K1, K2, K3) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                (sid, _PHYSICS["T_INSIDE"], _PHYSICS["BASE"], _PHYSICS["K1"], _PHYSICS["K2"], _PHYSICS["K3"]))
    if count("personnel") == 0:
        for p in DEFAULT_PERSONNEL:
            run("INSERT INTO personnel (id, station_id, name, role, blood_group, emergency_contact, status) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING", p)
    if count("expeditions") == 0:
        for r in DEFAULT_EXPEDITIONS:
            run("INSERT INTO expeditions VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING", (*r, None))
        for r in DEFAULT_LEGS:
            run("INSERT INTO voyage_legs VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING", r)
    if count("triage_sla") == 0:
        for r in DEFAULT_TRIAGE_SLA:
            run("INSERT INTO triage_sla VALUES (?,?,?) ON CONFLICT DO NOTHING", r)
    if count("freight_rates") == 0:
        for r in DEFAULT_FREIGHT_RATES:
            run("INSERT INTO freight_rates VALUES (?,?,?) ON CONFLICT DO NOTHING", r)
    if count("lots") == 0:
        rows = cur.execute(q("SELECT id, sku, qty, expiry_date, crate_id FROM assets")).fetchall()
        now = utc_now()
        for aid, sku, qty, exp, crate in rows:
            run("INSERT INTO lots (id, asset_sku, lot_code, qty, expiry_date, crate_id, received_ts) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                (f"LOT-{sku}-0", sku, f"{sku}-L0", qty, exp, crate, now))

def _ensure_sqlite_schema(conn):
    """Self-heal a new/empty thread-local connection (see get_sqlite): Starlette's
    TestClient runs each request in a worker thread, each opening its own
    connection, and a fresh one can land on an empty file if another thread
    (re)created it after this one cached its handle."""
    try:
        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stations'")
        if cur.fetchone() is not None:
            return
    except Exception:
        pass
    _run_schema(conn, is_pg=False)
    _run_migrations(conn, is_pg=False)
    _seed_if_empty(conn, is_pg=False)
    conn.commit()

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
        _ensure_sqlite_schema(conn)
    else:
        # Detect a stale handle: the DB file was unlinked/recreated after this
        # handle was cached (e.g. a test deleted hq.db mid-run). Reopen fresh.
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

def init_db():
    global _initialized
    if USE_PG:
        import psycopg
        with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
            with conn.cursor() as cur:
                try: cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb;")
                except Exception: pass
                _run_schema(cur, is_pg=True)
                _run_migrations(cur, is_pg=True)
                try:
                    _seed_if_empty(cur, is_pg=True)
                except Exception as e:
                    logger.warning(f"[hq] PG seed failed (non-fatal, /health stays up): {e}")
        print(f"[hq] Postgres init ok {DATABASE_URL.split('@')[-1]}")
    else:
        # Drop any cached handle first: it may point at an unlinked inode if the
        # DB file was removed between runs. get_sqlite() then reopens the current
        # file and self-heals schema + seed.
        try:
            old = getattr(_local, "conn", None)
            if old is not None:
                try: old.close()
                except Exception: pass
                _local.conn = None
        except Exception:
            pass
        conn = get_sqlite()
        _run_schema(conn, is_pg=False)
        _run_migrations(conn, is_pg=False)
        _seed_if_empty(conn, is_pg=False)
        conn.commit()
        print(f"[hq] SQLite init ok {HQ_DB_PATH} (fallback, no Docker)")
    _initialized = True

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
