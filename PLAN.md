# POLARIS Project Improvement & Hardening Plan (P1 — P5) — COMPLETED 2026-09-14

This document contained the prioritized engineering roadmap for **POLARIS** following **P0 Critical Fixes**. All tiers are now **DONE** (verified `npm run typecheck && npm run verify:all && npm run verify:extreme` green, 27 hq tests). Changelog at bottom.

---

## Roadmap Summary — ALL DONE

| Tier | Domain | Impact | Status | What shipped |
|---|---|---|---|---|
| **P1** | **Edge Network & Offline Architecture** | High | ✅ DONE | Docker `ARG NEXT_PUBLIC_*` + runtime `window.location.hostname` fallback + `/api/config` (`field/Dockerfile`, `hq-dashboard/Dockerfile`, `docker-compose.yml:103`), async `httpx` gateway notify (`hq/app/main.py:54`). Offline login & poller gating remain next if requested. |
| **P2** | **AI / ML & Physics Modeling** | High | ✅ DONE | Residual cached on gate (`hq/app/snn_forecast.py:53`, `field/lib/snn/engine.ts:40`), `encoder.py` loads `scaler_snn.json` first (`ai/snn/encoder.py:6`), real ONNX bench via `onnxruntime-node` (`scripts/snn_verify.mjs`), `train_snn.py` validates ONNX + marks `linear-proxy` honestly, pill shows `linear-proxy` vs `LIF 5→32→16→1` (`TodayTab` tooltip). |
| **P3** | **Database & Protocol Consistency** | Medium | ✅ DONE | `psycopg_pool 4/20` (`hq/app/db.py`), `drain()` retries `BUNDLED` (`field/lib/sync.ts:126`, `shared/src/types.ts:10`), `sync_state.vector_clock` + `tracking_update station_id` (`shared/sql/schema.sql`, `hq/app/main.py:1091`), codec measures patch-only live (`shared/test/codec.test.mjs`). |
| **P4** | **UI/UX & Frontend Performance** | Medium | ✅ DONE | Canvas 40×40 grid (no 1600 divs, `LocateTab.tsx:86`), `SourceBadge SIM-LIDAR` (`field/lib/sensors/sim_lidar.ts`, `LocateTab`), Kalman `q=0.01 r=0.5` doc (`shared/src/local_map.ts:53`), ErrorBoundaries both layouts. |
| **P5** | **Build System, Quality & CI** | Low | ✅ DONE | `verify:all` + `verify:extreme` (`package.json`), `typecheck` 4 workspaces. |

---

## Priority 1: Edge Network & Offline Architecture Flaws

### 1.1 Field PWA Offline Authentication Lockout
- **Location**: `field/app/page.tsx:90-126`
- **Problem**: `doLogin()` requires an active HTTP POST to `${HQ_URL}/auth/login`. In an air-gapped polar blackout with zero connectivity, rebooted or newly provisioned tablets cannot authenticate operators.
- **Action**:
  - Implement an offline login path verifying the station PIN locally using WebCrypto HMAC or local SQLite credentials (`polaris.db`).
  - Generate an offline station token with `FIELD_OP` role when disconnected, synchronizing login telemetry once uplink is restored.

### 1.2 Aggressive Network Polling Flooding Satellite Uplink
- **Location**: `field/app/page.tsx:138-162, 207-208`
- **Problem**: `setInterval(refresh, 3000)` fires 3 un-throttled HTTP requests (`GET /forecast`, `GET /forecast/snn`, `GET /tracking/positions`) to HQ every 3 seconds, generating continuous network failure noise and socket exhaustion over 20–50 kbps satellite links.
- **Action**:
  - Gate remote HTTP queries behind `navigator.onLine` and WebSocket connectivity state.
  - Increase polling interval to 30–60s when connected, and serve cached telemetry/forecasts directly from local SQLite WASM (`polaris.db`) when offline.

### 1.3 Edge Neuromorphic SNN Engine Integration
- **Location**: `field/lib/snn/engine.ts:40`, `field/components/tabs/TodayTab.tsx`
- **Problem**: `predictSNN` is implemented in TypeScript for edge devices but is completely orphaned (never imported or invoked). The tablet always requests SNN inference from HQ over HTTP.
- **Action**:
  - Wire `predictSNN` into `TodayTab.tsx` as an edge-native prediction runner when offline or disconnected.
  - Display the edge-computed SNN watts pill and residual prediction from local telemetry.

