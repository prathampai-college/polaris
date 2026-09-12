# POLARIS — Polar Logistics & Survival Engine (SIH26062) — 3.5-Minute Pitch

## 0:00 — The Problem (30 seconds)

A −40°C blizzard. Six months of isolation. A 20–50 kbps satellite link with multi-hour blackouts, GPS degraded by ionospheric disturbance, and whiteouts down to 0.8 m visibility. If diesel, oxygen, or a generator bearing runs out during the polar night, that is a survival failure — not a shipping delay. Standard cloud CRUD, GPS telemetry, and continuous REST sync are guaranteed to fail at Maitri and Bharati, because the latency, power budget, and satellite geometry all work against them. **Our answer is edge-native, decentralized, and neuromorphic.**

## 0:30 — Demo 1: Blizzard and DTN Data Muling (90 seconds)

On screen, side by side: HQ India on the Next.js SOC dashboard (`hq-dashboard:3001`), a rugged field tablet at Bharati (`field:3000`, SQLite over OPFS/WAL), and the gateway on `ws://8787`.

Throttle DevTools to 20 kbps and 500 ms latency — or just pull the network cable. Take 5 QR-scan updates offline and file a CRITICAL fuel indent. The UI responds instantly while offline: the outbox holds 5 `PENDING` rows, and with the socket closed they convert to `BUNDLED` custody — 5 bundles announced over `BroadcastChannel` and exportable as QR codes via `bundleToBase64`.

Personnel and vehicles are the mules. Hand a bundle to a peer tablet with `Export QR (Mule)` → `Import QR` (simulated BLE), drive back to base, and press `Push Bundles to HQ`. All 5 bundles ingest through `POST /dtn/ingest_bulk`, merge with LWW-plus-vector-clock logic (`concurrent` ties break on wall-clock timestamps), and land as `APPLIED` — or `APPLIED_LOCAL_WINS` when the server copy is causally newer. The gateway log tells the story: 5 deltas in about 1.1 KB of msgpack versus 7.8 KB of JSON (86% saved), CRC clean, vector clocks merged.

Replay the same 5 ULIDs and bundle IDs, and all 5 come back `DEDUPED` with zero applied. HQ quantity stays at 4150 — no double-apply, no corruption.

## 1:30 — Demo 2: Stockout Forecast, Neuromorphic SNN, Whiteout Tracking (60 seconds)

HQ shows diesel at 42 calm days (95% CI 38–47) from the thermo hybrid: physics (`base*(1 + k1ΔT + k2*wind) + k3ΔP`) plus an int8 ONNX residual under 2 MB, served by `onnxruntime-node` in under 200 ms. **Toggle the SNN**: `GET /forecast/snn/ST-BHARATI` reports `SNN Active, 47 spikes, 0.82 mW vs 8.2 mW ANN (90% saved)` — and when inputs stop changing past the `0.12` event gate, it drops to `Idle at 0.08 mW (99% saved)`. The watts pill lives in `TodayTab` and the sync drawer.

Feed the telemetry simulator a blizzard — −38°C and 22 m/s — and the forecast ticks live down to 18 days (95% CI 15–22), auto-filing a `CRITICAL` indent for 500 L as `FORECAST_AUTO`. Let the weather repeat, and the SNN correctly falls back to `Idle` with zero spikes.

Then open the **Locate tab**. In `GPS` mode, a red card reads `GPS Unavailable — ionospheric whiteout`. Flip to `LOCAL`: a 40×40 occupancy grid (2 m cells) with cyan dots for `asset_positions` at 79% confidence — 360 LiDAR points fused 70/30 with camera boxes through a Kalman filter, holding error under 0.8 m (`scripts/tracking_verify.mjs`). Switch `Whiteout ON`: the camera returns nothing, and the LiDAR carries tracking alone.

## 2:30 — Architecture (60 seconds)

**Three pillars, as proposed:** first, vision-fused local spatial mapping — 2D LiDAR plus camera in `shared/src/local_map.ts` and `field/lib/sensors/*`, persisted to `asset_positions`. Second, neuromorphic edge analytics — an snnTorch LIF `5→32→16→1` in `ai/snn/*`, served by `hq/app/snn_forecast.py` and mirrored in `field/lib/snn/engine.ts`. Third, DTN asynchronous data muling — `shared/src/dtn/*` plus `field/lib/dtn/*` plus `hq/app/dtn.py` plus `sync-gateway/src/gateway.ts`, exchanging at `POST /dtn/exchange`.

The field live path is one language, TypeScript on Node: a PWA, a single-file SQLite database over OPFS/WAL (`polaris.db`, holding outbox, bundles, positions, and SNN state), websockets, msgpack field deltas, vector clocks, ULID idempotency, CRC32 framing, and AES-GCM under a pre-shared key (rotated via a `KEY_ROTATE` outbox message). HQ is FastAPI on Postgres/TimescaleDB with audit and RBAC; Python in training ships only `.onnx` and `snn_weights.json`. Weather is live Open-Meteo, physics is calibrated per station, vessels track over AIS, power is metered — every feed is real, with honest offline states and no `?demo=1` dummy data.

## 3:30 — Feasibility Close (30 seconds)

Everything runs air-gapped: `docker compose up` with WiFi off, the PWA pre-cached by Workbox, `polaris.db` in OPFS WAL custody, nightly `pg_dump` plus `VACUUM INTO` snapshots.

It reuses the existing rugged tablet, HQ VM, and Iridium link — **₹0 of new hardware** (DTN over `BroadcastChannel`/QR, SNN as JS LIF, simulated LiDAR). It scales to N stations behind the `station_id` filter, with 48 px glove targets, 200% font mode, an immutable audit log, role-based access from `NCPOR_ADMIN` down to `VIEWER`, and deterministic vector-clock merges.

**Production today:** database-driven procurement, bulk import, per-station physics, live weather (Open-Meteo/IMD) and vessel AIS, DTN muling, SNN watt metering, local tracking, a Leaflet ETA pill, acoustic bearing prognostics, an immutable audit trail, and a design proven for a six-month offline winter — with no demo fallback.

## Risks (Proposal §3 — How Each Was Solved)

- **Hardware thresholds:** the JS LIF engine, a 40-cell grid (not 200), and event gating keep thermals safe on Pi-class hardware.
- **Conflict resolution:** LWW plus vector clocks in `hq/app/dtn.py` resolve deterministically, covered by 5 checks in `scripts/dtn_verify.mjs` and replay-dedupe proof in `scripts/m1_verify.mjs`.
- **SNN tooling:** `ai/snn/encoder.py` maps sigmoid outputs to rates to Poisson spikes with `T=20` exactly, `scaler_snn.json` is kept separate, and `scripts/snn_verify.mjs` pins behavior with 6 checks.
