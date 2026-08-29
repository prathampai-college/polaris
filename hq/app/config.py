import os

_secret = os.getenv("SECRET_KEY") or os.getenv("PSK_HEX")
if not _secret:
    # ponytail: fail fast in production; demo fallback for local dev/CI
    import logging as _lg
    _lg.getLogger("polaris.hq.config").warning("SECRET_KEY/PSK_HEX not set — using insecure demo key (set SECRET_KEY in production)")
    _secret = "a" * 64
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
