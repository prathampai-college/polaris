import os, sqlite3, pathlib

DATABASE_URL = os.getenv("DATABASE_URL", "")  # e.g. postgresql://user:pass@db:5432/polaris
USE_PG = DATABASE_URL.startswith("postgresql")

_pg_conn = None

SCHEMA_SQL = pathlib.Path(__file__).with_name("schema.sql").read_text() if pathlib.Path(__file__).with_name("schema.sql").exists() else ""

# Fallback schema inline if file missing
if not SCHEMA_SQL:
    SCHEMA_SQL = open(pathlib.Path(__file__).parent / ".." / ".." / "shared" / "sql" / "schema.sql", encoding="utf-8").read() if pathlib.Path(pathlib.Path(__file__).parent / ".." / ".." / "shared" / "sql" / "schema.sql").exists() else ""

HQ_DB_PATH = pathlib.Path(__file__).parent / "hq.db"

def get_sqlite():
    conn = sqlite3.connect(str(HQ_DB_PATH), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn

_sqlite_conn = None

def init_db():
    global _sqlite_conn
    if USE_PG:
        import psycopg
        with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
            with conn.cursor() as cur:
                # TimescaleDB extension if available (ignore failure)
                try: cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb;")
                except: pass
                cur.execute(SCHEMA_SQL)
                # seed stations if empty
                cur.execute("SELECT COUNT(*) FROM stations")
                if cur.fetchone()[0]==0:
                    seed(cur)
        print(f"[hq] Postgres init ok {DATABASE_URL.split('@')[-1]}")
    else:
        _sqlite_conn = get_sqlite()
        _sqlite_conn.executescript(SCHEMA_SQL)
        cur = _sqlite_conn.execute("SELECT COUNT(*) FROM stations")
        if cur.fetchone()[0]==0:
            seed_sqlite(_sqlite_conn)
        print(f"[hq] SQLite init ok {HQ_DB_PATH} (fallback, no Docker)")

def seed(cur):
    # cur is psycopg cursor
    cur.execute("INSERT INTO stations VALUES ('ST-BHARATI','Bharati','69°24′S 76°11′E',24) ON CONFLICT DO NOTHING")
    cur.execute("INSERT INTO stations VALUES ('ST-MAITRI','Maitri','70°45′S 11°44′E',25) ON CONFLICT DO NOTHING")
    cur.execute("INSERT INTO stations VALUES ('ST-HIMADRI','Himadri','78°55′N 11°56′E',8) ON CONFLICT DO NOTHING")
    for row in [("C1","ST-BHARATI","ISO_20ft","A1"),("C2","ST-BHARATI","ColdStore","A2"),("C3","ST-BHARATI","Hazmat","B1")]:
        cur.execute("INSERT INTO containers VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING", row)
    for row in [("C1-K1","C1",'{"x":0,"y":0}',"AMBIENT"),("C1-K2","C1",'{"x":1,"y":0}',"AMBIENT"),("C2-K1","C2",'{"x":0,"y":1}',"COLD"),("C2-K2","C2",'{"x":1,"y":1}',"COLD"),("C2-K3","C2",'{"x":0,"y":2}',"COLD"),("C3-K1","C3",'{"x":0,"y":0}',"AMBIENT"),("C3-K2","C3",'{"x":0,"y":1}',"HAZMAT")]:
        cur.execute("INSERT INTO crates VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING", row)
    assets = [
        ('A1','FUEL-DIESEL-001','Diesel (Winter Grade)','FUEL_DIESEL',4200,'L',None,'CRITICAL','C1-K1','FUEL-DIESEL-001'),
        ('A2','FUEL-KERO-JP8-002','Kerosene JP-8','FUEL_KEROSENE',1800,'L',None,'CRITICAL','C1-K2','FUEL-KERO-JP8-002'),
        ('A3','O2-CYL-47L-003','Oxygen Cylinder 47L','OXYGEN',24,'cyl','2026-09-15','CRITICAL','C2-K1','O2-CYL-47L-003'),
        ('A4','RATION-FD-30D-004','Freeze-Dried Rations (30-day pack)','FOOD',90,'packs','2027-06-01','HIGH','C2-K2','RATION-FD-30D-004'),
        ('A5','MED-ANTIBIOTIC-005','Antibiotic Kit (Amoxicillin)','MEDICAL',12,'kits','2026-09-20','CRITICAL','C2-K3','MED-ANTIBIOTIC-005'),
        ('A6','MED-TRAUMA-006','Trauma Kit (Type A)','MEDICAL',6,'kits','2026-10-10','CRITICAL','C2-K3','MED-TRAUMA-006'),
        ('A7','SPARE-BRG-6205-007','DG Bearing 6205-2RS','SPARES_DG',8,'pcs',None,'HIGH','C3-K1','SPARE-BRG-6205-007'),
        ('A8','SPARE-FILTER-FUEL-008','DG Fuel Filter (Fleetguard)','SPARES_DG',14,'pcs',None,'HIGH','C3-K1','SPARE-FILTER-FUEL-008'),
        ('A9','SPARE-HVAC-FAN-009','HVAC Blower Motor','SPARES_HVAC',2,'pcs',None,'HIGH','C3-K2','SPARE-HVAC-FAN-009'),
        ('A10','SCI-ICE-CORE-010','Ice Core Drill Bit','SCIENTIFIC',4,'pcs',None,'LOW','C3-K2','SCI-ICE-CORE-010'),
    ]
    for a in assets:
        cur.execute("INSERT INTO assets (id,sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode,version,updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,now()) ON CONFLICT (id) DO NOTHING", a)

def seed_sqlite(conn):
    conn.execute("INSERT OR IGNORE INTO stations VALUES ('ST-BHARATI','Bharati','69°24′S 76°11′E',24)")
    conn.execute("INSERT OR IGNORE INTO stations VALUES ('ST-MAITRI','Maitri','70°45′S 11°44′E',25)")
    conn.execute("INSERT OR IGNORE INTO stations VALUES ('ST-HIMADRI','Himadri','78°55′N 11°56′E',8)")
    for row in [("C1","ST-BHARATI","ISO_20ft","A1"),("C2","ST-BHARATI","ColdStore","A2"),("C3","ST-BHARATI","Hazmat","B1")]:
        conn.execute("INSERT OR IGNORE INTO containers VALUES (?,?,?,?)", row)
    for row in [("C1-K1","C1",'{"x":0,"y":0}',"AMBIENT"),("C1-K2","C1",'{"x":1,"y":0}',"AMBIENT"),("C2-K1","C2",'{"x":0,"y":1}',"COLD"),("C2-K2","C2",'{"x":1,"y":1}',"COLD"),("C2-K3","C2",'{"x":0,"y":2}',"COLD"),("C3-K1","C3",'{"x":0,"y":0}',"AMBIENT"),("C3-K2","C3",'{"x":0,"y":1}',"HAZMAT")]:
        conn.execute("INSERT OR IGNORE INTO crates VALUES (?,?,?,?)", row)
    import datetime
    now=datetime.datetime.utcnow().isoformat()
    assets = [
        ('A1','FUEL-DIESEL-001','Diesel (Winter Grade)','FUEL_DIESEL',4200,'L',None,'CRITICAL','C1-K1','FUEL-DIESEL-001',1,now),
        ('A2','FUEL-KERO-JP8-002','Kerosene JP-8','FUEL_KEROSENE',1800,'L',None,'CRITICAL','C1-K2','FUEL-KERO-JP8-002',1,now),
        ('A3','O2-CYL-47L-003','Oxygen Cylinder 47L','OXYGEN',24,'cyl','2026-09-15','CRITICAL','C2-K1','O2-CYL-47L-003',1,now),
        ('A4','RATION-FD-30D-004','Freeze-Dried Rations (30-day pack)','FOOD',90,'packs','2027-06-01','HIGH','C2-K2','RATION-FD-30D-004',1,now),
        ('A5','MED-ANTIBIOTIC-005','Antibiotic Kit (Amoxicillin)','MEDICAL',12,'kits','2026-09-20','CRITICAL','C2-K3','MED-ANTIBIOTIC-005',1,now),
        ('A6','MED-TRAUMA-006','Trauma Kit (Type A)','MEDICAL',6,'kits','2026-10-10','CRITICAL','C2-K3','MED-TRAUMA-006',1,now),
        ('A7','SPARE-BRG-6205-007','DG Bearing 6205-2RS','SPARES_DG',8,'pcs',None,'HIGH','C3-K1','SPARE-BRG-6205-007',1,now),
        ('A8','SPARE-FILTER-FUEL-008','DG Fuel Filter (Fleetguard)','SPARES_DG',14,'pcs',None,'HIGH','C3-K1','SPARE-FILTER-FUEL-008',1,now),
        ('A9','SPARE-HVAC-FAN-009','HVAC Blower Motor','SPARES_HVAC',2,'pcs',None,'HIGH','C3-K2','SPARE-HVAC-FAN-009',1,now),
        ('A10','SCI-ICE-CORE-010','Ice Core Drill Bit','SCIENTIFIC',4,'pcs',None,'LOW','C3-K2','SCI-ICE-CORE-010',1,now),
    ]
    for a in assets:
        conn.execute("INSERT OR IGNORE INTO assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", a)
    conn.commit()

def get_conn():
    if USE_PG:
        import psycopg
        return psycopg.connect(DATABASE_URL)
    else:
        if _sqlite_conn is None:
            init_db()
        return _sqlite_conn
