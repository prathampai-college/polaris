import os, sqlite3, pathlib, json

DATABASE_URL = os.getenv("DATABASE_URL", "")
USE_PG = DATABASE_URL.startswith("postgresql")

_shared_schema = pathlib.Path(__file__).parent / ".." / ".." / "shared" / "sql" / "schema.sql"
# also try docker context path /app/shared
_alt_schema = pathlib.Path("/app/shared/sql/schema.sql")
_alt2 = pathlib.Path(__file__).parent / "schema.sql"
if _shared_schema.exists():
    SCHEMA_SQL = _shared_schema.read_text(encoding="utf-8")
elif _alt_schema.exists():
    SCHEMA_SQL = _alt_schema.read_text(encoding="utf-8")
elif _alt2.exists():
    SCHEMA_SQL = _alt2.read_text(encoding="utf-8")
else:
    SCHEMA_SQL = ""

HQ_DB_PATH = pathlib.Path(__file__).parent / "hq.db"

def _load_seed():
    for p in [
        pathlib.Path(__file__).parent / ".." / ".." / "shared" / "seed.json",
        pathlib.Path("/app/shared/seed.json"),
        pathlib.Path(__file__).parent / "seed.json",
    ]:
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
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

def _pg_schema_sql():
    # strip PRAGMA lines which are SQLite-only
    return "\n".join(l for l in SCHEMA_SQL.splitlines() if not l.strip().upper().startswith("PRAGMA"))

def init_db():
    global _sqlite_conn
    if USE_PG:
        import psycopg
        with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
            with conn.cursor() as cur:
                try: cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb;")
                except: pass
                cur.execute(_pg_schema_sql())
                cur.execute("SELECT COUNT(*) FROM stations")
                if cur.fetchone()[0] == 0:
                    seed(cur)
        print(f"[hq] Postgres init ok {DATABASE_URL.split('@')[-1]}")
    else:
        _sqlite_conn = get_sqlite()
        _sqlite_conn.executescript(SCHEMA_SQL)
        cur = _sqlite_conn.execute("SELECT COUNT(*) FROM stations")
        if cur.fetchone()[0] == 0:
            seed_sqlite(_sqlite_conn)
        print(f"[hq] SQLite init ok {HQ_DB_PATH} (fallback, no Docker)")

def seed(cur):
    s = _SEED
    if s:
        for r in s["stations"]: cur.execute("INSERT INTO stations VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING", r)
        for r in s["containers"]: cur.execute("INSERT INTO containers VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING", r)
        for r in s["crates"]: cur.execute("INSERT INTO crates VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING", r)
        for a in s["assets"]: cur.execute("INSERT INTO assets (id,sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode,version,updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,now()) ON CONFLICT (id) DO NOTHING", a)
        return
    # fallback (should not happen)
    for r in [("ST-BHARATI","Bharati","69°24′S 76°11′E",24)]: cur.execute("INSERT INTO stations VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING", r)

def seed_sqlite(conn):
    s = _SEED
    if s:
        for r in s["stations"]: conn.execute("INSERT OR IGNORE INTO stations VALUES (?,?,?,?)", r)
        for r in s["containers"]: conn.execute("INSERT OR IGNORE INTO containers VALUES (?,?,?,?)", r)
        for r in s["crates"]: conn.execute("INSERT OR IGNORE INTO crates VALUES (?,?,?,?)", r)
        import datetime
        now = datetime.datetime.utcnow().isoformat()
        for a in s["assets"]: conn.execute("INSERT OR IGNORE INTO assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (*a, 1, now))
        conn.commit()
        return

def get_conn():
    if USE_PG:
        import psycopg
        return psycopg.connect(DATABASE_URL)
    else:
        if _sqlite_conn is None:
            init_db()
        return _sqlite_conn
