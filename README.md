# POLARIS — Polar Logistics & Survival Engine

**SIH26062 — Integrated Polar Expedition Logistics & Asset Management System** for NCPOR/MoES stations **Bharati, Maitri, Himadri**.

Offline-first, decentralized, air-gapped. Survives -40°C blizzards, 6-month winter isolation, 20–50 kbps satellite with multi-hour blackouts. A diesel/O₂ stockout in polar night is a survival failure — this system prevents it.

> **Live demo in 3.5 min:** `PITCH_DECK.md`. Field PWA + Sync Gateway + HQ Dashboard run via `docker compose up` with WiFi off.

---

## Architecture at a Glance

```
ANTARCTICA EDGE (Offline-First)          SAT (20-50 kbps ws)          INDIA HQ (NCPOR)
┌─────────────────────────────┐         msgpack+CRC+AES-GCM           ┌──────────────────────────────┐
│ Next.js PWA (Workbox)       │ ◄══════ FULL-DUPLEX WEBSOCKET ══════► │ FastAPI + Postgres/        │
│  Glove 48px + QR + 3D X-Ray │ ── Upstream Deltas + SYNC_INIT ────► │  TimescaleDB + RBAC/audit  │
├─────────────────────────────┤ ◄── Downstream Push (<50ms) ──────── │                               │
│ SQLite WASM OPFS/WAL        │                                       ├──────────────────────────────┤
│  polaris.db + outbox WAL    │ ◄── Real-Time Indent & Asset Push ─── │ ONNX Trainer (Python)      │
└────────────┬────────────────┘                                       │ Thermo Hybrid <2MB         │
             │ onnxruntime-node <2MB, <200ms + Acoustic AI            └──────────────┬───────────────┘
             └────────── Thermo Hybrid (physics + ML residual) ──────────────────────┘
```

**One language on field live path:** TypeScript/Node (`field` + `sync-gateway` + ONNX runner) — zero cross-FFI at the edge. HQ and training stay Python where they belong. Rust is the planned production hardening (`tokio`/`ort`), not this round.

See `docs/ARCHITECTURE.md` for deep dive and `docs/API.md` for endpoints.


---

## Tech Stack

| Component | Build | Rationale |
|-----------|-------|-----------|
| **Field PWA** | Next.js 14 + Tailwind + Three.js 3D X-Ray + `html5-qrcode` + Workbox | QR offline, 3D interactive container locator (shared `CONTAINER_SPECS` via `@polaris/shared`), glove 48px, tactical dark, 200% font. Split into `Icons` + `tabs/{Today,Inventory,Scan,Indents,Locate}` for maintainability |
| **Offline DB** | `@sqlite.org/sqlite-wasm` OPFS/WAL | WAL crash safety, `outbox`/`dedupe`/`sync_state` in same DB, `BEGIN IMMEDIATE` avoids TOCTOU. Falls back to `:memory:` with explicit ephemeral warning if OPFS unavailable |
| **Sync Engine** | Node.js `ws` + `@msgpack/msgpack` field deltas + `ulid` + CRC32 + AES-GCM (Node `crypto` / WebCrypto) | 70-80% smaller than JSON for patch vs row, idempotent `ulid` replay, `sizeReport` logging, `SENT` retry on next `drain` (no lost `SENT`) |
| **AI** | `onnxruntime-node` int8 <2MB `ai/thermo_residual.onnx` + Acoustic Prognostics | Thermo hybrid `phys + ML residual`, `<200ms`, acoustic bearing anomaly detection, physics fallback |
| **HQ** | FastAPI + PostgreSQL/TimescaleDB (Docker) / SQLite fallback (local dev) | Audit, RBAC, forecast, telemetry time-series aggregation |
| **HQ Dashboard** | Next.js 14 (`hq-dashboard:3001`) + Three.js 3D View + Recharts | Fleet view, forecast 42→18d, TimescaleDB live trend telemetry charts, procurement, 3D container twin |
| **Training** | Python PyTorch + ONNX export (`ai/training/`) | Synthetic physics+noise, 1095 rows, ships only `.onnx` |

> Ponytail simplifications: removed `@automerge/automerge` (dead CRDT — outbox+dedupe+version already convergent), removed `mqtt`/`paho-mqtt` (SSE covers live telemetry), removed `httpx`/`python-ulid`/`@types/mqtt`/`zod` unused in field, shared `CONTAINER_SPECS` via `@polaris/shared`.

---

## Quick Start

### Prereqs

- Node 20+, Python 3.11+, (optional) Docker Desktop
- No cloud, no CDN at runtime — fully air-gapped.

### 1. Clone & install

