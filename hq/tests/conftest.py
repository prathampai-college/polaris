# Each pytest session gets a fresh SQLite file so tests never read (or tamper
# with) the dev database at hq/app/hq.db. Runs before test modules import the app.
import os, tempfile, pathlib

os.environ.pop("DATABASE_URL", None)
os.environ["HQ_DB_PATH"] = str(pathlib.Path(tempfile.mkdtemp(prefix="polaris-test-")) / "hq.db")
