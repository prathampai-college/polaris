# PROJECT POLARIS: Polar Logistics & Survival Engine

**Problem Statement:** Integrated Polar Expedition Logistics and Asset Management System (SIH26062) — for NCPOR / MoES stations **Bharati, Maitri, Himadri**

---

## 1. Executive Summary & Core Value Proposition

Standard warehouse platforms assume reliable internet and temperate warehouses. Antarctic stations do not. They face **-40°C blizzards, 6-month winter isolation, and satellite links capped at 20–50 kbps with frequent multi-hour blackouts**. A stockout of diesel, oxygen, or a DG-set bearing during polar night is not an operational delay — it is a survival failure.

**Project Polaris** is an **offline-first, decentralized polar logistics & asset intelligence platform** with a deliberately narrow live stack:

*   **Systems Depth:** A Node.js delta micro-sync engine (`ws` + `@msgpack/msgpack`) that makes a WMS usable at 20 kbps.
*   **Applied AI:** A single ONNX model via `onnxruntime-node` that converts inventory from a static ledger into a survival forecast — predicting *when* you will run out.

**Guiding Principle:** Core logistics must work with zero connectivity. Sync and AI are survival multipliers, not dependencies.

> **Stack note (read this on stage):** The **field live path** — Field PWA + Sync Gateway + ONNX runner — is a single language (TypeScript/Node.js) so one person can read the whole data-flow `write → outbox → wire → HQ` without context-switching under pressure. HQ (FastAPI + PostgreSQL/TimescaleDB) and model training (Python) stay in Python intentionally — that's the right tool for analytics and training. Rust is not abandoned: it's the planned production rewrite of the field sync engine and ONNX runner once this Node.js prototype proves the architecture (see §11). This signals engineering maturity, not avoidance.

```
       ANTARCTICA EDGE STATION (Offline-First)              SATELLITE LINK                         INDIA HQ COMMAND (NCPOR/MoES)
+-------------------------------------------+            (20-50 kbps, WebSocket)                +-------------------------------------------+
|  React / Next.js PWA (Field UI)           |                         |                          |  Next.js SOC Enterprise Dashboard         |
|  + Glove Mode + QR Scan + Tactical Dark   |                         |                          |  + Global Fleet / Station Overview        |
|  + 2D Grid Locator (48px targets)         |                         |                          |  + Indent & Procurement Workflow         |
+-------------------------------------------+                         |                          +-------------------------------------------+
                   |                                                  |                                            |
+-------------------------------------------+                         v                          +-------------------------------------------+
|  SQLite WASM (OPFS + WAL) Offline DB      | <================================================> |  FastAPI + PostgreSQL / TimescaleDB     |
|  + Outbox Queue + WAL + idempotent ULIDs  |    Node.js Micro-Gateway (`ws` + msgpack deltas)   |  + Audit Log + RBAC + Analytics         |
+-------------------------------------------+                         ^                          +-------------------------------------------+
                   |                                                  |                                            |
+-------------------------------------------+                         |                          +-------------------------------------------+
|  Node.js Edge AI (onnxruntime-node)       |                         |                          |  Python AI/ML Training Pipeline           |
|  - Thermodynamic Depletion Model (<2MB)   |                         |                          |  - Physics-informed training & quantize   |
+-------------------------------------------+                         |                          +-------------------------------------------+
```

---

## 2. System Architecture & Tech Stack

One language on the field live path; Python where it earns its keep (HQ analytics + training). No cross-language FFI to debug at the edge.

