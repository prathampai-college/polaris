import os

SECRET_KEY = os.getenv("SECRET_KEY", "a" * 64)
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
