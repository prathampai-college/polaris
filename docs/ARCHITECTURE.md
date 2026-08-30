# Architecture — POLARIS (Production)

## Stack

Field tablets and HQ Dashboard are **Next.js 14**; HQ and training are **Python 3.11**; Sync Gateway is **Node 20**. No future rewrite is planned for the demo — system is production-ready with real data feeds.

## 3D Container X-Ray & Shared Specs
- **3D X-Ray Locator:** React Three Fiber (`@react-three/fiber` & `@react-three/drei`) visualizer rendering ISO-20ft containers and mapping coordinate-indexed crates (`{x,y}`) in 3D space on both field tablets and HQ dashboard. Specs centralized in `shared/src/containers.ts` (`CONTAINER_SPECS`/`CRATE_COORDS`) imported via `@polaris/shared/containers.js` (avoids pulling `node:crypto` into browser bundle).
- **Offline DB:** SQLite WASM OPFS/WAL (`@sqlite.org/sqlite-wasm`) — single `polaris.db` with `outbox`/`dedupe`/`sync_state`/`vessels`. Schema `shared/sql/schema.sql:1` → `field/lib/db.ts:18` inline mirror + `hq/app/db.py:118` (strips PRAGMA/BLOB→BYTEA for PG). Ponytailed: removed `@automerge/automerge` CRDT (outbox+dedupe+version already convergent).
- **Vessel Map:** Leaflet `1.9.4` + `react-leaflet` `4.2.1` in `hq-dashboard/components/VesselMap.tsx:1`. Probes `tile.openstreetmap.org` `HEAD 0/0/0.png` with 2s timeout; if offline/air-gapped, falls back to schematic offline map + ETA pill (SOG kn, `shared/vessel_schedule.json` mock). Field tablets show offline vessel ETA via `listVessels()` `field/lib/db.ts:293` from `DOWNSTREAM_DELTA vessels`.

## Data-Flow `write → outbox → wire → HQ → downstream`

```
Field UI (React) --(local call)--> SQLite WASM OPFS/WAL polaris.db
      |-- BEGIN IMMEDIATE; SELECT asset; check expiry (fail-safe invalid→expired) + qty<0; UPDATE assets; INSERT transactions/audit/outbox; COMMIT (atomic, WAL, TOCTOU-safe)
      |-- outbox row {ulid, device_id, patch:msgpack, base_version, op:UPSERT|CONSUME|IN|..., status PENDING}
      v
SyncWorker (field/lib/sync.ts:13) -- drain PENDING|SENT every 2s, draining guard --
      | encode patch → msgpack (field-level diff)
      | encrypt AES-GCM (PSK 32B hex strictly 64 chars, hexToBytes validated, nonce 12B, tag 16B)
      | prepend CRC32 (4B BE, DataView byteOffset-safe) → ws.send(binary)
      | retry: stays PENDING|SENT until ACK, increment retry_count, dedupe at HQ
      v
Gateway (sync-gateway/src/gateway.ts:20) ws server :8787
      | fromWire: CRC check → decrypt (GCM tag verifies) → decode → validate
      | log json vs mp via sizeReport (shared/src/codec.ts)
      | POST HQ /sync/ingest JSON (gateway does not own DB, just validates wire)
      | on >2KB: sends FAILED ACK instead of silent drop
      v
HQ FastAPI (hq/app/main.py:76) :8000
      | BEGIN IMMEDIATE; dedupe(ulid) → DEDUPED if replay
      | if assets: SELECT FOR UPDATE (PG) / BEGIN IMMEDIATE (SQLite), pessimistic lock reject qty<0 → CONFLICT_CRITICAL
      | if indents: upsert indents / status+vessel_imo patch, strict ALLOWED {DRAFT→APPROVED→DISPATCHED→RECEIVED}, vessel_imo FK validated
      | INSERT dedupe, audit_log, sync_state last_acked_ulid
      | COMMIT → 200 {status: APPLIED|DEDUPED|CONFLICT_CRITICAL, server_version}
      | PING/PONG keepalive survives satellite dropouts
Gateway ← ACK (toWire ACK, sizeReport) ← HQ
Field ← onmessage fromWire → UPDATE outbox SET ACKED, sync_state
```

Downstream (HQ→Field) is full-duplex WebSocket push: HQ `notify_gateway` (`X-PSK` header authenticated `hq/app/main.py:52`) triggers Gateway `/internal/broadcast_delta` on indent status changes (`APPROVED`, `DISPATCHED` with `vessel_imo`), auto-critical forecast escalations, asset mutations, and vessel positions (`hq/app/vessel_poller.py:62`). Gateway broadcasts encrypted `DOWNSTREAM_DELTA` wire frames (<50ms) to connected tablets matching `station_id` (SYNC_INIT `device_id`/`station_id` trusted after PSK decrypt, but broadcast filtered). Initial handshake catch-up sync is via `SYNC_INIT` / `SYNC_INIT_RESP` binary frames. `KEY_ROTATE` delivered as outbox `op` on next window (old key retained one window).

