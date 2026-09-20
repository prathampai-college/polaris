# POLARIS — Polar Logistics & Survival Engine

> **Problem Statement (exact):** "Develop a centralized digital platform for expedition planning, cargo tracking, inventory management, personnel movement and emergency response."

**SIH26062 · Integrated Polar Expedition Logistics for NCPOR/MoES** — Bharati (69°24′S 76°11′E), Maitri (70°45′S 11°44′E), Himadri (78°55′N 11°56′E). Built to run when everything else struggles: −40°C, months of winter isolation, and 20–50 kbps Iridium links that drop for hours.

`docker compose up` brings up field tablets, the sync gateway, and HQ dashboards. Turn WiFi off and it still works. `PITCH_DECK.md` has the 3.5-minute demo walkthrough.

---

## Why POLARIS

Antarctic and Arctic stations cannot afford a missed shipment. A stockout of diesel or oxygen during polar night is not an inventory issue — it is a survival issue. NCPOR teams plan from Goa and depend on the same system to track every crate from port to station, know what is low before it is critical, keep crews safe outside, and respond fast when something goes wrong.

POLARIS replaces spreadsheets, scattered trackers, and informal radio checks with one place to:

- **Plan expeditions centrally** — Antarctic and Arctic programs, voyage legs, shipment manifests, and stowage, all offline-capable.
- **Track every crate** — from Goa through Mumbai and Cape Town to the right station and container bay, with cold-chain and customs checks that actually block.
- **Know what to order** — database-driven targets, per-station burn models, and a clear 60-day watch window.
- **Keep people safe** — field sorties in buddy pairs, live local positions without GPS, and a triage flow that never loses track of an emergency.
- **Keep data moving without internet** — store-and-forward bundles that travel by person or vehicle and sync when a link returns.

If you run a station, dispatch from HQ, or lead a field party, POLARIS is designed for you.

---

## What it covers

| Need | How POLARIS helps |
|------|-------------------|
| **Expedition planning** | Create ANTARCTIC/ARCTIC expeditions, add voyage legs (validated for route, dates, and vessel overlap), import AL-1403-style manifests, run auto-pack stowage, and check readiness + cost before sailing. |
| **Cargo tracking** | Custody flows Goa → Mumbai → Cape Town → Vessel → Station → Crate. Cold and hazmat goods are blocked if sent to the wrong container. Every item prints a scannable label. |
| **Inventory** | Lot-level stock with earliest-expiry-first (FEFO) consumption. Bulk import via CSV, synced across stations even offline. `GET /lots` shows what is really on the shelf. |
| **Personnel movement** | Station rosters tagged ANTARCTIC/ARCTIC/BOTH. Sorties require a buddy (solo needs a STATION_LEAD override and leaves an audit trail). Positions show as live dots on a local map that does not need GPS. |
| **Emergency response** | One-tap SOS through ACTIVE → ACK → RESPONDING → RESOLVED with SLA timers, watchdog alerts, and automatic medevac tasking for medical cases. Every override is logged. |

All five areas work offline first, stay audited, and converge cleanly when links return.

---

## Architecture at a glance

```
ANTARCTICA — field tablet (offline-first)          thin satellite / DTN           INDIA — HQ
┌──────────────────────────────┐                   msgpack + AES-GCM + VC        ┌────────────────────────┐
│ Next.js PWA · Workbox cache  │ ◄────────── websocket / DTN mule ───────────► │ FastAPI + Postgres     │
│ SQLite WASM (OPFS/WAL)       │  deltas + custody bundles + vector clocks     │ TimescaleDB · RBAC     │
│  outbox · dtn_bundles ·      │ ─────────────────────────────────────────────► │ procurement targets    │
│  asset_positions · lots      │ ◄────────── downstream deltas ─────────────── │ physics · vessels ·    │
│  local fusion 40×40 2m/grid  │                                               │ SNN · forecasting      │
└──────────────────────────────┘                                                 └────────────────────────┘
         ▲ sensors: LiDAR 360pt + camera → Kalman → local [x,y]                   ▲ pollers: weather
         └ SNN 0.8mW idle · DTN bundle QR/BroadcastChannel                          └ AIS · burn model
```