```
                  ┌──────────────────────────────────────────────────┐
                  │           React / Next.js PWA (Field UI)         │
                  │   Tailwind CSS + Glove Mode (48px targets)       │
                  │   + QR/Barcode Scanner + 2D Grid Locator         │
                  │   Tested on rugged Android tablet                │
                  └────────────────────────┬─────────────────────────┘
                                           │
                  ┌────────────────────────▼─────────────────────────┐
                  │     SQLite WASM (OPFS + WAL) Single DB           │
                  │  SQLite file in OPFS, WAL mode, single writer    │
                  │  + outbox table + LWW + pessimistic lock (CRIT.) │
                  └────────────────────────┬─────────────────────────┘
                                           │ (Local call, same process)
        ┌──────────────────────────────────┴──────────────────────────────────┐
        │                                                                     │
        ▼                                                                     ▼
┌───────────────────────────────┐                     ┌───────────────────────────────┐
│     Node.js Sync Engine       │                     │     Node.js ONNX AI Runner    │
│ - `ws` WebSocket +            │                     │ - `onnxruntime-node`          │
│   `@msgpack/msgpack` deltas   │                     │ - Thermodynamic Hybrid Model  │
│ - Store-and-Forward Outbox    │                     │ - int8 quantized, <2MB        │
│ - Idempotent ULID + CRC       │                     │ - <200ms, no Python process   │
└───────────────┬───────────────┘                     └───────────────────────────────┘
                │
                │ (20 kbps Encrypted Binary Stream: msgpack + AES-GCM + CRC32)
                ▼
┌───────────────────────────────┐
│     MoES Central HQ (India)   │
│ - FastAPI + PostgreSQL +      │
│   TimescaleDB + Audit Log     │
│ - RBAC + Indent Workflow      │
└───────────────────────────────┘
```

### Tech Stack Selection

| Component | Build This Round | Rationale |
| --- | --- | --- |
| **Field Frontend** | Next.js PWA (Workbox) + Tailwind + `html5-qrcode` | QR scan is core logistics — must work with zero network. Glove Mode 48px targets, tactical dark, 200% font toggle. |
| **Offline DB** | **SQLite WASM only** — `@sqlite.org/sqlite-wasm` (or `wa-sqlite`) with OPFS persistence, WAL mode, single DB file | One DB, one mental model. No Dexie/IndexedDB dual. SQLite gives relational queries, transactions, and WAL crash safety without learning a second API. OPFS is the durable file backend; falls back to IndexedDB VFS shim if OPFS unavailable. |
| **Micro-Sync Engine** | **Node.js** (`ws` WebSocket server) + `@msgpack/msgpack` for binary delta encoding + field-level diffing | Same language as frontend, so whole flow is debuggable by anyone. `@msgpack/msgpack` is maintained (unlike `msgpack-lite`), schemaless, zero `.proto` compile — fastest path to proving the bandwidth claim. Schema is enforced by shared TS types + `zod` validation at both ends. |
| **Data Protocol** | `@msgpack/msgpack` + field-level deltas (`FieldMask`-style) + CRC32 per frame + `ulid` idempotency | Transmit only changed fields, not full rows. Each delta carries `ulid + device_id + base_version` for idempotent replay. |
| **AI Inference** | `onnxruntime-node`, int8 quantized <2MB | Runs inside same Node.js process — no Python runtime at the edge, no cross-language FFI. |
| **Backend (HQ)** | Python FastAPI + PostgreSQL + TimescaleDB | HQ needs heavy analytics, time-series, and audit — Python/FastAPI is the right choice there. Not part of single-language claim. |
| **Training** | Python PyTorch / XGBoost + ONNX export | Offline only; only the `.onnx` file ships to the edge. |
| **HQ Dashboard** | Next.js + PostgreSQL + TimescaleDB + Row-Level RBAC | Required for NCPOR audit & procurement. |

> **On Rust:** Deliberately not used this round. Once this Node.js prototype proves sync converges and deltas are 70–80% smaller, a Rust rewrite (`tokio`/`axum` + `ort`) is the natural production hardening for lower memory on RPi-class field hardware.

> **On msgpack vs protobuf:** Picked `@msgpack/msgpack` for this round because it avoids a `.proto` compilation step and keeps the whole edge in TS. Protobuf (`protobufjs`) remains a valid future upgrade when a strict schema registry is needed — listed in §11.

---

## 3. Domain Data Model & Core Workflows

Tech without domain is a demo, not a system. This is what NCPOR actually audits.

### 3.1 Canonical Data Model (Single SQLite DB)

All tables live in one SQLite WASM file (`polaris.db` in OPFS). WAL mode enabled (`PRAGMA journal_mode=WAL`).