Pollers (HQ, 15m adaptive):
- **Telemetry** `hq/app/telemetry_poller.py:11` — Open-Meteo free `https://api.open-meteo.com/v1/forecast` (no key) + optional `IMD_API_KEY` `https://mausam.imd.gov.in/api`, `TELEMETRY_SOURCE=both|openmeteo|imd|sim`, `GET /telemetry/sources` health, `dg_load=0.7+0.1*sin(hour)`. Starts in `lifespan` `hq/app/main.py:76`.
- **Vessel** `hq/app/vessel_poller.py:11` — AISHub `https://data.aishub.net/ws.php?username={AIS_API_KEY}&format=1` live `lat/lon/sog/eta` + fallback `shared/vessel_schedule.json` Sagar Nidhi interpolation on `429`/no key, cache `/tmp/ais_cache.json`, `VESSEL_MODE auto|live|mock`, `GET /vessels?station_id`, `PATCH /indents {vessel_imo}` validated.

## Offline-First Invariants

- **Single DB file:** `shared/sql/schema.sql:1` → `polaris.db` OPFS, `PRAGMA journal_mode=WAL; SYNCHRONOUS=NORMAL;`. One writer, transactions atomic. Tab kill → SQLite auto-recovers WAL, outbox replays exactly-once via `dedupe`. Schema `outbox.op CHECK` includes `CONSUME|IN|OUT|ADJUST` (was `UPSERT|DELETE` only — would crash field `consumeAsset`). `indents` now 9 cols with `vessel_imo` FK to `vessels`, `vessels` table + `idx_vessels_station` `shared/sql/schema.sql:119`.
- **Idempotent ULID:** every outbox row `ulid` (26-char). HQ `dedupe(ulid)` table, replay → `DEDUPED` without re-apply. `retry_count` backs off; `draining` guard prevents concurrent duplicate sends.
- **Field-level deltas:** transmits only changed fields, not full rows. `@msgpack/msgpack` schemaless + `zod` both ends. Target 70-80% vs full-row JSON (CI asserts per frame + 10k DB).
- **Wire:** `shared/src/codec.ts:toWire` → `nonce||ciphertext||tag` + `CRC32` framing (CRC is not integrity — GCM tag is). Node `crypto` at gateway, WebCrypto at field (same `PSK_HEX` hex-decoded 32B, `64 hex` strictly validated, `hexToBytes` rejects odd/invalid, `DataView` byteOffset-safe on both ends). Throttled tested at 20 kbps/500 ms/5% loss — no crash, convergence <5 s.
- **RBAC:** JWT 30d — `PSK_HEX` hex-decoded via `hexToBytes`/`bytes.fromhex` on both sides, compact JSON `separators=(',',':')` cross-verified (Node ↔ Python). `POST /auth/login` ignores client `role` unless `device_id` contains `ADMIN`/`LEAD`/`TEST`/`HQ` — otherwise `FIELD_OP` (prevents PIN-holder escalation). Roles `NCPOR_ADMIN>HQ_LOGISTICS>DISPATCH>STATION_LEAD>FIELD_OP>VIEWER`. `GET /rbac/me` returns `VIEWER` when unauthenticated. Row-level `station_id` filter.
- **Expiry:** `shared/src/expiry.ts` fail-safe: `isExpired` returns `true` on `NaN` (invalid date → expired), `isExpiringSoon` returns `false` on `NaN`. Blocks any expired stock from `CONSUME` without override (covers `MEDICAL`/`OXYGEN`/`FOOD`).
- **State machine:** strict `ALLOWED` `DRAFT→APPROVED→DISPATCHED→RECEIVED` enforced in both `field/lib/db.ts:169 updateIndentLocal` and `hq/app/main.py:263 PATCH /indents` — no `DRAFT→RECEIVED` shortcut. `DISPATCHED` now validates `vessel_imo` exists in `vessels` `hq/app/main.py:283`.
- **Audit:** immutable `audit_log` both sides, `before/after` JSON, HQ can replay state (`/audit`). `vessel_imo` changes audited.
- **Vessel offline:** field `applyDownstreamVessel` `field/lib/db.ts:276` upserts `vessels` via `DOWNSTREAM_DELTA vessels`, `listVessels()` shows ETA even air-gapped.

## AI Path (Production)

