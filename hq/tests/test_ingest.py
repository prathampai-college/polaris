import pathlib, sys, os
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
os.environ.pop("DATABASE_URL", None)  # force SQLite fallback for CI
import tempfile
from fastapi.testclient import TestClient

# ensure clean DB
db_path = pathlib.Path(__file__).parent.parent / "app" / "hq.db"
for p in [db_path, pathlib.Path(str(db_path)+"-wal"), pathlib.Path(str(db_path)+"-shm")]:
    try: p.unlink()
    except: pass

from hq.app.main import app
from hq.app.db import init_db, get_conn
init_db()
client = TestClient(app)

def _clean_ingest():
    conn=get_conn()
    try:
        conn.execute("DELETE FROM dedupe WHERE ulid LIKE '01TEST%'")
        conn.commit()
    except: pass

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

def test_sync_ingest_and_dedupe():
    _clean_ingest()
    from ulid import ULID
    uid=str(ULID())
    # fetch asset A1 version
    assets = client.get("/assets").json()
    a1 = next(a for a in assets if a["id"]=="A1")
    v = a1["version"]
    frame = {
        "ulid": uid,
        "device_id": "TEST-DEV-01",
        "entity": "assets",
        "entity_id": "A1",
        "op": "UPSERT",
        "patch": {"qty": a1["qty"]+1, "version": v+1},
        "base_version": v,
        "ts": "2026-08-27T00:00:00"
    }
    r = client.post("/sync/ingest", json=frame)
    assert r.json()["status"] == "APPLIED"
    # replay same ulid should be DEDUPED
    r2 = client.post("/sync/ingest", json=frame)
    assert r2.json()["status"] == "DEDUPED"
    # qty should not double-apply
    qty2 = next(a for a in client.get("/assets").json() if a["id"]=="A1")["qty"]
    assert qty2 == a1["qty"]+1

def test_pessimistic_lock_negative():
    from ulid import ULID
    uid=str(ULID())
    assets = client.get("/assets").json()
    a1 = next(a for a in assets if a["id"]=="A1")
    frame = {
        "ulid": uid,
        "device_id": "TEST-DEV-01",
        "entity": "assets",
        "entity_id": "A1",
        "op": "UPSERT",
        "patch": {"qty": -5, "version": 999},
        "base_version": 999,
        "ts": "2026-08-27T00:00:00"
    }
    r = client.post("/sync/ingest", json=frame)
    assert r.json()["status"] == "CONFLICT_CRITICAL"
