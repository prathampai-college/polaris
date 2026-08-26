# POLARIS — Polar Logistics & Survival Engine

**SIH26062 — Integrated Polar Expedition Logistics & Asset Management System** for NCPOR/MoES stations **Bharati, Maitri, Himadri**.

Offline-first, decentralized, air-gapped. Survives -40°C blizzards, 6-month winter isolation, 20–50 kbps satellite with multi-hour blackouts. A diesel/O₂ stockout in polar night is a survival failure — this system prevents it.

> **Live demo in 3.5 min:** `PLAN.md` → `PITCH_DECK.md`. Field PWA + Sync Gateway + HQ Dashboard run via `docker compose up` with WiFi off.

---

## Architecture at a Glance

```
ANTARCTICA EDGE (Offline-First)          SAT (20-50 kbps ws)          INDIA HQ (NCPOR)
┌─────────────────────────────┐            msgpack+CRC+AES            ┌──────────────────────────────┐
│ Next.js PWA (Workbox)       │ ───────── ws binary deltas ─────────→ │ FastAPI + Postgres/        │
│  Glove 48px + QR + 2D grid │  PSK + idempotent ULID               │  TimescaleDB + RBAC/audit  │
├─────────────────────────────┤                                       ├──────────────────────────────┤
│ SQLite WASM OPFS/WAL (single│ ←────── forecast + indent pull ───── │ ONNX trainer (Python)      │
│  polaris.db + outbox)       │                                       │ Thermo Hybrid <2MB         │
└────────────┬────────────────┘                                       └──────────────┬───────────────┘
             │ onnxruntime-node <2MB, <200ms                                         │
             └────────── Thermo Hybrid (physics + ML residual) ──────────────────────┘
```

**One language on field live path:** TypeScript/Node (`field` + `sync-gateway` + ONNX runner) — zero cross-FFI at the edge. HQ and training stay Python where they belong. Rust is the planned production hardening (`tokio`/`ort`), not this round.

See `docs/ARCHITECTURE.md` for deep dive and `docs/API.md` for endpoints.

---

## Tech Stack

