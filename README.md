# POLARIS — Polar Logistics & Survival Engine

**SIH26062 — Integrated Polar Expedition Logistics & Asset Management System** for NCPOR/MoES stations **Bharati (69°24′S 76°11′E), Maitri (70°45′S 11°44′E), Himadri (78°55′N 11°56′E)**.

Offline-first, decentralized, air-gapped. Survives **-40°C blizzards, 6-month winter isolation, 20–50 kbps Iridium with multi-hour blackouts**. A diesel/O₂ stockout in polar night is a survival failure — this system prevents it.

> **Live demo 3.5 min:** `PITCH_DECK.md`. Field PWA + Sync Gateway + HQ Dashboard run via `docker compose up` with WiFi off. **Phase 1 (Aug 2026):** DB-driven procurement, server-scoped assets, honest empty-state trends — zero hardcoded `5000L/1200₹` mocks. See `PLAN.md` for the 4-phase mock→real roadmap.

---

## Table of Contents

1. [Architecture at a Glance](#architecture-at-a-glance)
2. [Tech Stack — Why Each Choice](#tech-stack--why-each-choice)
3. [Data Model — Single Source of Truth](#data-model--single-source-of-truth)
4. [What Is Real vs What Was Mock (Phase 1 Changelog)](#what-is-real-vs-what-was-mock-phase-1-changelog)
5. [Quick Start](#quick-start)
6. [Environment — Every Variable Explained](#environment--every-variable-explained)
7. [Usage — Field & HQ Dashboard](#usage--field--hq-dashboard)
8. [API Reference](#api-reference)
9. [Sync Wire — MsgPack+AES-GCM+CRC](#sync-wire--msgpackaes-gcmcrc)
10. [AI — Thermo Hybrid](#ai--thermo-hybrid)
11. [Security & Resilience](#security--resilience)
12. [Testing — Unit / Chaos / Budgets](#testing--unit--chaos--budgets)
13. [Project Structure](#project-structure)
14. [Roadmap — 4 Phases to Fully Real](#roadmap--4-phases-to-fully-real)
15. [Troubleshooting](#troubleshooting)
16. [Feasibility & Pitch](#feasibility--pitch)

---

## Architecture at a Glance

```
ANTARCTICA EDGE (Offline-First)          SAT (20–50 kbps ws, 500ms, 5% loss)    INDIA HQ (NCPOR)
┌─────────────────────────────┐          msgpack+CRC+AES-GCM  <2KB frame    ┌──────────────────────────────┐
│ Next.js 14 PWA (Workbox)    │ ◄════════ FULL-DUPLEX WEBSOCKET ══════════► │ FastAPI + Postgres/        │
│  Glove 48px + QR + 3D X-Ray │ ─── Upstream Deltas + SYNC_INIT ────────► │  TimescaleDB + RBAC/audit  │
├─────────────────────────────┤  ◄── Downstream Push (<50ms) ───────────  │  procurement_targets DB    │
│ SQLite WASM OPFS/WAL        │                                         ├──────────────────────────────┤
│  polaris.db + outbox WAL    │  ◄── Real-Time Indent & Asset Push ────  │ ONNX Thermo Hybrid <2MB    │
│  dedupe + sync_state        │                                          │  + Acoustic AI             │
└────────────┬────────────────┘                                           └──────────────┬───────────────┘
             │ onnxruntime-node <2MB, <200ms (Phase 2: retrain on real) ────────────────┘
             └────────── Thermo Hybrid (physics + ML residual) ──────────────────────────┘
```

**One language on field live path:** TypeScript/Node (`field` + `sync-gateway` + ONNX runner) — zero cross-FFI at the edge. HQ and training stay Python where they belong. Rust is the planned production hardening (`tokio`/`ort`), not this round.

- **Field reads:** local SQLite WASM OPFS `polaris.db` (WAL, `shared/sql/schema.sql:1` mirrors `field/lib/db.ts:9`). `getDb()` `field/lib/db.ts:28` falls back to `:memory:` with `window.__polaris_ephemeral` warning if `SecureContext` missing.
- **HQ reads:** `GET /assets` `hq/app/main.py:188` now joins `assets→crates→containers` to return `station_id, container_id` — client scopes via `station_id` not hardcoded `STATION_CRATES` (removed `hq-dashboard/app/page.tsx:60`).
- **Trends:** `GET /telemetry/history` `hq/app/main.py:342` aggregated; `TrendChart` `hq-dashboard/components/TrendChart.tsx:28` shows empty state unless `?demo=1`.

See `docs/ARCHITECTURE.md` and `docs/API.md` (now includes `GET /procurement/targets`, `PUT /procurement/targets/{sku}`).

---

## Tech Stack — Why Each Choice

| Component | Build | Rationale & Hardening |
|-----------|-------|----------------------|
| **Field PWA** | Next.js 14.2.5 + Tailwind + Three.js `@react-three/fiber/drei` 3D X-Ray + `html5-qrcode` 2.3.8 + Workbox | QR offline, 3D crate locator (shared `CONTAINER_SPECS` via `@polaris/shared`), glove 48px hit targets, tactical dark, `fontLarge` 200% toggle. Split into `Icons` + `tabs/{Today,Inventory,Scan,Indents,Locate}` for maintainability. `TodayTab` shows `forecast.days_to_stockout + ci` from `GET /forecast/:id` `hq-dashboard/app/page.tsx:145`. |
| **Offline DB** | `@sqlite.org/sqlite-wasm` 3.53 OPFS/WAL | WAL crash safety, `outbox`/`dedupe`/`sync_state` in same DB, `BEGIN IMMEDIATE` `field/lib/db.ts:112` avoids TOCTOU. Index `idx_outbox_status` for drain. |
| **Sync Engine** | Node `ws` 8.17 + `@msgpack/msgpack` 3.0 + `ulid` 2.3 + CRC32 + AES-GCM (Node `crypto` / WebCrypto) | 70–80% smaller than JSON, idempotent `ulid` replay, `sizeReport` logging, `SENT` retry on next `drain` every 2s with `draining` guard `field/lib/sync.ts:30`, `PING/PONG` 30s, `>2KB` returns `FAILED` not silent drop `sync-gateway/src/gateway.ts:6`. |
| **AI** | `onnxruntime-node` 1.17 int8 <2MB `ai/thermo_residual.onnx` (1.3KB) + `ai/scaler.json` + Acoustic Prognostics | Hybrid `phys + ML residual` `hq/app/forecast.py:51`, `<200ms`, fallback `5*dg+0.3*crew-2` `hq/app/forecast.py:66`. Honest framing: *physics-informed forecast, not certified prediction*. |
| **HQ** | FastAPI + `psycopg[binary]` + TimescaleDB `timescale/timescaledb:latest-pg15` (Docker) / SQLite WAL fallback `hq/app/hq.db` | Audit append-only, RBAC `hq/app/auth.py:1`, Timescale hypertable for `telemetry`, `procurement_targets` + `physics_params` tables Phase 1 `shared/sql/schema.sql:112`. |
| **HQ Dashboard** | Next.js 14 (`:3001`) + Recharts 3.10 + Three.js 0.185 | Fleet view, forecast 42→18d, SSE live `EventSource /telemetry/stream` `hq-dashboard/app/page.tsx:180`, `TrendChart` empty-state `hq-dashboard/components/TrendChart.tsx:118`, `ProcurementTable` DB-driven `hq/app/main.py:491`. |
| **Training** | Python PyTorch + ONNX export `ai/training/generate.py` + `train.py` | Synthetic physics+noise 1095 rows ships only `.onnx` — Phase 3 replaces with `train_real.py` on live `telemetry`. |

> Ponytail simplifications: removed `@automerge/automerge` (dead CRDT — outbox+dedupe+version already convergent), `mqtt`/`paho-mqtt` (SSE covers live), unused `httpx/python-ulid/@types/mqtt/zod`.

---

## Data Model — Single Source of Truth

`shared/sql/schema.sql:1` is canonical DDL (copied to `field/lib/db.ts:9` inline mirror for browser bundle; `hq/app/db.py:45` strips `PRAGMA` and `BLOB→BYTEA` for PG). HQ `hq/app/db.py:63 init_db` handles Timescale extension + per-statement execute + seed iff `COUNT(*)=0` else migrates `procurement_targets`.

| Table | PK / FK | Purpose | Seed (20 SKUs) |
|-------|---------|---------|----------------|
| `stations` | `id` | Bharati/Maitri/Himadri + `winter_crew_count` `hq/app/db.py:110` | 3 rows `shared/seed.json:2` |
| `containers` | `id` → `stations` | ISO_20ft/ColdStore/Hazmat + `position_2d` | 6 rows C1–C6 `shared/seed.json:7` |
| `crates` | `id` → `containers` | `coords {x,y}` JSON + `temp_zone` AMBIENT/COLD/HAZMAT | 12 rows `shared/seed.json:15` |
| `assets` | `id`, `sku UNIQUE` → `crates` | `category` FUEL_DIESEL…SCIENTIFIC, `qty REAL`, `unit`, `expiry_date`, `criticality` CRITICAL/HIGH/LOW, `barcode`, `version` | 20 SKUs A1–A20 `shared/seed.json:29` (Diesel 4200L C1-K1, O2 24cyl C2-K1 exp 2026-09-15 etc.) |
| `transactions` | `id` → `assets` | `type` IN/OUT/CONSUME/ADJUST, `qty_delta`, `actor_id`, `ts`, `sync_status` | — |
| `indents` | `id` → `stations,assets` | `qty_requested`, `urgency` LOW/MEDIUM/CRITICAL, `status` DRAFT→APPROVED→DISPATCHED→RECEIVED `hq/app/config.py:16 ALLOWED` | — |
| `telemetry` | `(ts, station_id)` | `temp_outside, wind_speed, pressure, dg_load` — Timescale hypertable on PG | via `POST /telemetry` `hq/app/main.py:322` + `ai/runner/telemetry_sim.mjs:10` |
| `audit_log` | `id` | `actor_id, action, entity, before, after, ts` append-only | every write |
| `procurement_targets` *(Phase 1)* | `sku PK` | `target_qty, cost_per_unit, unit, eta` — DB replaces `SEASON_TARGETS` `hq/app/main.py:467` | 3 rows `FUEL-DIESEL 5000/1200, O2 30/200, BRG 10/80` `hq/app/db.py:43` |
| `physics_params` *(Phase 1 DDL, Phase 2 populated)* | `station_id PK` | `T_INSIDE, BASE, K1, K2, K3` per-station calibration | from `shared/src/physics.json:1` |
| `outbox` | `ulid PK` | `device_id, entity, entity_id, op` UPSERT/DELETE/CONSUME…, `patch BLOB`, `base_version, retry_count, status` PENDING/SENT/ACKED/FAILED | field WAL |
| `sync_state` | `device_id PK` | `last_acked_ulid, last_server_version` | per tablet |
| `dedupe` | `ulid PK` | idempotency `processed_at` | every `POST /sync/ingest` `hq/app/main.py:514` |

Indexes: `idx_assets_crate`, `idx_outbox_status (status, created_at)`, `idx_transactions_asset`, `idx_vessels_station` (Phase 4).

**Seed idempotency:** `hq/app/db.py:79 seed(cur)` `ON CONFLICT DO NOTHING` (PG) / `INSERT OR IGNORE` (SQLite) `shared/seed.json:1` → `field/lib/db.ts:58 seedIfEmpty` same via `@shared/seed.js`.

---

## What Is Real vs What Was Mock (Phase 1 Changelog)

| Domain | Before (mock) | After Phase 1 (real) | File:line |
|--------|---------------|----------------------|-----------|
| **Procurement** | `SEASON_TARGETS = {FUEL-DIESEL:5000,...}` + `UNIT_MAP` hardcoded `hq/app/main.py:467`, `need=5000-qty`, `₹need*1200/1L` | `procurement_targets` table `shared/sql/schema.sql:112`, `GET /procurement/{station}` `hq/app/main.py:491` joins DB targets, `GET /procurement/targets` + `PUT /procurement/targets/{sku}` RBAC `STATION_LEAD` `hq/app/main.py:465` | `hq/app/db.py:43` seed, `hq/app/db.py:56` migration |
| **Station scoping** | `STATION_CRATES` hardcoded `hq-dashboard/app/page.tsx:60` `ST-BHARATI->[C1-K1..]` | `GET /assets` `hq/app/main.py:188` returns `station_id, container_id` via `LEFT JOIN crates→containers`; `hq-dashboard/app/page.tsx:62 LEGACY_STATION_CRATES` fallback only if `station_id` missing; `field/lib/db.ts:76 listAssets` also returns `station_id` | `hq/app/db.py:45` schema, `field/lib/db.ts:76` |
| **Trend empty** | 7-day dummy `D-6..Today 4700→3850` always `hq-dashboard/components/TrendChart.tsx:31` | Empty dashed border "No telemetry yet — add `?demo=1`" unless `?demo=1` `hq-dashboard/components/TrendChart.tsx:118`, `demoMode` memo + `[data,demoMode,isEmpty]` deps `hq-dashboard/components/TrendChart.tsx:60` | — |
| **PSK** | `NEXT_PUBLIC_PSK_HEX=a*64` exposed in bundle `.env.example:10` | `scripts/provision_station.mjs:1` `crypto.randomBytes(32).hex` QR PNG, `hq/app/config.py:11` warns if `SECRET_KEY==PSK_HEX` with `DATABASE_URL`, `provision/` gitignored `.gitignore:103`, `.env.example:10` docs `provision via QR, not NEXT_PUBLIC` | — |
| **Still mock (next phases)** | Synthetic `ai/training/generate.py:12 random.seed(42)` → `thermo_residual.onnx` 1.3KB, global `physics.json` uncalibrated, no vessel AIS | Phase 2 IMD poller + per-station `physics_params` calibration, Phase 3 `train_real.py` on live `telemetry`, Phase 4 AISHub `vessel_poller.py` + `vessels` table — see `PLAN.md:1` | — |

**Bug fixes in this pass (skeptical review):** `_ensure_procurement_targets_sqlite` now catches `no such table: procurement_targets` on old DBs `hq/app/db.py:56` and creates table; `TrendChart` deps fixed `hq-dashboard/components/TrendChart.tsx:60` to include `demoMode,isEmpty`; `field/lib/db.ts:76 listAssets` now returns `station_id` via `cr.station_id` for parity with HQ.

---

## Quick Start

### Prereqs

- Node 20+, Python 3.11+, (optional) Docker Desktop. No cloud, no CDN at runtime — fully air-gapped.

### 1. Clone & Install

```powershell
git clone <repo> polar-logistics; cd polar-logistics
npm install --prefix shared; npx tsc -p shared/tsconfig.json
npm install --prefix sync-gateway; npx tsc -p sync-gateway/tsconfig.json
npm install --prefix field          # links @polaris/shared file:../shared
npm install --prefix hq-dashboard   # links @polaris/shared file:../shared
pip install -r hq/requirements.txt  # fastapi, uvicorn[standard], psycopg[binary], onnxruntime, python-ulid, pydantic
```

Shared build is required — both `field` and `hq-dashboard` import `@polaris/shared/containers.js`, `@polaris/shared/expiry.js`, `@polaris/shared/codec.web.js`.

### 2. Provision PSK (Phase 1.4 — one-time per station)

```powershell
node scripts/provision_station.mjs ST-BHARATI           # prints PSK_HEX + SECRET_KEY
node scripts/provision_station.mjs ST-BHARATI --qr      # + provision/ST-BHARATI.png QR (needs `npm install qrcode`)
# Add to .env: PSK_HEX=<64hex> SECRET_KEY=<distinct 64hex in prod>
```

Production: `SECRET_KEY` must be distinct from `PSK_HEX` (`hq/app/config.py:11` warns if equal with `DATABASE_URL`). `NEXT_PUBLIC_PSK_HEX` is demo-only — omit in prod; tablets store PSK in IndexedDB on QR scan.

### 3. Run without Docker (SQLite fallback — CI / no-Docker friendly)

```powershell
# HQ (fallback SQLite hq/app/hq.db WAL)
python -m uvicorn hq.app.main:app --port 8000 --log-level info
# Gateway (forwards ws → HQ, logs 70-80% saving, CRC/AES)
$env:HQ_URL="http://localhost:8000"; $env:GATEWAY_PORT="8787"; $env:PSK_HEX="a".repeat(64)
node sync-gateway/dist/gateway.js
# Field PWA  -> http://localhost:3000
npm --prefix field run dev
# HQ Dashboard -> http://localhost:3001  (add ?demo=1 for sample trend when DB empty)
npm --prefix hq-dashboard run dev
```

### 4. Run with Docker (TimescaleDB production path, air-gapped)

```powershell
docker compose up --build
# field :3000  hq-dashboard :3001  gateway :8787  hq :8000  db :5432 (pgdata volume)
# test air-gapped: disconnect WiFi, `docker compose up` still works, PWA cached via Workbox
# first boot seeds procurement_targets 3 rows + assets 20 SKUs if empty
```

### 5. Environment

Copy `.env.example` → `.env`:

```ini
PSK_HEX=a0000000000000000000000000000000000000000000000000000000000000a  # 32B hex per station, QR at HQ
SECRET_KEY=a00000000000000000000000000000000000000000000000000000000000a # JWT HMAC 32B hex; distinct from PSK_HEX in prod
HQ_URL=http://localhost:8000           # field → HQ HTTP
GATEWAY_PORT=8787
NEXT_PUBLIC_HQ_URL=http://localhost:8000
NEXT_PUBLIC_GATEWAY_URL=ws://localhost:8787
# NEXT_PUBLIC_PSK_HEX demo-only — provision via scripts/provision_station.mjs --qr, not NEXT_PUBLIC in prod
DATABASE_URL=postgresql://polaris:polaris@db:5432/polaris  # omit for SQLite fallback
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
```

See [Environment — Every Variable Explained](#environment--every-variable-explained) for full table.

---

## Environment — Every Variable Explained

| Var | Where | Default | Purpose & Pitfall |
|-----|-------|---------|-------------------|
| `PSK_HEX` | `hq`, `gateway`, `hq/app/config.py:3`, `sync-gateway/src/gateway.ts:6` | `a*64` demo | 32B hex (64 chars) per-station wire AES-GCM pre-shared key. Validated `hexToBytes` strict (odd/invalid rejected). Provision via `scripts/provision_station.mjs`. `hq/app/config.py:13` warns if `SECRET_KEY==PSK_HEX` with `DATABASE_URL`. |
| `SECRET_KEY` | `hq` `hq/app/config.py:3` | fallback `PSK_HEX` | JWT HMAC-SHA256 32B hex (decoded `bytes.fromhex`). Separate from `PSK_HEX` in prod. 30d expiry `TOKEN_EXPIRY_DAYS:30`. |
| `DATABASE_URL` | `hq` `hq/app/db.py:3` | `""` → SQLite | `postgresql://polaris:polaris@db:5432/polaris` → TimescaleDB. Omit → SQLite WAL `hq/app/hq.db` `hq/app/db.py:92`. |
| `HQ_URL` / `GATEWAY_INTERNAL_URL` | `field`, `gateway` `hq/app/main.py:52` | `http://localhost:8000` / `http://hq:8000` in Docker | Field → HQ HTTP; `hq` → `gateway` internal `POST /internal/broadcast_delta` with `X-PSK` `hq/app/main.py:54`. |
| `GATEWAY_PORT` | `gateway` | `8787` | WebSocket port `sync-gateway/src/gateway.ts:6`. |
| `NEXT_PUBLIC_HQ_URL` | `field`, `hq-dashboard` `hq-dashboard/app/page.tsx:5` | `http://localhost:8000` | Build-time Next.js public var — field `GET /forecast/:id` `field/app/page.tsx:145`, HQ `Promise.all` 8 fetches `hq-dashboard/app/page.tsx:140`. |
| `NEXT_PUBLIC_GATEWAY_URL` | `field` `field/lib/sync.ts:5` | `ws://localhost:8787` | Field `SyncWorker` WebSocket URL. |
| `NEXT_PUBLIC_PSK_HEX` | `field` `field/lib/sync.ts:6` | `a*64` | **Demo-only.** Phase 1.4: omit in prod — PSK stored in IndexedDB via QR, not bundle. |
| `ALLOWED_ORIGINS` | `hq` `hq/app/main.py:17` | `*` dev | CORS. `hq/app/main.py:19` warns if `*` with `DATABASE_URL`. Set per-deploy list in prod. |
| `TOKEN_EXPIRY_DAYS` | `hq` `hq/app/config.py:10` | `30` | JWT `exp`. |

---

## Usage — Field & HQ Dashboard

### Field — Station Tablets (`:3000`, 5 tabs)

- **Login** `field/app/page.tsx:91` — Station selector (Bharati/Maitri/Himadri) + Device ID + PIN (`BHARATI-2024` `hq/app/config.py:22 STATION_PINS`) → `POST /auth/login` → JWT `FIELD_OP` by default; `STATION_LEAD`/`NCPOR_ADMIN` only if `device_id` contains `ADMIN`/`LEAD`/`TEST`/`HQ` `hq/app/main.py:174`. Stored `polaris_token/station/device/role` localStorage. `GET /rbac/me` `hq/app/main.py:181` returns `VIEWER` when unauthenticated.
- **Today Tab** `field/components/tabs/TodayTab.tsx` — `forecast.days_to_stockout + ci` from `GET /forecast/ST-BHARATI` `field/app/page.tsx:145`, `criticalCount=qty≤5&CRITICAL`, `expiringCount<30d` via `@shared/expiry.js` `isExpiringSoon`, 3 telemetry buttons `POST /telemetry` `field/app/page.tsx:223` (Calm `-15C/5m/s` → 42d, Blizzard `-38C/22m/s` → 18d, Acoustic `0.95`→ bearing indent).
- **Inventory** `field/components/tabs/InventoryTab.tsx` — `listAssets()` `field/lib/db.ts:76` now includes `station_id` (parity with HQ). Search `sku+name+crate+category+barcode`, filter pills ALL/CRITICAL/EXPIRING/LOW≤3/FUEL/MEDICAL/SPARES. `consumeAsset` `field/lib/db.ts:107` `BEGIN IMMEDIATE` → `UPDATE assets + INSERT transactions/audit/outbox COMMIT`; expired `MEDICAL/OXYGEN/FOOD` blocked without `overrideExpired` + `CONSUME_OVERRIDE_EXPIRED` audit.
- **QR Scan** `field/components/tabs/ScanTab.tsx` + `field/components/QrScanner.tsx` — `html5-qrcode` env camera `fps12 qrbox220` or manual barcode + 8 preset chips (`FUEL-DIESEL-001`, `O2-CYL-47L-003`…); `getAssetByBarcode` `field/lib/db.ts:80` local, highlights `highlightCrate`.
- **Indents** `field/components/tabs/IndentsTab.tsx` — `listIndents()` local, `createIndent` `field/lib/db.ts:142` `INSERT indents DRAFT` + `outbox UPSERT msgpack`; strict `ALLOWED` `DRAFT→APPROVED→DISPATCHED→RECEIVED` `field/lib/db.ts:169`. Downstream applies via `applyDownstreamIndent` `field/lib/db.ts:186` / `applyDownstreamSyncInit` on `SYNC_INIT_RESP`.
- **Locate / 3D X-Ray** `field/components/tabs/LocateTab.tsx` + `field/components/Container3D.tsx` — `@polaris/shared/containers.js` `CONTAINER_SPECS`/`CRATE_COORDS` `shared/src/containers.ts:1` (6 containers, 12 crates), `OrbitControls`, wireframe envelope, color `CRITICAL qty≤5 red, ≤3 orange, HL gold #F59E0B`.

Sync drawer `field/app/page.tsx:585` shows `sent/acked/deduped/receivedDeltas/savingPct` `SyncWorker.stats` `field/lib/sync.ts:30` draining every 2s up to 20 rows `PING/PONG` keepalive, `CRC32`+`AES-GCM` via `shared/codec.web.ts`.

### HQ Dashboard (`:3001`, 7 tabs, `hq-dashboard/app/page.tsx:6`)

- **Header:** Station `<select>` drives 8 parallel fetches `hq-dashboard/app/page.tsx:140` + `EventSource /telemetry/stream` `hq-dashboard/app/page.tsx:180` with `sseStatus live|polling` (8s poll fallback). PIN input `BHARATI-2024` → `HQ-COMMAND-*` device.
- **Fleet Overview** — KPI 5 cards `stations/skus/critical/open/expiring` from `kpi` memo `hq-dashboard/app/page.tsx:324`; Thermo Hybrid hero `physics+residual=total L/d 95% ci` + Blizzard 42→18d button `hq-dashboard/app/page.tsx:562`; 3 station cards `stations/overview` `hq/app/main.py:289` with `days_to_stockout`.
- **Thermo AI Forecast** — 3 burn cards `physics, residual, days` `hq-dashboard/app/page.tsx:724` + same `TrendChart`/`ProcurementTable`.
- **Inventory** — `displayedAssets` `hq-dashboard/app/page.tsx:304` now `assets.filter(a=>a.station_id===selectedStation)` when `station_id` present, else `LEGACY_STATION_CRATES` fallback `hq-dashboard/app/page.tsx:62`; search `sku+name+crate+category`.
- **Indent Workbench** — `indents` table `hq-dashboard/app/page.tsx:808` columns indentId slice 8, sku, qty, urgency pill, status pill (amber DRAFT/blue APPROVED/purple DISPATCHED/emerald RECEIVED), `PATCH /indents/{id}` `hq-dashboard/app/page.tsx:249` with `NCPOR_ADMIN` RBAC.
- **Trends** `hq-dashboard/components/TrendChart.tsx:118` — 3 modes fuel/temp/load `AreaChart/LineChart` Recharts. **Phase 1.3:** empty `trend` shows dashed empty state not fake 4700L; `?demo=1` restores 7-day sample `hq-dashboard/components/TrendChart.tsx:36`.
- **Procurement** `hq-dashboard/components/TrendChart.tsx:220` — `GET /procurement/:station` `hq/app/main.py:491` DB-driven `need=max(0,target-qty)` `₹need*cost/1L`, `Budget ₹totalCost L`, Indent button → `POST /indents` `hq-dashboard/app/page.tsx:271` `status:APPROVED`.
- **Audit** `hq-dashboard/app/page.tsx:966` — `GET /audit?limit=30` append-only feed `ts.slice(11,19) action entity after`.
- **3D Twin** — same `Container3D` as field.

---

## API Reference

| Method | Path | Notes | Phase |
|--------|------|-------|-------|
| `GET` | `/health` | `{status:"ok", db:"postgres\|sqlite-fallback", ts}` `hq/app/main.py:150` | — |
| `POST` | `/auth/login` | `{device_id, pin, station_id, role?}` → JWT. `role` ignored unless `device_id` contains `ADMIN\|LEAD\|TEST\|HQ` → else `FIELD_OP` `hq/app/main.py:174`. Pin `BHARATI-2024` `hq/app/config.py:22`. `bytes.fromhex(PSK)` 32B cross-verified. | — |
| `GET` | `/rbac/me` | `VIEWER` when unauthenticated else `FIELD_OP…NCPOR_ADMIN` `hq/app/main.py:181` | — |
| `GET` | `/assets` | `Asset[] {id, sku, name, category, qty, unit, expiry_date, criticality, crate_id, barcode, version, updated_at, station_id, container_id}` ← Phase 1.2 added `station_id, container_id` via join `hq/app/main.py:188` | **1.2** |
| `GET` | `/audit?limit=20` | `AuditLog[]` immutable, `limit` 1–200 `hq/app/main.py:191` | — |
| `GET` | `/indents?station_id=` | `Indent[] + sku/name join` `hq/app/main.py:196` | — |
| `POST` | `/indents` | `{station_id,asset_id,qty_requested,urgency,created_by,status?}` → `{id,status}` + `INSERT audit` + `notify_gateway X-PSK` `hq/app/main.py:210` | — |
| `PATCH` | `/indents/{id}` | `{status,actor_id}` `ALLOWED DRAFT→APPROVED→DISPATCHED→RECEIVED` + `require_role(STATION_LEAD)` `hq/app/main.py:254` + downstream push | — |
| `GET` | `/stations/overview` | `Station[] {id,name,winter_crew_count,containers,assets,critical_low,open_indents,days_to_stockout,forecast_ci}` `hq/app/main.py:289` computes `predict_total` | — |
| `GET` | `/forecast/{station}?asset_sku=` | `{qty, physics, residual, total_per_day, days_to_stockout, ci:[low,high], used_model, tele, pure_physics_days}` `hq/app/main.py:450` | — |
| `GET` | `/procurement/targets` | `ProcurementTarget[] {sku,target_qty,cost_per_unit,unit,eta}` `hq/app/main.py:465` | **1.1** |
| `PUT` | `/procurement/targets/{sku}` | Upsert `{sku,target_qty,cost_per_unit,unit,eta}` → RBAC `STATION_LEAD` `hq/app/main.py:477`, `INSERT … ON CONFLICT DO UPDATE` | **1.1** |
| `GET` | `/procurement/{station}` | DB-driven `need=target-qty` `₹cost` `hq/app/main.py:491`; `[]` if no targets | **1.1** |
| `POST` | `/telemetry` | `{ts,station_id,temp_outside,wind_speed,pressure,dg_load,acoustic_anomaly?}` → triggers `check_and_escalate` (≤20d → `FORECAST_AUTO` 500L, `>0.90` → `ACOUSTIC_AI` 4 bearings) `hq/app/main.py:322` + `await _broadcast_telemetry` SSE `hq/app/main.py:41` | — |
| `GET` | `/telemetry/latest?station_id=` | last row or `{}` `hq/app/main.py:338` | — |
| `GET` | `/telemetry/history?station_id=&days=` | `[{day, avg_temp, avg_load}]` `GROUP BY date(ts)` `hq/app/main.py:342` | — |
| `GET` | `/telemetry/stream` | SSE `text/event-stream` `event: telemetry` `hq/app/main.py:347` `asyncio.Queue` 100 keepalive 30s | — |
| `POST` | `/sync/ingest` | `DeltaFrame {ulid(26),device_id,entity,entity_id,op,patch,base_version,ts}` `hq/app/main.py:515` rate 600/min `hq/app/main.py:517`, dedupe `hq/app/main.py:514`, `CONFLICT_CRITICAL` if negative `hq/app/main.py:547`, `DEDUPED` on replay | — |
| `GET` | `/sync/state/{device_id}` | `{device_id,last_acked_ulid,last_server_version}` `hq/app/main.py:509` | — |
| `POST` | `/internal/broadcast_delta` | Gateway `X-PSK` required `sync-gateway/src/gateway.ts:77` | — |
| `GET` | `/physics/{station}` | *(Phase 2 planned)* per-station `physics_params` | 2 |

Full spec `docs/API.md`. All writes append `audit_log`; idempotency via `ulid` + `dedupe`.

### Example curl

```bash
curl http://localhost:8000/health
curl http://localhost:8000/assets | jq '.[0] | {sku,qty,station_id}'
# station-scoped procurement (DB-driven)
curl http://localhost:8000/procurement/ST-BHARATI | jq
# edit target (requires NCPOR_ADMIN)
curl -X POST http://localhost:8000/auth/login -H "Content-Type: application/json" \
  -d '{"device_id":"HQ-ADMIN-01","pin":"BHARATI-2024","station_id":"ST-BHARATI","role":"NCPOR_ADMIN"}' | jq
TOKEN=$(curl -s http://localhost:8000/auth/login -H "Content-Type: application/json" \
  -d '{"device_id":"HQ-ADMIN-01","pin":"BHARATI-2024","station_id":"ST-BHARATI","role":"NCPOR_ADMIN"}' | jq -r .token)
curl -X PUT http://localhost:8000/procurement/targets/FUEL-DIESEL-001 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sku":"FUEL-DIESEL-001","target_qty":6000,"cost_per_unit":1300,"unit":"L","eta":"25d before freeze"}'
# Trend honest empty-state: no ?demo → no fake data
curl http://localhost:8000/telemetry/history?station_id=ST-BHARATI | jq length
# Telemetry blizzard → auto CRITICAL indent if days≤20
curl -X POST http://localhost:8000/telemetry -H "Content-Type: application/json" \
  -d '{"ts":"2026-08-29T00:00:00Z","station_id":"ST-BHARATI","temp_outside":-38,"wind_speed":22,"pressure":960,"dg_load":0.9}'
# RBAC: field tablet cannot elevate
curl -H "Authorization: Bearer $TOKEN" -X PATCH http://localhost:8000/indents/$ID \
  -H "Content-Type: application/json" -d '{"status":"APPROVED","actor_id":"LEAD_01"}'
```

---

## Sync Wire — MsgPack+AES-GCM+CRC

`shared/src/codec.ts` + `codec.web.ts` — `toWire(frame, PSK)` → `[4B CRC BE][12B nonce || ciphertext || 16B tag]` msgpack+AES-GCM. `PSK_HEX` `64 hex` validated `hexToBytes`/`assertKeyHex` — odd/invalid rejected, `DataView` `byteOffset`-safe. GCM tag is integrity, CRC is framing only.

Field `SyncWorker` `field/lib/sync.ts:30` full-duplex: `connect()` sends `SYNC_INIT` wire, `drain()` every 2s sends `PENDING|SENT` up to 20 rows (retry until `ACKED`, `draining` guard), `onmessage` handles `DOWNSTREAM_DELTA`→`applyDownstreamIndent` `field/lib/db.ts:186` / `SYNC_INIT_RESP`→`applyDownstreamSyncInit`, `ACK APPLIED|DEDUPED|CONFLICT_CRITICAL|FAILED`. `sizeReport` logs `jsonBytes vs mpBytes saving 70-80%` `shared/src/codec.ts:toWire`. Gateway `sync-gateway/src/gateway.ts:185` bridges `wss.on connection` + `fetch HQ/indents?station_id` + `fetch HQ/sync/ingest` + `POST /internal/broadcast_delta` filtered by `station_id`, `MAX_WIRE_SIZE 2048` `shared/src/codec.ts`.

Throttle tested `scripts/m4_verify.mjs` 20kbps/500ms/5% — convergence <5s.

---

## AI — Thermo Hybrid

`ai/training/generate.py` → `weather_fuel_history.csv` (1095 rows, `random.seed(42)` seasonal `temp=-25/-15+sin+gauss`, `physics=110*(1+0.012ΔT+0.018W)+0.08ΔP`, `residual=5*dg+0.3crew+gauss`) → `ai/training/train.py` tiny MLP `5→16→8→1` `torch.onnx.export` → `ai/thermo_residual.onnx` **1.3KB** + `ai/scaler.json`. Runner `ai/runner/infer.mjs` + `ai/runner/telemetry_sim.mjs` `onnxruntime-node <200ms` with fallback linear `hq/app/forecast.py:66` (`5*dg+0.3*crew-2`).

`hq/app/forecast.py:7 load_physics` loads `shared/physics.json:1` (`T_INSIDE 18, BASE 110, K1 0.012, K2 0.018, K3 0.08`) `physics_pred` `hq/app/forecast.py:46`; `predict_total` `hq/app/forecast.py:51` `phys+residual` with ONNX if present. `hq/app/main.py:374 check_and_escalate` auto `FORECAST_AUTO`/`ACOUSTIC_AI` indents.

Phase 2: `physics_params` per-station; Phase 3: `ai/training/train_real.py` on live `telemetry` + `transactions` burn.

Honest framing: *physics-informed forecast, not certified prediction* — `ci` is `days*0.85/1.15` placeholder until calibrated.

---

## Security & Resilience

- **Zero cloud:** `docker compose up` WiFi off, PWA Workbox pre-cached, OPFS `polaris.db` (ephemeral `:memory:` warned).
- **Transit:** TLS + AES-GCM per frame (`nonce 12B||tag 16B`) + `CRC32` framing, PSK per-station QR `64 hex` strictly validated (`sync-gateway/src/gateway.ts:6` `a*64` demo, `scripts/provision_station.mjs:1` generator), `X-PSK` on internal push `hq/app/main.py:58`, `DataView` byteOffset-safe.
- **At-rest:** SQLite WAL `SYNCHRONOUS=NORMAL` `hq/app/db.py:92`, OPFS + OS disk encryption.
- **Auth/RBAC:** HMAC-SHA256 JWT 30d — `PSK_HEX` hex-decoded 32B both Node `hexToBytes` and Python `bytes.fromhex` `hq/app/auth.py:1` + `shared/src/jwt.ts`, compact JSON `separators=(',',':')` cross-verified. Roles `NCPOR_ADMIN>HQ_LOGISTICS>DISPATCH=STATION_LEAD>FIELD_OP>VIEWER` `hq/app/auth.py`. `POST /auth/login` `hq/app/main.py:174` ignores `role` unless `device_id` privileged; `GET /rbac/me` `hq/app/main.py:181` returns `VIEWER READ` unauthenticated. `hq/app/config.py:11` warns if `SECRET_KEY==PSK_HEX` in prod.
- **Live Telemetry:** SSE `hq/app/main.py:347` `asyncio.Queue 100` + `field/app/page.tsx:180 EventSource` fallback 8s poll `hq-dashboard/app/page.tsx:180`; MQTT removed.
- **Audit:** immutable `audit_log` both field `field/lib/db.ts:132` + HQ `hq/app/main.py:232`, expiry override `CONSUME_OVERRIDE_EXPIRED`, replayable.
- **DR:** WAL + `pg_dump` + `VACUUM INTO 'snapshot.db'`, Timescale source of truth, re-bootstrap via snapshot + delta replay. `M5_RUNBOOK.md` checks air-gapped, WAL, budgets `10k 1.38MB wire 231B`, sync, ML `<2MB <200ms`, RBAC/audit/AES.

---

## Testing — Unit / Chaos / Budgets

```powershell
# unit
npm --prefix shared test        # zod, diff, codec roundtrip/CRC/AES <2KB, hex validation
npm --prefix sync-gateway test  # ws, crc, dedupe
pytest hq/tests -v              # ingest, forecast 42/18d, indents lifecycle, RBAC VIEWER, pessimistic lock

# quick (used in verify)
python -m pytest hq/tests -q    # 9 passed 7s (SQLite fallback, no Docker)
npm --prefix hq-dashboard run build  # Next build check (Phase 1.2/1.3)
npm --prefix field run build

# integration / chaos (no Docker — node:sqlite)
node scripts/m1_verify.mjs      # offline 5 → WAL → dedupe + SENT retry budgets
node scripts/m2_verify.mjs      # QR→consume→indent→approve→dispatch→receive + expiry fail-safe + strict machine
node scripts/m3_verify.mjs      # ONNX <2MB <200ms, 42→18d, auto CRITICAL
node scripts/m4_verify.mjs      # 20kbps/500ms/5% throttle, 10k txn <5MB, WAL, RBAC VIEWER, AES
node scripts/m5_verify.mjs      # §10 compliance: air-gapped, WAL, sync, ML, RBAC, domain QR/indent

# all verify
npm run verify                  # m1→m5 sequentially

# e2e Docker
docker compose up --build; pytest hq/tests -k e2e
```

Chaos & budgets asserted in CI at **20 kbps / 500 ms / 5% loss — no crash, convergence <5s, `polaris.db <5MB @10k` `shared/sql/schema.sql:1`, `frame <2KB` `shared/src/codec.ts`**.

After Phase 1, verify specifically:

```powershell
# procurement_targets 3 rows, assets station_id join
python -c "from hq.app.db import init_db, get_conn; init_db(); c=get_conn().execute('SELECT * FROM procurement_targets'); print([dict(r) for r in c.fetchall()])"
curl http://localhost:8000/procurement/targets | jq
curl http://localhost:8000/assets | jq '.[0] | {sku,station_id,container_id}'
# Trend honest: empty trend without ?demo shows no dummy
curl "http://localhost:3001/?demo=1" # vs plain / — check TrendChart
```

---

## Project Structure

```
shared/                 # @polaris/shared TS lib
  src/seed.ts           # SEED_STATIONS/CONTAINERS/CRATES/ASSETS 10-SKU demo (canonical 20-SKU in seed.json)
  src/containers.ts     # CONTAINER_SPECS 6 bays + CRATE_COORDS 12 crates (geometry fallback)
  src/physics.json      # global T_INSIDE 18 BASE 110 K1/K2/K3 (Phase 2 → physics_params per station)
  src/codec.ts/.web.ts  # msgpack+CRC+AES toWire/fromWire/sizeReport hexToBytes validation
  src/indent-machine.ts # ALLOWED DRAFT→APPROVED→DISPATCHED→RECEIVED
  src/expiry.ts         # isExpiringSoon(<30d)/isExpired/daysUntilExpiry
  sql/schema.sql        # canonical DDL 13 tables (procurement_targets + physics_params Phase 1)
  seed.json / physics.json

field/                  # Next 14 PWA :3000 — Offline-first tablet
  app/page.tsx          # FieldPage SPA 5 tabs hash-deep-linked today|inventory|scan|indents|locate
  app/api/health/route.ts # {status:'ok'} hardcoded
  lib/db.ts             # getDb() OPFS /polaris.db WAL + seedIfEmpty + consumeAsset BEGIN IMMEDIATE + createIndent + listAssets (station_id)
  lib/sync.ts           # SyncWorker ws://8787 drain every 2s, PENDING|SENT, downstream
  components/tabs/      # TodayTab, InventoryTab, ScanTab, IndentsTab, LocateTab
  components/Container3D.tsx # Three.js X-Ray (shared specs)
  components/QrScanner.tsx   # html5-qrcode + 8 preset barcodes

sync-gateway/           # Node ws :8787
  src/gateway.ts        # WSS + CRC/AES validation + POST /sync/ingest + broadcast_delta X-PSK

hq/                     # FastAPI :8000 — Python 3.11
  app/main.py           # 640 lines: auth, assets (station_id join), indents, stations/overview, forecast, procurement/*, telemetry/*, sync/ingest
  app/db.py             # init_db Postgres/SQLite, PROCUREMENT_SEED 3 rows, _ensure_procurement_targets_sqlite migration
  app/forecast.py       # load_physics + physics_pred + predict_total (ONNX or fallback)
  app/config.py         # SECRET_KEY==PSK_HEX warning, ALLOWED, STATION_PINS
  app/auth.py           # sign_jwt / get_current_user hex 32B

hq-dashboard/           # Next 14 SOC :3001
  app/page.tsx          # HQPage 7 tabs, station selector, SSE live, procurement edit
  components/TrendChart.tsx # Phase 1.3 empty-state vs ?demo=1 dummy
  components/Container3D.tsx # twin of field

ai/
  training/generate.py  # synthetic 1095 rows physics+noise seed 42
  training/train.py     # 5→16→8→1 1.3KB ONNX
  scaler.json / thermo_residual.onnx
  runner/telemetry_sim.mjs # CALM/BLIZZARD fixture injector POST /telemetry
  runner/infer.mjs

scripts/
  m1_verify.mjs … m5_verify.mjs
  provision_station.mjs # Phase 1.4 PSK_HEX generator + QR
  template_inventory.csv # (Phase 2 scaffold)

docker-compose.yml      # db, hq, gateway, field, hq-dashboard polaris-net pgdata
PLAN.md                 # 4-phase mock→real deep plan
```

---

## Roadmap — 4 Phases to Fully Real

Phase 1 **(done, this PR)** — Quick wins, no external keys: DB `procurement_targets` + `PUT /procurement/targets`, server `station_id` scoping, `TrendChart ?demo=1`, `provision_station.mjs`. Commit `24063fa docs: PLAN` → `eac58d6 phase1.4`.

Phase 2 **(1–2w, no NCPOR data needed)** — Real feeds: `POST /assets/bulk` importer scaffold (keep `seed.json` fallback), `hq/app/telemetry_poller.py` Open-Meteo (free, no key) + optional `IMD_API_KEY` poll every 15m → internal `POST /telemetry`, `physics_params` per-station calibration via `scripts/calibrate_physics.py` `np.linalg.lstsq` on 30d history, `GET /physics/{station}`.

Phase 3 **(2w after Phase 2, needs 30–90d live)** — Real ML: `ai/training/train_real.py` query `telemetry` + `transactions` burn `actual-phys residual`, same `5→16→8→1` export versioned `thermo_residual.v{date}.onnx`, `POST /forecast/retrain` (`NCPOR_ADMIN`), weekly cron `.github/workflows/retrain.yml`.

Phase 4 **(3–6w, answer #3: AIS adaptive)** — Vessel: `vessels(imo, name, lat, lon, sog, eta, station_id)` + `indents.vessel_imo`, `hq/app/vessel_poller.py` `AIS_API_KEY` optional every 15m (`AISHub` free 1/min) cache `/tmp/ais_cache.json`, on `429` or no key fallback `shared/vessel_schedule.json` Sagar Nidhi interpolation, `GET /vessels?station_id=&` + `hq-dashboard/components/VesselMap.tsx` Leaflet overlay (ETA pill if offline tiles), `sync-gateway` downstream for tablets.

Total 6–8w to fully real; Phase 1 alone makes demo *real-data credible* for SIH.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `GET /assets` missing `station_id` | Old `hq/app/hq.db` without migration | `rm hq/app/hq.db*` + restart `uvicorn` — `init_db` `hq/app/db.py:92` recreates + seeds `procurement_targets` |
| `TrendChart` shows dummy 4700L with empty DB | Forgot `?demo=1` is now opt-in | Add `?demo=1` to URL for pitch sample, or `POST /telemetry` one row `curl http://localhost:8000/telemetry -d '{"ts":"...","temp_outside":-15,...}'` |
| `PUT /procurement/targets` 403 | Device not `STATION_LEAD` | Login with `device_id` containing `ADMIN`/`LEAD` `hq/app/main.py:174` e.g. `HQ-ADMIN-01` + `pin BHARATI-2024` |
| `SELECT COUNT(*) FROM procurement_targets` → `no such table` | Old DB pre-Phase 1 | Fixed `hq/app/db.py:56` catches `no such table` and creates table; just restart HQ |
| `SECRET_KEY==PSK_HEX` warning | `.env` copied demo `a*64` for both | Generate distinct `node scripts/provision_station.mjs ST-BHARATI` and set separate `SECRET_KEY` |
| Field `Fully Synced` but HQ not seeing indents | `PSK_HEX` mismatch | Ensure `field NEXT_PUBLIC_PSK_HEX`, `gateway PSK_HEX`, `hq PSK_HEX` same 64hex `docker compose config` |
| `WAL` not persisting after refresh | `SecureContext` missing (http without localhost) | `field/lib/db.ts:43` shows `__polaris_ephemeral` warning — use `localhost` or `https` |
| Build `next build` fails `hexToBytes` | Odd hex length | `scripts/provision_station.mjs` always 64 hex; don’t hand-edit to odd length |

Logs: `hq` `X-Request-ID` `hq/app/main.py:99`, `gateway` `sizeReport` JSON vs mp saving, `field` SyncDrawer `sent/acked/deduped`.

---

## Feasibility

`COST_FEASIBILITY.md` — reuses existing rugged tablet + HQ VM + Iridium link, **₹0** new hardware, 2 days provision for 3 stations (`provision/ST-*.png` QR), `N` stations via `station_id` filter, Rust `tokio/ort` later for RPi hardening.

## Pitch

`PITCH_DECK.md` — 3.5 min: Blizzard cut (msgpack 86% saving, dedupe) + Stockout 42→18d (ML toggle + fallback) + arch (one TS language, Python HQ, Rust future) + feasibility close. Cut order: trends → 2D polish → rest. Add `?demo=1` to dashboard URL for the 7-day trend story when live DB empty.

## Compliance (§10)

`scripts/m5_verify.mjs` checks: air-gapped ✓, WAL ✓, budgets ✓ (10k 1.38MB, wire 231B), sync ✓, ML 1.3KB <2MB <200ms ✓, RBAC/audit/AES ✓, domain QR/indent/RBAC ✓, demo fallback ✓ (now honest — fake trend only with `?demo=1`).

---

## License

MIT — for NCPOR/MoES evaluation. `PLAN.md` is the source of truth for mock→real elimination order.
