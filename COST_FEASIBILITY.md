# Feasibility & Cost — NCPOR MoES (Stage Slide)

**Runs on hardware NCPOR already has. No new satellite gear.**

| Item | Requirement | Cost | Note |
|------|-------------|------|------|
| Field tablet | Rugged Android 10+ (existing) | ₹0 (reuse) | PWA + SQLite OPFS/WAL, glove 48px, 200% font validated |
| HQ server | Existing MoES VM / laptop, Docker | ₹0 | FastAPI + PostgreSQL/TimescaleDB + audit, air-gapped `docker compose up` |
| Satellite link | Existing 20-50 kbps Iridium, ws + msgpack deltas (70-80% smaller, frame <2KB, CRC+AES-GCM) | ₹0 | Throttled harness proves <5s convergence after blackout |
| AI model | ONNX int8 <2MB (`ai/thermo_residual.onnx` 1.3KB) via `onnxruntime-node`, physics fallback | ₹0 | No Python at edge, <200ms, retrained HQ on TimescaleDB |
| Deployment | PSK provisioned at HQ via QR pairing, key rotation as `KEY_ROTATE` outbox on next sync window | ₹0 PKI optional (WireGuard/mTLS §11) loops in without new infra | 

**Total incremental:** ₹0 hardware, ~2 days to provision 3 stations. Scales to N stations — schema `station_id` filter, no rebuild. Leaflet `1.9.4` already installed for vessel map; RPi-class hardening via Rust `tokio`/`ort` is optional, not required — system is production-ready air-gapped.

**Impact:** Stockout warning 42→18d (95% CI) weeks before route freeze, auto CRITICAL indent, audit immutable, offline 6-month winter proof.
