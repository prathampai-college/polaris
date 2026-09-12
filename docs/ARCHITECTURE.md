# Architecture — POLARIS (Production, Extreme-Edge)

## Stack

Field tablets and the HQ Dashboard run **Next.js 14**, HQ and training run **Python 3.11**, and the Sync Gateway runs **Node 20**. The stack is settled: the system is production-ready on these pillars, and no rewrite is planned.

## 3-Pillar Extreme-Edge

| Pillar | Standard Trap (Will Fail) | POLARIS Resilient | Code |
|--------|---------------------------|-------------------|------|
| **I Vision-Fused Local Tracking** | GPS geotags sent to a central database, which fail under ionospheric disturbance and 0.8 m whiteout visibility. | 360-point 2D LiDAR scans and camera bounding boxes fuse on a 40×40 grid (2 m cells): `fuse()` blends 70% LiDAR with 30% camera, then a Kalman filter writes `[x, y, theta]` into `asset_positions` — a local frame with GPS denied. | `field/lib/sensors/sim_lidar.ts:1` `field/lib/sensors/fusion.ts:1` `shared/src/local_map.ts:1` `hq/app/main.py:903` |
| **II Neuromorphic SNN** | A continuously running dense ANN in the cloud at 8.2 mW. | An snnTorch LIF network (`5→32→16→1`) with rate-coded spikes (`T=20`), gated to run only when inputs move more than `Δ 0.12` — idling at 0.8 mW (about 90% saved, `shared/src/snn-config.ts:1`). | `ai/snn/encoder.py:1` `ai/snn/train_snn.py:1` `hq/app/snn_forecast.py:1` `field/lib/snn/engine.ts:1` `shared/src/snn-config.ts:1` |
| **III DTN Data Muling** | Continuous REST calls over an uplink that drops by default. | `dtn_bundles` held in custody and carried by `BroadcastChannel`/QR mules, merging with LWW plus vector clocks (`compare`/`merge`, single-sourced in `hq/app/_vc.py:1`). | `shared/src/dtn/vector_clock.ts:1` `shared/src/dtn/bundle.ts:1` `field/lib/dtn/mule.ts:1` `hq/app/dtn.py:1` `hq/app/_vc.py:1` |

The proposal's risks are covered: hardware thresholds are respected (JS LIF engine, 40-cell grid), conflicts resolve deterministically (LWW plus vector clocks with `dedupe`), and the SNN pipeline is exact (`encoder.py` maps sigmoid outputs to rates to Poisson spikes).

