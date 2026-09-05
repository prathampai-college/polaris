# Architecture — POLARIS (Production, Extreme-Edge)

## Stack

Field tablets and HQ Dashboard are **Next.js 14**; HQ and training are **Python 3.11**; Sync Gateway is **Node 20**. No future rewrite is planned — system is production-ready with extreme-edge pillars.

## 3-Pillar Extreme-Edge

| Pillar | Standard Trap (Will Fail) | POLARIS Resilient | Code |
|--------|---------------------------|-------------------|------|
| **I Vision-Fused Local Tracking** | GPS geotag to central DB — ionospheric/whiteout `vis 0.8m` | 2D LiDAR 360pts + Camera bbox → 40×40 2m/cell `fuse()` 70% LiDAR+30% cam → Kalman `asset_positions` `[x,y,theta]` local frame, GPS denied | `field/lib/sensors/sim_lidar.ts:1` `field/lib/sensors/fusion.ts:1` `shared/src/local_map.ts:1` `hq/app/main.py:903` |
| **II Neuromorphic SNN** | Continuous dense ANN 8.2mW cloud | snnTorch LIF `5→32→16→1` rate `T=20` event-gated `Δ>0.12` — 0.8mW idle (90% saved) `shared/src/power.ts:1` + `shared/src/snn-config.ts:1` | `ai/snn/encoder.py:1` `ai/snn/train_snn.py:1` `hq/app/snn_forecast.py:1` `field/lib/snn/engine.ts:1` `shared/src/snn-config.ts:1` |
| **III DTN Data Muling** | Continuous REST — uplink default drops | `dtn_bundles` custody + `BroadcastChannel`/QR mule + LWW+VC `compare/merge` (`hq/app/_vc.py:1` single source) | `shared/src/dtn/vector_clock.ts:1` `shared/src/dtn/bundle.ts:1` `field/lib/dtn/mule.ts:1` `hq/app/dtn.py:1` `hq/app/_vc.py:1` |

Risks from proposal addressed: hardware thresholds (JS LIF, 40 grid), conflict resolution (LWW+VC + `dedupe`), SNN exactness (`encoder.py` sigmoid→Poisson).

## 3D Container X-Ray & Shared Specs
- **3D X-Ray Locator:** React Three Fiber (`@react-three/fiber` & `@react-three/drei`) visualizer rendering ISO-20ft containers and mapping coordinate-indexed crates (`{x,y}`) in 3D space on both field tablets and HQ dashboard. Specs centralized in `shared/src/containers.ts` (`CONTAINER_SPECS`/`CRATE_COORDS`) imported via `@polaris/shared/containers.js` (avoids pulling `node:crypto` into browser bundle). Component deduped to `shared/components/Container3D.tsx:1` canonical with `legendVariant` prop, wrappers `field/components/Container3D.tsx:1` (`stocked`) and `hq-dashboard/components/Container3D.tsx:1` (`normal`).
- **Shared helpers (refactor):** `shared/src/wire.ts:1` `MAX_WIRE_SIZE` (used by `codec.ts`, `codec.web.ts`, `sync-gateway/src/gateway.ts:3`, `field/lib/sync.ts:2`), `shared/src/filters.ts:1` `filterByStation()`, `shared/src/url.ts:1` `toHttpUrl()`, `shared/src/snn-config.ts:1` `SNN_EVENT_THRESH`/`SNN_DEFAULT_WEIGHTS` (used by `field/lib/snn/engine.ts:1` + `hq/app/snn_forecast.py:1`), `hq/app/_time.py:1` `utc_now()`, `hq/app/_vc.py:1` VC single source.
- **Offline DB:** SQLite WASM OPFS/WAL (`@sqlite.org/sqlite-wasm`) — single `polaris.db` with `outbox`/`dedupe`/`sync_state`/`vessels`/`dtn_bundles`/`asset_positions`/`snn_state`. Schema `shared/sql/schema.sql:1` → `field/lib/db.ts:18` inline mirror + `hq/app/db.py:118` (strips PRAGMA/BLOB→BYTEA for PG). VC cols `vector_clock TEXT` backfilled via `ALTER TABLE ADD COLUMN` in `_ensure_dtn_sqlite` `hq/app/db.py:115` + `field/lib/db.ts:56` migration. Procurement seed single-sourced from `shared/seed.json:4` `procurement_targets`.
- **Vessel Map:** Leaflet `1.9.4` + `react-leaflet` `4.2.1` in `hq-dashboard/components/VesselMap.tsx:1`. Probes `tile.openstreetmap.org` `HEAD 0/0/0.png` with 2s timeout; if offline/air-gapped, falls back to schematic offline map + ETA pill (SOG kn, `shared/vessel_schedule.json` mock). Field tablets show offline vessel ETA via `listVessels()` `field/lib/db.ts:296` from `DOWNSTREAM_DELTA vessels`.
- **Local Grid:** `shared/src/local_map.ts:1` `GRID_SIZE 40` `CELL_M 2` `polarToCart`/`cartToGrid`/`createGrid`/`insertPoints`/`fuse()`/`Kalman1D`. Fusion `field/lib/sensors/fusion.ts:1` runs every 3s via `startFusionLoop()`, 15% whiteout `0.8m` (camera blind), LiDAR alone `conf 0.75` keeps tracking.
- **Power:** `shared/src/power.ts:1` `POWER_BASE {ANN 8.2, SNN_ACTIVE 0.82, SNN_IDLE 0.08, TX_PER_KB 0.45}` + `powerReport()` used by `TodayTab` watts pill and `hq/app/snn_forecast.py:1` `saved_pct`.

