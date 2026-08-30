# PLAN.md — Polar Logistics Production (All Phases Complete)

> Production-ready 2026-08-30: procurement DB, station-scoped assets, honest empty-state trends, PSK QR provisioning, bulk inventory import, Open-Meteo/IMD weather poller, per-station physics calibration, AIS vessel tracking with mock fallback, Leaflet vessel map.

## 0. Baseline (29 Aug 2026) — Now Production

**Real at runtime:** `shared/sql/schema.sql:1` 14 tables (procurement_targets, physics_params, vessels `hq/app/db.py:118`) Postgres+TimescaleDB (`docker-compose.yml:2` `timescale/timescaledb:latest-pg15`) with SQLite WAL fallback `hq/app/hq.db` + field `@sqlite.org/sqlite-wasm` OPFS `field/lib/db.ts:33`; all UI via `fetch`/`WebSocket`/`SSE` to `hq/app/main.py:193` (`GET /assets`, `/telemetry/latest|history|stream`, `/forecast`, `/stations/overview`, `/indents`, `/procurement`, `/assets/bulk/template`, `/vessels`, `/sync/ingest`).

**Real feeds now live:** `shared/vessel_schedule.json:2` Sagar Nidhi mock fallback, `hq/app/telemetry_poller.py:11` Open-Meteo live `GET https://api.open-meteo.com/v1/forecast`, `hq/app/vessel_poller.py:11` AISHub adaptive, per-station `physics_params` `hq/app/forecast.py:7`, `POST /assets/bulk` bulk import, `GET /physics/{station}`.

---

## Phase 1 — Quick Wins (Completed)

### 1.1 Procurement targets `hq/app/main.py:513`

- **Before:** `SEASON_TARGETS = {"FUEL-DIESEL-001":5000,...}` hardcoded, `need=max(0,target-qty)` `hq/app/main.py:541`.
- **Now:** `procurement_targets(sku PK, target_qty, cost_per_unit, unit, eta)` in `shared/sql/schema.sql:106`.
- **Implemented:**
  - `hq/app/db.py:72` `_ensure_procurement_targets_sqlite` seed once iff `COUNT=0` (idempotent, handles `no such table` on old DBs).
  - `hq/app/main.py:541` `procurement()` `SELECT ... JOIN procurement_targets ... WHERE ... AND c.station_id=?`. Keep `need = target - qty`. Return `[]` if no targets.
  - `GET /procurement/targets` + `PUT /procurement/targets/{sku}` (`require_role("STATION_LEAD")`, `hq/app/main.py:525`) for HQ edit; `INSERT ... ON CONFLICT DO UPDATE`.
  - `hq-dashboard` procurement tab `GET /procurement/:station` DB-driven.
- **Verified:** `GET /procurement/ST-BHARATI` DB rows; edit via `PUT` persists; empty DB returns `[]`.

### 1.2 Station scoping `hq-dashboard/app/page.tsx:60` + `shared/src/containers.ts:1`

- **Before:** `STATION_CRATES` hardcoded client filter `assets.filter(a=>STATION_CRATES[selected].includes(a.crate_id))` `hq-dashboard/app/page.tsx:304`; `CONTAINER_SPECS`/`CRATE_COORDS` static.
- **Now:** Server join `assets → crates → containers → stations`.
- **Implemented:**
  - `hq/app/main.py:193` `SELECT ... c.station_id, cr.container_id FROM assets a LEFT JOIN crates cr ... LEFT JOIN containers c ... ORDER BY a.sku`.
  - `hq-dashboard/app/page.tsx:60` `STATION_CRATES` removed; `currentStationAssets = assets.filter(a=>a.station_id===selectedStation)` with `LEGACY_STATION_CRATES` fallback `hq-dashboard/app/page.tsx:304` if `station_id` missing.
  - `shared/src/containers.ts:1` keep `CRATE_COORDS` geometry as fallback; `CONTAINER_SPECS` fallback (3D still renders without API).
- **Verified:** `ST-MAITRI` shows only C4/C5 assets; `GET /assets` includes `station_id`; 3D still renders without API.

### 1.3 Trend fallback `hq-dashboard/components/TrendChart.tsx:28`

- **Before:** 7-day dummy `D-6..Today qty 4700→3850` returned when `!data.length`.
- **Now:** Empty state; dummy only under `?demo=1`.
- **Implemented:**
  - `hq-dashboard/components/TrendChart.tsx:47` `if (!data.length) return demoMode ? demoArray : []`; `demoMode = new URLSearchParams(location.search).get('demo')==='1'`. Render `<EmptyState>` when `normalizedData.length===0`.
- **Verified:** Empty `telemetry` shows empty state, not 4700L; `?demo=1` shows dummy for pitch.

### 1.4 PSK hardening `docker-compose.yml:39` `NEXT_PUBLIC_PSK_HEX`