## 3D Container X-Ray & Shared Specs
- **3D X-Ray Locator:** A React Three Fiber visualizer (`@react-three/fiber` and `@react-three/drei`) renders ISO-20ft containers and maps coordinate-indexed crates (`{x,y}`) in 3D on both field tablets and the HQ dashboard. Specs are centralized in `shared/src/containers.ts` (`CONTAINER_SPECS`/`CRATE_COORDS`) imported via `@polaris/shared/containers.js` (avoids pulling `node:crypto` into browser bundle), implemented in `field/components/Container3D.tsx` (`Stocked`) and `hq-dashboard/components/Container3D.tsx` (`Normal`).
- **Shared helpers (refactor):** `shared/src/wire.ts:1` `MAX_WIRE_SIZE` (used by `codec.ts`, `codec.web.ts`, `sync-gateway/src/gateway.ts:3`, `field/lib/sync.ts:2`), `shared/src/url.ts:1` `toHttpUrl()`, `shared/src/snn-config.ts:1` `SNN_EVENT_THRESH`/`SNN_DEFAULT_WEIGHTS` (used by `field/lib/snn/engine.ts:1` + `hq/app/snn_forecast.py:1`), `hq/app/db.py:1` `utc_now()`, `hq/app/_vc.py:1` VC single source.
- **Offline DB:** SQLite WASM over OPFS/WAL (`@sqlite.org/sqlite-wasm`) keeps a single `polaris.db` holding `outbox`, `dedupe`, `sync_state`, `vessels`, `dtn_bundles`, `asset_positions`, and `snn_state`. The schema in `shared/sql/schema.sql:1` is mirrored inline for the browser (`field/lib/db.ts:18`) and adapted for Postgres by `hq/app/db.py:118` (which strips `PRAGMA` statements and maps `BLOB` to `BYTEA`). The `vector_clock TEXT` columns are backfilled on older databases with `ALTER TABLE ADD COLUMN` (`_ensure_dtn_sqlite` in `hq/app/db.py:115`, plus the matching migration in `field/lib/db.ts:56`). Procurement seeds come from a single source: `procurement_targets` in `shared/seed.json:4`.
- **Vessel Map:** Leaflet `1.9.4` with `react-leaflet` `4.2.1` in `hq-dashboard/components/VesselMap.tsx:1`. The map probes `tile.openstreetmap.org` (`HEAD 0/0/0.png`, 2-second timeout); when offline or air-gapped, it falls back to a schematic map with an ETA pill (speed in knots, from the `shared/vessel_schedule.json` mock). Field tablets show offline vessel ETAs through `listVessels()` (`field/lib/db.ts:296`), fed by `DOWNSTREAM_DELTA vessels`.
- **Local Grid:** `shared/src/local_map.ts:1` provides the grid (`GRID_SIZE 40`, `CELL_M 2`) with `polarToCart`, `cartToGrid`, `createGrid`, `insertPoints`, `fuse()`, and `Kalman1D`. Fusion (`field/lib/sensors/fusion.ts:1`) runs every 3 s through `startFusionLoop()`, injects 0.8 m whiteouts 15% of the time (camera blind), and keeps tracking on LiDAR alone at confidence 0.75.
- **Power:** `GET /forecast/snn` `saved_pct` (0.8mW vs 8.2mW, 90% idle saved) drives the `TodayTab` watts pill.

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

Downstream (HQ to field) is a full-duplex websocket push. HQ's `notify_gateway` (authenticated with the `X-PSK` header, `hq/app/main.py:52`) triggers the gateway's `/internal/broadcast_delta` on indent status changes (`APPROVED`, and `DISPATCHED` with `vessel_imo`), automatic critical-forecast escalations, asset mutations, and vessel positions (`hq/app/vessel_poller.py:62`). The gateway broadcasts encrypted `DOWNSTREAM_DELTA` wire frames (under 50 ms) to the connected tablets matching `station_id` — the `SYNC_INIT` device and station IDs are trusted after PSK decryption, and broadcasts are filtered on top. The initial handshake catches tablets up through binary `SYNC_INIT` / `SYNC_INIT_RESP` frames that include pending `bundles` (`sync-gateway/src/gateway.ts:57`). Key rotation arrives as a `KEY_ROTATE` outbox operation on the next sync window, with the old key retained for one window.

DTN mule flow (offline 6h): field 5 writes → `BUNDLED` → QR `bundleToBase64` `field/lib/dtn/mule.ts:1` → personnel carries to base → `POST /dtn/exchange` gateway → `POST /dtn/ingest_bulk` HQ LWW+VC → `DEDUPED` via `bundleId`.

Pollers (HQ, 15m adaptive, explicit gating):
- **Telemetry** (`hq/app/telemetry_poller.py:11`) polls free Open-Meteo (`https://api.open-meteo.com/v1/forecast`, no key needed) with an optional IMD branch (`https://mausam.imd.gov.in/api`). `TELEMETRY_SOURCE` selects `both`, `openmeteo`, `imd`, or `sim`, and the explicit `LIVE_WEATHER_ENABLED` gate defaults to `false` (forcing mock data) until set to `true`. `GET /telemetry/sources` reports health including `live_enabled`. The poller starts with the app lifespan (`hq/app/main.py:76`), and generator load is synthesized as `0.7 + 0.1*sin(hour)`.
- **Vessels** (`hq/app/vessel_poller.py:11`) fetch live `lat/lon/sog/eta` from AISHub (`https://data.aishub.net/ws.php?username={AIS_API_KEY}&format=1`), falling back to Sagar Nidhi interpolation from `shared/vessel_schedule.json` when the key is missing or a `429` arrives; responses are cached in `/tmp/ais_cache.json`. `VESSEL_MODE` selects `auto`, `live`, or `mock`, and the explicit `LIVE_AIS_ENABLED`/`AIS_ENABLED` gate defaults to `false`. `GET /vessels?station_id` serves positions, `PATCH /indents {vessel_imo}` validates the assignment, and `get_status()` exposes `live_enabled`.