```powershell
git clone <repo> polar-logistics; cd polar-logistics
npm install --prefix shared; npx tsc -p shared/tsconfig.json
npm install --prefix sync-gateway; npx tsc -p sync-gateway/tsconfig.json
npm install --prefix field          # links @polaris/shared file:../shared
npm install --prefix hq-dashboard   # links @polaris/shared file:../shared
pip install -r hq/requirements.txt
```

### 2. Run without Docker (SQLite fallback — CI/no-Docker friendly)

```powershell
# HQ (fallback SQLite hq/app/hq.db)
python -m uvicorn hq.app.main:app --port 8000 --log-level info

# Gateway (forwards ws → HQ, logs 70-80% saving, CRC/AES)
$env:HQ_URL="http://localhost:8000"; $env:GATEWAY_PORT="8787"; $env:PSK_HEX="a".repeat(64)
node sync-gateway/dist/gateway.js

# Field PWA
npm --prefix field run dev          # http://localhost:3000

# HQ Dashboard
npm --prefix hq-dashboard run dev   # http://localhost:3001
```

### 3. Run with Docker (TimescaleDB production path, air-gapped)

```powershell
docker compose up --build
# field :3000  hq-dashboard :3001  gateway :8787  hq :8000  db :5432
# test air-gapped: disconnect WiFi, `docker compose up` still works, PWA cached via Workbox
```

### 4. Environment

Copy `.env.example` → `.env`:

```ini
PSK_HEX=a...64hex  # per-station 32B pre-shared key, QR-provisioned at HQ (wire AES-GCM)
SECRET_KEY=a...64hex # JWT HMAC secret; falls back to PSK_HEX if unset. Set in production (hex decoded, 32B)
HQ_URL=http://localhost:8000
GATEWAY_PORT=8787
DATABASE_URL=postgresql://polaris:polaris@db:5432/polaris  # omit for SQLite fallback
# NEXT_PUBLIC_PSK_HEX demo-only — production provisions via QR, not NEXT_PUBLIC
```

---

## Usage

### Field (Station tablets)

- **Login:** Station selector (Bharati/Maitri/Himadri) + Device ID + PIN (`BHARATI-2024` etc) → JWT (`FIELD_OP` by default; `STATION_LEAD`/`NCPOR_ADMIN` only for privileged `ADMIN`/`TEST`/`HQ` device_ids). Token stored in localStorage.
- **QR IN/OUT/CONSUME:** `QR Scan` → `html5-qrcode` (offline) or type barcode → `CONSUME -1` / `IN +1` (WAL `BEGIN IMMEDIATE` → `UPDATE assets + INSERT transactions/audit/outbox; COMMIT`). Invalid dates treated as expired (fail-safe). Expiry blocks **any** expired stock from `CONSUME` without override + audit `CONSUME_OVERRIDE_EXPIRED`. Pessimistic lock — HQ rejects negative.
- **Indent:** select asset → qty/urgency → `Create DRAFT` (offline→outbox `op=UPSERT`). State machine strict `DRAFT→APPROVED→DISPATCHED→RECEIVED` (both field `updateIndentLocal` and HQ `PATCH /indents` enforce `ALLOWED`). Once HQ approves/dispatches, status is pushed instantly (<50ms) over the encrypted WebSocket without HTTP polling → `RECEIVED`.
- **3D Container X-Ray:** Interactive 3D visualizer using Three.js / React Three Fiber, ISO-20ft container rendering with coordinate-indexed crates, highlighting on pick/scan (specs from `@polaris/shared/containers`).
- **Forecast & Acoustic Prognostics:** `GET /forecast/ST-BHARATI` → `42d (95% CI 38-47)` calm, `18d (15-22)` blizzard, auto CRITICAL indent ≤20d. Acoustic anomaly detection auto-escalates critical bearing spare indents. `X-PSK` header authenticates HQ→gateway downstream push.

### HQ Dashboard (`:3001`)

- **Station Selector:** Switch between Bharati/Maitri/Himadri, filter all views by station.
- **Forecast & Prognostics:** live thermo hybrid, Calm/Blizzard/Acoustic Failure buttons post telemetry, `ML residual ON/OFF` (fallback physics), SSE live updates (`/telemetry/stream`).
- **Fleet overview:** `GET /stations/overview` — per-station containers, SKUs, critical_low, open_indents, computed `days_to_stockout`.
- **Indents:** workflow table `DRAFT→APPROVED→DISPATCHED→RECEIVED` with RBAC (`STATION_LEAD`+ required) and real-time satellite push broadcast.
- **Trends & Procurement:** Responsive `TrendChart` powered by Recharts + dynamic procurement table from API.
- **Audit & 3D Twin:** `GET /audit`, `<30d` list, 3D container twin mirrors field.

