# Each pytest session gets a fresh SQLite file so tests never read (or tamper
# with) the dev database at hq/app/hq.db. Runs before test modules import the app.
import os, tempfile, pathlib

os.environ.pop("DATABASE_URL", None)
os.environ["HQ_DB_PATH"] = str(pathlib.Path(tempfile.mkdtemp(prefix="polaris-test-")) / "hq.db")

# Writes now need a JWT. Every TestClient gets an admin token by default; auth
# tests opt out with TestClient(app, headers={"Authorization": ""}).
from fastapi.testclient import TestClient  # noqa: E402
from hq.app.auth import sign_jwt  # noqa: E402
from hq.app.config import SECRET_KEY  # noqa: E402

ADMIN = {"Authorization": "Bearer " + sign_jwt({"sub": "TEST-ADMIN", "device_id": "TEST-ADMIN", "role": "NCPOR_ADMIN", "station_id": "ST-BHARATI"}, SECRET_KEY, 1)}
_orig_init = TestClient.__init__


def _init(self, app, *a, headers=None, **k):
    _orig_init(self, app, *a, headers={**ADMIN, **(headers or {})}, **k)


TestClient.__init__ = _init
