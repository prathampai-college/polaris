# POLARIS — Polar Logistics & Survival Engine

> **Problem statement (exact):** "Develop a centralized digital platform for expedition planning, cargo tracking, inventory management, personnel movement and emergency response."

**SIH26062 · Integrated Polar Expedition Logistics for NCPOR/MoES.** Covers Bharati (69°24′S 76°11′E), Maitri (70°45′S 11°44′E) and Himadri (78°55′N 11°56′E). It is built for stations that spend months in isolation on 20–50 kbps satellite links that drop for hours.

`docker compose up` starts the field tablet app, the sync gateway, HQ, the HQ dashboard and the database. The tablet keeps working with no link and syncs when one returns. `PITCH_DECK.md` has the demo walkthrough.

> **New to the code?** Read [docs/START_HERE.md](docs/START_HERE.md) first (15 min), then the guide for your part:
> [field](docs/guide/01-field.md) · [hq](docs/guide/02-hq.md) · [gateway](docs/guide/03-gateway.md) · [shared](docs/guide/04-shared.md) · [hq-dashboard](docs/guide/05-hq-dashboard.md) · [website](docs/guide/06-website.md) · [ai, scripts & tests](docs/guide/07-ai-scripts-tests.md)

---

## What it covers

| Need | How POLARIS handles it |
|------|------------------------|
| **Expedition planning** | ANTARCTIC and ARCTIC expeditions, voyage legs (route, dates and vessel overlap validated), manifest import, auto-pack stowage, readiness and cost (HQ dashboard + API). |
| **Cargo tracking** | Manifest custody GOA → MUMBAI → CAPETOWN → VESSEL → STATION → CRATE, with customs and biosecurity gates at HQ. The tablet's Cargo screen advances stages and prints QR labels. |
| **Inventory** | Lot-level stock with earliest-expiry-first (FEFO) consumption on the tablet. Expired stock is blocked for CONSUME unless a station lead overrides it. Bulk CSV import at HQ. |
| **Personnel movement** | Station rosters and a muster board. Sorties need a buddy; a solo sortie needs a STATION_LEAD override and is audited. The HQ watchdog flags overdue sorties and auto-raises an SOS once one is 30 minutes late. |
| **Emergency response** | Hold-to-transmit SOS with a required location, logged on the tablet first. Triage runs ACTIVE → ACK → RESPONDING → RESOLVED, with SLA timers at HQ. Other tablets at the station are alerted when the SOS reaches HQ. |

---

## Architecture at a glance

```
FIELD TABLET (offline-first PWA)            SYNC GATEWAY :8787                 HQ :8000
┌───────────────────────────────┐   WS     ┌────────────────────┐  HTTP   ┌──────────────────────┐
│ Next.js 14 routes             │ ◀──────▶ │ CRC32 + AES-GCM    │ ──────▶ │ FastAPI              │
│ Web Worker:                   │ msgpack  │ zod validation     │         │ sync_apply.apply_    │
│  sqlite-wasm on OPFS          │ ≤2 KB    │ ordered forwarding │ ◀────── │   frame (one path)   │
│  outbox → sync engine         │          │ ACK: 5xx→RETRY     │ push    │ Postgres/Timescale   │
│  DTN bundles (QR / Broadcast- │          │      4xx→FAILED    │         │ (SQLite fallback)    │
│  Channel) when offline        │ ───────▶ │ POST /dtn/exchange │ ──────▶ │ /dtn/ingest_bulk     │
└───────────────────────────────┘          └────────────────────┘         └──────────────────────┘
```

- **One apply path at HQ.** WS frames (`POST /sync/ingest`) and DTN bundles (`POST /dtn/ingest_bulk`, `POST /dtn/exchange`) all go through `hq/app/sync_apply.py`. A write carries one ULID on every channel and applies exactly once.
- **Local-first tablet.** Every write commits to on-device SQLite with an audit row and an outbox frame. Screens re-render from per-table change events, not polling.
- **Honest labels.** The tablet's status strip only shows real state: link, unsynced and failed counts, last ACK, EPHEMERAL storage, INSECURE HTTP, DEV KEY. HQ forecasts flag `tele.source = "assumed_default"` when no telemetry exists.

Details: `docs/ARCHITECTURE.md`, `docs/API.md`, `field/README.md`, `hq-dashboard/README.md`.

---

## Quick start

**Requirements:** Node 20+ (Node 22.18+ to run the field core test), Python 3.11+, and Docker Desktop (recommended).

### 1. Install

```powershell
npm install --prefix shared; npm run build --prefix shared
npm install --prefix sync-gateway
npm install --prefix field
npm install --prefix hq-dashboard
pip install -r hq/requirements.txt -r hq/requirements-test.txt
```

### 2. Configure

```powershell
Copy-Item .env.example .env
node scripts/provision_station.mjs ST-BHARATI --qr   # generates a 64-hex key (+ QR)
```