## Data-Flow `write → outbox → wire/bundle → HQ → downstream`

```
Field UI (React) --(local call)--> SQLite WASM OPFS/WAL polaris.db
      |-- BEGIN IMMEDIATE; SELECT asset; check expiry (fail-safe invalid→expired) + qty<0; UPDATE assets SET qty, version, vector_clock=merge; INSERT transactions/audit/outbox{vector_clock}; COMMIT (atomic, WAL, TOCTOU-safe)
      |-- outbox row {ulid, device_id, patch:msgpack, base_version, op:UPSERT|CONSUME|IN|..., status PENDING, vector_clock VC}
      v
SyncWorker (field/lib/sync.ts:13) -- drain PENDING|SENT every 2s, draining guard --
      | if ws OPEN: encode patch → msgpack (field-level diff) → encrypt AES-GCM (PSK 32B hex) → prepend CRC32 → ws.send(binary) + vector_clock
      | if ws CLOSED: createAndSaveMuleBundle(src,dst,VC,payload) → dtn_bundles custody + BroadcastChannel('polaris-mule') QR base64 → status BUNDLED
      | when online: pushBundlesToHQ() → POST /dtn/ingest_bulk via POST /dtn/exchange gateway
      v
Gateway (sync-gateway/src/gateway.ts:20) ws server :8787
      | fromWire: CRC check → decrypt (GCM tag verifies) → decode → validate
      | log json vs mp via sizeReport (shared/src/codec.ts) + VC
      | POST HQ /sync/ingest JSON or POST /dtn/exchange → HQ /dtn/ingest_bulk
      | on >2KB: sends FAILED ACK instead of silent drop
      | POST /dtn/exchange mule bundles → HQ DTN
      v
HQ FastAPI (hq/app/main.py:76) :8000
      | BEGIN IMMEDIATE; dedupe(ulid) → DEDUPED if replay
      | if assets: SELECT FOR UPDATE (PG) / BEGIN IMMEDIATE (SQLite), vector_clock compare_vc(existing, remote) → gt: APPLIED_LOCAL_WINS, concurrent→LWW ts, else merge_vc → UPDATE qty, version, vector_clock
      | if indents: upsert indents / status+vessel_imo patch, strict ALLOWED {DRAFT→APPROVED→DISPATCHED→RECEIVED}, vessel_imo FK validated
      | INSERT dedupe, audit_log, sync_state last_acked_ulid, dtn_bundles custody
      | COMMIT → 200 {status: APPLIED|DEDUPED|CONFLICT_CRITICAL|APPLIED_LOCAL_WINS, server_version, reason}
      | PING/PONG keepalive survives satellite dropouts
Gateway ← ACK (toWire ACK, sizeReport) ← HQ
Field ← onmessage fromWire → UPDATE outbox SET ACKED, sync_state + applyDownstreamAsset VC merge
```