```sql
-- Core domain
stations      { id TEXT PK, name TEXT CHECK(name IN ('Bharati','Maitri','Himadri')), location TEXT, winter_crew_count INT }
containers    { id TEXT PK, station_id FK, type TEXT CHECK(type IN ('ISO_20ft','ColdStore','Hazmat')), position_2d TEXT }
crates        { id TEXT PK, container_id FK, coords TEXT -- JSON {x,y}, temp_zone TEXT }
assets        { id TEXT PK, sku TEXT UNIQUE, name TEXT, category TEXT, qty REAL, unit TEXT, expiry_date TEXT, criticality TEXT, crate_id FK, barcode TEXT }
  -- categories: FUEL_DIESEL | FUEL_KEROSENE | OXYGEN | FOOD | MEDICAL | SPARES_DG | SPARES_HVAC | SCIENTIFIC
transactions  { id TEXT PK, asset_id FK, type TEXT CHECK(type IN ('IN','OUT','CONSUME','ADJUST')), qty_delta REAL, actor_id TEXT, ts TEXT, sync_status TEXT }
indents       { id TEXT PK, station_id FK, asset_id FK, qty_requested REAL, urgency TEXT, status TEXT CHECK(status IN ('DRAFT','APPROVED','DISPATCHED','RECEIVED')), created_by TEXT, created_at TEXT }
telemetry     { ts TEXT, station_id FK, temp_outside REAL, wind_speed REAL, pressure REAL, dg_load REAL }
  -- source: Automatic Weather Station (AWS) via serial/MQTT when available; falls back to telemetry simulator (§8) in this round
audit_log     { id TEXT PK, actor_id TEXT, action TEXT, entity TEXT, before TEXT, after TEXT, ts TEXT } -- immutable, append-only

-- Sync plumbing (same DB)
outbox        { ulid TEXT PK, device_id TEXT, entity TEXT, entity_id TEXT, op TEXT, patch BLOB, base_version INT, retry_count INT, created_at TEXT, status TEXT }
sync_state    { device_id TEXT PK, last_acked_ulid TEXT, last_server_version INT }
dedupe        { ulid TEXT PK, processed_at TEXT } -- HQ-side, prevents double-apply on replay
```

> `coords` simplified to `{x, y}` (2D grid) for this round — see §11 for the future `{x, y, z}` 3D upgrade.

#### 3.1.1 Realistic Seed Data (10 NCPOR-Style SKUs — Preload `polaris.db`)

These go in `assets` across 3 containers / 6 crates so every workflow has something real to scan:

| # | SKU | Name | Category | Qty | Unit | Crate | Coords | Criticality |
|---|-----|------|----------|-----|------|-------|--------|-------------|
| 1 | `FUEL-DIESEL-001` | Diesel (Winter Grade) | FUEL_DIESEL | 4200 | L | C1-K1 | {0,0} | CRITICAL |
| 2 | `FUEL-KERO-JP8-002` | Kerosene JP-8 | FUEL_KEROSENE | 1800 | L | C1-K2 | {1,0} | CRITICAL |
| 3 | `O2-CYL-47L-003` | Oxygen Cylinder 47L | OXYGEN | 24 | cyl | C2-K1 | {0,1} | CRITICAL |
| 4 | `RATION-FD-30D-004` | Freeze-Dried Rations (30-day pack) | FOOD | 90 | packs | C2-K2 | {1,1} | HIGH |
| 5 | `MED-ANTIBIOTIC-005` | Antibiotic Kit (Amoxicillin) | MEDICAL | 12 | kits | C2-K3 | {0,2} | CRITICAL |
| 6 | `MED-TRAUMA-006` | Trauma Kit (Type A) | MEDICAL | 6 | kits | C2-K3 | {1,2} | CRITICAL |
| 7 | `SPARE-BRG-6205-007` | DG Bearing 6205-2RS | SPARES_DG | 8 | pcs | C3-K1 | {0,0} | HIGH |
| 8 | `SPARE-FILTER-FUEL-008` | DG Fuel Filter (Fleetguard) | SPARES_DG | 14 | pcs | C3-K1 | {1,0} | HIGH |
| 9 | `SPARE-HVAC-FAN-009` | HVAC Blower Motor | SPARES_HVAC | 2 | pcs | C3-K2 | {0,1} | HIGH |
| 10 | `SCI-ICE-CORE-010` | Ice Core Drill Bit | SCIENTIFIC | 4 | pcs | C3-K2 | {1,1} | LOW |

Each has a printed QR (`barcode` = SKU) for §8 demos. Expiry set on `MED-*` and `O2-*` to exercise `<30d` flag; `FUEL-*` and `SPARE-*` drive the thermo forecast and indent flow.

### 3.2 Critical Workflows