| Variable | Used by | What it does |
|----------|---------|--------------|
| `PSK_HEX` | hq, gateway | A 64-hex (32-byte) AES-GCM wire key. **One key is shared** by the gateway and every tablet. Tablets receive it in Comms (paste or QR); until then they run on the dev key `'a'*64` and show DEV KEY. |
| `SECRET_KEY` | hq | The JWT signing key. Falls back to `PSK_HEX`; set a distinct value in production. |
| `DATABASE_URL` | hq | A Postgres URL. Leave it empty to use the SQLite fallback `hq/app/hq.db`. |
| `HQ_PUBLIC_URL` / `GATEWAY_PUBLIC_URL` | field | Read at runtime by `field/app/api/config/route.ts`. `localhost` is swapped on the client for the host the tablet loaded the page from. |
| `GATEWAY_INTERNAL_URL` | hq | Where HQ pushes downstream deltas. Compose sets `http://gateway:8787`. |
| `ALLOWED_ORIGINS` | hq | CORS allowlist. `*` is dropped when `DATABASE_URL` is set. |
| `TELEMETRY_SOURCE`, `LIVE_WEATHER_ENABLED`, `IMD_API_KEY` | hq | Weather poller: Open-Meteo (free) plus optional IMD, or `sim`. |
| `AIS_API_KEY`, `VESSEL_MODE`, `LIVE_AIS_ENABLED` | hq | Vessel poller. Without a key it falls back to schedule interpolation, labelled `mock`. |
| `TOKEN_EXPIRY_HOURS` | hq | JWT lifetime, 8 h by default. |
| `ADMIN_KEY` | hq | Optional. A PIN equal to this grants an elevated role at login. |

### 3a. Run with Docker (recommended)

```powershell
docker compose up -d --build --wait
# field       → http://localhost:3000
# dashboard   → http://localhost:3001
# gateway     → ws://localhost:8787
# HQ API      → http://localhost:8000
```

### 3b. Run without Docker (SQLite fallback)

```powershell
python -m uvicorn hq.app.main:app --port 8000
npm --prefix sync-gateway run build; $env:HQ_URL="http://localhost:8000"; node sync-gateway/dist/gateway.js
npm --prefix field run dev          # :3000
npm --prefix hq-dashboard run dev   # :3001
```

**Tablets on a LAN** need a secure context. The camera, OPFS storage and WebCrypto only work over HTTPS or on `localhost`. On plain `http://<LAN-IP>:3000`, storage falls back to memory (EPHEMERAL), sign-in cannot store the offline PIN hash, and the strip shows INSECURE HTTP. Put the field app behind TLS for real devices.

### 4. Import inventory (optional)

```powershell
node scripts/import_inventory.mjs --file scripts/template_inventory.csv --hq http://localhost:8000 --pin BHARATI-2024
```

Or POST to `/assets/bulk` as NCPOR_ADMIN. The seed is only loaded into an empty database.

---

## Using it

### Field tablet — `:3000`

Real routes under `field/app/(field)/`, sharing a shell of a status strip, a nav rail or bottom bar, a global SOS sheet, a global asset sheet and a hardware-scanner catcher:

- **Brief** (`/`): the action queue, sorted by severity.
- **Scan**: camera or typed code, then quick IN / CONSUME.
- **Stock** (`/inventory`): stock with FEFO lots.
- **Muster**: triage, sorties and the muster board.
- **Indents**: create DRAFT indents and receive DISPATCHED ones.
- **Cargo** (`/expeditions`): manifest custody and printable QR labels.
- **Locate**: 2D store plan and 3D twin. Simulated LiDAR appears only in drill mode.
- **Comms**: custody ledger, frame retry and discard, PSK provisioning, DTN bundle QR export and import, pull stock from HQ.
- **Settings**: Day / Glare or Polar Night theme, glove mode, larger text, drill mode, lock or forget sign-in, wipe.

See `field/README.md`.

**Sign-in:** pick a station, device ID and PIN (`BHARATI-2024` / `MAITRI-2024` / `HIMADRI-2024`). The first sign-in must reach HQ; after that the same tablet can unlock offline with that PIN. HQ grants STATION_LEAD only to device IDs starting with `LEAD-` or `STATION-LEAD-` (or an admin prefix). Everyone else signs in as FIELD_OP.

### HQ dashboard — `:3001`

A Next.js 14 App Router app with 10 routes under `hq-dashboard/app/(dashboard)/`:

- `/` fleet overview
- `/forecast`
- `/stations`
- `/inventory`
- `/indents`
- `/personnel`
- `/expeditions`
- `/audit`
- `/locate`
- `/command`

The vessel map (Leaflet) falls back to a schematic when map tiles cannot be reached. Telemetry arrives over SSE, with a polling fallback. See `hq-dashboard/README.md`.

---

## API quick reference

The base URL is `http://localhost:8000`. The full reference is `docs/API.md`.

