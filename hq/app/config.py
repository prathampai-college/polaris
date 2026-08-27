DEMO_FORECAST = {
    "baseline": {"days": 42, "ci": [38, 47]},
    "blizzard": {"days": 18, "ci": [15, 22]},
}
ALLOWED = {
    "DRAFT": ["APPROVED"],
    "APPROVED": ["DISPATCHED"],
    "DISPATCHED": ["RECEIVED"],
}