- **One language at the edge** — TypeScript on the tablet, gateway, and SNN engine. Python stays at HQ and training where it makes sense.
- **One schema everywhere** — `shared/sql/schema.sql` is the source of truth, mirrored into the browser bundle (`field/lib/db.ts`) and adapted for Postgres in `hq/app/db.py`.
- **No hidden mocks** — every fallback (AIS schedule, physics residual, weather cache) shows a badge with age and reason: `LIVE · 12s` / `STALE · 4h` / `MOCK SCHEDULE` / `OFFLINE`.

Details live in `docs/ARCHITECTURE.md` and `docs/API.md`.

### Three edge pillars

1. **Local tracking without GPS** (`field/lib/sensors/fusion.ts`, `shared/src/local_map.ts`) — 2D LiDAR + camera fused on a 40×40 grid (2 m cells) into a Kalman-filtered `[x,y,theta]`. Camera goes blind in whiteout; LiDAR keeps tracking. Error stays under 0.8 m.
2. **Neuromorphic forecasting** (`field/lib/snn/engine.ts`, `hq/app/snn_forecast.py`) — snnTorch LIF `5→32→16→1` with rate-coded spikes (`T=20`). It only fires when inputs change meaningfully, idling near 0.8 mW. A watts pill in the UI shows what it saved.
3. **Delay-tolerant sync** (`field/lib/dtn/mule.ts`, `shared/src/dtn/vector_clock.ts`) — bundles with custody travel over BroadcastChannel or QR codes, ingested via `POST /dtn/ingest_bulk`, merged with vector-clock + wall-clock LWW. Nothing is lost during blackouts.

---

## Quick start

**Requirements:** Node 20+, Python 3.11+, Docker Desktop (optional but recommended). No cloud account needed.

### 1. Install

```powershell
git clone https://github.com/prathampai-college/polaris.git; cd polaris
npm install --prefix shared; npm run build --prefix shared
npm install --prefix sync-gateway
npm install --prefix field
npm install --prefix hq-dashboard
pip install -r hq/requirements.txt
# optional: SNN training (CPU) — skip and the JS fallback still works
pip install -r ai/requirements.txt; python ai/snn/train_snn.py
```

### 2. Configure

```powershell
Copy-Item .env.example .env
# generate a per-station key + QR:
node scripts/provision_station.mjs ST-BHARATI --qr
```

Key settings in `.env` (all have safe defaults for local dev):

| Variable | What it does |
|----------|--------------|
| `PSK_HEX` | 32-byte hex wire key (AES-GCM). Keep it unique per station. |
| `SECRET_KEY` | 32-byte hex JWT key. Must differ from `PSK_HEX` in production. |
| `DATABASE_URL` | Postgres URL. Leave empty for the SQLite fallback `hq/app/hq.db`. |
| `NEXT_PUBLIC_HQ_URL` / `NEXT_PUBLIC_GATEWAY_URL` | Tablet → HQ / gateway addresses. Runtime falls back to `window.location.hostname` on LAN. |
| `TELEMETRY_SOURCE` | `both` (Open-Meteo free + optional IMD), `openmeteo`, `imd`, or `sim`. |
| `LIVE_WEATHER_ENABLED` / `LIVE_AIS_ENABLED` | Master switches for live feeds. Off still works with cached data. |
| `AIS_API_KEY` / `VESSEL_MODE` | AISHub key and `auto`/`live`/`mock` mode. |

In production, remove `NEXT_PUBLIC_PSK_HEX` — tablets receive the key by scanning a QR code into IndexedDB.

### 3a. Run with Docker (recommended)

```powershell
docker compose up --build
# field       → http://localhost:3000
# dashboard   → http://localhost:3001
# gateway     → ws://localhost:8787
# HQ API      → http://localhost:8000
# turn WiFi off and the PWA keeps working — Workbox cache + OPFS + DTN custody
```

### 3b. Run without Docker (SQLite fallback, good for CI)

```powershell
python -m uvicorn hq.app.main:app --port 8000
$env:HQ_URL="http://localhost:8000"; $env:GATEWAY_PORT="8787"; node sync-gateway/dist/gateway.js
npm --prefix field run dev          # :3000
npm --prefix hq-dashboard run dev   # :3001
```

### 4. Import inventory

```powershell
curl http://localhost:8000/assets/bulk/template -o template.csv
node scripts/import_inventory.mjs --file scripts/template_inventory.csv --hq http://localhost:8000 --pin BHARATI-2024
```