1.  **QR In/Out/Consume:** Scan barcode → SQLite transaction (`BEGIN; UPDATE assets; INSERT transactions; INSERT outbox; COMMIT;`) → instant UI. WAL guarantees atomicity even if power dies mid-commit. No network required. Expiry auto-flags `<30 days` as `HIGH`.
2.  **Indent Lifecycle:** Field creates indent (offline, inserts to `indents` + `outbox`) → syncs to HQ → NCPOR approves → status syncs back → field marks `RECEIVED` on scan. Every transition appends to `audit_log`.
3.  **Cold-Chain & Hazmat:** `FUEL/OXYGEN/MEDICAL` have `temp_zone` + `expiry` validation in SQLite `CHECK` + app `zod` layer. Cannot `CONSUME` expired medical without override + audit entry.
4.  **RBAC:** `NCPOR_ADMIN (HQ) > STATION_LEAD > FIELD_OP > VIEWER`. Row-level: field `device_id` is bound to one `station_id` at provisioning; SQLite queries always filter `WHERE station_id = :mine`. Critical `CONSUME` requires `STATION_LEAD` JWT or creates audited exception.

### 3.3 Design for Antarctic Reality

*   **Glove Mode UI:** 48px minimum targets, high-contrast tactical dark, 200% font toggle, haptic feedback. Validated on rugged Android tablet (the actual demo device).
*   **Power-Fail Resilience (SQLite-native):** One SQLite file in OPFS with WAL + `SYNCHRONOUS=NORMAL`. Every mutation is a single SQLite transaction that commits to WAL before UI ACK. Kill tab mid-write → reopen → SQLite auto-recovers from WAL + `outbox` replays. HQ also does nightly `pg_dump` + SQLite `VACUUM INTO` snapshot export. HQ TimescaleDB is source of truth; stations re-bootstrap from last snapshot via delta sync.
*   **Personnel Rotation & Offline Auth (Option A — this round):** Field JWT is long-lived (30 days) + local RBAC cache so the tablet stays usable through winter isolation with no satellite. Crew roster + revocation list syncs on each window; deactivated users lose write on the next successful sync via `sync_state` version bump. The tighter model — short-lived 15 min JWT + offline refresh key — is listed in §11 as the production upgrade.

---

## 4. Core Architectural Modules & Novel Features

### Module 1: PolarNet Micro-Sync Engine (Node.js + SQLite + msgpack)

Standard HTTP JSON wastes 60–80% on keys/brackets and resends full rows. PolarNet does not.

*   **Binary Delta Encoding:** On edit, client computes a field-level diff (e.g., `{qty: 12, updated_by: "op_4"}`) and encodes only those fields via `@msgpack/msgpack`. Not byte offsets — field-level deltas that survive schema changes. Shared TS types + `zod` validate both ends (zero `.proto` compilation). Target: **70–80% smaller than equivalent JSON**, logged per frame.
*   **Store-and-Forward Outbox (Idempotent):** Every local SQLite transaction also inserts one `outbox` row: `{ulid (ULID), device_id, entity, entity_id, patch (msgpack bytes), base_version, retry_count}`. A background `ws` worker drains `outbox WHERE status='PENDING' ORDER BY created_at`. Each frame: `msgpack({ulid, device_id, patch}) + CRC32 + AES-GCM`. **Idempotency:** HQ maintains `dedupe(ulid)`; re-delivered ULIDs are ACKed without re-applying. `retry_count` backs off. No double-apply on flaky reconnect. Handles multi-hour satellite blackouts — data stays in SQLite OPFS file.
*   **Transport:** WebSocket (`ws` library), throttled and tested at 20 kbps. Frames carry binary payload + CRC32, AES-GCM encrypted via Node's built-in `crypto`. `PING/PONG` keepalive survives satellite dropouts.
*   **Conflict Resolution (Minimal — this round):** Last-Write-Wins by HQ server timestamp + minimal `conflict_toast: "Updated elsewhere — refreshed to {qty} {unit} (server)"` for operator review. **Pessimistic lock for `CRITICAL`** — HQ checks `SELECT qty FROM assets` inside a transaction; rejects `CONSUME` if `qty - delta < 0` and returns `CONFLICT_CRITICAL` with current server version. Client must refresh and retry. No persistent conflict UI this round — audited `conflict_log` with `Resolve` flow is deferred to §11. Future: `§11` CRDT (Automerge) for non-critical.