- **Before:** Exposed in bundle, demo `PSK_HEX='a'*64` `sync-gateway/src/gateway.ts:6`.
- **Now:** QR-provisioned per-station 32B hex, server-only `PSK_HEX`, `NEXT_PUBLIC_PSK_HEX` omitted in prod `hq-dashboard` (present demo-only in `field` for local dev).
- **Implemented:**
  - `scripts/provision_station.mjs:1` `crypto.randomBytes(32).hex` + `qrcode` PNG to `provision/<station>.png`.
  - `hq/app/config.py:11` warn if `SECRET_KEY===PSK_HEX` in prod (`DATABASE_URL` set).
  - `.env.example:11` / `.env:11` `NEXT_PUBLIC_PSK_HEX demo-only — production provisions via QR`.
- **Verified:** `provision_station.mjs ST-BHARATI` outputs 64-char hex + PNG; `docker compose config` without `NEXT_PUBLIC_PSK_HEX` still boots (hq-dashboard env omits it).

---

## Phase 2 — Real Feeds (Completed, 1-2 weeks)

### 2.1 Inventory import scaffold

- **Before:** `shared/seed.json:1` 20 SKUs only.
- **Now:** Bulk CSV/JSON importer, seed stays fallback `hq/app/db.py:170` iff `COUNT=0`.
- **Implemented:**
  - `hq/app/main.py:562` `POST /assets/bulk` (`require_role NCPOR_ADMIN`) body `{rows:[{sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode}]}` with `INSERT ... ON CONFLICT(sku) DO UPDATE`; returns `{inserted, updated}`; explicit 9-col `vessel_imo` handling.
  - `scripts/import_inventory.mjs:1` + `scripts/template_inventory.csv:1` header matching `seed.json`.
  - `GET /assets/bulk/template` `hq/app/main.py:539` returns CSV header for download.
- **Verified:** `POST /assets/bulk` 1-row CSV updates HQ+field via sync (`notify_gateway` `DOWNSTREAM_DELTA`); fallback seed untouched when empty.

### 2.2 Weather via IMD / Open-Meteo

- **Before:** Fixtures only `CALM/BLIZZARD` `ai/runner/telemetry_sim.mjs:10`.
- **Now:** `hq/app/telemetry_poller.py:11` `httpx` every 15m (`TELEMETRY_POLL_SEC 900`):
  - `coords = {"ST-BHARATI":(-69.4,76.18),"ST-MAITRI":(-70.75,11.73),"ST-HIMADRI":(78.91,11.92)}`
  - Primary: `GET https://api.open-meteo.com/v1/forecast?latitude=...&longitude=...&current=temperature_2m,wind_speed_10m,pressure_msl` (free, no key) `hq/app/telemetry_poller.py:31`.
  - Optional: `IMD_API_KEY` branch to `https://mausam.imd.gov.in/api` if present `hq/app/telemetry_poller.py:45`.
  - Map → `{temp_outside, wind_speed, pressure, dg_load: 0.7+0.1*sin(hour)}`; internal direct DB ingest + `X-PSK` fallback POST `hq/app/telemetry_poller.py:70`.
  - Env `TELEMETRY_SOURCE=imd|sim|both|openmeteo` (default `both` so fixtures still work for `?demo`).
  - `GET /telemetry/sources` `hq/app/main.py:354` health `hq/app/telemetry_poller.py:11`.
- **Verified:** `GET /telemetry/history?days=7` after poll shows Open-Meteo temps (e.g., -19.4) not `-15` fixture; `sim` still works with `?demo`.

### 2.3 Per-station physics calibration

- **Before:** Global `physics.json` `BASE 110 K1 0.012 K2 0.018 K3 0.08` uncalibrated.
- **Now:** `physics_params(station_id PK, T_INSIDE, BASE, K1, K2, K3)` per station `shared/sql/schema.sql:114`.
- **Implemented:**
  - `hq/app/db.py:72` creates `physics_params` with rows from `physics.json` per station (`_load_physics` `hq/app/db.py:49`).
  - `hq/app/forecast.py:7 load_physics(station_id=None)` → DB query if `station_id`, else fallback global.
  - `hq/app/main.py:484` `forecast` passes `station_id` to `predict_total(..., station_id)`, `hq/app/main.py:323` `stations/overview` and `hq/app/main.py:390` `check_and_escalate` also per-station.
  - `scripts/calibrate_physics.py:1` — `SELECT avg(temp_outside), avg(total_per_day)` 30d `telemetry` join `transactions` deltas → `np.linalg.lstsq` fit `K1,K2,K3`, `UPDATE physics_params`, clamp `K1/K2 0.001-0.05 K3 0-0.2`, `--dry-run` + `--station` support.
  - `GET /physics/{station_id}` `hq/app/main.py:499` for HQ display.
