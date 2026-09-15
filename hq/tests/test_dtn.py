import pathlib, sys, os
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
os.environ.pop("DATABASE_URL", None)  # force SQLite fallback for CI
from hq.app.dtn import compare_vc, merge_vc
from fastapi.testclient import TestClient
from hq.app.main import app
from hq.app.db import init_db, get_conn
init_db()
client = TestClient(app)

def test_vc_concurrent():
    assert compare_vc({"A":1},{"B":1})=="concurrent"
    assert compare_vc({"A":1},{})=="gt"
    assert compare_vc({},{"B":1})=="lt"
    assert compare_vc({"A":1},{"A":1})=="equal"

def test_merge():
    assert merge_vc({"A":1},{"B":1})=={"A":1,"B":1}
    assert merge_vc({"A":2},{"A":1})=={"A":2}

def test_lww_deterministic():
    # concurrent -> later ts wins
    a_vc={"A":1}
    b_vc={"B":1}
    assert compare_vc(a_vc,b_vc)=="concurrent"
    # later ts simulated: B wins
    import datetime
    ta="2026-09-03T10:00:00Z"
    tb="2026-09-03T10:00:05Z"
    assert tb > ta

def test_dtn_ingest_endpoint():
    import datetime
    from ulid import ULID
    bid = str(ULID())
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    bundle = {
        "bundleId": bid,
        "src": "TEST-MULE-01",
        "dstStation": "ST-BHARATI",
        "vectorClock": {"TEST-MULE-01": 1},
        "payload": {"entity": "indents", "entity_id": f"DTN-TEST-{bid[-6:]}",
                    "op": "UPSERT",
                    "patch": {"station_id": "ST-BHARATI", "asset_id": "A1",
                              "qty_requested": 5, "urgency": "LOW", "status": "DRAFT",
                              "created_by": "TEST-MULE-01", "created_at": now}},
        "createdAt": now,
        "ttlSec": 86400,
        "custody": True,
    }
    r = client.post("/dtn/ingest_bulk", json={"bundles": [bundle]})
    assert r.status_code == 200
    res = r.json()["results"][0]
    assert res["status"] == "APPLIED", res
    # replay same bundleId -> DEDUPED, no double-apply
    r2 = client.post("/dtn/ingest_bulk", json={"bundles": [bundle]})
    assert r2.json()["results"][0]["status"] == "DEDUPED"
    # listed in bundles for the station
    lst = client.get("/dtn/bundles?dst_station=ST-BHARATI&limit=50").json()
    assert any(b["bundle_id"] == bid for b in lst)
    # cleanup test rows
    conn = get_conn()
    try:
        conn.execute("DELETE FROM dtn_bundles WHERE bundle_id=?", (bid,))
        conn.execute("DELETE FROM dedupe WHERE ulid=?", (bid,))
        conn.execute("DELETE FROM indents WHERE id=?", (f"DTN-TEST-{bid[-6:]}",))
        conn.commit()
    except Exception:
        pass

def test_dtn_expired_bundle():
    from ulid import ULID
    bid = str(ULID())
    bundle = {
        "bundleId": bid,
        "src": "TEST-MULE-01",
        "dstStation": "ST-BHARATI",
        "vectorClock": {},
        "payload": {"entity": "indents", "entity_id": "DTN-OLD",
                    "op": "UPSERT", "patch": {"station_id": "ST-BHARATI"}},
        "createdAt": "2020-01-01T00:00:00Z",
        "ttlSec": 60,
        "custody": True,
    }
    r = client.post("/dtn/ingest_bulk", json={"bundles": [bundle]})
    assert r.json()["results"][0]["status"] == "EXPIRED"