### Module 2: Thermodynamic-Aware Consumption AI (Physics + ML Hybrid)

Static `100L/day` fails when a blizzard hits. Consumption is thermodynamic. This is the one AI model this round — it maps directly to "asset management," the core of SIH26062.

*   **Telemetry Source:** Live `telemetry` rows come from the station's **Automatic Weather Station (AWS) via serial/MQTT** when deployed; in this round they are fed by the telemetry simulator (§8 M3/M4) that replays the same schema, so the forecast pipeline is identical in prod and demo. This answers "where does weather come from offline?" — from the AWS, not the cloud.
*   **Hybrid Model (Defensible to Judges):**
    *   **Base Physics:** `predicted_consumption = base_load * (1 + k1*(T_inside - T_outside) + k2*wind_speed) + k3*pressure_delta` derived from Newton's law of cooling + wind chill. Works with zero ML — always available.
    *   **ML Residual Corrector:** A small gradient-boosted / MLP model trained to predict *residual* `(actual - physics)` from `[temp_outside, wind_speed, pressure, crew_count, dg_load]`. Trained on **synthetic history generated from the physics equation + noise** (see §7). This lets you claim ML without needing real Antarctic fuel logs.
*   **Dynamic Horizon Warning:** When forecast telemetry breaches thresholds, model re-projects `days_to_stockout` with a confidence band and auto-escalates `CRITICAL` indents weeks before routes freeze. HQ dashboard shows `42 days → 18 days (95% CI: 15–22)` shift live — the memorable number judges recall.
*   **Deployment:** Exported to `ONNX int8, <2MB`, runs via `onnxruntime-node` — no Python, no cloud, no separate runtime process. HQ retrains periodically on aggregated telemetry (TimescaleDB). Graceful degrade: if ONNX fails to load, forecast falls back to pure physics baseline.
*   **Honest framing:** "Physics-informed forecast, not certified prediction" — states confidence interval and degrades gracefully.

### Module 3: 2D Container/Crate Locator (This Round's Build)

At -40°C, opening 10 containers to find one item risks hypothermia and time.

*   **Build:** SQLite query `SELECT ... WHERE crate_id=?` → 2D table + lightweight grid/floorplan canvas (CSS grid or `<canvas>`) that highlights the target crate's `{x,y}` position. Not just a text table — a spatial view, but still 2D. QR scan jumps straight to location.
*   **Validation:** `crate.coords` is `{x,y}` JSON validated by `zod`; out-of-bounds rejected at write time.
*   **Deliberately deferred:** 3D "X-Ray" (Three.js instanced grid) is a natural next step once the 2D workflow and coordinate model are validated — see §11.

> **Removed from this round's scope:** the acoustic DG-set bearing prognostics model (second AI model). Strong idea, stays on roadmap (§11), but sits outside "logistics and asset management" and would split the pitch across two AI stories. One well-defended model beats two half-defended.

---

## 5. Security, Resilience & Compliance

*   **Zero Cloud Dependency (Air-Gapped):** Entire stack runs via `docker-compose` on local network. No external API, no CDN at runtime. PWA assets pre-cached via Workbox.
*   **Encryption & Key Management:**
    *   **At-rest:** SQLite WASM file in OPFS is encrypted at the SQLite layer (`SQLCipher` build or `OPFS` + OS disk encryption) + app-level field encryption for `medical`/`hazmat` barcodes. No plaintext IndexedDB fallback stores.
    *   **In-transit:** TLS for HQ link. Field sync frames add `AES-GCM` (Node `crypto`) with **per-station pre-shared key (PSK)** provisioned at deployment (QR-based station pairing at HQ). Key version is stored in `sync_state`; rotation is delivered as a `KEY_ROTATE` outbox message on next successful sync window. Old key retained for one window to handle in-flight frames. Frame format: `nonce (12B) || ciphertext || tag (16B) + CRC32`.
    *   **Better alternative considered:** `WireGuard` / mutual TLS with client certs is cleaner for production but heavier to demo air-gapped; PSK + AES-GCM is the minimal shippable step that proves link encryption without PKI overhead. Listed as §11 upgrade.
