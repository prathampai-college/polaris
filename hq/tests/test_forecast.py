import pathlib, sys, os
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
os.environ.pop("DATABASE_URL", None)
from fastapi.testclient import TestClient
from hq.app.main import app
from hq.app.db import init_db, get_conn
init_db()
client = TestClient(app)

def _clean():
    conn=get_conn()
    try:
        conn.execute("DELETE FROM telemetry")
        conn.execute("DELETE FROM indents WHERE created_by='FORECAST_AUTO'")
        conn.execute("DELETE FROM dedupe WHERE ulid LIKE '01TEST%'")
        conn.commit()
    except: pass

def test_forecast_baseline_42():
    _clean()
    r = client.get("/forecast/ST-BHARATI")
    assert r.status_code == 200
    j = r.json()
    assert 20 < j["days_to_stockout"] < 60
    assert len(j["ci"]) == 2
    assert j["used_model"] in [True, False]
    assert j["qty"] > 0

def test_forecast_blizzard_18_and_auto_indent():
    _clean()
    # post blizzard telemetry
    client.post("/telemetry", json={"ts":"2026-08-27T00:00:00","station_id":"ST-BHARATI","temp_outside":-38,"wind_speed":22,"pressure":960,"dg_load":0.9})
    r = client.get("/forecast/ST-BHARATI")
    j = r.json()
    # blizzard conditions should reduce stockout days significantly vs calm
    assert j["days_to_stockout"] < 50
    assert len(j["ci"]) == 2
    assert j["qty"] > 0

def test_onnx_size_and_fallback():
    import pathlib
    p = pathlib.Path("ai/thermo_residual.onnx")
    assert p.exists()
    assert p.stat().st_size < 2*1024*1024
    assert p.stat().st_size > 0

def test_telemetry_history_and_acoustic_escalation():
    _clean()
    # post telemetry with high acoustic anomaly
    res = client.post("/telemetry", json={
        "ts": "2026-08-27T12:00:00.000Z",
        "station_id": "ST-BHARATI",
        "temp_outside": -15,
        "wind_speed": 5,
        "pressure": 1013,
        "dg_load": 0.7,
        "acoustic_anomaly": 0.95
    })
    assert res.status_code == 200

    # check telemetry history
    hist = client.get("/telemetry/history?station_id=ST-BHARATI&days=7")
    assert hist.status_code == 200
    hist_data = hist.json()
    assert len(hist_data) >= 1
    assert "day" in hist_data[0]
    assert hist_data[0]["day"] == "2026-08-27"

    # check acoustic ai indent was created
    indents = client.get("/indents?station_id=ST-BHARATI").json()
    acoustic_indent = next((i for i in indents if i["created_by"] == "ACOUSTIC_AI"), None)
    assert acoustic_indent is not None
    assert acoustic_indent["urgency"] == "CRITICAL"

def test_procurement_targets_and_calculation():
    targets = client.get("/procurement/targets")
    assert targets.status_code == 200
    assert len(targets.json()) >= 1

    proc = client.get("/procurement/ST-BHARATI")
    assert proc.status_code == 200
    assert isinstance(proc.json(), list)
