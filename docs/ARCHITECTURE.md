# Architecture — POLARIS

Source of truth: `PLAN.md:2`. This doc expands the stage-ready diagram with data-flow, failure modes, and production path.

## Data-Flow `write → outbox → wire → HQ`

```
Field UI (React) --(local call)--> SQLite WASM OPFS/WAL polaris.db
      |-- BEGIN; UPDATE assets; INSERT transactions/audit/outbox; COMMIT (atomic, WAL)
      |-- outbox row {ulid, device_id, patch:msgpack, base_version}
      v
SyncWorker (field/lib/sync.ts) -- drain PENDING every 2s --
      | encode patch → msgpack (field-level diff diff(old,new))
      | encrypt AES-GCM (PSK 32B hex, nonce 12B, tag 16B)
      | prepend CRC32 (4B BE) → ws.send(binary)
      v
Gateway (sync-gateway/src/gateway.ts) ws server :8787
      | fromWire: CRC check → decrypt → decode → zod deltaFrameSchema
      | log json 240B vs mp 199B saving 17% + patch vs row 70.9%
      | POST HQ /sync/ingest JSON (gateway does not own DB, just validates wire)
      v
HQ FastAPI (hq/app/main.py) :8000
      | BEGIN IMMEDIATE; dedupe(ulid) → DEDUPED if replay
      | if assets: SELECT ... FOR UPDATE (PG) / BEGIN IMMEDIATE (SQLite), pessimistic lock reject qty<0 → CONFLICT_CRITICAL
      | if indents: upsert indents / status patch
      | INSERT dedupe, audit_log, sync_state last_acked_ulid
      | COMMIT → 200 {status: APPLIED|DEDUPED|CONFLICT_CRITICAL, server_version}
      | PING/PONG keepalive survives satellite dropouts
Gateway ← ACK (toWire ACK) ← HQ
Field ← onmessage fromWire → UPDATE outbox SET ACKED, sync_state
```

Downstream (HQ→Field) is polling: `field/lib/db.ts:197 pullIndentsFromHQ` every 4s `field/app/page.tsx:27` + `field/lib/sync.ts:76`. `KEY_ROTATE` delivered as outbox `op=KEY_ROTATE` on next window (old key retained one window for in-flight frames).

## Offline-First Invariants

- **Single DB file:** `shared/sql/schema.sql` → `polaris.db` OPFS, `PRAGMA journal_mode=WAL; SYNCHRONOUS=NORMAL;`. One writer, transactions atomic. Tab kill → SQLite auto-recovers WAL, outbox replays exactly-once via `dedupe`.
- **Idempotent ULID:** every outbox row `ulid` (26-char). HQ `dedupe(ulid)` table, replay → `DEDUPED` without re-apply. `retry_count` backs off (gateway logs).
- **Field-level deltas:** `shared/src/diff.ts:diff(old,new)→patch` transmits only changed fields, not full rows. `@msgpack/msgpack` schemaless + `zod` both ends (no .proto compile this round; `protobufjs` §11). Target 70-80% vs full-row JSON (CI asserts per frame + 10k DB).
- **Wire:** `shared/src/codec.ts:60 toWire` → `nonce||ciphertext||tag` + `CRC32`. Node `crypto` at gateway, Web Crypto at field (same PSK hex). Throttled tested at 20 kbps/500 ms/5% loss — no crash, convergence <5 s.
- **RBAC:** JWT 30 d + local RBAC cache (survives 6-month winter). `device_id` bound to `station_id` at provisioning; `WHERE station_id=:mine`. Revocation list syncs on next window via `sync_state` version bump. Production upgrade §11: 15 min JWT + offline refresh key.
- **Audit:** immutable `audit_log` both sides, `before/after` JSON, HQ can replay state (`/audit`).

## AI Path

