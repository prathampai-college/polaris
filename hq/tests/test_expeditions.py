"""Expedition planner: all-station depth, triage machine, watchdog, 60-day rule."""
import pathlib, sys, os
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
os.environ.pop("DATABASE_URL", None)  # force SQLite fallback for CI
from fastapi.testclient import TestClient
from ulid import ULID
from hq.app.main import app
from hq.app import db as _db
from hq.app.db import init_db
init_db()
client = TestClient(app)

def _reset():
    try:
        conn = _db.get_conn()
        for tbl, ids in [
            ("manifests", ["MAN-T1", "MAN-SYNC-01"]),
            ("voyage_legs", ["LEG-T1"]),
            ("expeditions", ["EXP-TEST-01"]),
            ("emergencies", ["SOS-TRI-01"]),
            ("field_sorties", ["SORTIE-WD-01", "SORTIE-TEST-01"]),
        ]:
            for i in ids:
                try: conn.execute(f"DELETE FROM {tbl} WHERE id=?", (i,))
                except Exception: pass
        try: conn.execute("DELETE FROM emergencies WHERE id LIKE 'SOS-%WD-%' OR id LIKE 'SOS-%DBG-%'")
        except Exception: pass
        try: conn.execute("DELETE FROM audit_log WHERE action LIKE 'EXPEDITION_%' OR action='SORTIE_OVERDUE'")
        except Exception: pass
        try: conn.execute("UPDATE personnel SET status='ON_STATION' WHERE id IN ('PER-BHA-01','PER-BHA-02')")
        except Exception: pass
        try: conn.commit()
        except Exception: pass
    except Exception:
        pass

def test_expedition_crud_all_stations():
    _reset()
    r = client.get("/expeditions")
    assert r.status_code == 200
    ids = {e["id"] for e in r.json()}
    assert "EXP-ANT-46" in ids and "EXP-ARC-26" in ids
    # create new expedition + legs (arctic without vessel)
    r = client.post("/expeditions", json={"id": "EXP-TEST-01", "program": "ARCTIC", "name": "Test Arctic", "season": "HIM-TEST", "status": "PLANNED"})
    assert r.status_code == 200
    r = client.post("/expeditions/EXP-TEST-01/legs", json={"id": "LEG-T1", "seq": 1, "from_point": "GOA", "to_point": "HIMADRI", "mode": "AIR", "status": "PLANNED"})
    assert r.status_code == 200
    # antarctic leg with vessel validation
    r = client.post("/expeditions/EXP-TEST-01/legs", json={"from_point": "CAPETOWN", "to_point": "MAITRI", "mode": "SEA", "vessel_imo": "NOPE"})
    assert r.status_code == 404
    # manifest add + stage advance + regression blocked
    r = client.post("/expeditions/EXP-TEST-01/manifests", json={"id": "MAN-T1", "destination_station": "ST-HIMADRI", "description": "Test kit", "qty": 5, "unit": "pcs", "labelling_code": "TEST-LBL-001"})
    assert r.status_code == 200
    r = client.patch("/expeditions/EXP-TEST-01/manifests/MAN-T1", json={"stage": "MUMBAI"})
    assert r.status_code == 400  # customs+biosecurity pending
    r = client.patch("/expeditions/EXP-TEST-01/manifests/MAN-T1", json={"stage": "MUMBAI", "customs_status": "CLEARED"})
    assert r.status_code == 200
    r = client.patch("/expeditions/EXP-TEST-01/manifests/MAN-T1", json={"stage": "GOA"})
    assert r.status_code == 400  # regression
    # expedition status regression blocked
    r = client.patch("/expeditions/EXP-TEST-01", json={"status": "IN_TRANSIT"})
    assert r.status_code == 200
    r = client.patch("/expeditions/EXP-TEST-01", json={"status": "PLANNED"})
    assert r.status_code == 400

def test_readiness_mutual_aid_timeline_overrides():
    _reset()
    r = client.get("/expeditions/EXP-ANT-46/readiness")
    assert r.status_code == 200
    assert set(r.json()["stations"].keys()) == {"ST-BHARATI", "ST-MAITRI", "ST-HIMADRI"}
    r = client.get("/procurement/mutual-aid")
    assert r.status_code == 200 and isinstance(r.json(), list)
    r = client.get("/timeline?limit=10")
    assert r.status_code == 200
    r = client.get("/overrides?limit=10")
    assert r.status_code == 200

def test_triage_machine_and_watchdog():
    _reset()
    r = client.post("/emergency/sos", json={"id": "SOS-TRI-01", "station_id": "ST-BHARATI", "type": "SOS_MEDICAL", "reported_by": "TEST"})
    assert r.status_code == 200
    r = client.patch("/emergency/SOS-TRI-01", json={"status": "BOGUS"})
    assert r.status_code == 400
    r = client.patch("/emergency/SOS-TRI-01", json={"status": "ACK", "actor_id": "LEAD_01"})
    assert r.status_code == 200
    r = client.patch("/emergency/SOS-TRI-01", json={"status": "ACTIVE"})
    assert r.status_code == 400  # regression blocked
    r = client.patch("/emergency/SOS-TRI-01", json={"status": "RESPONDING"})
    assert r.status_code == 200
    # overdue sortie -> watchdog marks + auto SOS (buddy required, use free personnel after medevac consumed 01/02)
    r = client.post("/sorties", json={"id": "SORTIE-WD-01", "station_id": "ST-BHARATI", "lead_personnel_id": "PER-BHA-04", "buddy_personnel_id": "PER-BHA-05", "destination": "Test Ridge", "departure_time": "2020-01-01T00:00:00", "expected_return_time": "2020-01-01T01:00:00", "safety_status": "ACTIVE"})
    assert r.status_code == 200
    r = client.post("/sorties/check-overdue")
    assert r.status_code == 200
    assert "SORTIE-WD-01" in r.json()["marked_overdue"]
    assert len(r.json()["auto_sos"]) >= 1
    # personnel positions local frame
    r = client.post("/tracking/personnel", json={"personnel_id": "PER-BHA-01", "x": 12.5, "y": -3.2, "station_id": "ST-BHARATI"})
    assert r.status_code == 200
    r = client.get("/tracking/personnel?station_id=ST-BHARATI")
    assert r.status_code == 200 and any(p["personnel_id"] == "PER-BHA-01" for p in r.json())

def test_sync_new_entities():
    import uuid
    u = "01" + uuid.uuid4().hex[:24].upper()
    r = client.post("/sync/ingest", json={"ulid": u, "device_id": "TAB-TEST", "entity": "manifests", "entity_id": "MAN-SYNC-01", "op": "UPSERT", "patch": {"expedition_id": "EXP-ANT-46", "destination_station": "ST-MAITRI", "description": "sync test", "qty": 2, "unit": "pcs", "stage": "GOA"}, "base_version": 0, "ts": "2026-01-01T00:00:00"})
    assert r.status_code == 200 and r.json()["status"] == "APPLIED"
