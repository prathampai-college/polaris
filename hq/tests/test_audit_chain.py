"""Regression tests for the audit_log hash chain (hq/app/db.py::write_audit)."""
import pathlib, sys, os
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
os.environ.pop("DATABASE_URL", None)
from fastapi.testclient import TestClient
from hq.app.main import app
from hq.app.db import init_db, get_conn
init_db()
client = TestClient(app)


def test_chain_verifies_clean_and_flags_tamper():
    r1 = client.post("/expeditions", json={"program": "ANTARCTIC", "name": "chain test 1"})
    assert r1.status_code == 200
    r2 = client.post("/expeditions", json={"program": "ANTARCTIC", "name": "chain test 2"})
    assert r2.status_code == 200

    ok = client.get("/audit/verify").json()
    assert ok["verified"] is True, ok

    conn = get_conn()
    row = conn.execute("SELECT id FROM audit_log ORDER BY ts LIMIT 1").fetchone()
    conn.execute("UPDATE audit_log SET after='TAMPERED' WHERE id=?", (row["id"],))
    conn.commit()

    broken = client.get("/audit/verify").json()
    assert broken["verified"] is False
    assert broken["broken_at"] == row["id"]
