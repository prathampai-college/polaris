import pathlib, sys, os
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
os.environ.pop("DATABASE_URL", None)  # force SQLite fallback for CI
from fastapi.testclient import TestClient
from hq.app.main import app
from hq.app.db import init_db, get_conn
init_db()
client = TestClient(app)

def test_tracking_update():
    r = client.post("/tracking/update", json={
        "asset_id": "A1", "x": 12.5, "y": 7.25, "theta": 1.57,
        "conf": 0.79, "station_id": "ST-BHARATI"})
    assert r.status_code == 200
    assert r.json()["asset_id"] == "A1"
    pos = client.get("/tracking/positions?station_id=ST-BHARATI").json()
    a1 = next((p for p in pos if p["asset_id"] == "A1"), None)
    assert a1 is not None
    assert abs(a1["x"] - 12.5) < 1e-6
    assert abs(a1["conf"] - 0.79) < 1e-6

def test_local_map_import():
    # check shared local_map exists via python? just check file
    p = pathlib.Path(__file__).parent.parent.parent / "shared" / "src" / "local_map.ts"
    assert p.exists()

def test_asset_positions_table():
    from hq.app.db import init_db
    init_db()
    tables = {r[0] for r in get_conn().execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert "asset_positions" in tables
    # not strict — just check schema contains
    import pathlib
    schema = (pathlib.Path(__file__).parent.parent.parent / "shared" / "sql" / "schema.sql").read_text()
    assert "asset_positions" in schema
    assert "dtn_bundles" in schema