Or POST as `NCPOR_ADMIN` to `/assets/bulk` (see API below). The 20-SKU seed is only used when the database is empty.

---

## Using it

### Field tablet — `:3000` (5 tabs)

- **Today** — forecast days-to-stockout with confidence bands, SNN watts pill, freshness badge, vessel ETA, and three telemetry buttons (calm / blizzard / acoustic anomaly) that push to `/telemetry`.
- **Inventory** — searchable by SKU, name, crate, or barcode. `CONSUME` uses `BEGIN IMMEDIATE` and lot-level FEFO, so the earliest-expiring lot is used first. Expired medical/oxygen/food needs an explicit override.
- **Scan** — `html5-qrcode` at 12 fps + manual entry + preset chips. Scans resolve locally via `getAssetByBarcode`.
- **Indents** — create `DRAFT` requests, follow `DRAFT → APPROVED → DISPATCHED → RECEIVED` strictly, and see vessel linkage when dispatched. Downstream pushes arrive via `SYNC_INIT_RESP` and `DOWNSTREAM_DELTA`.
- **Locate** — toggle `LOCAL` vs `GPS`. `GPS` intentionally shows "Unavailable — ionospheric whiteout." `LOCAL` shows the occupancy canvas, fused position dots (cyan = personnel, teal/amber = cargo confidence), and buddy lines. Fusion loops every 3 s with a 15% whiteout chance to prove LiDAR carries tracking alone.

A **sync drawer** shows `sent / acked / deduped / saving %`, plus DTN custody counts with Export QR, Import QR, and Push Bundles.

**Login:** pick a station, enter device ID + PIN (`BHARATI-2024`). New devices start as `FIELD_OP`; `STATION_LEAD`/`NCPOR_ADMIN` requires a device ID containing `ADMIN`, `LEAD`, `TEST`, or `HQ`.

### HQ dashboard — `:3001` (7 tabs)

- **Fleet Overview** + **Thermo Forecast** — five KPIs, a physics+residual burn card (42 → 18 days in a blizzard), and per-station cards backed by `GET /stations/overview` and `GET /forecast/snn/{station}`.
- **Inventory / Indent Workbench / Trends / Procurement / Audit** — honest empty states (no dummy chart), database-driven `need = max(0, target − qty)` needs with cost, indent approval with automatic vessel attachment, and an append-only audit feed.
- **3D Twin + Vessel Tracker** — Leaflet map that probes tiles and falls back to a schematic with an ETA pill when offline. Vessel rows show `LIVE AIS · Ns ago` / `MOCK SCHEDULE` badges. SSE on `/telemetry/stream` with an 8 s poll fallback keeps it live.

---

## Configuration reference

All variables are documented in `.env.example` and validated on startup (`hq/app/config.py`).

```
PSK_HEX=...            # 64 hex chars, per-station wire key
SECRET_KEY=...         # 64 hex chars, JWT HMAC (≠ PSK_HEX in prod)
DATABASE_URL=          # postgres://… or empty → SQLite WAL
TELEMETRY_SOURCE=both
LIVE_WEATHER_ENABLED=true
IMD_API_KEY=           # optional
AIS_API_KEY=           # optional, else schedule interpolation
VESSEL_MODE=auto       # auto|live|mock
LIVE_AIS_ENABLED=false
VESSEL_POLL_SEC=900
TELEMETRY_POLL_SEC=900
NEXT_PUBLIC_HQ_URL=http://localhost:8000
NEXT_PUBLIC_GATEWAY_URL=ws://localhost:8787
ALLOWED_ORIGINS=*      # restrict in prod
TOKEN_EXPIRY_HOURS=8
```

---

## API quick reference

Base `http://localhost:8000` (`hq:8000` in Docker). Full spec in `docs/API.md`.

