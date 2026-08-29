# PLAN.md — Polar Logistics Mock → Real Data (4 Phases)

> Answers baked in: (1) No master inventory yet → importer scaffold with seed fallback. (2) No AWS hardware → IMD / Open-Meteo poller. (3) AIS API with adaptive throttle + mock schedule fallback.

## 0. Baseline (29 Aug 2026)

**Real at runtime:** `shared/sql/schema.sql:1` + `hq/app/db.py:50` Postgres+TimescaleDB (`docker-compose.yml:2` `timescale/timescaledb:latest-pg15`) with SQLite WAL fallback `hq/app/hq.db` + field `@sqlite.org/sqlite-wasm` OPFS `field/lib/db.ts:31`; all UI via `fetch`/`WebSocket`/`SSE` to `hq/app/main.py:188` (`GET /assets`, `/telemetry/latest|history|stream`, `/forecast`, `/stations/overview`, `/indents`, `/procurement`, `/sync/ingest`).

**Mock / hardcoded:** `shared/seed.json:1` 20 SKUs (qty/expiry), `shared/src/containers.ts:1` `CONTAINER_SPECS` + `CRATE_COORDS`, `hq-dashboard/app/page.tsx:60` `STATION_CRATES` client filter, `shared/src/telemetry-fixtures.ts:1` `CALM/BLIZZARD`, `ai/runner/telemetry_sim.mjs:10` `makeTelemetry`, `shared/src/physics.json:1` global `BASE 110 K1 0.012 K2 0.018 K3 0.08`, `ai/training/generate.py:12` `random.seed(42)` synthetic 1095-row `weather_fuel_history.csv` → `ai/thermo_residual.onnx` (1.3KB MLP 5→16→8→1) + `ai/scaler.json`, fallback `hq/app/forecast.py:66` `5*dg+0.3*crew-2`, `hq/app/main.py:467` `SEASON_TARGETS` + `UNIT_MAP`, `hq-dashboard/components/TrendChart.tsx:31` 7-day dummy, `PS K_HEX='a'*64` + `NEXT_PUBLIC_PSK_HEX` demo exposure, no vessel tracking (only `DISPATCHED` status via `hq/app/main.py:54 notify_gateway` `X-PSK`).

---

## Phase 1 — Quick Wins (3 days, zero external deps)

**Goal:** Remove 4 hardcoded mocks that read as "fake data" with pure code, no keys. No schema break.

### 1.1 Procurement targets `hq/app/main.py:467`

- **Now:** `SEASON_TARGETS = {"FUEL-DIESEL-001":5000,...}` + `UNIT_MAP` hard-coded, `need=max(0,target-qty)` `hq/app/main.py:473`.
- **Real:** `procurement_targets(sku TEXT PRIMARY KEY, target_qty REAL, cost_per_unit REAL, unit TEXT, eta TEXT)` in `shared/sql/schema.sql`.
- **Changes:**
  - `hq/app/db.py:50 init_db` — after Timescale extension create `procurement_targets` if not exists, seed once from existing map iff `SELECT COUNT(*)=0` (idempotent).
  - `hq/app/main.py:464 procurement()` — `SELECT a.sku,a.name,a.qty,a.unit, t.target_qty,t.cost_per_unit,t.eta FROM assets a JOIN procurement_targets t ON t.sku=a.sku ... WHERE a.sku IN (SELECT sku FROM procurement_targets) AND c.station_id=?`. Keep `need = target - qty` math. Return `[]` if no targets for station.
  - New `GET /procurement/targets` + `PUT /procurement/targets/{sku}` (`require_role("NCPOR_ADMIN")`, `hq/app/main.py:254` pattern) for HQ edit; `POST /procurement/targets` upsert.
  - `hq-dashboard` procurement tab already calls `GET /procurement/:station` — no UI change, just numbers now DB-driven.
- **Acceptance:** `GET /procurement/ST-BHARATI` returns DB rows; edit via `PUT` persists; empty DB returns `[]` not crash.

### 1.2 Station scoping `hq-dashboard/app/page.tsx:60` + `shared/src/containers.ts:1`

- **Now:** `STATION_CRATES` hardcoded client filter `assets.filter(a=>STATION_CRATES[selected].includes(a.crate_id))` `hq-dashboard/app/page.tsx:300`; `CONTAINER_SPECS`/`CRATE_COORDS` static.
- **Real:** Server join `assets → crates → containers → stations`.
- **Changes:**
  - `hq/app/main.py:188 list_assets()` → `SELECT a.*, cr.container_id, c.station_id FROM assets a JOIN crates cr ON a.crate_id=cr.id JOIN containers c ON cr.container_id=c.id ORDER BY a.sku` (add `station_id`, `container_id` to payload).
  - `hq-dashboard/app/page.tsx:60` — delete `STATION_CRATES`; `currentStationAssets = assets.filter(a=>a.station_id===selectedStation)`. Remove dead const.
  - `shared/src/containers.ts:1` — keep `CRATE_COORDS` geometry as fallback; `CONTAINER_SPECS` becomes fallback if `GET /stations/overview` returns `containers` array. Add `useEffect` in `hq-dashboard/components/Container3D.tsx` and `field/components/Container3D.tsx` to prefer API specs when present.