## Offline-First Invariants

- **Single DB file:** `shared/sql/schema.sql:1` → `polaris.db` OPFS, `PRAGMA journal_mode=WAL; SYNCHRONOUS=NORMAL;`. One writer, transactions atomic. Tab kill → SQLite auto-recovers WAL, outbox replays exactly-once via `dedupe` + `BUNDLED` custody survives. The schema constrains `outbox.op` to `CONSUME|IN|OUT|ADJUST` (plus `status BUNDLED`) and carries `assets.vector_clock`, `outbox.vector_clock`, `dtn_bundles`, `asset_positions`, and `snn_state` (`shared/sql/schema.sql:1`).
- **Idempotent ULID + VC:** every outbox row `ulid` (26-char) + `vector_clock VC`. HQ `dedupe(ulid)` + `compare_vc()` → `DEDUPED` or `APPLIED_LOCAL_WINS` without re-apply. `retry_count` backs off; `draining` guard prevents concurrent duplicate sends. Bundles dedupe via `bundleId`.
- **Field-level deltas:** transmits only changed fields, not full rows. `@msgpack/msgpack` schemaless + `zod` both ends. Target 70-80% vs full-row JSON (CI asserts per frame + 10k DB) + `vector_clock` overhead minimal.
- **Wire:** `shared/src/codec.ts:toWire` → `nonce||ciphertext||tag` + `CRC32` framing (CRC is not integrity — GCM tag is). Node `crypto` at gateway, WebCrypto at field (same `PSK_HEX` hex-decoded 32B, `64 hex` strictly validated, `hexToBytes` rejects odd/invalid, `DataView` byteOffset-safe on both ends). Throttled tested at 20 kbps/500 ms/5% loss — no crash, convergence <5 s. DTN bundled frames also `vector_clock` tagged.
- **RBAC:** JWT 30d — `PSK_HEX` hex-decoded via `hexToBytes`/`bytes.fromhex` on both sides, compact JSON `separators=(',',':')` cross-verified (Node ↔ Python). `POST /auth/login` ignores the requested `role` unless `device_id` contains `ADMIN`, `LEAD`, `TEST`, or `HQ` — everyone else receives `FIELD_OP`, which blocks PIN holders from escalating their own privileges. Roles `NCPOR_ADMIN>HQ_LOGISTICS>DISPATCH>STATION_LEAD>FIELD_OP>VIEWER`. `GET /rbac/me` returns `VIEWER` when unauthenticated. Row-level `station_id` filter + DTN `dstStation`.
- **Expiry:** `shared/src/expiry.ts` fail-safe: `isExpired` returns `true` on `NaN` (invalid date → expired), `isExpiringSoon` returns `false` on `NaN`. Blocks any expired stock from `CONSUME` without override (covers `MEDICAL`/`OXYGEN`/`FOOD`).
- **State machine:** strict `ALLOWED` `DRAFT→APPROVED→DISPATCHED→RECEIVED` enforced in both `field/lib/db.ts:169 updateIndentLocal` and `hq/app/main.py:263 PATCH /indents` — no `DRAFT→RECEIVED` shortcut. `DISPATCHED` now validates `vessel_imo` exists in `vessels` `hq/app/main.py:283`.
- **Audit:** immutable `audit_log` both sides, `before/after` JSON + `vector_clock` merge, HQ can replay state (`/audit`, `/dtn/conflicts`). `vessel_imo` + `bundleId` audited.
- **Vessel offline:** field `applyDownstreamVessel` `field/lib/db.ts:278` upserts `vessels` via `DOWNSTREAM_DELTA vessels`, `listVessels()` shows ETA even air-gapped.
- **DTN custody:** bundles keep `dtn_bundles.custody = 1` until `pushBundlesToHQ()` deletes them after an `APPLIED` response; each bundle carries a `ttl` of 86400 seconds; and `BroadcastChannel` peers in the same origin receive instantly (simulated BLE).
- **SNN event gate:** in `hq/app/snn_forecast.py:1`, the normalized input must move more than `EVENT_THRESH 0.12` to fire — a calm repeat stays idle at 0 mW (99% saved), while a blizzard goes active with `spike_count > 0`.

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