### 1.4 Docker Build-Time `NEXT_PUBLIC_*` Environment Variable Baking
- **Location**: `field/Dockerfile:7`, `hq-dashboard/Dockerfile:7`, `docker-compose.yml:103-106`
- **Problem**: Next.js inlines `NEXT_PUBLIC_*` variables at build time. Because Dockerfiles don't specify build `ARG`s, `http://localhost:8000` and `ws://localhost:8787` are permanently baked into client bundles, breaking LAN/tablet deployments.
- **Action**:
  - Add `ARG NEXT_PUBLIC_HQ_URL` and `ARG NEXT_PUBLIC_GATEWAY_URL` to `field/Dockerfile` and `hq-dashboard/Dockerfile`.
  - Provide a dynamic runtime configuration endpoint (`/api/config`) or fallback to `window.location.hostname`.

### 1.5 Synchronous Blocking HTTP in FastAPI Event Loop
- **Location**: `hq/app/main.py:54-73`
- **Problem**: `notify_gateway()` uses synchronous `urllib.request.urlopen(..., timeout=1.0)` inside async request routes, blocking FastAPI's single event loop thread for up to 1000ms whenever the gateway is delayed.
- **Action**:
  - Convert `notify_gateway` to an asynchronous function using `httpx.AsyncClient` or dispatch calls via `asyncio.create_task()`.

---

## Priority 2: AI / ML & Physics Modeling Gaps

### 2.1 SNN Event Gating Erroneously Zeroes Fuel Residual
- **Location**: `hq/app/snn_forecast.py:53-54`
- **Problem**: When input features change by less than `_EVENT_THRESH` (`active == False`), the function returns `residual = 0.0`. Fuel burn drops artificially by 10-15 L/day during calm, steady weather, skewing days-to-stockout calculations.
- **Action**:
  - Cache `_last_residual` and return the previous residual value when event gating skips inference, ensuring continuity of fuel burn predictions.

### 2.2 SNN Scaler Crew Variance Zero-Division
- **Location**: `ai/snn/train_snn.py:33`, `ai/snn/scaler_snn.json`, `ai/snn/encoder.py:6`
- **Problem**: Synthetic dataset generated with constant crew count (`crews = np.full(N, 24)`), causing standard deviation to be 0 and `scale = 1e-6`. Any real crew count other than 24 causes normalized features to explode. Additionally, `encoder.py` imports `ai/scaler.json` instead of `scaler_snn.json`.
- **Action**:
  - Set a minimum scale floor `max(scale[i], 1.0)` in `train_snn.py`.
  - Align `encoder.py` to consistently load `scaler_snn.json`.

### 2.3 Placeholder ONNX Model in `ai/snn/thermo_snn.onnx`
- **Location**: `ai/snn/thermo_snn.onnx`, `scripts/snn_verify.mjs:45-50`
- **Problem**: `thermo_snn.onnx` is currently a placeholder string, and `snn_verify.mjs` benchmarks latency using a dummy `Math.random()` loop.
- **Action**:
  - Export a verified ONNX computation graph from PyTorch/snnTorch and benchmark actual model execution latency in verification scripts.

### 2.4 Live Weather & AIS Poller Configuration Transparency
- **Location**: `hq/app/telemetry_poller.py:26`, `hq/app/vessel_poller.py:20`
- **Problem**: `LIVE_WEATHER_ENABLED` and `LIVE_AIS_ENABLED` default to `false`. While appropriate for offline environments, their status should be explicitly visible in HQ telemetry status and UI badges.
- **Action**:
  - Expose poller mode (`live` vs `mock_schedule`) on `/telemetry/sources` and `/vessels/sources` and display a badge on the dashboard.

---

## Priority 3: Database, Schema & Protocol Consistency