*   **Auth & Audit:** JWT (30 days, station-scoped, offline-validated against local RBAC cache) + RBAC (§3.2). This survives weeks of satellite blackout — the field tablet does not need to phone HQ to authorize a `CONSUME`. Every `transactions` + `indents` mutation appends to immutable `audit_log` in both SQLite (field) and PostgreSQL (HQ). HQ can replay state from audit. Revocation is enforced on next sync window via `sync_state` + revocation list.
*   **Disaster Recovery:** SQLite WAL + nightly `pg_dump` + `VACUUM INTO 'snapshot.db'` export. HQ TimescaleDB is source of truth; stations re-bootstrap by copying last `snapshot.db` into OPFS and replaying `outbox` deltas.
*   **Bandwidth & Size Verification:** CI throttles to `20 kbps / 500ms / 5% loss` (Chrome DevTools / `tc`) and asserts: no crash, no data loss, SQLite WAL recovery, sync convergence `<5s` after reconnect. **Size budget (assert in CI):** `polaris.db` <5 MB at 10k transactions; single msgpack delta frame <2 KB; msgpack vs JSON saving logged per frame and must be 70–80% (fail CI if not).

---

## 6. Team Roles & Responsibility Matrix

One language on the field path consolidates roles — fewer silos, easier to unblock.

| Member | Role | Core Deliverables | Primary Stack |
| --- | --- | --- | --- |
| **Dev 1** | **Field Sync Engineer** | `ws` WebSocket gateway + `@msgpack/msgpack` delta + Outbox drain + `ulid` idempotency | Node.js, `ws`, `@msgpack/msgpack`, `ulid` |
| **Dev 2** | **Offline SQLite Engineer** | SQLite WASM (OPFS + WAL) schema (§3.1) + SQLite transactions + Outbox/Dedupe tables + LWW + pessimistic lock | TypeScript, `@sqlite.org/sqlite-wasm`, `zod` |
| **Dev 3** | **Field UI Engineer** | Next.js PWA (Workbox) + Glove Mode (48px, dark, 200% font, haptics) + QR scan + 2D grid locator on rugged tablet | Next.js, Tailwind, `html5-qrcode` |
| **Dev 4** | **AI/ML Engineer** | Physics-informed synthetic generator + train residual model + export int8 ONNX (<2MB) | Python, PyTorch/XGBoost, ONNX |
| **Dev 5** | **Edge Integration & Telemetry Simulator** | `onnxruntime-node` integration + telemetry generator (weather/QR events) + 20 kbps throttle harness | Node.js, Python |
| **Dev 6** | **HQ Dashboard, QA & Pitch Lead** | FastAPI + HQ Next.js dashboard (stockout countdown `42→18 days`) + RBAC/audit QA + pitch deck + demo script | Python FastAPI, Next.js, QA, Pitch |

*Dev 1 owns field sync only; Dev 6 owns HQ backend + dashboard. No one straddles Node and Python simultaneously.*

---

## 7. Assets to Prepare Before Building

*   [ ] Shared TS types + `zod` schemas for `assets`, `transactions`, `telemetry`, `indents`, with field-level diff helper (`diff(old, new) → patch`) and msgpack round-trip test
*   [ ] Synthetic dataset: `weather_fuel_history.csv` (physics equation + noise, generated across 3 stations, 365 days each — used to train residual model)
*   [ ] Pretrained `thermo_residual.onnx` (int8, <2MB), tested end-to-end in `onnxruntime-node` (`node -e "ort.InferenceSession.create(...)"`)
*   [ ] SQLite WASM schema + seed data (`polaris.db` with stations/containers/crates/assets across few containers) + QR codes printed/generated, verified in OPFS and after tab kill recovery
*   [ ] `docker-compose` (FastAPI + PostgreSQL/TimescaleDB + HQ Next.js) boots air-gapped (`docker compose up` with WiFi off)
*   [ ] Throttle harness: Chrome DevTools / `comcast` profile at `20 kbps / 500ms / 5% loss` + size-log script (`JSON bytes vs msgpack bytes`, assert 70–80% saving, assert `polaris.db` <5 MB at 10k transactions, assert delta frame <2 KB)

---

## 8. Milestone-Based Build Plan (No Fixed Clock)

Work in milestones with a clear "done" definition — not hour blocks. Don't start the next milestone until the current one's chaos check passes.

