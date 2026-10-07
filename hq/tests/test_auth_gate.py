"""The HQ auth gate: writes need a JWT (or the wire PSK on machine paths),
role floors per path, private reads, and audit identity taken from the token."""
import os
from fastapi.testclient import TestClient
from ulid import ULID
from hq.app.main import app
from hq.app.db import init_db, get_conn
from hq.app.auth import sign_jwt
from hq.app.config import SECRET_KEY
init_db()

anon = TestClient(app, headers={"Authorization": ""})


def as_role(role, sub="TOKEN-USER"):
    tok = sign_jwt({"sub": sub, "device_id": sub, "role": role, "station_id": "ST-BHARATI"}, SECRET_KEY, 1)
    return TestClient(app, headers={"Authorization": f"Bearer {tok}"})


def test_unauthenticated_writes_rejected():
    assert anon.post("/emergency/sos", json={"station_id": "ST-BHARATI", "type": "SOS_MEDICAL"}).status_code == 401
    assert anon.post("/expeditions", json={"program": "ANTARCTIC", "name": "x"}).status_code == 401
    assert anon.post("/sorties/check-overdue").status_code == 401


def test_role_floor_per_path():
    assert as_role("FIELD_OP").post("/expeditions", json={"program": "ANTARCTIC", "name": "x"}).status_code == 403
    assert as_role("HQ_LOGISTICS").post("/expeditions", json={"program": "ANTARCTIC", "name": "auth gate"}).status_code == 200


def test_private_reads_need_login_public_reads_dont():
    assert anon.get("/personnel").status_code == 401
    assert anon.get("/audit").status_code == 401
    assert anon.get("/assets").status_code == 200


def test_sync_accepts_psk_rejects_wrong_psk():
    frame = {"ulid": str(ULID()), "device_id": "TAB-PSK", "entity": "personnel", "entity_id": "PER-BHA-02",
             "op": "UPSERT", "patch": {"status": "ON_STATION"}, "base_version": 0, "ts": "2026-01-01T00:00:00"}
    psk = os.getenv("INTERNAL_PSK_HEX") or os.getenv("PSK_HEX") or "a" * 64
    assert anon.post("/sync/ingest", json=frame, headers={"X-PSK": "b" * 64}).status_code == 401
    assert anon.post("/sync/ingest", json=frame, headers={"X-PSK": psk}).json()["status"] == "APPLIED"


def test_audit_actor_comes_from_token_not_body():
    c = as_role("HQ_LOGISTICS", sub="REAL-OFFICER")
    r = c.post("/expeditions", json={"program": "ANTARCTIC", "name": "actor test", "created_by": "SPOOFED"})
    assert r.status_code == 200
    row = get_conn().execute("SELECT actor_id FROM audit_log WHERE action LIKE 'EXPEDITION_%' ORDER BY ts DESC LIMIT 1").fetchone()
    assert row[0] == "REAL-OFFICER"


def test_production_refuses_demo_secrets():
    import subprocess, sys
    env = {**os.environ, "POLARIS_ENV": "production", "SECRET_KEY": "", "PSK_HEX": "a" * 64}
    r = subprocess.run([sys.executable, "-c", "import hq.app.config"], env=env, capture_output=True, text=True)
    assert r.returncode != 0 and "SECRET_KEY" in r.stderr
    env.update(SECRET_KEY="s" * 40, PSK_HEX="b" * 64, STATION_PINS_JSON='{"ST-BHARATI": "x"}')
    assert subprocess.run([sys.executable, "-c", "import hq.app.config"], env=env).returncode == 0