Training generates 1,095 rows of physics plus noise in `ai/training/generate.py` (`110*(1 + 0.012ΔT + 0.018*wind) + 0.08ΔP`), fits an MLP (`5→16→8→1`) in `train.py`, and exports a checked 1.3 KB ONNX file (opset 14). SNN: `ai/snn/train_snn.py:1` `5→32→16→1` LIF snnTorch → `ai/snn/snn_weights.json` + `ai/snn/scaler_snn.json` + `ai/snn/thermo_snn.onnx`. Runner `ai/runner/infer.mjs` <200ms, fallback linear if ONNX missing. HQ loads same model via Python `onnxruntime` + `scaler.json`. Calibration fits per-station coefficients with `scripts/calibrate_physics.py:1` (`np.linalg.lstsq` over 30 days of averaged telemetry joined against summed burn: `total = BASE*(1 + K1*(T_INSIDE − temp) + K2*wind) + K3*pd*BASE`) and writes them with `UPDATE physics_params`. Forecasting in `hq/app/main.py:484` passes `station_id` into `predict_total(…, station_id)`; `GET /physics/{station}` (`hq/app/main.py:499`) exposes the per-station `K1/K2/K3`. SNN and tracking behavior are pinned by `scripts/snn_verify.mjs:1` and `scripts/tracking_verify.mjs:1`.

## HQ

- **SQLite fallback:** when `DATABASE_URL` is unset (CI or no-Docker setups), `hq/app/db.py:118` uses the `hq/app/hq.db` WAL file. Under Docker, `docker-compose.yml:2` provides TimescaleDB (`timescale/timescaledb:latest-pg15`) with `CREATE EXTENSION timescaledb`, which fails silently without permission and falls back to full scans. The `_ensure_*_sqlite` migrations create `procurement_targets`, `physics_params`, and `vessels`, and add `indents.vessel_imo`, `dtn_bundles`, `asset_positions`, `snn_state`, and the vector-clock columns (`hq/app/db.py:115`).
- **Endpoints:** `docs/API.md`. `GET /stations/overview` aggregates + SNN overlay; `GET /forecast` live per-station physics; `POST /telemetry` triggers escalate + SSE broadcast; `TrendChart` uses TimescaleDB hypertable when available; `GET /assets/bulk/template` + `POST /assets/bulk` bulk import; `GET /telemetry/sources` + `GET /physics/{station}`; `GET /vessels` + `GET /vessels/{imo}` vessel tracking; `POST /dtn/ingest_bulk` + `GET /dtn/bundles` + `GET /dtn/conflicts` + `POST /dtn/exchange` DTN; `POST /tracking/update` + `GET /tracking/positions` local frame; `GET /forecast/snn/{station}` SNN.
- **Pollers:** the telemetry and vessel pollers start with the app lifespan (`hq/app/main.py:76`), with adaptive fallback and caching. The SNN has no poller — it runs event-driven when `POST /telemetry` crosses the `check_and_escalate` threshold.

## Security