| Area | Endpoints |
|------|-----------|
| Health / auth | `GET /health` · `POST /auth/login` · `GET /rbac/me` |
| Assets / lots | `GET /assets` · `GET /assets/bulk/template` · `POST /assets/bulk` · `GET /lots` · `GET /audit` |
| Indents | `GET /indents?station_id=` · `POST /indents` · `PATCH /indents/{id}` |
| Stations / forecast | `GET /stations/overview` · `GET /forecast/{station}` · `GET /forecast/snn/{station}` · `GET /physics/{station}` |
| Procurement | `GET /procurement/targets` · `PUT /procurement/targets/{sku}` · `GET /procurement/{station}` · `GET /procurement/mutual-aid` |
| Vessels | `GET /vessels` · `GET /vessels/{imo}` · `GET /vessels/sources` · `POST /vessels/poll` |
| Telemetry | `POST /telemetry` · `GET /telemetry/latest` · `GET /telemetry/history` · `GET /telemetry/sources` · `GET /telemetry/stream` |
| Tracking | `POST /tracking/update` · `GET /tracking/positions` · `POST/GET /tracking/personnel` |
| People & safety | `GET/POST /personnel` · `GET/POST /sorties` · `PATCH /sorties/{id}` · `POST /sorties/check-overdue` · `GET /emergencies` · `POST /emergency/sos` · `PATCH /emergency/{id}` · `GET /overrides` · `GET /timeline` |
| Expeditions | `GET/POST /expeditions` · `PATCH /expeditions/{id}` · legs · manifests (+ `bulk`, `template`) · `auto-pack` · `readiness` · `cost` · `GET/PUT /freight_rates` |
| Sync / DTN | `POST /sync/ingest` · `GET /sync/state/{device_id}` · `POST /dtn/ingest_bulk` · `POST /dtn/exchange` · `GET /dtn/bundles` · `GET /dtn/conflicts` |

---

## Testing

```powershell
python -m pytest hq/tests -q          # 51 passed (SQLite fallback)
npm --prefix shared test              # codec, wire, schemas
npm --prefix sync-gateway test        # wire, throttle, ACK mapping (5xx/429→RETRY, 4xx→FAILED)
node field/lib/db/core.test.ts        # field data core (FEFO, ACK machine, downstream, DTN, buddy rule)
npm run typecheck                     # shared, sync-gateway, field, hq-dashboard

node scripts/m1_verify.mjs            # HQ + gateway chaos: offline replay, dedupe, budgets
npm run verify                        # m1..m5
npm run verify:extreme                # shared + hq + dtn/snn/tracking verifies
```

The latest results are recorded in `docs/VERIFY_BASELINE.md`.

---

## Project layout

```
shared/        @polaris/shared — wire codec (msgpack+AES-GCM+CRC), zod schemas, seed, expiry, DTN types
field/         Next.js 14 PWA :3000 — routes in app/(field)/, DB+sync Web Worker in lib/db/, sw.js
sync-gateway/  Node WS gateway :8787 — gateway.ts (WS, /dtn/exchange, /internal/broadcast_delta), ack.ts
hq/            FastAPI :8000 — main.py routes, sync_apply.py, dtn.py, forecast/SNN, pollers, db init
hq-dashboard/  Next.js 14 HQ console :3001
ai/            training + ONNX models (thermo_residual, thermo_snn)
scripts/       m1..m5 + dtn/snn/tracking verifies, provisioning, inventory import, calibration
docs/          ARCHITECTURE.md · API.md · VERIFY_BASELINE.md
website/       standalone Vite marketing site (own README)
```

---

## Troubleshooting

| You see | Meaning | Fix |
|---------|---------|-----|
| Strip shows **KEY MISMATCH** | The tablet's PSK differs from the gateway's `PSK_HEX` | Comms → paste or scan the station key. The link turns LIVE. |
| **EPHEMERAL · LOST ON RELOAD** | OPFS is unavailable: another POLARIS tab is open, or the page is not in a secure context | Close other tabs and reload, and serve over HTTPS or localhost. |
| **INSECURE HTTP** | Plain http on a LAN IP | Put the field app behind TLS. |
| **DTN STORE-FWD** | No link; writes are held as bundles | Wait for the link, or hand bundles off by QR in Comms. |
| Frames stuck **FAILED** | HQ rejected them permanently (4xx, negative stock, invalid) | Comms → read the error, then retry or discard (discards are audited). |
| No downstream pushes | HQ cannot reach the gateway | Check `GATEWAY_INTERNAL_URL` (compose: `http://gateway:8787`). |
| Forecast `tele.source: assumed_default` | No telemetry row yet | POST `/telemetry`, or wait for the poller. |
| `403` on bulk import or targets | The role is not elevated | Sign in with an `NCPOR-ADMIN-…` / `LEAD-…` device ID. |

---

## Known limits

- Most HQ endpoints are **unauthenticated**. Only 5 routes plus the solo-sortie branch check roles.
- There is a **single shared PSK**. No per-device keys or rotation.
- The DTN "mesh" is a same-origin `BroadcastChannel`. There is **no radio transport**; hand-off between devices is by QR or text.
- Tablets need a **secure context** for the camera, OPFS and WebCrypto.
- Locate positioning is simulated and only shown in drill mode. `dg_load` is synthetic unless a meter is configured. Forecast `ci` is a placeholder ±15 % band.

## Feasibility and pitch

- `COST_FEASIBILITY.md`: reuses the tablet, HQ VM and satellite link already on station.
- `PITCH_DECK.md`: the demo storyline.

## License

MIT — for NCPOR/MoES evaluation.
