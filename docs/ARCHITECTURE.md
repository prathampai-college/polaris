# Architecture — POLARIS

## 3D Container X-Ray & Shared Specs
- **3D X-Ray Locator:** Interactive React Three Fiber (`@react-three/fiber` & `@react-three/drei`) visualizer rendering ISO-20ft containers and mapping coordinate-indexed crates (`{x,y}`) in 3D space on both field tablets and HQ dashboard. Specs centralized in `shared/src/containers.ts` (`CONTAINER_SPECS`/`CRATE_COORDS`) imported via `@polaris/shared/containers.js` (avoids pulling `node:crypto` into browser bundle).
- **Offline DB:** SQLite WASM OPFS/WAL (`@sqlite.org/sqlite-wasm`) — single `polaris.db` with `outbox`/`dedupe`/`sync_state`. Ponytailed: removed `@automerge/automerge` CRDT (dead — outbox+dedupe+version already convergent).

## Data-Flow `write → outbox → wire → HQ`

```
Field UI (React) --(local call)--> SQLite WASM OPFS/WAL polaris.db
      |-- BEGIN IMMEDIATE; SELECT asset; check expiry (fail-safe invalid→expired) + qty<0; UPDATE assets; INSERT transactions/audit/outbox; COMMIT (atomic, WAL, TOCTOU-safe)
      |-- outbox row {ulid, device_id, patch:msgpack, base_version, op:UPSERT|CONSUME|IN|..., status PENDING}
      v
SyncWorker (field/lib/sync.ts) -- drain PENDING|SENT every 2s, draining guard --
      | encode patch → msgpack (field-level diff)
      | encrypt AES-GCM (PSK 32B hex strictly 64 chars, hexToBytes validated, nonce 12B, tag 16B)
      | prepend CRC32 (4B BE, DataView byteOffset-safe) → ws.send(binary)
      | retry: stays PENDING|SENT until ACK, increment retry_count, dedupe at HQ
      v
Gateway (sync-gateway/src/gateway.ts) ws server :8787
      | fromWire: CRC check → decrypt (GCM tag verifies) → decode → validate
      | log json vs mp via sizeReport (shared/src/codec.ts)
      | POST HQ /sync/ingest JSON (gateway does not own DB, just validates wire)
      | on >2KB: sends FAILED ACK instead of silent drop
      v
HQ FastAPI (hq/app/main.py) :8000
      | BEGIN IMMEDIATE; dedupe(ulid) → DEDUPED if replay
      | if assets: SELECT FOR UPDATE (PG) / BEGIN IMMEDIATE (SQLite), pessimistic lock reject qty<0 → CONFLICT_CRITICAL
      | if indents: upsert indents / status patch, strict ALLOWED {DRAFT→APPROVED→DISPATCHED→RECEIVED}
      | INSERT dedupe, audit_log, sync_state last_acked_ulid
      | COMMIT → 200 {status: APPLIED|DEDUPED|CONFLICT_CRITICAL, server_version}
      | PING/PONG keepalive survives satellite dropouts
Gateway ← ACK (toWire ACK, sizeReport) ← HQ
Field ← onmessage fromWire → UPDATE outbox SET ACKED, sync_state
```

Downstream (HQ→Field) is full-duplex WebSocket push: HQ `notify_gateway` (`X-PSK` header authenticated) triggers Gateway `/internal/broadcast_delta` on indent status changes (`APPROVED`, `DISPATCHED`), auto-critical forecast escalations, or asset mutations. Gateway broadcasts encrypted `DOWNSTREAM_DELTA` wire frames (<50ms) to connected tablets matching `station_id` (SYNC_INIT `device_id`/`station_id` trusted after PSK decrypt, but broadcast filtered). Initial handshake catch-up sync is performed via `SYNC_INIT` / `SYNC_INIT_RESP` binary frames. `KEY_ROTATE` delivered as outbox `op` on next window (old key retained one window).

## Offline-First Invariants