| Layer | This round | Hardening |
|-------|------------|-----------|
| Transit | PSK `64 hex` (32B) strictly validated + AES-GCM (tag is integrity, CRC is framing) + `VectorClock` causality + `X-PSK` on internal push, `DataView` byteOffset-safe, `>2KB` → `FAILED` ack | mTLS / WireGuard, PKI, QUIC |
| DTN | QR `bundleToBase64` msgpack inside same AES-GCM when via WS; `bundleId` dedupe + VC merge prevents replay | `cose` sign bundles, custody ACK chain |
| At-rest | OPFS plus OS disk encryption, with the `:memory:` fallback explicitly warned as ephemeral (`__polaris_ephemeral`), and WAL at `SYNCHRONOUS=NORMAL` | SQLCipher + `VACUUM INTO` snapshots |
| Auth | JWT 30d — hex-decoded 32B, compact JSON, `role` not client-controlled, `VIEWER` fallback, `hexToBytes` strict | 15m JWT + refresh key, device registry |
| RBAC | `NCPOR_ADMIN>HQ_LOGISTICS>DISPATCH>STATION_LEAD>FIELD_OP>VIEWER` + `station_id` filter, `vessel_imo` FK validated | Row-level + revocation list via `sync_state` + VC |

## Failure Modes

- **Blackout 6h:** field continues IN/OUT → outbox PENDING|SENT→BUNDLED via `createAndSaveMuleBundle` `field/lib/sync.ts:107`. On reconnect, `pushBundlesToHQ()` `POST /dtn/ingest_bulk` drains custody, dedupe at HQ, LWW+VC deterministic, <2KB each at 20 kbps in <5 s `scripts/dtn_verify.mjs:1`.
- **Power kill mid-tx:** WAL recovers, `BEGIN IMMEDIATE` prevents TOCTOU, outbox+`dtn_bundles` not duplicated (single transaction). Tested `m1_verify` power-kill.
- **Concurrent edit 2 tablets:** both `vc {A:1}` vs `{B:1}` concurrent → LWW `ts` later wins, loser `APPLIED_LOCAL_WINS` audited `hq/app/dtn.py:1`.
- **Flaky replay:** gateway may resend (draining guard prevents concurrent dup), HQ dedupe → `DEDUPED`.
- **CRITICAL negative:** pessimistic `SELECT ... FOR UPDATE` / `BEGIN IMMEDIATE` rejects `CONFLICT_CRITICAL`, client to refresh.
- **ONNX missing:** the forecast falls back to the `110*(...)` physics branch, returns `pure_physics_days`, and the UI still shows 21 vs 18 days. SNN fallback `5*dg+0.3*crew-2` `hq/app/snn_forecast.py:1` when `snn_weights.json` missing.
- **SNN idle:** with `EVENT_THRESH 0.12`, a calm repeat produces no spikes and reports 99% saved — that is the event gate working, not a bug (`hq/app/snn_forecast.py:1`, `test_snn_gating`).
- **Invalid expiry:** `isExpired("bad")` returns `true`, so the write is blocked until an override is audited (fail-safe).
- **OPFS unavailable:** the database falls back to `:memory:` with `__polaris_ephemeral=true` and a console error, so offline writes are explicitly warned as ephemeral.
- **Telemetry poller fails / 429:** free Open-Meteo may return `429` under load; the `TELEMETRY_SOURCE=both` probe then records the failure in `last_poll.error` on `GET /telemetry/sources`, while telemetry keeps flowing through `POST /telemetry`.
- **Vessel AIS 429 / no key / offline tiles:** when the `VesselMap` tile probe (`fetch HEAD`, 2 s) fails, the map falls back to the schematic plus ETA pill (`hq-dashboard/components/VesselMap.tsx:44`); the poller cache (`/tmp/ais_cache.json`) serves the last known position; and `GET /vessels` keeps answering with `source: mock`.
- **Whiteout 0.8 m:** camera `generateBbox()` returns `[]` at confidence 0 while the LiDAR still sweeps 360 points; `fuse()` tracks on the 70% LiDAR weight with error under 0.8 m (`scripts/tracking_verify.mjs:1`); GPS shows red `GPS Unavailable` while the `LOCAL` grid keeps its dots (`field/components/tabs/LocateTab.tsx:1`).
- **Indents 9-column + VC migration:** an old `hq/app/hq.db` without `vessel_imo`, `vector_clock`, or `dtn_bundles` triggers `ALTER … ADD COLUMN` (`hq/app/db.py:115`), and explicit column lists on inserts prevent the 8-value crash (`hq/app/main.py:243`).

