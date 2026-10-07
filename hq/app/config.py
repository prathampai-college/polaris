import os, json

_psk = os.getenv("PSK_HEX")
_secret = os.getenv("SECRET_KEY")
if not _secret:
    if os.getenv("DATABASE_URL"):
        import logging as _lg
        _lg.getLogger("polaris.hq.config").warning("SECRET_KEY not set in production — using insecure demo key (set distinct SECRET_KEY; PSK is wire AES, JWT must be separate)")
    elif not _psk:
        import logging as _lg
        _lg.getLogger("polaris.hq.config").warning("SECRET_KEY/PSK_HEX not set — using insecure demo key (set SECRET_KEY in production)")
    _secret = _psk if _psk else "a" * 64
# Phase 5 hardening: SECRET_KEY must differ from PSK_HEX in production
if _psk and _secret == _psk and os.getenv("DATABASE_URL"):
    import logging as _lg2
    _lg2.getLogger("polaris.hq.config").warning("SECRET_KEY == PSK_HEX in production — set distinct SECRET_KEY (PSK is wire AES, JWT must be separate)")
# POLARIS_ENV=production turns the warnings above into a refusal to boot: a
# known or shared JWT key lets anyone mint an NCPOR_ADMIN token.
PRODUCTION = os.getenv("POLARIS_ENV", "").lower() == "production"
if PRODUCTION:
    _weak = {"", "a" * 64, _psk or ""}
    if not os.getenv("SECRET_KEY") or os.getenv("SECRET_KEY") in _weak or len(os.getenv("SECRET_KEY")) < 32:
        raise RuntimeError("POLARIS_ENV=production: set SECRET_KEY (>=32 chars, not the demo key, not PSK_HEX)")
    if not _psk or _psk == "a" * 64:
        raise RuntimeError("POLARIS_ENV=production: set PSK_HEX (64 hex, not the demo key)")
    if not os.getenv("STATION_PINS_JSON"):
        raise RuntimeError("POLARIS_ENV=production: set STATION_PINS_JSON (the built-in *-2024 PINs are public)")
SECRET_KEY = _secret
# JWT expiry: 8h default (was 30d). TOKEN_EXPIRY_HOURS wins over TOKEN_EXPIRY_DAYS for clarity.
if os.getenv("TOKEN_EXPIRY_HOURS"):
    TOKEN_EXPIRY_DAYS = int(os.getenv("TOKEN_EXPIRY_HOURS")) / 24
elif os.getenv("TOKEN_EXPIRY_DAYS"):
    TOKEN_EXPIRY_DAYS = float(os.getenv("TOKEN_EXPIRY_DAYS"))
else:
    TOKEN_EXPIRY_DAYS = 8 / 24  # 8h
TOKEN_EXPIRY_HOURS = int(round(TOKEN_EXPIRY_DAYS * 24))

ALLOWED = {
    "DRAFT": ["APPROVED"],
    "APPROVED": ["DISPATCHED"],
    "DISPATCHED": ["RECEIVED"],
}

# Demo PINs; override with STATION_PINS_JSON='{"ST-BHARATI": "..."}' (required in production).
STATION_PINS = json.loads(os.getenv("STATION_PINS_JSON") or "null") or {
    "ST-BHARATI": "BHARATI-2024",
    "ST-MAITRI": "MAITRI-2024",
    "ST-HIMADRI": "HIMADRI-2024",
}