- **Acceptance:** `ST-MAITRI` shows only C4/C5 assets; `GET /assets` includes `station_id`; 3D still renders without API.

### 1.3 Trend fallback `hq-dashboard/components/TrendChart.tsx:31`

- **Now:** 7-day dummy `D-6..Today qty 4700→3850` returned when `!data.length`.
- **Real:** Empty state; dummy only under `?demo=1`.
- **Changes:**
  - `hq-dashboard/components/TrendChart.tsx:29 normalizedData` — `if (!data.length) return demoMode ? demoArray : []`; add `const demoMode = typeof window!=='undefined' && new URLSearchParams(location.search).get('demo')==='1'`. Render `<EmptyState>` when `normalizedData.length===0` (text: "No telemetry yet — post first /telemetry or enable ?demo=1").
- **Acceptance:** Empty `telemetry` shows empty state, not 4700L; `?demo=1` still shows dummy for pitch.

### 1.4 PSK hardening `docker-compose.yml:98` `NEXT_PUBLIC_PSK_HEX`

- **Now:** Exposed in bundle, demo `PSK_HEX='a'*64` `sync-gateway/src/gateway.ts:6`.
- **Real:** QR-provisioned per-station 32B hex, server-only `PSK_HEX`, `NEXT_PUBLIC_PSK_HEX` omitted in prod.
- **Changes:**
  - Add `scripts/provision_station.mjs` — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` + `qrcode` PNG to `provision/<station>.png`. Doc: run once per station.
  - `hq/app/config.py` warn if `SECRET_KEY===PSK_HEX` in prod (`DATABASE_URL` set).
  - `README.md` + `.env.example:10` comment: `NEXT_PUBLIC_PSK_HEX demo-only — production provisions via QR and not expose`.
- **Acceptance:** `provision_station.mjs ST-BHARATI` outputs 64-char hex + PNG; `docker compose config` without `NEXT_PUBLIC_PSK_HEX` still boots.

**Phase 1 verification:** `npm --prefix shared test`, `pytest hq/tests -v`, manual `docker compose up --build` + `GET /health`, `GET /assets` has `station_id`, `GET /procurement` DB-driven, `?demo=1` toggle.

---

## Phase 2 — Real Feeds Without NCPOR Data (1-2 weeks)

**Goal:** Replace synthetic weather + uncalibrated physics + seed-bound inventory. Works today.

### 2.1 Inventory import scaffold (no data needed now)

- **Now:** `shared/seed.json:1` 20 SKUs only.
- **Real:** Bulk CSV/JSON importer, seed stays fallback `hq/app/db.py:78` iff `COUNT=0`.
- **Changes:**
  - `hq/app/main.py` — `POST /assets/bulk` (`require_role NCPOR_ADMIN`) body `{rows:[{sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode}]}` with `INSERT ... ON CONFLICT(sku) DO UPDATE`; returns `{inserted, updated}`.
  - `scripts/import_inventory.mjs` + `scripts/template_inventory.csv` (header matching `seed.json`).
  - `GET /assets/bulk/template` returns CSV header for download.
- **Acceptance:** `POST /assets/bulk` 1-row CSV updates HQ+field via sync; fallback seed untouched when empty.

### 2.2 Weather via IMD / Open-Meteo (answer #2)

- **Now:** Fixtures only.
- **Real:** `hq/app/telemetry_poller.py` + `httpx` APScheduler every 15m:
  - `coords = {"ST-BHARATI":(-69.4,76.18),"ST-MAITRI":(-70.75,11.73),"ST-HIMADRI":(78.91,11.92)}`
  - Primary: `GET https://api.open-meteo.com/v1/forecast?latitude=...&longitude=...&current=temperature_2m,wind_speed_10m,pressure_msl` (free, no key, CORS ok).
  - Optional: `IMD_API_KEY` branch to `https://mausam.imd.gov.in/api` if present.
  - Map → `{temp_outside, wind_speed, pressure, dg_load: 0.7+0.1*sin(hour)}`; internal `POST http://localhost:8000/telemetry` with `X-PSK`.
  - Env `TELEMETRY_SOURCE=imd|sim|both` (default `both` in dev so fixtures still work for `?demo`).
  - `GET /telemetry/sources` health.