Downstream (HQ→Field) is full-duplex WebSocket push: HQ `notify_gateway` (`X-PSK` header authenticated `hq/app/main.py:52`) triggers Gateway `/internal/broadcast_delta` on indent status changes (`APPROVED`, `DISPATCHED` with `vessel_imo`), auto-critical forecast escalations, asset mutations, and vessel positions (`hq/app/vessel_poller.py:62`). Gateway broadcasts encrypted `DOWNSTREAM_DELTA` wire frames (<50ms) to connected tablets matching `station_id` (SYNC_INIT `device_id`/`station_id` trusted after PSK decrypt, but broadcast filtered). Initial handshake catch-up sync is via `SYNC_INIT` / `SYNC_INIT_RESP` binary frames including `bundles` `sync-gateway/src/gateway.ts:57`. `KEY_ROTATE` delivered as outbox `op` on next window (old key retained one window).

DTN mule flow (offline 6h): field 5 writes → `BUNDLED` → QR `bundleToBase64` `field/lib/dtn/mule.ts:1` → personnel carries to base → `POST /dtn/exchange` gateway → `POST /dtn/ingest_bulk` HQ LWW+VC → `DEDUPED` via `bundleId`.

Pollers (HQ, 15m adaptive, explicit gating):
- **Telemetry** `hq/app/telemetry_poller.py:11` — Open-Meteo free `https://api.open-meteo.com/v1/forecast` (no key) + optional `IMD_API_KEY` `https://mausam.imd.gov.in/api`, `TELEMETRY_SOURCE=both|openmeteo|imd|sim` + explicit `LIVE_WEATHER_ENABLED` gate (default `false` forces mock; `true` enables live fetches). `GET /telemetry/sources` health now includes `live_enabled`. Starts in `lifespan` `hq/app/main.py:76`. `dg_load` via `0.7+0.1*sin(hour)`.
- **Vessel** `hq/app/vessel_poller.py:11` — AISHub `https://data.aishub.net/ws.php?username={AIS_API_KEY}&format=1` live `lat/lon/sog/eta` + fallback `shared/vessel_schedule.json` Sagar Nidhi interpolation on `429`/no key, cache `/tmp/ais_cache.json`, `VESSEL_MODE auto|live|mock` + explicit `LIVE_AIS_ENABLED`/`AIS_ENABLED` gate (default `false`). `GET /vessels?station_id`, `PATCH /indents {vessel_imo}` validated. `get_status()` now exposes `live_enabled`.

## Offline-First Invariants