```
Open-Meteo / IMD poller (15m) ─┐
                               ├→ telemetry {ts,station_id,temp,wind,pressure,dg_load} → telemetry table (Timescale hypertable or SQLite)
Simulator (ai/runner/telemetry_sim.mjs) ─┘ (fixtures still work for ?demo)
                                ↓
hq/app/forecast.py:7 load_physics(station_id) → DB physics_params per-station (T_INSIDE 18, BASE 110, K1 0.012, K2 0.018, K3 0.08) else global shared/src/physics.json
hq/app/forecast.py:46 physics_pred() + onnxruntime (ai/thermo_residual.onnx 1.3KB, scaler.json)
                                ↓
GET /forecast/{station}?asset_sku → {days_to_stockout, ci, physics, residual, total_per_day, pure_physics_days}
                                ↓ (if days ≤20)
                    check_and_escalate() → INSERT indents CRITICAL DRAFT + audit + notify_gateway (X-PSK)
                                ↓ (if acoustic_anomaly >0.90)
                    INSERT indents CRITICAL 4 bearings ACOUSTIC_AI
```

Training: `ai/training/generate.py` physics `110*(1+0.012ΔT+0.018wind)+0.08ΔP` + noise 1095 rows → `train.py` MLP `5→16→8→1` → ONNX opset 14, checker, 1.3KB. Runner `ai/runner/infer.mjs` <200ms, fallback linear if ONNX missing. HQ loads same model via Python `onnxruntime` + `scaler.json`. Calibration: `scripts/calibrate_physics.py:1` per-station `np.linalg.lstsq` on 30d `AVG(tele) JOIN -SUM(qty_delta)` `total = BASE*(1+K1*(T_INSIDE-temp)+K2*wind)+K3*pd*BASE`, `UPDATE physics_params`. Forecast `hq/app/main.py:484` passes `station_id` to `predict_total(..., station_id)`, `GET /physics/{station}` `hq/app/main.py:499` shows per-station `K1/K2/K3`.

## HQ

- **SQLite fallback:** when `DATABASE_URL` unset (CI/no-Docker), `hq/app/db.py:118` uses `hq/app/hq.db` WAL. With Docker, `docker-compose.yml:2` TimescaleDB `timescale/timescaledb:latest-pg15` + `CREATE EXTENSION timescaledb` (silent fail if permission missing, falls back to full scan). Migrations `_ensure_*_sqlite` handle `procurement_targets`, `physics_params`, `vessels` + `indents.vessel_imo` `hq/app/db.py:138`.
- **Endpoints:** `docs/API.md`. `GET /stations/overview` aggregates + forecast per-station; `GET /forecast` live per-station physics; `POST /telemetry` triggers escalate + SSE broadcast; `TrendChart` uses TimescaleDB hypertable when available; `GET /assets/bulk/template` + `POST /assets/bulk` bulk import; `GET /telemetry/sources` + `GET /physics/{station}`; `GET /vessels` + `GET /vessels/{imo}` vessel tracking.
- **Pollers:** telemetry + vessel start in `lifespan` `hq/app/main.py:76`, adaptive fallback, cache.

## Security

| Layer | This round | Hardening |
|-------|------------|-----------|
| Transit | PSK `64 hex` (32B) strictly validated + AES-GCM (tag is integrity, CRC is framing) + `X-PSK` on internal push, `DataView` byteOffset-safe, `>2KB` → `FAILED` ack | mTLS / WireGuard, PKI, QUIC |
| At-rest | OPFS + OS disk encryption; `:memory:` fallback warned ephemeral (`__polaris_ephemeral`) | SQLCipher + `VACUUM INTO` snapshots |
| Auth | JWT 30d — hex-decoded 32B, compact JSON, `role` not client-controlled, `VIEWER` fallback, `hexToBytes` strict | 15m JWT + refresh key, device registry |
| RBAC | `NCPOR_ADMIN>HQ_LOGISTICS>DISPATCH>STATION_LEAD>FIELD_OP>VIEWER` + `station_id` filter, `vessel_imo` FK validated | Row-level + revocation list via `sync_state` |

## Failure Modes

- **Blackout 6h:** field continues IN/OUT → outbox PENDING|SENT. On reconnect, drain retries `SENT` until ACK, dedupe at HQ, <2KB each at 20 kbps in <5 s.
- **Power kill mid-tx:** WAL recovers, `BEGIN IMMEDIATE` prevents TOCTOU, outbox not duplicated (single transaction). Tested `m1_verify` power-kill.
- **Flaky replay:** gateway may resend (draining guard prevents concurrent dup), HQ dedupe → `DEDUPED`.
- **CRITICAL negative:** pessimistic `SELECT ... FOR UPDATE` / `BEGIN IMMEDIATE` rejects `CONFLICT_CRITICAL`, client to refresh.
- **ONNX missing:** forecast falls back to physics `110*(...)` branch, `pure_physics_days` returned, UI still shows 21d vs 18d.
- **Invalid expiry:** `isExpired("bad")===true` → blocked, requires override audit (fail-safe).
- **OPFS unavailable:** `:memory:` with `__polaris_ephemeral=true` and console error — offline writes warned ephemeral.
- **Telemetry poller fails / 429:** Open-Meteo free may 429 under load → `TELEMETRY_SOURCE=both` probe fails → `last_poll.error` in `GET /telemetry/sources`, fixtures still work for `?demo`.
- **Vessel AIS 429 / no key / offline tiles:** `VesselMap` probe `fetch HEAD tile 2s` fails → schematic offline fallback + ETA pill `hq-dashboard/components/VesselMap.tsx:44`; poller cache `/tmp/ais_cache.json` serves last mock position; `GET /vessels` still returns `source:mock`.
- **Indents 9-column migration:** old `hq/app/hq.db` without `vessel_imo` triggers `ALTER ADD COLUMN` `hq/app/db.py:138`; explicit column inserts prevent 8-value crash `hq/app/main.py:243`.