---

## API Reference

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/health` | `{db: postgres|sqlite-fallback}` |
| `POST` | `/auth/login` | `{device_id, pin, station_id, role?}` → JWT. `role` ignored unless device_id contains `ADMIN`/`LEAD`/`TEST`/`HQ` — otherwise `FIELD_OP`. `pin` is per-station (`BHARATI-2024`). |
| `GET` | `/assets` | list SKUs + version |
| `GET` | `/audit?limit=20` | immutable tail |
| `GET` | `/indents?station_id=` | filtered by station |
| `POST` | `/indents` | `{station_id,asset_id,qty,urgency,created_by}` (broadcasts downstream push via `X-PSK`) |
| `PATCH` | `/indents/{id}` | `{status,actor_id}` enforces `ALLOWED` strict + `require_role(STATION_LEAD)`. HQ also broadcasts downstream push |
| `GET` | `/stations/overview` | per-station aggregated inventory + computed forecast |
| `GET` | `/forecast/{station}` | thermo hybrid `{days_to_stockout, ci, physics, residual, used_model, pure_physics_days}` |
| `GET` | `/procurement/{station}` | per-station procurement needs from inventory |
| `POST` | `/telemetry` | `{ts,station_id,temp_outside,wind_speed,pressure,dg_load,acoustic_anomaly?}` triggers `check_and_escalate`, SSE broadcast |
| `GET` | `/telemetry/latest?station_id=` | |
| `GET` | `/telemetry/history?station_id=&days=` | TimescaleDB trend aggregation |
| `GET` | `/telemetry/stream` | SSE live telemetry stream |
| `POST` | `/sync/ingest` | `DeltaFrame {ulid(26),device_id,entity:assets|indents,entity_id,op:UPSERT|CONSUME|IN|OUT|ADJUST|DELETE,patch,base_version,ts}` dedupe+version, `CONFLICT_CRITICAL` if negative, `DEDUPED` on replay |
| `POST` | `/internal/broadcast_delta` | Gateway internal endpoint for HQ-triggered downstream push — requires `X-PSK` header equal to `PSK_HEX` |
| `GET` | `/sync/state/{device_id}` | |
| `GET` | `/rbac/me` | returns `VIEWER` with `READ` when unauthenticated; authenticated returns `FIELD_OP`/`STATION_LEAD`/... with `CONSUME,IN,READ` |

Full spec `docs/API.md`. Wire: `toWire(frame, PSK)` → `[4B CRC BE][12B nonce||ciphertext||16B tag]` msgpack+AES-GCM (PSK `64 hex` validated, `DataView` byteOffset-safe, `hexToBytes` strict). Field `SyncWorker` maintains full-duplex socket, drains `outbox PENDING|SENT` every 2s with `draining` guard, handles instant downstream push, logs `json vs mp saving` via `sizeReport`, `PING/PONG` keepalive, `>2KB` returns `FAILED` ack not silent drop.


---

## Data Model (single SQLite `polaris.db` WAL)

`shared/sql/schema.sql` — `stations, containers, crates({x,y}), assets(sku,criticality,expiry), transactions, indents(DRAFT→RECEIVED), telemetry, audit_log(append-only), outbox(ulid,retry,CRC, CHECK op IN ('UPSERT','DELETE','CONSUME','IN','OUT','ADJUST')), sync_state, dedupe`. Seed `shared/seed.json` 20 SKUs across 3 stations (Bharati/Maitri/Himadri), 6 containers, 12 crates. Field inline schema mirrors shared with `CHECK` expanded.

---

## Testing

```powershell
# unit
npm --prefix shared test        # zod, diff, codec roundtrip/CRC/AES, <2KB, hex validation
npm --prefix sync-gateway test  # ws, crc, dedupe
pytest hq/tests -v              # ingest, forecast, indents (STATION_LEAD via forged JWT), RBAC VIEWER fallback

# integration / chaos (no Docker — uses node:sqlite fallback)
node scripts/m1_verify.mjs      # offline 5 → WAL → dedupe + budgets (SENT retry)
node scripts/m2_verify.mjs      # QR→consume→indent→approve→dispatch→receive + expiry (fail-safe invalid date) + strict state machine
node scripts/m3_verify.mjs      # ONNX <2MB <200ms, 42→18d, auto CRITICAL
node scripts/m4_verify.mjs      # 20kbps/500ms/5% throttle, 10k txn <5MB, WAL, RBAC VIEWER, AES