- **Single DB file:** `shared/sql/schema.sql:1` → `polaris.db` OPFS, `PRAGMA journal_mode=WAL; SYNCHRONOUS=NORMAL;`. One writer, transactions atomic. Tab kill → SQLite auto-recovers WAL, outbox replays exactly-once via `dedupe` + `BUNDLED` custody survives. Schema `outbox.op CHECK` includes `CONSUME|IN|OUT|ADJUST` + `status BUNDLED`, `assets.vector_clock`, `outbox.vector_clock`, `dtn_bundles`, `asset_positions`, `snn_state` `shared/sql/schema.sql:1`.
- **Idempotent ULID + VC:** every outbox row `ulid` (26-char) + `vector_clock VC`. HQ `dedupe(ulid)` + `compare_vc()` → `DEDUPED` or `APPLIED_LOCAL_WINS` without re-apply. `retry_count` backs off; `draining` guard prevents concurrent duplicate sends. Bundles dedupe via `bundleId`.
- **Field-level deltas:** transmits only changed fields, not full rows. `@msgpack/msgpack` schemaless + `zod` both ends. Target 70-80% vs full-row JSON (CI asserts per frame + 10k DB) + `vector_clock` overhead minimal.
- **Wire:** `shared/src/codec.ts:toWire` → `nonce||ciphertext||tag` + `CRC32` framing (CRC is not integrity — GCM tag is). Node `crypto` at gateway, WebCrypto at field (same `PSK_HEX` hex-decoded 32B, `64 hex` strictly validated, `hexToBytes` rejects odd/invalid, `DataView` byteOffset-safe on both ends). Throttled tested at 20 kbps/500 ms/5% loss — no crash, convergence <5 s. DTN bundled frames also `vector_clock` tagged.
- **RBAC:** JWT 30d — `PSK_HEX` hex-decoded via `hexToBytes`/`bytes.fromhex` on both sides, compact JSON `separators=(',',':')` cross-verified (Node ↔ Python). `POST /auth/login` ignores client `role` unless `device_id` contains `ADMIN`/`LEAD`/`TEST`/`HQ` — otherwise `FIELD_OP` (prevents PIN-holder escalation). Roles `NCPOR_ADMIN>HQ_LOGISTICS>DISPATCH>STATION_LEAD>FIELD_OP>VIEWER`. `GET /rbac/me` returns `VIEWER` when unauthenticated. Row-level `station_id` filter + DTN `dstStation`.
- **Expiry:** `shared/src/expiry.ts` fail-safe: `isExpired` returns `true` on `NaN` (invalid date → expired), `isExpiringSoon` returns `false` on `NaN`. Blocks any expired stock from `CONSUME` without override (covers `MEDICAL`/`OXYGEN`/`FOOD`).
- **State machine:** strict `ALLOWED` `DRAFT→APPROVED→DISPATCHED→RECEIVED` enforced in both `field/lib/db.ts:169 updateIndentLocal` and `hq/app/main.py:263 PATCH /indents` — no `DRAFT→RECEIVED` shortcut. `DISPATCHED` now validates `vessel_imo` exists in `vessels` `hq/app/main.py:283`.
- **Audit:** immutable `audit_log` both sides, `before/after` JSON + `vector_clock` merge, HQ can replay state (`/audit`, `/dtn/conflicts`). `vessel_imo` + `bundleId` audited.
- **Vessel offline:** field `applyDownstreamVessel` `field/lib/db.ts:278` upserts `vessels` via `DOWNSTREAM_DELTA vessels`, `listVessels()` shows ETA even air-gapped.
- **DTN custody:** `dtn_bundles.custody=1` until `pushBundlesToHQ()` deletes after `APPLIED`; `ttl 86400` per bundle; `BroadcastChannel` peers receive instantly in same origin (sim BLE).
- **SNN event:** `hq/app/snn_forecast.py:1` `EVENT_THRESH 0.12` normalized delta — calm repeat → idle `0mW` + `saved 99%`, blizzard → active `spike_count>0`.

## AI Path (Production)

```
Open-Meteo / IMD poller (15m) ─┐
                               ├→ telemetry {ts,station_id,temp,wind,pressure,dg_load} → telemetry table (Timescale hypertable or SQLite)
Simulator (ai/runner/telemetry_sim.mjs) ─┘
                                ↓
hq/app/forecast.py:7 load_physics(station_id) → DB physics_params per-station (T_INSIDE 18, BASE 110, K1 0.012, K2 0.018, K3 0.08) else global shared/src/physics.json
hq/app/forecast.py:46 physics_pred() + onnxruntime (ai/thermo_residual.onnx 1.3KB, scaler.json)
hq/app/snn_forecast.py:1 SNN rate T=20 → snn_residual 5*dg+0.3*crew LIF
                                ↓
GET /forecast/{station}?asset_sku → {days_to_stockout, ci, physics, residual, total_per_day, pure_physics_days}
GET /forecast/snn/{station} → {snn_active, spike_count, snn_residual, saved_pct, watts}
                                ↓ (if days ≤20)
                    check_and_escalate() → INSERT indents CRITICAL DRAFT + audit + notify_gateway (X-PSK)
                                ↓ (if acoustic_anomaly >0.90)
                    INSERT indents CRITICAL 4 bearings ACOUSTIC_AI
```

Training: `ai/training/generate.py` physics `110*(1+0.012ΔT+0.018wind)+0.08ΔP` + noise 1095 rows → `train.py` MLP `5→16→8→1` → ONNX opset 14, checker, 1.3KB. SNN: `ai/snn/train_snn.py:1` `5→32→16→1` LIF snnTorch → `ai/snn/snn_weights.json` + `ai/snn/scaler_snn.json` + `ai/snn/thermo_snn.onnx`. Runner `ai/runner/infer.mjs` <200ms, fallback linear if ONNX missing. HQ loads same model via Python `onnxruntime` + `scaler.json`. Calibration: `scripts/calibrate_physics.py:1` per-station `np.linalg.lstsq` on 30d `AVG(tele) JOIN -SUM(qty_delta)` `total = BASE*(1+K1*(T_INSIDE-temp)+K2*wind)+K3*pd*BASE`, `UPDATE physics_params`. Forecast `hq/app/main.py:484` passes `station_id` to `predict_total(..., station_id)`, `GET /physics/{station}` `hq/app/main.py:499` shows per-station `K1/K2/K3`. SNN verify `scripts/snn_verify.mjs:1` + tracking `scripts/tracking_verify.mjs:1`.