**Milestone 1 — Foundation**
 ├── Boot Next.js PWA (Workbox) + SQLite WASM (OPFS + WAL) + seed data (§3.1), verify WAL recovery after tab kill
 ├── Boot FastAPI + PostgreSQL/TimescaleDB + RBAC skeleton + `dedupe` table
 └── Wire sync: SQLite `outbox` → Node.js WebSocket gateway (`@msgpack/msgpack` + `ulid`) → FastAPI
 *Done when:* a write on the field UI reaches HQ's PostgreSQL through the real sync path, online, with `dedupe` preventing double-apply on replay.

**Milestone 2 — Core Logistics Features**
 ├── QR Scan IN/OUT/CONSUME → SQLite transaction + outbox → instant UI (offline, no network)
 ├── Indent lifecycle (DRAFT→APPROVED→DISPATCHED→RECEIVED) + expiry flags + `audit_log`
 ├── Glove Mode + HQ Dashboard (station overview + stockout countdown with CI band)
 └── 2D grid locator wired to `coords {x,y}` (CSS grid/canvas highlight)
 *Done when:* full logistics workflow — scan, consume, indent, approve, receive — works end-to-end online, and offline.

**Milestone 3 — AI Integration**
 ├── Integrate thermo ONNX via `onnxruntime-node` → `days_to_stockout` with confidence interval
 ├── Telemetry simulator feeding live weather data
 └── Dynamic horizon warning auto-creates/escalates `CRITICAL` indents (`42 → 18 days` visible shift)
 *Done when:* changing simulated weather visibly shifts the stockout forecast and triggers an indent.

**Milestone 4 — Chaos Hardening**
 ├── Chaos Test 1: Offline 5 writes → reconnect → verify HQ convergence + CRC + `dedupe` (replay same 5 → no duplicate)
 ├── Chaos Test 2: 20 kbps / 500ms throttle → msgpack vs JSON size log (prove 70–80% claim, assert polaris.db <5 MB, frame <2 KB)
 ├── Chaos Test 3: Power-kill (kill tab mid-transaction) → reopen → SQLite WAL recovery → outbox replays, no loss
 └── RBAC + AES-GCM (PSK + rotation) + audit replay QA
 *Done when:* all three chaos tests pass without manual intervention.

**Milestone 5 — Polish & Pitch Prep**
 ├── HQ TimescaleDB trend charts + procurement forecast
 ├── One feasibility/cost slide (runs on existing station hardware, no new satellite gear)
 ├── Fallback video recorded of both demos, in case live demo fails
 └── Final pitch deck + rehearsed run (including PSK rotation line and Rust future line)

> **Cut order if time is short**, agreed in advance: **1) HQ trend charts → 2) polish on 2D grid view → 3) anything not in Milestones 1–4.** The offline QR workflow + thermodynamic forecast + chaos demo is the whole pitch.

---

## 9. The Pitch & Demo Strategy

Judges see many idea decks. You show a working system that survives.

**1. The "Blizzard" Network Cut Test**
*   *Action:* Open HQ dashboard (India) + Field tablet (Antarctica, rugged Android) side-by-side. Enable DevTools throttle `20 kbps / 500ms` or pull the network.
*   *Demonstration:* Scan 5 QR updates + create a `CRITICAL` fuel indent on the field UI — UI responds instantly (offline). Show SQLite `outbox` `PENDING 5` with `ulid`s.
*   *The Reveal:* Reconnect. Show gateway log: `5 deltas, ~1.1KB msgpack (vs ~7.8KB JSON, 86% saving), 5/5 deduped, CRC ok`. HQ updates in <2s with `SYNCED` + `audit_log` entry. Replay same 5 ULIDs → `dedupe hit 5, 0 applied` (idempotency proof). *Fallback: pre-recorded video of the same if venue network blocks throttling.*

**2. The "Stockout Forecast" Reveal**
*   *Action:* Show HQ dashboard's current `days_to_stockout` for diesel at calm baseline: **`42 days (95% CI: 38–47)`**.
*   *Demonstration:* Feed telemetry simulator a blizzard scenario (temperature −38°C + 22 m/s wind).
*   *The Reveal:* Forecast ticks live to **`18 days (95% CI: 15–22)`**, confidence band tightens, and system auto-escalates a `CRITICAL` indent — before a human would notice the thermodynamic trend by eye. Toggle `ML residual off` → falls back to pure physics `21 days` (graceful degrade).