| Component | Build | Rationale |
|-----------|-------|-----------|
| **Field PWA** | Next.js 14 + Tailwind + `html5-qrcode` + Workbox | QR offline, glove 48px, tactical dark, 200% font |
| **Offline DB** | `@sqlite.org/sqlite-wasm` OPFS/WAL single `polaris.db` | WAL crash safety, single writer, `outbox`/`dedupe`/`sync_state` same DB |
| **Sync Engine** | Node.js `ws` + `@msgpack/msgpack` field deltas + `ulid` + CRC32 + AES-GCM (Node `crypto`) | 70-80% smaller than JSON, idempotent replay |
| **AI** | `onnxruntime-node` int8 <2MB `ai/thermo_residual.onnx` | Thermo hybrid `phys + ML residual`, `<200ms`, physics fallback |
| **HQ** | FastAPI + PostgreSQL/TimescaleDB (Docker) / SQLite fallback (local dev) | Audit, RBAC, forecast |
| **HQ Dashboard** | Next.js 14 (`hq-dashboard:3001`) | Fleet view, forecast 42→18d, Trends, procurement |
| **Training** | Python PyTorch + ONNX export (`ai/training/`) | Synthetic physics+noise, 1095 rows, ships only `.onnx` |

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
npm install --prefix field
npm install --prefix hq-dashboard
pip install -r hq/requirements.txt
pip install -r ai/training/requirements.txt  # for retrain only
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
PSK_HEX=a...64hex  # per-station 32B pre-shared key, QR-provisioned at HQ
HQ_URL=http://localhost:8000
GATEWAY_PORT=8787
DATABASE_URL=postgresql://polaris:polaris@db:5432/polaris  # omit for SQLite fallback
```

---

## Usage

### Field (Bharati tablet)

- **QR IN/OUT/CONSUME:** `QR Scan` → `html5-qrcode` (offline) or type barcode → `CONSUME -1` / `IN +1` (WAL tx: `UPDATE assets + INSERT transactions/audit/outbox; COMMIT`). Expiry `<30d` flagged HIGH; expired MEDICAL blocks without `STATION_LEAD` override + audit `CONSUME_OVERRIDE_EXPIRED`. Pessimistic lock — HQ rejects negative.
- **Indent:** select asset → qty/urgency → `Create DRAFT` (offline→outbox). After sync HQ `Approve→Dispatch`, field pulls (every 4s) → `RECEIVED`.
- **2D Locator:** 7 crates grid, coords `{x,y}` zod-validated, highlight on scan.
- **Forecast:** `GET /forecast/ST-BHARATI` → `42d (95% CI 38-47)` calm, `18d (15-22)` blizzard, auto CRITICAL indent ≤20d. Toggle blizzard via `Calm`/`Blizzard 42→18d` buttons (posts telemetry).

### HQ Dashboard (`:3001`)

- **Forecast:** live thermo hybrid, Calm/Blizzard buttons post telemetry, `ML residual ON/OFF` (fallback physics 21d), sparkline + auto-escalate banner.
- **Fleet overview:** `GET /stations/overview` — containers, SKUs, critical_low, open_indents, `days_to_stockout`.
- **Indents:** workflow table `DRAFT→APPROVED→DISPATCHED→RECEIVED` with RBAC actions.
- **Trends:** `TrendChart` (TimescaleDB mock, solid actual / dashed forecast) + procurement table (ETA before freeze, cost).
- **Audit & expiring:** `GET /audit`, `<30d` list, locator mirrors field.

---

## API Reference

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/health` | `{db: postgres|sqlite-fallback}` |
| `GET` | `/assets` | list 10 SKUs + version |
| `GET` | `/audit?limit=20` | immutable tail |
| `GET` | `/indents?station_id=` | |
| `POST` | `/indents` | `{station_id,asset_id,qty,urgency,created_by}` |
| `PATCH` | `/indents/{id}` | `{status,actor_id}` enforces `ALLOWED` |
| `GET` | `/stations/overview` | aggregates + canned 42d forecast |
| `GET` | `/forecast/{station}` | thermo hybrid `{days_to_stockout, ci, physics, residual, used_model, pure_physics_days}` |
| `POST` | `/telemetry` | `{ts,station_id,temp_outside,wind_speed,pressure,dg_load}` triggers `check_and_escalate` |
| `GET` | `/telemetry/latest?station_id=` | |
| `POST` | `/sync/ingest` | `DeltaFrame {ulid,device_id,entity,entity_id,op,patch,base_version,ts}` dedupe+version, `CONFLICT_CRITICAL` if negative |
| `GET` | `/sync/state/{device_id}` | |
| `GET` | `/rbac/me` | `FIELD_OP/STATION_LEAD/NCPOR_ADMIN` |

Full spec `docs/API.md`. Wire: `toWire(frame, PSK)` → `[4B CRC][12B nonce||ciphertext||16B tag]` msgpack+AES-GCM. Field `SyncWorker` drains `outbox PENDING` every 2s, logs `json vs mp saving`, `PING/PONG` keepalive.

---

## Data Model (single SQLite `polaris.db` WAL)

`shared/sql/schema.sql` — `stations, containers, crates({x,y}), assets(sku,criticality,expiry), transactions, indents(DRAFT→RECEIVED), telemetry, audit_log(append-only), outbox(ulid,retry,CRC), sync_state, dedupe`. Seed `shared/src/seed.ts` 10 SKUs (diesel/O₂/meds/spares/ice drill) across 3 containers/6 crates.

---

## Testing

```powershell
# unit
npm --prefix shared test        # zod, diff, codec roundtrip/CRC/AES, <2KB
npm --prefix sync-gateway test  # ws, crc, dedupe
pytest hq/tests -v              # ingest, forecast, indents, RBAC

# integration / chaos (no Docker — uses node:sqlite fallback)
node scripts/m1_verify.mjs      # offline 5 → WAL → dedupe + budgets
node scripts/m2_verify.mjs      # QR→consume→indent→approve→dispatch→receive + expiry
node scripts/m3_verify.mjs      # ONNX <2MB <200ms, 42→18d, auto CRITICAL
node scripts/m4_verify.mjs      # 20kbps/500ms/5% throttle, 10k txn <5MB, WAL, RBAC

# e2e (Docker when available)
docker compose up --build; pytest hq/tests -k e2e
```

