import pathlib, sys, os
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
os.environ.pop("DATABASE_URL", None)
from fastapi.testclient import TestClient
from hq.app.main import app
from hq.app.db import init_db
init_db()
client = TestClient(app)

def test_vessel_sources():
    r = client.get("/vessels/sources")
    assert r.status_code == 200
    data = r.json()
    assert "mode" in data
    assert "poll_interval_sec" in data

def test_vessel_poll_and_list():
    r_poll = client.post("/vessels/poll")
    assert r_poll.status_code == 200
    poll_data = r_poll.json()
    assert "source" in poll_data

    r = client.get("/vessels")
    assert r.status_code == 200
    vessels = r.json()
    assert isinstance(vessels, list)
    assert len(vessels) >= 1
    v0 = vessels[0]
    assert "imo" in v0
    assert "name" in v0
    assert "lat" in v0
    assert "lon" in v0

    imo = v0["imo"]
    r_single = client.get(f"/vessels/{imo}")
    assert r_single.status_code == 200
    assert r_single.json()["imo"] == imo

def test_physics_params_endpoint():
    r = client.get("/physics/params/ST-BHARATI")
    assert r.status_code == 200
    p = r.json()
    assert "T_INSIDE" in p
    assert "BASE" in p
    assert "K1" in p
    assert "K2" in p
    assert "K3" in p

def test_telemetry_sources():
    r = client.get("/telemetry/sources")
    assert r.status_code == 200
    data = r.json()
    assert "source_setting" in data
    assert "coords" in data

def test_asset_template_csv():
    r = client.get("/assets/template.csv")
    assert r.status_code == 200
    assert "sku,name,category,qty,unit" in r.text