## Production Status

System is production-ready — all real data feeds live with honest offline states (no demo dummy):

- **Procurement** targets live in the database.
- **Weather** arrives live from Open-Meteo with optional IMD, reported at `GET /telemetry/sources`.
- **Physics** is calibrated per station (`physics_params` plus `scripts/calibrate_physics.py` least-squares).
- **Vessels** arrive live from AISHub with the Sagar Nidhi schedule as fallback, shown on a Leaflet map with an offline ETA pill.
- **Inventory** imports through `POST /assets/bulk`; `seed.json` only seeds an empty database (`COUNT = 0`).
- **DTN** ingests through `POST /dtn/ingest_bulk` with `BroadcastChannel`/QR mules and LWW-plus-vector-clock merges (`scripts/dtn_verify.mjs:1`).
- **SNN** serves `GET /forecast/snn` with a 0.8 mW-idle watts pill (`scripts/snn_verify.mjs:1`).
- **Tracking** accepts `POST /tracking/update` in the local frame with error under 0.8 m (`scripts/tracking_verify.mjs:1`).

## File Map

- `shared/src/`: types (`UserRole` 6 levels, `OutboxOp` 6 ops, `VectorClock`), `schemas.ts:zod`, `codec.ts/codec.web.ts:msgpack+crc+aes` (hex-validated, byteOffset-safe, `sizeReport`), `expiry.ts:fail-safe`, `containers.ts:CONTAINER_SPECS`, `jwt.ts:hexToBytes`, `physics.json`, `local_map.ts:GRID`, `dtn/vector_clock.ts:VC`, `dtn/bundle.ts:Bundle`, `vessel_schedule.json` (Sagar Nidhi routes)
- `shared/sql/schema.sql:1`: single source, 17 tables (`dtn_bundles`, `asset_positions`, `snn_state`, `vector_clock`, `local_coord` + indexes `idx_dtn_bundles_dst`, `idx_asset_positions_station`), `indents.vessel_imo` FK, copied to `hq/app/schema.sql` for Docker build
- `field/lib/db.ts:9`: OPFS init (ephemeral warn), seed, `consumeAsset` (`BEGIN IMMEDIATE`, expiry fail-safe, VC bump, TOCTOU-safe), `updateIndentLocal` (strict), `applyDownstream*` (`applyDownstreamAsset` VC merge) + `applyDownstreamVessel` + `listVessels` + `listBundles` + `pullIndentsFromHQ` (9-col+VC)
- `field/lib/sync.ts:13`: `SyncWorker` drain (`PENDING|SENT`→`BUNDLED` offline, `draining` guard, `sizeReport`, `>2KB` skip, `pushBundlesToHQ`) + `DOWNSTREAM_DELTA vessels/bundles` + `vector_clock` in frames
- `field/lib/dtn/mule.ts:1` (store folded in): `dtn_bundles` OPFS + `saveBundle`/`createAndSaveMuleBundle`/`BroadcastChannel`/`bundleToBase64`/`pushBundlesToHQ`
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
- `scripts/`: `m1_verify`…`m5_verify` (sharing `scripts/_harness.mjs`), `dtn_verify.mjs:1`, `snn_verify.mjs:1`, `tracking_verify.mjs:1`, `provision_station.mjs`, `template_inventory.csv`, `import_inventory.mjs`, `calibrate_physics.py`
- `docker-compose.yml:46`: hq env `TELEMETRY_SOURCE`, `IMD_API_KEY`, `AIS_API_KEY`, `VESSEL_MODE`, `VESSEL_POLL_SEC`, `VESSEL_CACHE`
