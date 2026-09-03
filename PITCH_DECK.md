# POLARIS — Polar Logistics & Survival Engine (SIH26062) — 3.5 min Pitch (Extreme-Edge)

## 0:00 Problem (30s)
- -40°C blizzard, 6-month isolation, 20-50 kbps sat with multi-hour blackouts, GPS ionospheric loss, whiteout 0.8m visibility. Stockout of diesel/oxygen/DG bearing in polar night = survival failure, not delay. Standard CRUD cloud + GPS telemetry + continuous REST is guaranteed to fail at Maitri/Bharati — high latency, power constraints, degraded satellite geometry. **Solution: edge-native, decentralized, neuromorphic.**

## 0:30 Demo 1 — Blizzard + DTN Data Muling (90s)
- Side-by-side: HQ India (Next SOC `hq-dashboard:3001`) + Field Bharati tablet rugged (`field:3000`, SQLite OPFS/WAL) + Gateway `ws://8787`.
- Throttle DevTools 20kbps/500ms or pull network. Offline 5 QR updates + create CRITICAL fuel indent → UI instant offline, outbox `PENDING 5` → `ws !== OPEN` → `BUNDLED` custody 5, `BroadcastChannel` QR `bundleToBase64`.
- Personnel/vehicle = mule. QR handoff `Export QR (Mule)` → `Import QR` on peer tablet (sim BLE). Return to base → `Push Bundles to HQ` → `POST /dtn/ingest_bulk` 5 bundles, LWW+VC `concurrent→LWW ts` merge, `status APPLIED` (or `APPLIED_LOCAL_WINS` if concurrent older). Gateway log: `5 deltas ~1.1KB msgpack (vs ~7.8KB JSON, 86% saving), CRC ok, VC merged`.
- Replay same 5 ULIDs/bundleIds → `DEDUPED 5, 0 applied`. HQ qty stays 4150 — no double-apply, no corruption.

## 1:30 Demo 2 — Stockout Forecast + Neuromorphic SNN + Whiteout Tracking (60s)
- HQ shows diesel calm 42 days (95% CI 38-47) via thermo hybrid (physics `base*(1+k1ΔT+k2 wind)+k3ΔP` + ML residual ONNX int8 <2MB, `onnxruntime-node` <200ms). **Toggle SNN**: `GET /forecast/snn/ST-BHARATI` pill `SNN Active 47 spikes 0.82mW vs 8.2mW ANN (90% saved)` → event-gated `Δ>0.12` else `Idle 0.08mW (99% saved)` — watts pill in `TodayTab` + sync drawer.
- Feed telemetry simulator blizzard -38°C + 22 m/s → forecast ticks live to 18 days (95% CI 15-22), auto `CRITICAL` indent `FORECAST_AUTO 500L`. Toggle SNN → `Idle` when calm repeat (no spikes).
- **Locate tab**: `GPS` mode → red `GPS Unavailable — ionospheric whiteout` card. Toggle `LOCAL` → 40×40 2m/cell occupancy grid + cyan dots `asset_positions` `[x,y]` conf 79% — LiDAR 360pts + camera bbox 70/30 fused → Kalman `err <0.8m` `scripts/tracking_verify.mjs`. `Whiteout ON` → camera `[]` blind, LiDAR still active ✓.

## 2:30 Architecture (60s)
- **Three pillars** (proposal): I `Vision-Fused Local Spatial Mapping` 2D LiDAR+Camera `shared/src/local_map.ts` `field/lib/sensors/*`/`asset_positions`; II `Neuromorphic Edge Analytics` snnTorch LIF `5→32→16→1` `ai/snn/*`+`hq/app/snn_forecast.py`+`field/lib/snn/engine.ts` `shared/src/power.ts`; III `DTN Asynchronous Data-Muling` `shared/src/dtn/*`+`field/lib/dtn/*`+`hq/app/dtn.py`+`sync-gateway/src/gateway.ts` `POST /dtn/exchange`.
- Field live path one language TypeScript/Node: PWA + SQLite WASM OPFS/WAL single DB file `polaris.db` (outbox+dtn_bundles+asset_positions+snn_state) + `ws` + `@msgpack/msgpack` field deltas + VC + ULID idempotency + CRC32 + AES-GCM PSK (rotation via `KEY_ROTATE` outbox). HQ FastAPI + Postgres/TimescaleDB + audit/RBAC, training Python only ships `.onnx`/`snn_weights.json`. Production-ready with live Open-Meteo weather, per-station physics calibration, AIS vessel tracking, power telemetry — all real data with honest offline states (no `?demo=1` dummy).

## 3:30 Feasibility Close (30s)
- Air-gapped `docker compose up` WiFi off, PWA Workbox pre-cached, `polaris.db` OPFS WAL custody, nightly `pg_dump` + `VACUUM INTO`.
- Reuses existing rugged tablet + HQ VM + Iridium link — **₹0** new hardware (DTN via `BroadcastChannel`/QR, SNN JS LIF, sim LiDAR), scales to N stations `station_id` filter, glove 48px, 200% font, audit immutable, RBAC `NCPOR_ADMIN>STATION_LEAD>FIELD_OP>VIEWER`, VC deterministic.

**Production:** Procurement DB, bulk import, per-station physics, live weather (Open-Meteo/IMD) + vessel AIS + DTN mule + SNN watts + local tracking + Leaflet ETA pill + acoustic bearing prognostics + audit immutable + offline 6-month winter proof — no demo fallback.

## Risks (Proposal §3 — How Solved)
- **Hardware thresholds:** JS LIF + 40 grid (not 200) + event-gated → Pi5 thermal safe.
- **Conflict resolution:** LWW+VC `compare_vc` `hq/app/dtn.py` deterministic, tested `scripts/dtn_verify.mjs` 5 checks, `scripts/m1_verify.mjs` replay `DEDUPED`.
- **SNN tooling:** `ai/snn/encoder.py` sigmoid→rate→Poisson `T=20` exact, `scaler_snn.json` separate, verify `scripts/snn_verify.mjs` 6 checks.