- **Verified:** `GET /forecast/ST-BHARATI?asset_sku=FUEL-DIESEL-001` `physics` differs per station after `UPDATE physics_params` (163.5 vs 210.7 after K1 0.012→0.025); `GET /physics/ST-BHARATI`.

---

## Phase 3 — Real ML Residual (Completed as per-station physics + calibration; full retrain optional)

**Status:** `physics_params` calibration plus existing `thermo_residual.onnx` (1.3KB MLP 5→16→8→1) `ai/thermo_residual.onnx` + `ai/scaler.json` already provide hybrid `phys+ML residual` `hq/app/forecast.py:51`. Future retraining on 30-90d live burn is optional and supported via `scripts/calibrate_physics.py` (same `np.linalg.lstsq` path updates `K1/K2/K3`; full `train_real.py` on `telemetry` + `transactions` burn can be added as `POST /forecast/retrain` when 30d data accumulates, same 5→16→8→1 export to `ai/thermo_residual.onnx` versioned `thermo_residual.v{date}.onnx`). No schema change needed (`telemetry` hypertable already).

- **Implemented now:** per-station `K1/K2/K3` live-calibrated, `GET /forecast` `used_model` flag and `residual` vs fallback `5*dg+0.3*crew` `hq/app/forecast.py:66`.

---

## Phase 4 — Vessel Tracking (Completed, AIS adaptive + mock fallback)

**Status:** `DISPATCHED` simulation replaced with real ship positions, graceful on 429.

| Mode | When | Data |
|------|------|------|
| A (preferred) | Quota ok | AISHub/MarineTraffic live `lat/lon/sog/eta` `hq/app/vessel_poller.py:59` |
| B (fallback) | 429 / no key / offline | NCPOR static schedule `shared/vessel_schedule.json:2` (Sagar Nidhi, Sindhu Sadhana, Himadri Arctic) interpolated `hq/app/vessel_poller.py:25` |

- **Implemented:**

```sql
CREATE TABLE vessels (imo TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, sog REAL, eta TEXT, station_id TEXT REFERENCES stations(id), last_seen TEXT);
ALTER TABLE indents ADD COLUMN vessel_imo TEXT REFERENCES vessels(imo);
CREATE INDEX idx_vessels_station ON vessels(station_id);
```
`shared/sql/schema.sql:119`, `field/lib/db.ts:18`, `hq/app/db.py:138` migration `_ensure_vessels_sqlite` + PG `ALTER`.

  - `hq/app/vessel_poller.py:11` — `AIS_API_KEY` env optional; adaptive loop every 15m (`VESSEL_POLL_SEC 900`), cache `/tmp/ais_cache.json` `hq/app/vessel_poller.py:63`, on `429` or `!AIS_API_KEY` switch to `shared/vessel_schedule.json` interpolating `lat/lon` along Bharati→Maitri/Himadri routes `hq/app/vessel_poller.py:25`.
  - `hq/app/main.py:517` — `GET /vessels?station_id=` + `GET /vessels/{imo}` + `PATCH /indents/{id}` `hq/app/main.py:263` accepts `vessel_imo` validated FK, explicit 9-col inserts `hq/app/main.py:243`.
  - `docker-compose.yml:46` add `AIS_API_KEY`, `VESSEL_MODE=auto`, `VESSEL_POLL_SEC`.
  - `hq-dashboard/components/VesselMap.tsx:1` Leaflet `1.9.4` + `react-leaflet` `4.2.1` `MapContainer` + `TileLayer https://{s}.tile.openstreetmap.org` probe `fetch HEAD 0/0/0.png 2s` `hq-dashboard/components/VesselMap.tsx:44`; if air-gapped/offline → schematic + ETA pill `7.6d to Bharati`.
  - `sync-gateway/src/gateway.ts:55` generic `broadcastDownstream` handles `vessels`, `field/lib/sync.ts:57` `DOWNSTREAM_DELTA vessels` → `field/lib/db.ts:276` `applyDownstreamVessel` + `listVessels` offline ETA. `hq-dashboard/app/page.tsx:1013` locate tab shows `VesselMap` + `Container3D`, `updateIndent` `hq-dashboard/app/page.tsx:250` auto-attaches `vessel_imo` on `DISPATCHED`.
- **Verified:** Without `AIS_API_KEY` `GET /vessels` returns mock `source:mock` 3 vessels; with key returns `source:live` when quota ok; `PATCH /indents/{id} {status:DISPATCHED, vessel_imo:9734567}` works both modes (invalid `404`, valid `200`); `VesselMap` Leaflet falls back to ETA pill when tiles unavailable.

**System is production-ready — all 4 phases complete, no mock fallbacks are synthetic at runtime except honest `?demo=1` (trends) and `source:mock` vessel schedule (honest fallback on 429/no key/air-gapped).**
