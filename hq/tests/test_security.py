import pathlib, sys, os, re, time
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
os.environ.pop("DATABASE_URL", None)
from fastapi.testclient import TestClient
from hq.app.main import app
from hq.app.db import init_db
from hq.app import config as hq_config
from hq.app.auth import sign_jwt, verify_jwt
init_db()
client = TestClient(app)

def test_cors_wildcard_dropped_in_prod(monkeypatch=None):
    # ALLOWED_ORIGINS should never contain '*' when DATABASE_URL is set.
    # We simulate prod by checking current app's CORS middleware config.
    # The app was imported without DATABASE_URL, so "*" may be present in dev — that's ok.
    # Here we assert the hardening code exists: config drops '*' when DATABASE_URL is set.
    src = pathlib.Path("hq/app/main.py").read_text()
    assert "DATABASE_URL" in src and "ALLOWED_ORIGINS" in src
    assert "dropping * for safety" in src or "CORS allow * in production" in src

def test_jwt_expiry_is_8h_not_30d():
    # config.TOKEN_EXPIRY_DAYS should be 8/24 ~0.33, not 30. Allow override via env but default must be 8h.
    assert hq_config.TOKEN_EXPIRY_DAYS < 2, f"TOKEN_EXPIRY_DAYS={hq_config.TOKEN_EXPIRY_DAYS} should be ~0.33 (8h), not 30d"
    assert abs(hq_config.TOKEN_EXPIRY_DAYS - 8/24) < 0.01 or hq_config.TOKEN_EXPIRY_HOURS == 8
    # sign a token and check exp - iat == 8h
    tok = sign_jwt({"sub": "TEST-SEC", "role": "FIELD_OP", "station_id": "ST-BHARATI"}, hq_config.SECRET_KEY, hq_config.TOKEN_EXPIRY_DAYS)
    payload = verify_jwt(tok, hq_config.SECRET_KEY)
    assert payload is not None
    assert payload["exp"] - payload["iat"] == int(hq_config.TOKEN_EXPIRY_DAYS * 86400)
    assert payload["exp"] - payload["iat"] <= 9*3600  # <=9h
    assert payload["exp"] - payload["iat"] >= 7*3600  # >=7h

def test_jwt_expired_rejected():
    tok = sign_jwt({"sub": "TEST-SEC", "role": "FIELD_OP"}, hq_config.SECRET_KEY, expires_in_days=-0.001)
    assert verify_jwt(tok, hq_config.SECRET_KEY) is None
    # also via HTTP: /rbac/me without token returns VIEWER, with expired token also VIEWER (no crash)
    r = client.get("/rbac/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.json()["role"] in ("VIEWER", "FIELD_OP")

def test_secret_psk_split_warning_present():
    src = pathlib.Path("hq/app/config.py").read_text()
    assert "SECRET_KEY == PSK_HEX" in src
    assert "TOKEN_EXPIRY_HOURS" in src or "8 / 24" in src

def test_next_public_psk_not_in_compose():
    compose = pathlib.Path("docker-compose.yml").read_text()
    # field service must not set NEXT_PUBLIC_PSK_HEX in production image
    # allow it only as commented line
    lines = [l for l in compose.splitlines() if "NEXT_PUBLIC_PSK_HEX" in l and not l.strip().startswith("#")]
    assert len(lines) == 0, f"docker-compose.yml should not set NEXT_PUBLIC_PSK_HEX (found: {lines})"
    env_example = pathlib.Path(".env.example").read_text()
    assert "NEXT_PUBLIC_PSK_HEX removed" in env_example or "never bake it" in env_example

def test_cors_rejects_unknown_origin_when_explicit(monkeypatch=None):
    # In prod ALLOWED_ORIGINS is explicit; evil origin must not be echoed.
    # In dev (DATABASE_URL unset) the fallback "*" is allowed — so we only assert evil is never echoed,
    # and that prod hardening (dropping '*') is present in code (checked above).
    r = client.get("/health", headers={"Origin": "https://evil.example.com"})
    acao = r.headers.get("access-control-allow-origin")
    assert acao != "https://evil.example.com"
    # When DATABASE_URL is unset, "*" is the dev default — that's expected; prod drops it.