| Area | Endpoints |
|------|-----------|
| **Health / auth** | `GET /health` · `POST /auth/login` · `GET /rbac/me` |
| **Assets / lots** | `GET /assets` · `GET /assets/bulk/template` · `POST /assets/bulk` · `GET /lots` |
| **Indents** | `GET /indents?station_id=` · `POST /indents` · `PATCH /indents/{id}` |
| **Stations / forecast** | `GET /stations/overview` · `GET /forecast/{station}` · `GET /forecast/snn/{station}` · `GET /physics/{station}` |
| **Procurement** | `GET /procurement/targets` · `PUT /procurement/targets/{sku}` · `GET /procurement/{station}` · `GET /procurement/mutual-aid` |
| **Vessels** | `GET /vessels?station_id=` · `GET /vessels/{imo}` · `GET /vessels/sources` |
| **Telemetry** | `POST /telemetry` · `GET /telemetry/latest` · `GET /telemetry/history` · `GET /telemetry/sources` · `GET /telemetry/stream` (SSE) |
| **Tracking** | `POST /tracking/update` · `GET /tracking/positions` · `POST /tracking/personnel` · `GET /tracking/personnel` |
| **People & safety** | `GET/POST /personnel` · `GET/POST /sorties` · `PATCH /sorties/{id}` · `POST /sorties/check-overdue` · `GET /emergencies` · `POST /emergency/sos` · `PATCH /emergency/{id}` |
| **Expeditions** | `GET/POST /expeditions` · `PATCH /expeditions/{id}` · `GET/POST /expeditions/{id}/legs` · `GET/POST /expeditions/{id}/manifests` · `PATCH /expeditions/{id}/manifests/{mid}` · `POST /expeditions/{id}/manifests/bulk` · `POST /expeditions/{id}/auto-pack` · `GET /expeditions/{id}/readiness` · `GET /expeditions/{id}/cost` · `GET /expeditions/manifests/template` · `GET /freight_rates` · `PUT /freight_rates/{mode}` |
| **DTN / sync** | `POST /dtn/ingest_bulk` · `GET /dtn/bundles` · `GET /dtn/conflicts` · `POST /dtn/exchange` · `POST /sync/ingest` · `GET /sync/state/{device_id}` · `GET /timeline` · `GET /overrides` |

Examples:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/assets | jq '.[0] | {sku,qty,station_id}'
curl http://localhost:8000/forecast/snn/ST-BHARATI | jq '.days_to_stockout, .snn_active'
curl http://localhost:8000/vessels?station_id=ST-BHARATI | jq
curl http://localhost:8000/dtn/bundles | jq
```

Every write is appended to `audit_log` and deduplicated by ULID + vector clock.

---

## How it stays reliable

- **Sync wire** (`shared/src/wire.ts`, `shared/src/codec.web.ts`) — msgpack + CRC32 framing + AES-GCM (`[CRC][nonce‖cipher‖tag]`), ULID + vector clock, `MAX_WIRE_SIZE` 2048. Patch-only updates save ~95% vs full rows; `SyncWorker` drains `PENDING|SENT|BUNDLED` every 2 s with `PING/PONG` keepalive. Offline writes become `BUNDLED` custody and are retried on reconnect.
- **Forecasting** (`hq/app/forecast.py`) — per-station `physics_params` + ONNX residual (`ai/thermo_residual.onnx` 2 KB, <200 ms). Falls back to `5*dg + 0.3*crew − 2` if the model is absent. `scripts/calibrate_physics.py` fits coefficients over 30 days of burn.
- **Vessels** (`hq/app/vessel_poller.py`) — tries AISHub (`data.aishub.net`) then interpolates `shared/vessel_schedule.json` on `429`/no-key. HQ pushes `DOWNSTREAM_DELTA vessels` through the gateway; the field applies it offline.
- **Weather** (`hq/app/telemetry_poller.py`) — Open-Meteo (free, no key) with optional IMD, every 15 min. `GET /telemetry/sources` shows health; `LIVE_WEATHER_ENABLED=false` forces sim mode. Ranges drive the forecast (calm −15°C → ~42 days, blizzard −38°C → ~18 days, both checked by `m3_verify`).

---

## Testing

```powershell
# fast — no Docker needed
python -m pytest hq/tests -q                 # 42 tests, SQLite fallback
npm --prefix shared test                     # codec roundtrip + schema
npm --prefix sync-gateway test               # wire + throttle
npx tsc -p shared/tsconfig.json --noEmit; npx tsc -p field/tsconfig.json --noEmit