**Timing:** problem framing (30s) + two demos (90s) + brief architecture (60s: SQLite WAL + msgpack deltas + `ulid` idempotency + physics+ML hybrid, one-line Rust future) + feasibility/impact close (30s: audit, RBAC, air-gapped, PSK rotation, runs on hardware NCPOR already has, glove-mode UI). Total ~3.5 min.

> Judges typically score relevance, innovation, feasibility/scalability, and impact separately. Don't skip feasibility close — cheapest points on the table.

---

## 10. Compliance & Readiness Checklist

*   [ ] **Zero Cloud / Air-Gapped:** `docker compose up` works with WiFi off; PWA installable offline via Workbox; `polaris.db` loads from OPFS with no CDN
*   [ ] **Offline Data Integrity:** Kill tab mid-transaction → reopen → SQLite WAL recovers, `outbox` replays exactly once (`dedupe` check), no loss, no duplicate
*   [ ] **Bandwidth & Size Budget:** Logged: msgpack deltas 70–80% smaller than JSON at 20 kbps / 500ms / 5% loss; `polaris.db` <5 MB at 10k transactions; delta frame <2 KB (CI asserts all three)
*   [ ] **Sync Correctness:** 5 offline writes + concurrent `CRITICAL` consume → HQ converges, pessimistic lock prevents negative stock, duplicate ULID replay is no-op
*   [ ] **Embedded ML:** ONNX int8 <2MB runs via `onnxruntime-node` with no Python process or network call; <200ms; falls back to physics baseline if model missing
*   [ ] **Security & Audit:** RBAC enforced, `audit_log` append-only (SQLite + Postgres), AES-GCM (PSK + rotation) + CRC per frame, SQLite file at-rest encryption
*   [ ] **Domain Completeness:** QR IN/OUT, expiry flags, indent workflow, and RBAC all demoable end-to-end
*   [ ] **Demo Resilience:** fallback video + PWA + `polaris.db` cached on demo tablet; fault injection via simulator (no venue mic dependency)

---

## 11. Future Roadmap (Say This Out Loud — Don't Build This Round)

Naming these as deliberate future work tells judges you understand production scope without spending this round's hours on them.

*   **Rust rewrite of the sync engine and ONNX runner:** once this Node.js prototype proves delta-sync and forecast, a Rust (`tokio`/`axum` + `ort`) rewrite delivers lower memory on RPi-class field hardware.
*   **QUIC (`quinn`) transport:** removes TCP head-of-line blocking on lossy satellite links, layered on top of Rust rewrite.
*   **Protobuf (`protobufjs`) with schema registry:** strict schema evolution once multiple station software versions coexist; today `@msgpack/msgpack` + `zod` is sufficient for a single fleet version.
*   **Mutual TLS / WireGuard:** replace PSK + AES-GCM with cert-based auth once PKI is viable air-gapped.
*   **3D "X-Ray" visual locator:** extend `coords` to `{x,y,z}` and add Three.js instanced-grid view once 2D grid is validated with users.
*   **Edge Acoustic Machinery Prognostics:** second ONNX model (1D-CNN autoencoder on DG-set audio) — deferred to keep AI story focused on asset management.
*   **Full CRDT merge (Automerge) for non-critical assets:** lets multiple offline tablets edit concurrently; today's LWW + pessimistic lock for CRITICAL is sufficient for one tablet per station.
*   **Short-lived JWT + offline refresh key:** replace the 30-day offline JWT with 15 min JWT + local refresh key that can re-issue offline for a bounded window, with immediate server-side revocation — tighter security for production once sync is reliable.
*   **Audited conflict log:** upgrade the minimal `conflict_toast` (§4) to a persistent `conflict_log` table with `Resolve` flow for concurrent edits that need human adjudication.
*   **Multi-season historical retraining:** replace synthetic-trained residual model with one trained on real NCPOR consumption logs once available.
*   **Fleet expansion beyond 3 stations:** schema (§3.1) is station-agnostic — config change, not rebuild.

---

## 12. Before You Start Building

*   [ ] Confirm exact SIH26062 deliverables/evaluation bullets from the official sih.gov.in PDF — align feature priority to what's actually asked, not just the title
*   [ ] Agree on cut order (§8) now, in writing, so it's never a live debate
*   [ ] Verify SQLite WASM OPFS + WAL works on your demo tablet's browser (Chrome/Edge 110+); confirm fallback VFS if not
*   [ ] One rehearsed run of the full pitch and demo before submission, including feasibility/impact close and the Rust future line

---