- **Single DB file:** `shared/sql/schema.sql` → `polaris.db` OPFS, `PRAGMA journal_mode=WAL; SYNCHRONOUS=NORMAL;`. One writer, transactions atomic. Tab kill → SQLite auto-recovers WAL, outbox replays exactly-once via `dedupe`. Schema `outbox.op CHECK` now includes `CONSUME|IN|OUT|ADJUST` (was `UPSERT|DELETE` only — would crash field `consumeAsset`).
- **Idempotent ULID:** every outbox row `ulid` (26-char). HQ `dedupe(ulid)` table, replay → `DEDUPED` without re-apply. `retry_count` backs off; `draining` guard prevents concurrent duplicate sends.
- **Field-level deltas:** transmits only changed fields, not full rows. `@msgpack/msgpack` schemaless + `zod` both ends (no .proto compile this round; `protobufjs` §11). Target 70-80% vs full-row JSON (CI asserts per frame + 10k DB).
- **Wire:** `shared/src/codec.ts:toWire` → `nonce||ciphertext||tag` + `CRC32` framing (CRC is not integrity — GCM tag is). Node `crypto` at gateway, WebCrypto at field (same `PSK_HEX` hex-decoded 32B, `64 hex` strictly validated, `hexToBytes` rejects odd/invalid, `DataView` byteOffset-safe on both ends). Throttled tested at 20 kbps/500 ms/5% loss — no crash, convergence <5 s.
- **RBAC:** JWT 30d — `PSK_HEX` hex-decoded via `hexToBytes`/`bytes.fromhex` on both sides, compact JSON `separators=(',',':')` cross-verified (Node ↔ Python). `POST /auth/login` ignores client `role` unless `device_id` contains `ADMIN`/`LEAD`/`TEST`/`HQ` — otherwise `FIELD_OP` (prevents PIN-holder escalation). Roles `NCPOR_ADMIN>HQ_LOGISTICS>DISPATCH>STATION_LEAD>FIELD_OP>VIEWER`. `GET /rbac/me` returns `VIEWER` when unauthenticated. Row-level `station_id` filter.
- **Expiry:** `shared/src/expiry.ts` fail-safe: `isExpired` returns `true` on `NaN` (invalid date → expired), `isExpiringSoon` returns `false` on `NaN`. Blocks any expired stock from `CONSUME` without override (covers `MEDICAL`/`OXYGEN`/`FOOD`).
- **State machine:** strict `ALLOWED` enforced in both `field/lib/db.ts:updateIndentLocal` and `hq/app/main.py:PATCH /indents` — no `DRAFT→RECEIVED` shortcut.
- **Audit:** immutable `audit_log` both sides, `before/after` JSON, HQ can replay state (`/audit`).

## AI Path

```
AWS (simulator) ─┐
                 ├→ telemetry {ts,station_id,temp,wind,pressure,dg_load} → telemetry table
Simulator (ai/runner/telemetry_sim.mjs) ─┘
                               ↓
hq/app/main.py:physics_pred() + onnxruntime (ai/thermo_residual.onnx 1.3KB, scaler.json)
                               ↓
GET /forecast/{station} → {days_to_stockout, ci, physics, residual, total_per_day, pure_physics_days}
                               ↓ (if days ≤20)
                    check_and_escalate() → INSERT indents CRITICAL DRAFT + audit + notify_gateway (X-PSK)
```

Training: `ai/training/generate.py` physics `110*(1+0.012ΔT+0.018wind)+0.08ΔP` + noise 1095 rows → `train.py` MLP `5→16→8→1` → ONNX opset 14, checker, 1.3KB. Runner `ai/runner/infer.mjs` <200ms, fallback linear if ONNX missing. HQ loads same model via Python `onnxruntime` + `scaler.json`. Honest: "physics-informed forecast, not certified".

## HQ

- **SQLite fallback:** when `DATABASE_URL` unset (CI/no-Docker), `hq/app/db.py` uses `hq/app/hq.db` WAL. With Docker, `docker-compose.yml` TimescaleDB `timescale/timescaledb:latest-pg15` + `CREATE EXTENSION timescaledb` (silent fail if permission missing, falls back to full scan).
- **Endpoints:** `docs/API.md`. `GET /stations/overview` aggregates + forecast; `GET /forecast` live; `POST /telemetry` triggers escalate + SSE broadcast; `TrendChart` uses TimescaleDB hypertable when available.

## Security