Chaos & budgets asserted in CI at 20 kbps / 500 ms / 5% loss — no crash, convergence <5 s, `polaris.db <5MB @10k`, `frame <2KB`.

See `M1_RUNBOOK.md` … `M5_RUNBOOK.md` for phase demos.

---

## Security & Resilience

- **Zero cloud:** `docker compose up` WiFi off, PWA Workbox pre-cached, OPFS `polaris.db`, `SQLCipher`/disk encryption at-rest placeholder.
- **Transit:** TLS + `AES-GCM` per frame (`nonce 12B||tag 16B`) + `CRC32`, PSK per station QR-provisioned, `KEY_ROTATE` outbox on next window (WireGuard/mTLS planned §11).
- **At-rest:** SQLite WAL `SYNCHRONOUS=NORMAL`, file `OPFS` + OS disk encryption.
- **Auth/RBAC:** JWT 30d offline + local RBAC cache (`NCPOR_ADMIN>STATION_LEAD>FIELD_OP>VIEWER`), row-level `station_id` filter, roster revocation on next sync via `sync_state`.
- **Audit:** immutable `audit_log` both field/HQ, replayable.
- **DR:** WAL + nightly `pg_dump` + `VACUUM INTO 'snapshot.db'`, HQ TimescaleDB source of truth, re-bootstrap via snapshot + delta replay.

---

## AI — Thermo Hybrid

`ai/training/generate.py` → `weather_fuel_history.csv` (1095 rows, physics `110*(1+0.012ΔT+0.018wind)+0.08ΔP` + noise) → `ai/training/train.py` tiny MLP `5→16→8→1` → `ai/thermo_residual.onnx` **1.3KB** `ai/scaler.json`. Runner `ai/runner/infer.mjs` (`onnxruntime-node`, `<200ms`) + fallback linear. HQ `hq/app/main.py:236` `predict_total()` + `check_and_escalate()`. Honest framing: *"physics-informed forecast, not certified prediction"*.

---

## Project Structure

```
shared/          TS types/zod, msgpack+CRC+AES codec, diff, seed, schema.sql
field/           Next PWA + SQLite WASM + sync worker + QR + 2D grid + forecast
sync-gateway/    Node ws gateway, msgpack, idempotency
hq/              FastAPI + Postgres/TimescaleDB (or SQLite fallback)
hq-dashboard/    Next SOC dashboard + TrendChart
ai/              training (Python) + runner (Node) + thermo_residual.onnx
scripts/         m1→m5_verify, record_fallback.ps1
docker-compose.yml + Dockerfiles (hardened, non-root, healthcheck)
```

---

## Feasibility

`COST_FEASIBILITY.md` — reuses existing rugged tablet + HQ VM + Iridium link, **₹0** new hardware, 2 days provision for 3 stations, `N` stations via `station_id` filter, Rust `tokio/ort` later for RPi hardening.

## Pitch

`PITCH_DECK.md` — 3.5 min: Blizzard cut (msgpack 86% saving, dedupe) + Stockout 42→18d (ML toggle, fallback) + arch (one TS language, Python HQ, Rust future) + feasibility close. Cut order: trends → 2D polish → rest.

## Compliance (§10)

`scripts/m5_verify.mjs` checks: air-gapped `✓`, WAL `✓`, budgets `✓` (10k 1.38MB, wire 231B), sync `✓`, ML 1.3KB <2MB <200ms `✓`, RBAC/audit/AES `✓`, domain QR/indent/RBAC `✓`, demo fallback `✓`.

## Roadmap (§11)

Rust sync + QUIC (`quinn`) + protobuf registry + mTLS/WireGuard + 3D `{x,y,z}` Three.js + acoustic prognostics + Automerge CRDT + short-lived JWT+refresh + multi-season retrain + fleet N.

---

## Team

`PLAN.md:210` — Dev1 Sync, Dev2 Offline SQLite, Dev3 Field UI, Dev4 AI, Dev5 Edge+Telem Sim, Dev6 HQ+QA+Pitch.

## License

MIT — for NCPOR/MoES evaluation.