- **Acceptance:** `GET /telemetry/history?days=7` after 1h shows Open-Meteo temps not `-15` fixture; `fixtures` still work with `?demo`.

### 2.3 Per-station physics calibration

- **Now:** Global `physics.json` uncalibrated.
- **Real:** `physics_params(station_id PK, T_INSIDE, BASE, K1, K2, K3)` per station.
- **Changes:**
  - `hq/app/db.py:init_db` creates `physics_params` with rows from `physics.json` per station.
  - `hq/app/forecast.py:7 load_physics(station_id=None)` → DB query if `station_id`, else fallback global.
  - `hq/app/main.py:450 forecast` passes `station_id`.
  - `scripts/calibrate_physics.py` — `SELECT avg(temp_outside), avg(total_per_day)` 30d `telemetry` join `transactions` deltas → `np.linalg.lstsq` fit `K1,K2,K3`, `UPDATE physics_params`.
  - `GET /physics/{station_id}` for HQ display.
- **Acceptance:** `GET /forecast/ST-BHARATI` `physics` differs per station after calibration.

---

## Phase 3 — Real ML Residual (2 weeks after Phase 2, needs 30-90d live telemetry)

**Goal:** Retrain `thermo_residual.onnx` on real `telemetry` + consumption deltas, replace `ai/training/generate.py:12` synthetic.

- **Changes:**
  - No schema change; `telemetry` hypertable already.
  - `ai/training/train_real.py` (mirrors `ai/training/train.py:51`): `psycopg` query `SELECT t.temp_outside,t.wind_speed,t.pressure,s.winter_crew_count,t.dg_load, physics_pred(...) as phys, actual_burn` where `actual_burn = -SUM(transactions.qty_delta WHERE type IN('CONSUME','OUT') GROUP BY date(ts))`; `residual=actual-phys`; same 5→16→8→1 export to `ai/thermo_residual.onnx` + `ai/scaler.json` (versioned `thermo_residual.v{date}.onnx`).
  - `POST /forecast/retrain` (`NCPOR_ADMIN`) triggers `train_real.py` via subprocess.
  - `.github/workflows/retrain.yml` weekly cron `docker exec hq python ai/training/train_real.py`.
- **Acceptance:** `POST /forecast/retrain` after 30d produces new `.onnx` with different weights; `GET /forecast` `used_model=true` and `residual` diverges from `5*dg+0.3*crew` fallback `hq/app/forecast.py:66`.

---

## Phase 4 — Vessel Tracking (3-6 weeks, answer #3: AIS API adaptive + mock fallback)

**Goal:** Replace `DISPATCHED` simulation (`hq/app/main.py:254`, `check_and_escalate:405`) with real ship positions, graceful on 429.

| Mode | When | Data |
|------|------|------|
| A (preferred) | Quota ok | AISHub/MarineTraffic live `lat/lon/sog/eta` |
| B (fallback) | 429 / no key | NCPOR static schedule `shared/vessel_schedule.json` (e.g., Sagar Nidhi) interpolated |

- **Changes:**
```sql
CREATE TABLE vessels (imo TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, sog REAL, eta TEXT, station_id TEXT REFERENCES stations(id), last_seen TEXT);
ALTER TABLE indents ADD COLUMN vessel_imo TEXT REFERENCES vessels(imo);
CREATE INDEX idx_vessels_station ON vessels(station_id);
```
  - `hq/app/vessel_poller.py` — `AIS_API_KEY` env optional; adaptive loop: try `GET https://data.aishub.net/ws.php?...` every 15m, cache `/tmp/ais_cache.json`, on `429` or `!AIS_API_KEY` switch to `shared/vessel_schedule.json` interpolating `lat/lon` along Bharati→Maitri route.
  - `hq/app/main.py` — `GET /vessels?station_id=` + `GET /vessels/{imo}` + `PATCH /indents/{id}` accepts `vessel_imo`.
  - `docker-compose.yml:42` add `AIS_API_KEY`, `VESSEL_MODE=auto`.
  - `hq-dashboard/components/VesselMap.tsx` Leaflet overlay on `locate` tab; falls back to ETA pill if air-gapped tiles unavailable.
  - `sync-gateway/src/gateway.ts:185` broadcast `DOWNSTREAM_DELTA` for `vessels` so field gets ETA offline.
- **Acceptance:** With `AIS_API_KEY` set `GET /vessels` returns live positions; without key or on 429 returns schedule mock with `source:mock`; `PATCH /indents/{id} {status:DISPATCHED, vessel_imo}` works both modes.

**Dependencies:** Phase1 → Phase2 (2.1/2.2 parallel, 2.3 after 2.2) → Phase3 (needs Phase2 30d) → Phase4 (independent, last). Total 6-8w to fully real; Phase1 alone makes demo "real-data" credible for SIH.