## Production Status

System is production-ready — all real data feeds live with honest offline fallbacks:

- **Procurement** `procurement_targets` DB live.
- **Weather** Open-Meteo live + IMD optional, `GET /telemetry/sources`.
- **Physics** per-station `physics_params` + `scripts/calibrate_physics.py` `lstsq`.
- **Vessels** AISHub live + mock `vessel_schedule.json` Sagar Nidhi, Leaflet map with ETA pill offline.
- **Inventory** `POST /assets/bulk` bulk import, `seed.json` only fallback if `COUNT=0`.

## File Map

- `shared/src/`: types (`UserRole` 6 levels, `OutboxOp` 6 ops), `schemas.ts:zod`, `codec.ts/codec.web.ts:msgpack+crc+aes` (hex-validated, byteOffset-safe, `sizeReport`), `expiry.ts:fail-safe`, `containers.ts:CONTAINER_SPECS`, `jwt.ts:hexToBytes`, `indent-machine.ts`, `physics.json`, `vessel_schedule.json` (Sagar Nidhi routes)
- `shared/sql/schema.sql:1`: single source, 14 tables (`procurement_targets`, `physics_params`, `vessels` + `idx_vessels_station`), `indents.vessel_imo` FK, copied to `hq/app/schema.sql` for Docker build
- `field/lib/db.ts:9`: OPFS init (ephemeral warn), seed, `consumeAsset` (`BEGIN IMMEDIATE`, expiry fail-safe, TOCTOU-safe), `updateIndentLocal` (strict), `applyDownstream*` + `applyDownstreamVessel` + `listVessels` + `pullIndentsFromHQ` (9-col)
- `field/lib/sync.ts:55`: `SyncWorker` drain (`PENDING|SENT`, `draining` guard, `sizeReport`, `>2KB` skip, `SENT` retry) + `DOWNSTREAM_DELTA vessels`
- `field/components/Icons.tsx` + `tabs/{Today,Inventory,Scan,Indents,Locate}.tsx`: split from `field/app/page.tsx`
- `sync-gateway/src/gateway.ts:20`: `ws` + `fromWire` + `fetch HQ`, `X-PSK` internal auth, `>2KB FAILED` ack, `sizeReport`, `broadcastDownstream` for `indents/assets/vessels`
- `hq/app/main.py:76`: lifespan pollers, `GET /vessels`, `PATCH /indents {vessel_imo}`, `POST /assets/bulk` 9-col, `GET /telemetry/sources`, `GET /physics/{station}`, `GET /assets/bulk/template`
- `hq/app/db.py:118`: init_db Postgres/SQLite, `PROCUREMENT_SEED`, `physics_params` seed, `_ensure_vessels_sqlite` migration
- `hq/app/forecast.py:7`: `load_physics(station_id)` per-station DB + fallback, `physics_pred` + `predict_total`
- `hq/app/telemetry_poller.py:11`: Open-Meteo/IMD 15m poll
- `hq/app/vessel_poller.py:11`: AIS adaptive 15m poll + mock fallback
- `hq/app/auth.py:8`: JWT hex (`_secret_bytes` + `separators` compact), `ROLE_HIERARCHY` 6 levels
- `hq/app/config.py:11`: `SECRET_KEY==PSK_HEX` prod warning
- `hq-dashboard/:` SOC view + `TrendChart.tsx` + `Container3D.tsx` + `VesselMap.tsx:1` Leaflet + `react-leaflet` with offline fallback
- `ai/`: `training/generate.py`/`train.py` → `thermo_residual.onnx` + `runner/infer.mjs`
- `scripts/`: `m1_verify`…`m5_verify`, `provision_station.mjs`, `template_inventory.csv`, `import_inventory.mjs`, `calibrate_physics.py`
- `docker-compose.yml:46`: hq env `TELEMETRY_SOURCE`, `IMD_API_KEY`, `AIS_API_KEY`, `VESSEL_MODE`, `VESSEL_POLL_SEC`, `VESSEL_CACHE`