```
AWS (serial/MQTT) ─┐
                   ├→ telemetry {ts,station_id,temp,wind,pressure,dg_load} → telemetry table
Simulator (ai/runner/telemetry_sim.mjs) ─┘
                               ↓
hq/app/main.py:physics_pred() + onnxruntime (ai/thermo_residual.onnx 1.3KB, scaler.json)
                               ↓
GET /forecast/{station} → {days_to_stockout, ci, physics, residual, total_per_day, pure_physics_days}
                               ↓ (if days ≤20)
                    check_and_escalate() → INSERT indents CRITICAL DRAFT + audit
```

Training: `ai/training/generate.py` physics `110*(1+0.012ΔT+0.018wind)+0.08ΔP` + noise 1095 rows → `train.py` MLP `5→16→8→1` → ONNX opset 14, checker, 1.3KB. Runner `ai/runner/infer.mjs` <200ms, fallback linear if ONNX missing. HQ loads same model via Python `onnxruntime` + `scaler.json`. Honest: "physics-informed forecast, not certified".

## HQ

- **SQLite fallback:** when `DATABASE_URL` unset (CI/no-Docker), `hq/app/db.py` uses `hq/app/hq.db` WAL. With Docker, `docker-compose.yml` TimescaleDB `timescale/timescaledb:latest-pg15` + `CREATE EXTENSION timescaledb`.
- **Endpoints:** `docs/API.md`. `GET /stations/overview` aggregates + canned 42d forecast for stage; `GET /forecast` live; `POST /telemetry` triggers escalate; `TrendChart` mock (solid actual, dashed forecast) will use TimescaleDB hypertable in production.

## Security

| Layer | This round | Production §11 |
|-------|------------|----------------|
| Transit | PSK 32B hex + AES-GCM + CRC, QR provision, rotation via `KEY_ROTATE` outbox | mTLS / WireGuard, PKI |
| At-rest | OPFS + OS disk encryption (SQLCipher path commented for WASM build) | SQLCipher + `VACUUM INTO` snapshots |
| Auth | JWT 30d offline, RBAC `NCPOR_ADMIN>STATION_LEAD>FIELD_OP>VIEWER` | 15m JWT + refresh key |

## Failure Modes

- **Blackout 6h:** field continues IN/OUT → outbox PENDING. On reconnect, drain 5 deltas <2KB each at 20 kbps in <5 s.
- **Power kill mid-tx:** WAL recovers, outbox not duplicated (single transaction). Tested `m1_verify` power-kill.
- **Flaky replay:** gateway may resend, HQ dedupe → `DEDUPED`.
- **CRITICAL negative:** pessimistic `SELECT ... FOR UPDATE` rejects `CONFLICT_CRITICAL`, client to refresh.
- **ONNX missing:** forecast falls back to physics `110*(...)` branch, `pure_physics_days` returned, UI still shows 21d vs 18d.

## Production Path (Rust §11)

Node prototype proves convergence + 70-80% saving. Rewrite to Rust `tokio`/`axum` + `ort` (`ort` crate) + `quinn` QUIC for HoL blocking, `protobufjs`→`prost` registry, `sqlx` + `r2d2`. Lower memory on RPi-class field hardware.

## File Map

- `shared/src/`: types, `schemas.ts:zod`, `diff.ts:fieldMask`, `codec.ts:msgpack+crc+aes`
- `shared/sql/schema.sql`: single source, copied to `hq/app/schema.sql` for Docker build
- `field/lib/db.ts`: OPFS init, seed, `consumeAsset`+`createIndent` WAL tx
- `field/lib/sync.ts`: `SyncWorker` drain+pull
- `sync-gateway/src/gateway.ts`: `ws` + `fromWire` + `fetch HQ`
- `hq/app/main.py`: ingest, forecast, telemetry, indents, overview, RBAC, audit
- `hq-dashboard/`: SOC view + `TrendChart.tsx`
- `ai/`: `training/generate.py`/`train.py` → `thermo_residual.onnx` + `runner/infer.mjs`
