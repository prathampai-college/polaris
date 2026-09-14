# POLARIS — Polar Logistics & Survival Engine (SIH26062) — 3.5-Minute Pitch

## 0:00 — The Problem (30 seconds)

A −40°C blizzard. Six months of isolation. A 20–50 kbps satellite link with multi-hour blackouts, GPS degraded by ionospheric disturbance, and whiteouts down to 0.8 m visibility. If diesel, oxygen, or a generator bearing runs out during the polar night, that is a survival failure — not a shipping delay. Standard cloud CRUD, GPS telemetry, and continuous REST sync are guaranteed to fail at Maitri and Bharati, because the latency, power budget, and satellite geometry all work against them. **Our answer is edge-native, decentralized, and neuromorphic.**

## 0:30 — Demo 1: Blizzard and DTN Data Muling (90 seconds)

On screen, side by side: HQ India on the Next.js SOC dashboard (`hq-dashboard:3001`), a rugged field tablet at Bharati (`field:3000`, SQLite over OPFS/WAL), and the gateway on `ws://8787`.

Throttle to 20kbps/500ms or pull cable. Take 5 QR-scan updates offline + CRITICAL fuel indent. Outbox holds `PENDING` → `BUNDLED` custody 5 bundles `BroadcastChannel`+QR `bundleToBase64`; pil shows `Pending→Bundled` then on reconnect drains `BUNDLED` → `ACKED` (<2s, `SyncWorker drain PENDING|SENT|BUNDLED`), `psycopg_pool 4/20` keeps HQ responsive, `httpx` async notify never blocks.

Personnel and vehicles are the mules. Hand a bundle to a peer tablet with `Export QR (Mule)` → `Import QR` (simulated BLE), drive back to base, and press `Push Bundles to HQ`. All 5 bundles ingest through `POST /dtn/ingest_bulk`, merge with LWW-plus-vector-clock logic (`concurrent` ties break on wall-clock timestamps), and land as `APPLIED` — or `APPLIED_LOCAL_WINS` when the server copy is causally newer. The gateway log tells the story: 5 deltas in about 1.1 KB of msgpack versus 7.8 KB of JSON (86% saved), CRC clean, vector clocks merged.

Replay the same 5 ULIDs and bundle IDs, and all 5 come back `DEDUPED` with zero applied. HQ quantity stays at 4150 — no double-apply, no corruption.

## 1:30 — Demo 2: Stockout Forecast, Neuromorphic SNN, Whiteout Tracking (60 seconds)

HQ diesel 42 calm days (95% CI 38–47) thermo hybrid physics+int8 ONNX <2MB <200ms. **Toggle SNN**: `GET /forecast/snn/ST-BHARATI` `SNN Active 47 spikes 0.82mW vs 8.2mW 90% saved model: linear-proxy` (honest pill tooltip) — calm repeat `Idle at 0.08mW 99% saved` **cached residual** not zeroed. Watts pill `TodayTab`+drawer; bench `scripts/snn_verify.mjs` real ONNX `1546B p50 ~0.08ms`.

Feed the telemetry simulator a blizzard — −38°C and 22 m/s — and the forecast ticks live down to 18 days (95% CI 15–22), auto-filing a `CRITICAL` indent for 500 L as `FORECAST_AUTO`. Let the weather repeat, and the SNN correctly falls back to `Idle` with zero spikes.

Then **Locate tab**: `GPS` red `GPS Unavailable — ionospheric whiteout`; `LOCAL` 40×40 grid 2m cyan dots 79% conf — 360 LiDAR 70/30 camera + Kalman `q0.01 r0.5` err <0.8m (`tracking_verify.mjs`), **SIM-LIDAR badge** (`SourceBadge sim`) explicit — no hardware. `Whiteout ON` camera blind, LiDAR alone carries.

## 2:30 — Architecture (60 seconds)

**Three pillars, as proposed:** first, vision-fused local spatial mapping — 2D LiDAR plus camera in `shared/src/local_map.ts` and `field/lib/sensors/*`, persisted to `asset_positions`. Second, neuromorphic edge analytics — an snnTorch LIF `5→32→16→1` in `ai/snn/*`, served by `hq/app/snn_forecast.py` and mirrored in `field/lib/snn/engine.ts`. Third, DTN asynchronous data muling — `shared/src/dtn/*` plus `field/lib/dtn/*` plus `hq/app/dtn.py` plus `sync-gateway/src/gateway.ts`, exchanging at `POST /dtn/exchange`.

Field live path one language TypeScript+Node: PWA, OPFS/WAL `polaris.db` (`outbox BUNDLED` + `sync_state.vector_clock` + bundles/positions/SNN), WS msgpack field-deltas + VC + ULID + CRC+AES-GCM under PSK (`KEY_ROTATE` window). HQ FastAPI PG `psycopg_pool 4/20` + Timescale + audit/RBAC + async `httpx` gateway push; Python training ships only `.onnx`+`snn_weights.json` (`model: linear-proxy` until LIF). Weather live Open-Meteo, physics per-station, vessels AIS, power metered — every feed real, honest offline (`SIM-LIDAR` badge when sim), no `?demo=1`.

## 3:30 — Feasibility Close (30 seconds)

Everything runs air-gapped: `docker compose up` with WiFi off, the PWA pre-cached by Workbox, `polaris.db` in OPFS WAL custody, nightly `pg_dump` plus `VACUUM INTO` snapshots.

It reuses the existing rugged tablet, HQ VM, and Iridium link — **₹0 of new hardware** (DTN over `BroadcastChannel`/QR, SNN as JS LIF, simulated LiDAR). It scales to N stations behind the `station_id` filter, with 48 px glove targets, 200% font mode, an immutable audit log, role-based access from `NCPOR_ADMIN` down to `VIEWER`, and deterministic vector-clock merges.

**Production today:** database-driven procurement, bulk import, per-station physics, live weather (Open-Meteo/IMD) and vessel AIS, DTN muling, SNN watt metering, local tracking, a Leaflet ETA pill, acoustic bearing prognostics, an immutable audit trail, and a design proven for a six-month offline winter — with no demo fallback.

## Risks (Proposal §3 — How Each Was Solved)

- **Hardware thresholds:** the JS LIF engine, a 40-cell grid (not 200), and event gating keep thermals safe on Pi-class hardware.
- **Conflict resolution:** LWW plus vector clocks in `hq/app/dtn.py` resolve deterministically, covered by 5 checks in `scripts/dtn_verify.mjs` and replay-dedupe proof in `scripts/m1_verify.mjs`.
- **SNN tooling:** `ai/snn/encoder.py` maps sigmoid outputs to rates to Poisson spikes with `T=20` exactly, `scaler_snn.json` is kept separate, and `scripts/snn_verify.mjs` pins behavior with 6 checks.
