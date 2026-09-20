import pathlib, sys, os
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
os.environ.pop("DATABASE_URL", None)  # force SQLite fallback for CI
from fastapi.testclient import TestClient
from ulid import ULID

from hq.app.main import app
from hq.app.db import init_db, get_conn
init_db()
client = TestClient(app)

def test_personnel_list_and_upsert():
    # Verify default seeded personnel
    r = client.get("/personnel")
    assert r.status_code == 200
    personnel = r.json()
    assert len(personnel) >= 5
    bha_crew = [p for p in personnel if p["station_id"] == "ST-BHARATI"]
    assert len(bha_crew) >= 1

    # Upsert new personnel
    new_per = {
        "id": "PER-TEST-99",
        "station_id": "ST-BHARATI",
        "name": "Dr. Test Expeditioner",
        "role": "Robotics Specialist",
        "blood_group": "AB-",
        "emergency_contact": "+91-9999999999",
        "status": "ON_STATION"
    }
    r = client.post("/personnel", json=new_per)
    assert r.status_code == 200

    # Query back
    r = client.get("/personnel?station_id=ST-BHARATI")
    assert r.status_code == 200
    matches = [p for p in r.json() if p["id"] == "PER-TEST-99"]
    assert len(matches) == 1
    assert matches[0]["name"] == "Dr. Test Expeditioner"

def test_sortie_checkout_and_return():
    # ensure clean personnel/buddy state (test isolation across files)
    try:
        conn = get_conn()
        conn.execute("UPDATE personnel SET status='ON_STATION' WHERE id IN ('PER-BHA-01','PER-BHA-02')")
        conn.execute("DELETE FROM field_sorties WHERE id IN ('SORTIE-TEST-01','SORTIE-WD-01')")
        conn.commit()
    except Exception:
        pass
    sortie_payload = {
        "id": "SORTIE-TEST-01",
        "station_id": "ST-BHARATI",
        "lead_personnel_id": "PER-BHA-01",
        "buddy_personnel_id": "PER-BHA-02",
        "destination": "Testing Moraine Grid Alpha",
        "expected_return_time": "2026-10-01T12:00:00Z",
        "safety_status": "ACTIVE"
    }
    r = client.post("/sorties", json=sortie_payload)
    assert r.status_code == 200, r.text

    # Verify personnel status changed to FIELD_SORTIE
    r = client.get("/personnel?station_id=ST-BHARATI")
    p1 = next(p for p in r.json() if p["id"] == "PER-BHA-01")
    assert p1["status"] == "FIELD_SORTIE"

    # List sorties
    r = client.get("/sorties?station_id=ST-BHARATI")
    assert r.status_code == 200
    s1 = next(s for s in r.json() if s["id"] == "SORTIE-TEST-01")
    assert s1["safety_status"] == "ACTIVE"

    # Return sortie
    r = client.patch("/sorties/SORTIE-TEST-01", json={"safety_status": "RETURNED"})
    assert r.status_code == 200

    # Verify personnel is back ON_STATION
    r = client.get("/personnel?station_id=ST-BHARATI")
    p1 = next(p for p in r.json() if p["id"] == "PER-BHA-01")
    assert p1["status"] == "ON_STATION"

def test_emergency_sos_lifecycle():
    # Trigger SOS
    sos_payload = {
        "id": "SOS-TEST-99",
        "station_id": "ST-BHARATI",
        "type": "SOS_MEDICAL",
        "reported_by": "FIELD_OP (TAB-BHARATI-01)",
        "location_coord": "Sector 7 Crevasse",
        "status": "ACTIVE"
    }
    r = client.post("/emergency/sos", json=sos_payload)
    assert r.status_code == 200
    data = r.json()
    assert data["emergency"]["id"] == "SOS-TEST-99"

    # Query active emergencies
    r = client.get("/emergencies?active_only=true")
    assert r.status_code == 200
    actives = r.json()
    assert any(e["id"] == "SOS-TEST-99" for e in actives)

    # Resolve SOS
    r = client.patch("/emergency/SOS-TEST-99", json={"status": "RESOLVED"})
    assert r.status_code == 200

    # Query again
    r = client.get("/emergencies?active_only=true")
    actives = r.json()
    assert not any(e["id"] == "SOS-TEST-99" for e in actives)

def test_sync_ingest_personnel_and_emergencies():
    uid = str(ULID())
    frame = {
        "ulid": uid,
        "device_id": "TEST-TAB-01",
        "entity": "emergencies",
        "entity_id": "SOS-INGEST-01",
        "op": "UPSERT",
        "patch": {
            "station_id": "ST-MAITRI",
            "type": "SOS_FIRE",
            "reported_by": "TEST_CREW",
            "status": "ACTIVE",
            "location_coord": "Gen-Shed 2"
        },
        "base_version": 0,
        "ts": "2026-09-16T12:00:00"
    }
    r = client.post("/sync/ingest", json=frame)
    assert r.status_code == 200
    assert r.json()["status"] == "APPLIED"

    # Deduplication test
    r2 = client.post("/sync/ingest", json=frame)
    assert r2.status_code == 200
    assert r2.json()["status"] == "DEDUPED"

    # Verify emergency was recorded
    r = client.get("/emergencies?station_id=ST-MAITRI")
    assert r.status_code == 200
    assert any(e["id"] == "SOS-INGEST-01" for e in r.json())