# chaos + edge pillars
node scripts/m1_verify.mjs   # offline WAL → dedupe + replay + budgets
node scripts/m2_verify.mjs   # QR → consume → indent lifecycle + vessel
node scripts/m3_verify.mjs   # ONNX <2MB <200ms, 42→18d, auto indent
node scripts/m4_verify.mjs   # 20kbps/500ms/5% throttle, RBAC, AES, WAL
node scripts/m5_verify.mjs   # air-gapped compliance
node scripts/dtn_verify.mjs && node scripts/snn_verify.mjs && node scripts/tracking_verify.mjs

# all at once
npm run verify              # m1→m5
npm run verify:extreme      # shared + hq + dtn/snn/tracking
npm run verify:all          # everything

# Docker E2E
docker compose up --build; pytest hq/tests -k e2e; docker compose down -v
```

Budgets enforced in CI: polaris.db <5 MB at 10k transactions, wire frames <2 KB, ONNX <2 MB, throttle convergence <5 s.

---

## Project layout

```
shared/            @polaris/shared — schema, codec, DTN, local_map, SNN config
field/             Next.js PWA :3000 — 5 tabs, OPFS/WAL, fusion loop, DTN QR
sync-gateway/      Node gateway :8787 — WS + CRC/AES/VC + /sync/ingest + DTN exchange
hq/                FastAPI :8000 — forecast, procurement, vessels, telemetry, DTN, RBAC
hq-dashboard/      Next.js SOC :3001 — fleet, trends, procurement, Leaflet vessel map
ai/                training + ONNX (thermo_residual + thermo_snn) + SNN encoder
scripts/           m1…m5 + dtn/snn/tracking verifies, harness, provision, import, calibrate
docs/              ARCHITECTURE.md · API.md · VERIFY_BASELINE.md
```

---

## Production deployment

- `docker compose up --build` — TimescaleDB + HQ + gateway + field + dashboard. First boot seeds procurement targets, physics params, 20 SKUs, and 3 vessels.
- **Air-gapped:** Workbox precaches the PWA, Leaflet falls back to a schematic ETA pill, `/tmp/ais_cache.json` keeps last vessel positions, and DTN bundles survive restarts in WAL.
- **Data plane is always real:** procurement reads `procurement_targets`, weather comes from live polling (or cached stale), physics is per-station (`GET /physics/{station}`), vessels are live or honestly labeled `MOCK SCHEDULE`, and trends show an empty state instead of dummy data.
- **LAN tablets:** build with `NEXT_PUBLIC_HQ_URL=http://<LAN-IP>:8000` or rely on `window.location.hostname` fallback.

---

## Troubleshooting

| You see | What it means | Fix |
|---------|---------------|-----|
| `station_id` missing on assets | Old `hq/app/hq.db` before migration | Delete `hq/app/hq.db*` and restart HQ — `init_db` recreates and seeds. |
| Empty chart / no telemetry | No data yet | POST one row to `/telemetry` or wait 15 min for the poller. |
| `403` on `PUT /procurement/targets` or `POST /assets/bulk` | Need `STATION_LEAD` / `NCPOR_ADMIN` | Log in with a device containing `ADMIN` or `LEAD` (e.g. `HQ-ADMIN-01`). |
| `GET /vessels` is `source:mock` | No live AIS | Check `GET /vessels/sources` reason (`no_key`/`429`/`forced_mock`), set `AIS_API_KEY` + `LIVE_AIS_ENABLED=true` if you want live data. |
| Field says synced but HQ empty | PSK mismatch | Make sure field, gateway, and HQ share the same 64-hex `PSK_HEX`. |
| SNN never `active` | No significant input change | Post blizzard telemetry (`-38,22,960`) — calm repeats staying idle means the event gate is working. |
| GPS card always red | Whiteout mode | Toggle to `LOCAL` — LiDAR tracks alone at `err <0.8m`. |

Logs: HQ tags requests with `X-Request-ID`, the gateway logs `jsonBytes vs mpBytes` and vector clocks, and the field sync drawer shows `sent / acked / deduped / bundled`.

---

## Feasibility & pitch

- `COST_FEASIBILITY.md` — reuses the tablet, HQ VM, and Iridium link already on station. No new hardware.
- `PITCH_DECK.md` — the 3.5-minute story: a blizzard cut (bundle QR vs websocket), a stockout cut (42→18 days + SNN watts), and a vessel cut (mock-to-live with ETA pill).

## License

MIT — for NCPOR/MoES evaluation.

