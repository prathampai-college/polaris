# POLARIS — Polar Logistics & Survival Engine (SIH26062) — 3.5 min Pitch

## 0:00 Problem (30s)
- -40°C blizzard, 6-month isolation, 20-50 kbps sat with multi-hour blackouts. Stockout of diesel/oxygen/DG bearing in polar night = survival failure, not delay. Standard WMS assumes internet + temperate warehouse.

## 0:30 Demo 1 — Blizzard Network Cut (90s)
- Side-by-side: HQ India (Next SOC `hq-dashboard:3001`) + Field Bharati tablet rugged (`field:3000`, SQLite OPFS/WAL).
- Throttle DevTools 20kbps/500ms or pull network. Scan 5 QR updates + create CRITICAL fuel indent → UI instant offline, outbox PENDING 5 with ULIDs.
- Reconnect → gateway log: `5 deltas ~1.1KB msgpack (vs ~7.8KB JSON, 86% saving), 5/5 deduped, CRC ok`. HQ `<2s` SYNCED + audit. Replay same 5 ULIDs → `dedupe hit 5, 0 applied`. Fallback video pre-recorded.

## 1:30 Demo 2 — Stockout Forecast Reveal (60s)
- HQ shows diesel calm 42 days (95% CI 38-47) via thermo hybrid (physics `base*(1+k1ΔT+k2 wind)+k3ΔP` + ML residual ONNX int8 <2MB, `onnxruntime-node` <200ms, no Python).
- Feed telemetry simulator blizzard -38°C + 22 m/s → forecast ticks live to 18 days (95% CI 15-22), band tightens, auto CRITICAL indent.
- Toggle ML residual off → falls back to pure physics 21 days (graceful degrade). Honest: physics-informed, not certified.

## 2:30 Architecture (60s)
- Field live path one language TypeScript/Node: PWA + SQLite WASM OPFS/WAL single DB file + outbox + `ws` + `@msgpack/msgpack` field deltas + field-level diff + `zod` + ULID idempotency + CRC32 + AES-GCM PSK (rotation via KEY_ROTATE outbox). HQ FastAPI + Postgres/TimescaleDB + audit/RBAC, training Python only ships .onnx. Rust `tokio`/`ort` + QUIC is planned production hardening once Node proves architecture (signals maturity, not avoidance).

## 3:30 Feasibility Close (30s)
- Air-gapped `docker compose up` WiFi off, PWA Workbox pre-cached, `polaris.db` OPFS, nightly `pg_dump` + `VACUUM INTO`.
- Runs on existing hardware, no new sat, scales to N stations, glove 48px, 200% font, audit immutable, RBAC `NCPOR_ADMIN>STATION_LEAD>FIELD_OP>VIEWER`.
- Cut order agreed: 1) HQ trends →2) 2D grid polish →3) rest. Offline QR + thermo chaos is the whole pitch.

**Future (§11):** Rust sync, QUIC, protobuf registry, mTLS/WireGuard, 3D X-Ray `{x,y,z}`, acoustic prognostics, Automerge CRDT, short-lived JWT+refresh, multi-season retrain.

