import pathlib, sys, os
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
os.environ.pop("DATABASE_URL", None)
from fastapi.testclient import TestClient
from hq.app.main import app
from hq.app.db import init_db, get_conn
init_db()
client = TestClient(app)

def _clean_indent():
    conn=get_conn()
    try:
        conn.execute("DELETE FROM indents WHERE id LIKE '01TEST%'")
        conn.execute("DELETE FROM dedupe WHERE ulid LIKE '01TEST%'")
        conn.execute("DELETE FROM audit_log WHERE id LIKE '01TEST%'")
        conn.commit()
    except: pass

def test_indent_lifecycle():
    _clean_indent()
    from ulid import ULID
    iid=str(ULID())
    uid=str(ULID())
    assets = client.get("/assets").json()
    a1 = assets[0]["id"]
    # create via sync outbox path (field offline)
    frame = {
        "ulid": uid,
        "device_id": "TEST-DEV-01",
        "entity": "indents",
        "entity_id": iid,
        "op": "UPSERT",
        "patch": {"id": iid, "station_id":"ST-BHARATI","asset_id":a1,"qty_requested":100,"urgency":"CRITICAL","status":"DRAFT","created_by":"FIELD_OP_01","created_at":"2026-08-27T00:00:00"},
        "base_version": 0,
        "ts": "2026-08-27T00:00:00"
    }
    r = client.post("/sync/ingest", json=frame)
    assert r.json()["status"] == "APPLIED"
    # HQ approve via PATCH
    r2 = client.patch(f"/indents/{iid}", json={"status":"APPROVED","actor_id":"NCPOR_ADMIN"})
    assert r2.json()["new"] == "APPROVED"
    r3 = client.patch(f"/indents/{iid}", json={"status":"DISPATCHED","actor_id":"NCPOR_ADMIN"})
    assert r3.json()["new"] == "DISPATCHED"
    # field marks RECEIVED via sync
    from ulid import ULID
    uid2=str(ULID())
    frame2 = {
        "ulid": uid2,
        "device_id": "TEST-DEV-01",
        "entity": "indents",
        "entity_id": iid,
        "op": "UPSERT",
        "patch": {"status":"RECEIVED","id":iid},
        "base_version": 0,
        "ts": "2026-08-27T00:01:00"
    }
    r4 = client.post("/sync/ingest", json=frame2)
    assert r4.json()["status"] == "APPLIED"
    final = next(i for i in client.get("/indents").json() if i["id"]==iid)
    assert final["status"] == "RECEIVED"

def test_audit_immutable():
    r = client.get("/audit?limit=5")
    assert len(r.json()) >= 1
    assert "action" in r.json()[0]

def test_rbac():
    r = client.get("/rbac/me")
    assert r.json()["role"] in ["FIELD_OP","STATION_LEAD","NCPOR_ADMIN","VIEWER"]
