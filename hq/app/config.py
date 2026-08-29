import os

_secret = os.getenv("SECRET_KEY") or os.getenv("PSK_HEX")
_psk = os.getenv("PSK_HEX")
if not _secret:
    import logging as _lg
    _lg.getLogger("polaris.hq.config").warning("SECRET_KEY/PSK_HEX not set — using insecure demo key (set SECRET_KEY in production)")
    _secret = "a" * 64
# Phase 1.4: warn if SECRET_KEY == PSK_HEX in production (DATABASE_URL set)
if _psk and _secret == _psk and os.getenv("DATABASE_URL"):
    import logging as _lg2
    _lg2.getLogger("polaris.hq.config").warning("SECRET_KEY == PSK_HEX in production — set distinct SECRET_KEY (PSK is wire AES, JWT must be separate)")
SECRET_KEY = _secret
TOKEN_EXPIRY_DAYS = int(os.getenv("TOKEN_EXPIRY_DAYS", "30"))

DEMO_FORECAST = {
    "baseline": {"days": 42, "ci": [38, 47]},
    "blizzard": {"days": 18, "ci": [15, 22]},
}
ALLOWED = {
    "DRAFT": ["APPROVED"],
    "APPROVED": ["DISPATCHED"],
    "DISPATCHED": ["RECEIVED"],
}

STATION_PINS = {
    "ST-BHARATI": "BHARATI-2024",
    "ST-MAITRI": "MAITRI-2024",
    "ST-HIMADRI": "HIMADRI-2024",
}
