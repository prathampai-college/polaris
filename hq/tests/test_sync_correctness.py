"""Regression tests for field→HQ sync bugs fixed in the one-ingest-path rewrite."""
import pathlib, sys, os
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
os.environ.pop("DATABASE_URL", None)
from fastapi.testclient import TestClient
from ulid import ULID
from hq.app.main import app
from hq.app.db import init_db, get_conn
init_db()
client = TestClient(app)


def frame(entity, entity_id, patch, op="UPSERT", vc=None, uid=None):
    return {"ulid": uid or str(ULID()), "device_id": "TEST-SYNC-01", "entity": entity, "entity_id": entity_id,
            "op": op, "patch": patch, "base_version": 0, "ts": "2026-09-01T00:00:00", "vector_clock": vc}


def one(sql, params=()):
    r = get_conn().execute(sql, params).fetchone()
    return tuple(r) if r else None


def test_consume_op_applies_qty():
    get_conn().execute("UPDATE assets SET vector_clock='{}', updated_at='2020-01-01' WHERE id='A1'")
    before = one("SELECT qty FROM assets WHERE id='A1'")[0]
    r = client.post("/sync/ingest", json=frame("assets", "A1", {"qty": before - 3}, op="CONSUME", vc={"TEST-SYNC-01": 1}))
    assert r.json()["status"] == "APPLIED", r.json()
    assert one("SELECT qty FROM assets WHERE id='A1'")[0] == before - 3


def test_personnel_status_patch_keeps_name():
    name = one("SELECT name FROM personnel WHERE id='PER-BHA-02'")[0]
    r = client.post("/sync/ingest", json=frame("personnel", "PER-BHA-02", {"status": "FIELD_SORTIE"}))
    assert r.json()["status"] == "APPLIED"
    row = one("SELECT name, status, blood_group FROM personnel WHERE id='PER-BHA-02'")
    assert row[0] == name and row[1] == "FIELD_SORTIE" and row[2] == "A+"
    client.post("/sync/ingest", json=frame("personnel", "PER-BHA-02", {"status": "ON_STATION"}))


def test_manifest_stage_update_lands():
    mid = f"MAN-SC-{str(ULID())[-6:]}"
    client.post("/sync/ingest", json=frame("manifests", mid, {"expedition_id": "EXP-ANT-46", "destination_station": "ST-BHARATI", "description": "t", "qty": 1, "unit": "pcs", "stage": "GOA"}))
    r = client.post("/sync/ingest", json=frame("manifests", mid, {"stage": "VESSEL"}))
    assert r.json()["status"] == "APPLIED"
    assert one("SELECT stage, description FROM manifests WHERE id=?", (mid,)) == ("VESSEL", "t")


def test_lot_consume_keeps_expiry():
    lid = f"LOT-SC-{str(ULID())[-6:]}"
    sku = one("SELECT sku FROM assets WHERE id='A1'")[0]
    client.post("/sync/ingest", json=frame("lots", lid, {"asset_sku": sku, "lot_code": lid, "qty": 10, "expiry_date": "2027-01-01"}))
    client.post("/sync/ingest", json=frame("lots", lid, {"asset_sku": sku, "lot_code": lid, "qty": 4}))
    assert one("SELECT qty, expiry_date FROM lots WHERE id=?", (lid,)) == (4, "2027-01-01")
    get_conn().execute("DELETE FROM lots WHERE id=?", (lid,))


def test_emergency_assignee_and_status_ts_persist():
    eid = f"SOS-SC-{str(ULID())[-6:]}"
    client.post("/sync/ingest", json=frame("emergencies", eid, {"station_id": "ST-MAITRI", "type": "SOS_MEDICAL", "location_coord": "LOCATION UNKNOWN"}))
    r = client.post("/sync/ingest", json=frame("emergencies", eid, {"status": "ACK", "assignee": "PER-MAI-02"}))
    assert r.json()["status"] == "APPLIED"
    row = one("SELECT status, assignee, status_entered_ts, station_id FROM emergencies WHERE id=?", (eid,))
    assert row[0] == "ACK" and row[1] == "PER-MAI-02" and row[2] and row[3] == "ST-MAITRI"


def test_same_ulid_over_ws_and_dtn_applies_once():
    pid = f"PER-SC-{str(ULID())[-6:]}"
    f = frame("personnel", pid, {"station_id": "ST-BHARATI", "name": "Dual Channel", "role": "Tech"})
    bundle = {"bundleId": f["ulid"], "src": f["device_id"], "dstStation": "ST-BHARATI", "payload": {k: f[k] for k in ("entity", "entity_id", "op", "patch")}}
    r1 = client.post("/dtn/ingest_bulk", json={"bundles": [bundle]}).json()["results"][0]
    assert r1["status"] == "APPLIED", r1  # was UNSUPPORTED_ENTITY for personnel
    assert client.post("/sync/ingest", json=f).json()["status"] == "DEDUPED"


def test_bad_bundle_does_not_sink_batch():
    good = {"bundleId": str(ULID()), "src": "TEST-SYNC-01", "payload": {"entity": "indents", "entity_id": f"IND-SC-{str(ULID())[-6:]}", "op": "UPSERT",
            "patch": {"station_id": "ST-BHARATI", "asset_id": "A1", "qty_requested": 2}}}
    bad = {"bundleId": str(ULID()), "src": "TEST-SYNC-01", "payload": {"entity": "assets", "entity_id": "NO-SUCH", "op": "CONSUME", "patch": {"qty": 1}}}
    res = client.post("/dtn/ingest_bulk", json={"bundles": [bad, good]}).json()["results"]
    assert [r["status"] for r in res] == ["FAILED", "APPLIED"]
    assert one("SELECT 1 FROM indents WHERE id=?", (good["payload"]["entity_id"],))


def test_unknown_entity_is_400_not_404():
    r = client.post("/sync/ingest", json=frame("stations", "ST-BHARATI", {"name": "x"}))
    assert r.status_code == 400


def test_indent_sync_cannot_skip_hq_approval():
    iid = f"IND-SM-{str(ULID())[-6:]}"
    client.post("/sync/ingest", json=frame("indents", iid, {"station_id": "ST-BHARATI", "asset_id": "A1", "qty_requested": 1}))
    r = client.post("/sync/ingest", json=frame("indents", iid, {"status": "RECEIVED"}))
    assert r.status_code == 400
    assert one("SELECT status FROM indents WHERE id=?", (iid,)) == ("DRAFT",)