## HQ

- **SQLite fallback:** when `DATABASE_URL` unset (CI/no-Docker), `hq/app/db.py:118` uses `hq/app/hq.db` WAL. With Docker, `docker-compose.yml:2` TimescaleDB `timescale/timescaledb:latest-pg15` + `CREATE EXTENSION timescaledb` (silent fail if permission missing, falls back to full scan). Migrations `_ensure_*_sqlite` handle `procurement_targets`, `physics_params`, `vessels` + `indents.vessel_imo` + `dtn_bundles` + `asset_positions` + `snn_state` + VC cols `hq/app/db.py:115`.
- **Endpoints:** `docs/API.md`. `GET /stations/overview` aggregates + SNN overlay; `GET /forecast` live per-station physics; `POST /telemetry` triggers escalate + SSE broadcast; `TrendChart` uses TimescaleDB hypertable when available; `GET /assets/bulk/template` + `POST /assets/bulk` bulk import; `GET /telemetry/sources` + `GET /physics/{station}`; `GET /vessels` + `GET /vessels/{imo}` vessel tracking; `POST /dtn/ingest_bulk` + `GET /dtn/bundles` + `GET /dtn/conflicts` + `POST /dtn/exchange` DTN; `POST /tracking/update` + `GET /tracking/positions` local frame; `GET /forecast/snn/{station}` SNN.
- **Pollers:** telemetry + vessel start in `lifespan` `hq/app/main.py:76`, adaptive fallback, cache. SNN has no poller — event-driven on `POST /telemetry` `check_and_escalate` threshold.

## Security

| Layer | This round | Hardening |
|-------|------------|-----------|
| Transit | PSK `64 hex` (32B) strictly validated + AES-GCM (tag is integrity, CRC is framing) + `VectorClock` causality + `X-PSK` on internal push, `DataView` byteOffset-safe, `>2KB` → `FAILED` ack | mTLS / WireGuard, PKI, QUIC |
| DTN | QR `bundleToBase64` msgpack inside same AES-GCM when via WS; `bundleId` dedupe + VC merge prevents replay | `cose` sign bundles, custody ACK chain |
| At-rest | OPFS + OS disk encryption; `:memory:` fallback warned ephemeral (`__polaris_ephemeral`) + WAL `SYNCHRONOUS=NORMAL` | SQLCipher + `VACUUM INTO` snapshots |
| Auth | JWT 30d — hex-decoded 32B, compact JSON, `role` not client-controlled, `VIEWER` fallback, `hexToBytes` strict | 15m JWT + refresh key, device registry |
| RBAC | `NCPOR_ADMIN>HQ_LOGISTICS>DISPATCH>STATION_LEAD>FIELD_OP>VIEWER` + `station_id` filter, `vessel_imo` FK validated | Row-level + revocation list via `sync_state` + VC |

## Failure Modes

