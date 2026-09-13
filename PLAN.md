# POLARIS Project Improvement & Hardening Plan (P1 — P5)

This document contains the prioritized engineering roadmap for **POLARIS** following the completion of **P0 Critical Fixes** (Authentication Security, Thread-Safe SQLite Concurrency, DTN Custody Verification, and Multi-Asset Kalman Filter Isolation).

---

## Roadmap Summary

| Tier | Domain | Impact | Description |
|---|---|---|---|
| **P1** | **Edge Network & Offline Architecture** | High | True air-gapped offline login, satellite bandwidth preservation, Docker runtime config, and async event loop non-blocking gateway notifications. |
| **P2** | **AI / ML & Physics Modeling** | High | SNN event-gating residual persistence, scaler variance normalization, genuine ONNX export, and poller state transparency. |
| **P3** | **Database & Protocol Consistency** | Medium | PostgreSQL connection pooling, outbox sync un-trapping for reconnected tablets, and schema DDL alignment. |
| **P4** | **UI/UX & Frontend Performance** | Medium | 1,600 DOM node elimination in 2D LiDAR grid, WebGL context cleanup, and React Error Boundaries. |
| **P5** | **Build System, Quality & CI** | Low | Unified `verify:all` CI automation and lint enforcement. |

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

## Verification Strategy for Future Execution
Each tier should be validated against the existing test suite:
1. `npm run typecheck` (all 4 workspaces)
2. `npm test` (`shared`, `sync-gateway`, `hq/tests`)
3. `npm run test:chaos` (`m4_verify.mjs`, `m3_verify.mjs`)
4. `npm run test:e2e` (`m1_verify.mjs`, `m2_verify.mjs`)
5. `npm run verify:extreme` (`dtn_verify.mjs`, `snn_verify.mjs`, `tracking_verify.mjs`)