# e2e (Docker when available)
docker compose up --build; pytest hq/tests -k e2e
```

Chaos & budgets asserted in CI at 20 kbps / 500 ms / 5% loss — no crash, convergence <5 s, `polaris.db <5MB @10k`, `frame <2KB`.

See `M1_RUNBOOK.md` … `M5_RUNBOOK.md` for phase demos.

---

## Security & Resilience

- **Zero cloud:** `docker compose up` WiFi off, PWA Workbox pre-cached, OPFS `polaris.db` (ephemeral `:memory:` warned if `SecureContext` missing).
- **Transit:** TLS + `AES-GCM` per frame (`nonce 12B||tag 16B`) + `CRC32` (GCM tag is integrity; CRC is framing only), PSK per station QR-provisioned (`64 hex` strictly validated), `hexToBytes` rejects odd/invalid, `X-PSK` on internal gateway push, `DataView` byteOffset-safe.
- **At-rest:** SQLite WAL `SYNCHRONOUS=NORMAL`, file `OPFS` + OS disk encryption.
- **Auth/RBAC:** HMAC-SHA256 JWT 30d — `PSK_HEX` hex-decoded (32B) on both Node (`hexToBytes`) and Python (`bytes.fromhex`), compact JSON `separators=(',',':')` cross-verified. Roles `NCPOR_ADMIN>HQ_LOGISTICS>DISPATCH>STATION_LEAD>FIELD_OP>VIEWER`. `POST /auth/login` ignores client `role` unless `device_id` privileged; `GET /rbac/me` returns `VIEWER` when unauthenticated. Row-level `station_id` filter, local RBAC cache, revocation on next sync via `sync_state`.
- **Live Telemetry:** SSE streaming (`/telemetry/stream`) for real-time dashboard; MQTT removed (ponytail: add only if profiler proves needed).
- **Audit:** immutable `audit_log` both field/HQ, replayable, expiry override audited.
- **DR:** WAL + nightly `pg_dump` + `VACUUM INTO 'snapshot.db'`, HQ TimescaleDB source of truth, re-bootstrap via snapshot + delta replay.

---

## AI — Thermo Hybrid

`ai/training/generate.py` → `weather_fuel_history.csv` (1095 rows, physics `110*(1+0.012ΔT+0.018wind)+0.08ΔP` + noise) → `ai/training/train.py` tiny MLP `5→16→8→1` → `ai/thermo_residual.onnx` **1.3KB** `ai/scaler.json`. Runner `ai/runner/infer.mjs` (`onnxruntime-node`, `<200ms`) + fallback linear if ONNX missing. HQ `hq/app/main.py` `predict_total()` + `check_and_escalate()`. Honest framing: *"physics-informed forecast, not certified prediction"*.

---

## Project Structure

```
shared/          TS types/zod, msgpack+CRC+AES codec (hex-validated, byteOffset-safe), seed, schema.sql, containers
field/           Next PWA + SQLite WASM + sync worker (SENT retry, draining guard, sizeReport) + QR + 3D X-Ray + tabs split
sync-gateway/    Node ws gateway, msgpack, idempotency, X-PSK internal auth, >2KB FAILED ack
hq/              FastAPI + Postgres/TimescaleDB (or SQLite fallback) + JWT hex, strict indent machine
hq-dashboard/    Next SOC dashboard + TrendChart
ai/              training (Python) + runner (Node) + thermo_residual.onnx
scripts/         m1→m5_verify (updated for VIEWER rbac, STATION_LEAD via privileged device), record_fallback.ps1
docker-compose.yml + Dockerfiles (hardened, non-root, healthcheck)
```

---

## Feasibility

`COST_FEASIBILITY.md` — reuses existing rugged tablet + HQ VM + Iridium link, **₹0** new hardware, 2 days provision for 3 stations, `N` stations via `station_id` filter, Rust `tokio/ort` later for RPi hardening.

## Pitch

`PITCH_DECK.md` — 3.5 min: Blizzard cut (msgpack 86% saving, dedupe) + Stockout 42→18d (ML toggle, fallback) + arch (one TS language, Python HQ, Rust future) + feasibility close. Cut order: trends → 2D polish → rest.

## Compliance (§10)

`scripts/m5_verify.mjs` checks: air-gapped `✓`, WAL `✓`, budgets `✓` (10k 1.38MB, wire 231B), sync `✓`, ML 1.3KB <2MB <200ms `✓`, RBAC/audit/AES `✓`, domain QR/indent/RBAC `✓`, demo fallback `✓`.

## Roadmap & Architecture

Production path: Rust sync microservice (`tokio`/`quinn`) + protobuf schema registry + mTLS/WireGuard + key rotation via `X-PSK`, `2026-09-15` expiry handling tested fail-safe.

---

## License

MIT — for NCPOR/MoES evaluation.