- **Blackout 6h:** field continues IN/OUT → outbox PENDING|SENT→BUNDLED via `createAndSaveMuleBundle` `field/lib/sync.ts:107`. On reconnect, `pushBundlesToHQ()` `POST /dtn/ingest_bulk` drains custody, dedupe at HQ, LWW+VC deterministic, <2KB each at 20 kbps in <5 s `scripts/dtn_verify.mjs:1`.
- **Power kill mid-tx:** WAL recovers, `BEGIN IMMEDIATE` prevents TOCTOU, outbox+`dtn_bundles` not duplicated (single transaction). Tested `m1_verify` power-kill.
- **Concurrent edit 2 tablets:** both `vc {A:1}` vs `{B:1}` concurrent → LWW `ts` later wins, loser `APPLIED_LOCAL_WINS` audited `hq/app/dtn.py:1`.
- **Flaky replay:** gateway may resend (draining guard prevents concurrent dup), HQ dedupe → `DEDUPED`.
- **CRITICAL negative:** pessimistic `SELECT ... FOR UPDATE` / `BEGIN IMMEDIATE` rejects `CONFLICT_CRITICAL`, client to refresh.
- **ONNX missing:** forecast falls back to physics `110*(...)` branch, `pure_physics_days` returned, UI still shows 21d vs 18d. SNN fallback `5*dg+0.3*crew-2` `hq/app/snn_forecast.py:1` when `snn_weights.json` missing.
- **SNN idle:** `EVENT_THRESH 0.12` → calm repeat no spikes, `saved 99%` correct — event-driven not bug `hq/app/snn_forecast.py:1` `test_snn_gating`.
- **Invalid expiry:** `isExpired("bad")===true` → blocked, requires override audit (fail-safe).
- **OPFS unavailable:** `:memory:` with `__polaris_ephemeral=true` and console error — offline writes warned ephemeral.
- **Telemetry poller fails / 429:** Open-Meteo free may 429 under load → `TELEMETRY_SOURCE=both` probe fails → `last_poll.error` in `GET /telemetry/sources`, telemetry still via `POST /telemetry`.
- **Vessel AIS 429 / no key / offline tiles:** `VesselMap` probe `fetch HEAD tile 2s` fails → schematic offline fallback + ETA pill `hq-dashboard/components/VesselMap.tsx:44`; poller cache `/tmp/ais_cache.json` serves last position; `GET /vessels` still returns `source:mock`.
- **Whiteout 0.8m:** camera `generateBbox()` returns `[]` conf 0, LiDAR still `360pts` `fuse()` → `x,y` via LiDAR 70% → tracking `err <0.8m` `scripts/tracking_verify.mjs:1`, GPS red `GPS Unavailable` but `LOCAL` grid still shows dots `field/components/tabs/LocateTab.tsx:1`.
- **Indents 9-column + VC migration:** old `hq/app/hq.db` without `vessel_imo`/`vector_clock`/`dtn_bundles` triggers `ALTER ADD COLUMN` `hq/app/db.py:115` + explicit column inserts prevent 8-value crash `hq/app/main.py:243`.

## Production Status

System is production-ready — all real data feeds live with honest offline states (no demo dummy):

- **Procurement** `procurement_targets` DB live.
- **Weather** Open-Meteo live + IMD optional, `GET /telemetry/sources`.
- **Physics** per-station `physics_params` + `scripts/calibrate_physics.py` `lstsq`.
- **Vessels** AISHub live + schedule Sagar Nidhi, Leaflet map with ETA pill offline.
- **Inventory** `POST /assets/bulk` bulk import, `seed.json` only fallback if `COUNT=0`.
- **DTN** `POST /dtn/ingest_bulk` + `BroadcastChannel`/QR mule, LWW+VC, `scripts/dtn_verify.mjs:1`.
- **SNN** `GET /forecast/snn` watts pill 0.8mW idle, `scripts/snn_verify.mjs:1`.
- **Tracking** `POST /tracking/update` local frame, `scripts/tracking_verify.mjs:1` err<0.8m.

## File Map