| Layer | This round | Production §11 |
|-------|------------|----------------|
| Transit | PSK `64 hex` (32B) strictly validated + AES-GCM (tag is integrity, CRC is framing) + `X-PSK` on internal push, `DataView` byteOffset-safe, `>2KB` → `FAILED` ack | mTLS / WireGuard, PKI, QUIC |
| At-rest | OPFS + OS disk encryption; `:memory:` fallback warned ephemeral (`__polaris_ephemeral`) | SQLCipher + `VACUUM INTO` snapshots |
| Auth | JWT 30d — hex-decoded 32B, compact JSON, `role` not client-controlled, `VIEWER` fallback, `hexToBytes` strict | 15m JWT + refresh key, device registry |
| RBAC | `NCPOR_ADMIN>HQ_LOGISTICS>DISPATCH>STATION_LEAD>FIELD_OP>VIEWER` + `station_id` filter | Row-level + revocation list via `sync_state` |

## Failure Modes

- **Blackout 6h:** field continues IN/OUT → outbox PENDING|SENT. On reconnect, drain retries `SENT` until ACK, dedupe at HQ, <2KB each at 20 kbps in <5 s.
- **Power kill mid-tx:** WAL recovers, `BEGIN IMMEDIATE` prevents TOCTOU, outbox not duplicated (single transaction). Tested `m1_verify` power-kill.
- **Flaky replay:** gateway may resend (draining guard prevents concurrent dup), HQ dedupe → `DEDUPED`.
- **CRITICAL negative:** pessimistic `SELECT ... FOR UPDATE` / `BEGIN IMMEDIATE` rejects `CONFLICT_CRITICAL`, client to refresh.
- **ONNX missing:** forecast falls back to physics `110*(...)` branch, `pure_physics_days` returned, UI still shows 21d vs 18d.
- **Invalid expiry:** `isExpired("bad")===true` → blocked, requires override audit (fail-safe).
- **OPFS unavailable:** `:memory:` with `__polaris_ephemeral=true` and console error — offline writes warned ephemeral.

## Production Path (Rust §11)

Node prototype proves convergence + 70-80% saving. Rewrite to Rust `tokio`/`axum` + `ort` + `quinn` QUIC for HoL blocking, `protobufjs`→`prost` registry, `sqlx` + `r2d2`. Lower memory on RPi-class field hardware.

## File Map

- `shared/src/`: types (`UserRole` 6 levels, `OutboxOp` 6 ops), `schemas.ts:zod`, `codec.ts/codec.web.ts:msgpack+crc+aes` (hex-validated, byteOffset-safe, `sizeReport`), `expiry.ts:fail-safe`, `containers.ts:CONTAINER_SPECS`, `jwt.ts:hexToBytes`, `indent-machine.ts`
- `shared/sql/schema.sql`: single source, `outbox.op` CHECK expanded, copied to `hq/app/schema.sql` for Docker build
- `field/lib/db.ts`: OPFS init (ephemeral warn), seed, `consumeAsset` (`BEGIN IMMEDIATE`, expiry fail-safe, TOCTOU-safe), `updateIndentLocal` (strict), `applyDownstream*`
- `field/lib/sync.ts`: `SyncWorker` drain (`PENDING|SENT`, `draining` guard, `sizeReport`, `>2KB` skip, `SENT` retry)
- `field/components/Icons.tsx` + `tabs/{Today,Inventory,Scan,Indents,Locate}.tsx`: split from `field/app/page.tsx` (782 lines down from 1624)
- `sync-gateway/src/gateway.ts`: `ws` + `fromWire` + `fetch HQ`, `X-PSK` internal auth, `>2KB FAILED` ack, `sizeReport`
- `hq/app/main.py`: ingest (dedupe, `BEGIN IMMEDIATE`), forecast, telemetry, indents (strict), overview, RBAC (`VIEWER` fallback), audit, `notify_gateway` (`X-PSK`)
- `hq/app/auth.py`: JWT hex (`_secret_bytes` + `separators` compact), `ROLE_HIERARCHY` 6 levels
- `hq-dashboard/`: SOC view + `TrendChart.tsx` + shared containers
- `ai/`: `training/generate.py`/`train.py` → `thermo_residual.onnx` + `runner/infer.mjs`