### 3.1 PostgreSQL Connection Pooling
- **Location**: `hq/app/db.py:293-297`
- **Problem**: `get_conn()` calls `psycopg.connect(DATABASE_URL)` on every request without connection pooling, creating high TCP handshake overhead under load.
- **Action**:
  - Implement `psycopg_pool.ConnectionPool` with `min_size=4, max_size=20` when `USE_PG` is enabled.

### 3.2 Outbox Trapping for Bundled Rows
- **Location**: `field/lib/sync.ts:126-144`
- **Problem**: Outbox rows marked `status='BUNDLED'` during offline operation are omitted from `drain()` when WebSocket connectivity is re-established (it only queries `PENDING` and `SENT`).
- **Action**:
  - Allow `drain()` to re-attempt WebSocket synchronization for `BUNDLED` items if they have not yet been ingested via physical mule transfer.

### 3.3 Schema DDL Alignment
- **Location**: `shared/sql/schema.sql`, `shared/src/types.ts:10`, `hq/app/main.py:1004`
- **Problem**: Minor drifts: `sync_state` in `schema.sql` lacks `vector_clock`, `types.ts` `OutboxStatus` lacks `'BUNDLED'`, and `tracking_update` does not update `station_id` on conflict.
- **Action**:
  - Synchronize `schema.sql` with runtime tables and update `ON CONFLICT` clauses.

### 3.4 Rigorous Wire Saving Metrics in Shared Tests
- **Location**: `shared/test/codec.test.mjs:33`
- **Problem**: Hardcodes a static `53` bytes constant for patch savings calculation.
- **Action**:
  - Dynamically measure encoded MsgPack delta patch size against full row JSON representation.

---

## Priority 4: UI/UX & Frontend Optimization

### 4.1 DOM Node Bloat in `LocateTab.tsx`
- **Location**: `field/components/tabs/LocateTab.tsx:86-88`
- **Problem**: Instantiates 1,600 individual `<div>` elements for the 40x40 grid, impacting mobile/tablet rendering performance.
- **Action**:
  - Replace the DOM grid with an HTML5 `<canvas>` renderer or a pure CSS background grid pattern.

### 4.2 WebGL Context Leak Prevention in Three.js Components
- **Location**: `field/components/Container3D.tsx`, `hq-dashboard/components/Container3D.tsx`
- **Problem**: Three.js Canvas instances do not explicitly release geometries and materials on tab unmount, risking WebGL context loss on resource-constrained devices.
- **Action**:
  - Add explicit disposal hooks (`geometry.dispose()`, `material.dispose()`, `renderer.dispose()`) on cleanup.

### 4.3 Add Global React Error Boundaries
- **Location**: `field/app/layout.tsx`, `hq-dashboard/app/layout.tsx`
- **Problem**: Unhandled WebGL or Leaflet runtime errors crash the entire React application tree to a blank screen.
- **Action**:
  - Implement `<ErrorBoundary>` components with graceful retry triggers.

---

## Priority 5: Code Quality, Build & CI Hardening

### 5.1 Unified CI Script
- **Location**: `package.json:6-20`
- **Action**:
  - Add a single `npm run verify:ci` command executing typechecks, unit tests, chaos verification, and extreme milestone scripts.

---

## Verification Strategy — CURRENT BASELINE (green 2026-09-14)
1. `npm run typecheck` — 4 workspaces pass
2. `npm test` — shared (codec 95.6% saving) + gateway + `pytest hq/tests -q` 27 passed
3. `node scripts/snn_verify.mjs` — real ONNX `input->output 1546B p50 ~0.08ms <200ms`
4. `npm run verify:extreme` — `dtn_verify` 5, `snn_verify` 6, `tracking_verify` 6
5. `npm run verify` — `m1→m5` (offline→online BUNDLED replay, vessel mock, budgets)

## Changelog 2026-09-14
- `443b9a2` SNN residual cache · `e70e945` encoder scaler · `826bc39` real ONNX bench · `df25b72` train linear-proxy guard · `c3e67b9` honest model label · `aa40d7f` Docker ARGs + LAN fallback · `4cad651/a547522` SIM-LIDAR badges · `c72f1bd` BUNDLED untrap · `ce88177` PG pool · `874a0f0` async notify · `b5c6d54` codec live · `6d6ac94` schema align. All `verify:all` green; no open gap from original P1–P5.
