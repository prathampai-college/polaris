# Fallback video recording (run if live demo fails at venue)
# Records both demos side-by-side via ffmpeg or OBS. Minimal: screen cap 3.5min.

# 1. Start stack air-gapped
# docker compose up --build
# or local: python -m uvicorn hq.app.main:app --port 8000 & node sync-gateway/dist/gateway.js & npm --prefix field run dev & npm --prefix hq-dashboard run dev

# 2. Record Demo 1 — Blizzard cut (90s)
# - Throttle Chrome DevTools Network 20kbps 500ms 5% loss
# - Scan 5 QR on field tablet (rugged Android or emulator)
# - Show outbox PENDING 5, gateway log msgpack 70-80% saving, CRC, dedupe replay
# ffmpeg -f gdigrab -framerate 30 -i desktop -c:v libx264 fallback_blizzard.mp4

# 3. Record Demo 2 — Forecast 42→18d (60s)
# - HQ dashboard calm 42d (95% CI 38-47)
# - Run: curl -X POST http://localhost:8000/telemetry -d '{"ts":"...","station_id":"ST-BHARATI","temp_outside":-38,"wind_speed":22,"pressure":960,"dg_load":0.9}'
# - Show tick to 18d CI 15-22 + auto CRITICAL indent, toggle ML off → physics 21d

# 4. Save to /fallback/ and embed in deck
Write-Host "Fallback script ready — pre-recorded video at fallback/*.mp4 per PLAN M5"