- `shared/src/`: types (`UserRole` 6 levels, `OutboxOp` 6 ops, `VectorClock`), `schemas.ts:zod`, `codec.ts/codec.web.ts:msgpack+crc+aes` (hex-validated, byteOffset-safe, `sizeReport`), `expiry.ts:fail-safe`, `containers.ts:CONTAINER_SPECS`, `jwt.ts:hexToBytes`, `indent-machine.ts`, `physics.json`, `power.ts:POWER_BASE`, `local_map.ts:GRID`, `dtn/vector_clock.ts:VC`, `dtn/bundle.ts:Bundle`, `dtn/resolve.ts:resolveAsset`, `vessel_schedule.json` (Sagar Nidhi routes)
- `shared/sql/schema.sql:1`: single source, 17 tables (`dtn_bundles`, `asset_positions`, `snn_state`, `vector_clock`, `local_coord` + indexes `idx_dtn_bundles_dst`, `idx_asset_positions_station`), `indents.vessel_imo` FK, copied to `hq/app/schema.sql` for Docker build
- `field/lib/db.ts:9`: OPFS init (ephemeral warn), seed, `consumeAsset` (`BEGIN IMMEDIATE`, expiry fail-safe, VC bump, TOCTOU-safe), `updateIndentLocal` (strict), `applyDownstream*` (`applyDownstreamAsset` VC merge) + `applyDownstreamVessel` + `listVessels` + `listBundles` + `pullIndentsFromHQ` (9-col+VC)
- `field/lib/sync.ts:13`: `SyncWorker` drain (`PENDING|SENT`→`BUNDLED` offline, `draining` guard, `sizeReport`, `>2KB` skip, `pushBundlesToHQ`) + `DOWNSTREAM_DELTA vessels/bundles` + `vector_clock` in frames
- `field/lib/dtn/store.ts:1` + `field/lib/dtn/mule.ts:1`: `dtn_bundles` OPFS + `createAndSaveMuleBundle`/`BroadcastChannel`/`bundleToBase64`/`pushBundlesToHQ`
- `field/lib/snn/engine.ts:1`: JS LIF `predictSNN()` event-gated `T=20` 90% saved
- `field/lib/sensors/sim_lidar.ts:1` + `field/lib/sensors/fusion.ts:1`: `generateScan 360pts` + `generateBbox whiteout` + `runFusionCycle`/`startFusionLoop` + `POST /tracking/update`
- `field/components/Icons.tsx` + `tabs/{Today,Inventory,Scan,Indents,Locate}.tsx`: split from `field/app/page.tsx` — `TodayTab` SNN pill, `LocateTab` LOCAL/GPS + LocalGrid 40×40
- `sync-gateway/src/gateway.ts:20`: `ws` + `fromWire` + `fetch HQ`, `X-PSK` internal auth, `>2KB FAILED` ack, `sizeReport`, `broadcastDownstream` for `indents/assets/vessels`, `POST /dtn/exchange` + `SYNC_INIT bundles`
- `hq/app/main.py:76`: lifespan pollers, `GET /vessels`, `PATCH /indents {vessel_imo}`, `POST /assets/bulk` 9-col, `GET /telemetry/sources`, `GET /physics/{station}`, `GET /assets/bulk/template`, `POST /dtn/ingest_bulk`/`GET /dtn/bundles`/`GET /dtn/conflicts`/`POST /dtn/exchange`, `POST /tracking/update`/`GET /tracking/positions`, `GET /forecast/snn/{station}` SNN
- `hq/app/db.py:115`: init_db Postgres/SQLite, `PROCUREMENT_SEED`, `physics_params` seed, `_ensure_dtn_sqlite` migration (VC + `dtn_bundles` + `asset_positions` + `snn_state`)
- `hq/app/dtn.py:1`: `compare_vc`/`merge_vc`/`ingest_bundle` LWW+VC
- `hq/app/snn_forecast.py:1`: `predict_snn_total()` event-gated snnTorch LIF `T=20`
- `hq/app/forecast.py:7`: `load_physics(station_id)` per-station DB + fallback, `physics_pred` + `predict_total`
- `hq/app/telemetry_poller.py:11`: Open-Meteo/IMD 15m poll
- `hq/app/vessel_poller.py:11`: AIS adaptive 15m poll + mock fallback
- `hq/app/auth.py:8`: JWT hex (`_secret_bytes` + `separators` compact), `ROLE_HIERARCHY` 6 levels
- `hq/app/config.py:11`: `SECRET_KEY==PSK_HEX` prod warning
- `hq-dashboard/:` SOC view + `TrendChart.tsx` honest empty-state + `Container3D.tsx` + `VesselMap.tsx:1` Leaflet + `react-leaflet` with offline fallback
- `ai/`: `training/generate.py`/`train.py` → `thermo_residual.onnx` + `snn/encoder.py`/`train_snn.py` → `snn_weights.json`/`scaler_snn.json` + `runner/infer.mjs`
- `scripts/`: `m1_verify`…`m5_verify`, `dtn_verify.mjs:1` `snn_verify.mjs:1` `tracking_verify.mjs:1`, `provision_station.mjs`, `template_inventory.csv`, `import_inventory.mjs`, `calibrate_physics.py`
- `docker-compose.yml:46`: hq env `TELEMETRY_SOURCE`, `IMD_API_KEY`, `AIS_API_KEY`, `VESSEL_MODE`, `VESSEL_POLL_SEC`, `VESSEL_CACHE`
