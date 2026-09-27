# Architecture — POLARIS

> **Problem statement:** "Develop a centralized digital platform for expedition planning, cargo tracking, inventory management, personnel movement and emergency response."

## Services (`docker-compose.yml`)

| Service | Stack | Port | Notes |
|---------|-------|------|-------|
| `db` | TimescaleDB (`timescale/timescaledb:latest-pg15`) | 5432 | The HQ database. Without `DATABASE_URL`, HQ uses the SQLite file `hq/app/hq.db` instead. |
| `hq` | FastAPI, Python 3.11 (`hq/app/`) | 8000 | Env: `DATABASE_URL`, `PSK_HEX`, `SECRET_KEY`, and `GATEWAY_INTERNAL_URL=http://gateway:8787` (target for downstream pushes). |
| `gateway` | Node 20 + `ws` (`sync-gateway/src/`) | 8787 | Env: `HQ_URL=http://hq:8000`, `PSK_HEX`. |
| `field` | Next.js 14 PWA (`field/`) | 3000 | Env: `HQ_PUBLIC_URL`, `GATEWAY_PUBLIC_URL`, read at runtime by `/api/config`. Not given the PSK. |
| `hq-dashboard` | Next.js 14 (`hq-dashboard/`) | 3001 | Build arg and env `NEXT_PUBLIC_HQ_URL`. |

`shared/` (`@polaris/shared`) holds the wire codec, zod schemas, seed data, expiry rules, the local map and the DTN types. Both TypeScript apps and the gateway use it. `shared/sql/schema.sql` is HQ's schema, and HQ adapts it for Postgres in `hq/app/db.py`. The field tablet has its own inline schema, a subset in `field/lib/db/core.ts` `SCHEMA_SQL`, with ids and columns aligned to HQ.

## Write path: tablet → HQ

```
Field UI ──RPC──▶ DB Web Worker (field/lib/db/worker.ts)
                   │ core.ts mutation, one BEGIN IMMEDIATE txn:
                   │   domain row + audit_log + outbox frame(s) {ulid, entity, entity_id, op, msgpack patch, vector_clock}
                   ▼
            sync tick every 2 s
   link LIVE ──────────────┬────────────── link down
   up to 8 due frames      │               bundleOffline(): outbox row → dtn_bundles
   toWire(msgpack→AES-GCM  │               (bundleId = outbox ULID), status BUNDLED,
   →CRC32), ≤2048 B        │               posted on BroadcastChannel('polaris-mule');
   status SENT             │               QR/text export in Comms
            ▼              │                         ▼
   gateway WS :8787        │               carried to a live tablet → its worker forwards
   decrypt → zod →         │               foreign bundles every 30 s to gateway
   ordered per connection  │               POST /dtn/exchange (X-PSK) → HQ /dtn/ingest_bulk
   → HQ POST /sync/ingest  │                         │
            └──────────────┴──────────┬──────────────┘
                                      ▼
                   hq/app/sync_apply.py apply_frame()  (one path, SQLite or Postgres)
                   dedupe(ulid) → entity rules → audit_log + sync_state
                                      ▼
                   ACK {ulid, status} → gateway → tablet applyAck()
```

The tablet's own BUNDLED rows go back into the WS send queue when the link returns. Their ACK deletes the matching `dtn_bundles` row, so custody ends exactly when HQ confirms.

### Outbox status (`field/lib/db/core.ts`)

| Status | Meaning |
|--------|---------|
| `PENDING` | Queued. A RETRY ACK also returns a frame here, with `next_attempt_at` set by exponential backoff (2 s × 2ⁿ, max 120 s). |
| `SENT` | On the wire. Resent if not ACKed within 15 s (`RESEND_AFTER_MS`). |
| `ACKED` | Terminal. Reached on `APPLIED`, `DEDUPED` or `APPLIED_LOCAL_WINS`. A late FAILED or RETRY never downgrades it. |
| `FAILED` | Permanently rejected: an HQ 4xx, `CONFLICT_CRITICAL`, an invalid frame or an oversize frame. It shows in Comms, where you can retry or discard it (discards are audited). |
| `BUNDLED` | In DTN custody while offline. Sent over WS once the link returns. |

### Gateway ACK mapping (`sync-gateway/src/ack.ts`)

- HQ 2xx with a known status: that status is passed through.
- 5xx, 429, a network error or a 10 s timeout: **RETRY**. The write stays queued.
- Any other 4xx: **FAILED**.

Frames from one connection are forwarded one at a time, in order, because asset patches carry an absolute qty and an older frame must not land last. If a frame fails to decrypt, the gateway replies with plaintext `{"type":"KEY_MISMATCH"}` and the tablet shows KEY MISMATCH.

### HQ apply rules (`hq/app/sync_apply.py`)

- **Dedupe is insert-first** into `dedupe`. The same ULID arriving over WS and over DTN applies once.
- **`assets`:** every op (`UPSERT|CONSUME|IN|OUT|ADJUST`) applies the patch's absolute `qty`.
  - A negative qty returns `CONFLICT_CRITICAL`.
  - Vector clocks (`hq/app/_vc.py`) decide the rest. When HQ's clock is `gt`, or the clocks are concurrent and HQ's `updated_at` is not older, HQ keeps its copy and returns `APPLIED_LOCAL_WINS`. Otherwise it applies the qty, merges the clocks and returns `APPLIED`.
  - An unknown asset returns 404.
- **Other entities:** `indents, personnel, field_sorties, emergencies, expeditions, voyage_legs, manifests, lots` accept UPSERT only.
  - An update writes **only the columns present in the patch**, so a status-only patch never clobbers names.
  - Creating a row needs that entity's required columns.
  - A `lots` write recomputes `assets.qty` as the sum of that SKU's lots.
- An unknown entity or op returns 400.
- **Bulk DTN** (`hq/app/dtn.py`) wraps each bundle in a `SAVEPOINT`. It checks the TTL first (`EXPIRED`), and turns any DB error into `RETRY` so the sender keeps custody.

## Downstream: HQ → tablet

HQ's `notify_gateway()` is fire-and-forget (httpx, 1 s timeout). It posts to `GATEWAY_INTERNAL_URL/internal/broadcast_delta` with `X-PSK` when these change:

- indent status;
- personnel, sorties or emergencies arriving through sync;
- watchdog auto-SOS;
- forecast escalations;
- vessel positions.

The gateway encrypts a `DOWNSTREAM_DELTA` and sends it to the connected tablets of that `station_id`. On connect, `SYNC_INIT` → `SYNC_INIT_RESP` delivers the station's indents.

The tablet applies each delta with `applyDownstream()`. **If the tablet has unsynced writes for that row, the local copy wins. Otherwise the server copy wins.** An asset qty from HQ is treated as absolute and reconciled into the opening lot.

Screens can also pull on demand, and the same merge applies: stock (`GET /assets`), personnel, indents, and expeditions with their manifests. An `emergencies` delta with status ACTIVE triggers a haptic alert and a toast on the tablet.

## Field tablet

Details are in `field/README.md`. In short:

- **Storage:** sqlite-wasm on the OPFS SyncAccessHandle pool, running in a Web Worker. It falls back to `:memory:` with a visible EPHEMERAL warning.
- **Live UI:** `useLiveQuery` re-runs on per-table change events, with no polling.
- **Routes** under `field/app/(field)/`: Brief, Scan, Stock, Muster, Indents, Cargo, Locate, Comms, Settings, plus `/login`.
- **Sign-in:** offline unlock using a PBKDF2 PIN hash stored after the first online sign-in (`field/lib/session.ts`).
- **Offline shell:** a hand-written service worker, `field/public/sw.js`.

## Forecasting (HQ)

```
Open-Meteo / IMD poller (hq/app/telemetry_poller.py, 15 min)  ─┐
POST /telemetry                                                ├─▶ telemetry table
                                                               ▼
hq/app/forecast.py  per-station physics_params + ONNX residual (ai/thermo_residual.onnx)
hq/app/snn_forecast.py  event-gated LIF 5→32→16→1 (T=20), numpy mirror of ai/snn/thermo_snn.onnx
                                                               ▼
GET /forecast/{station} · GET /forecast/snn/{station}   (tele.source = live | stale_cache | assumed_default)
check_and_escalate(): ≤20 d → CRITICAL indent · ≤60 d → MEDIUM watch · acoustic > 0.90 → bearings
```

`ci` is a placeholder ±15 % band, and responses say so (`ci_source: placeholder_15pct`). `dg_load` is synthetic unless `DG_SOURCE=meter`. The vessel poller (`hq/app/vessel_poller.py`) uses AISHub when enabled and keyed, and otherwise interpolates `shared/vessel_schedule.json` (labelled `mock`). SNN inference runs at HQ only. The field tablet shows the HQ forecast on its Brief.

## HQ database init (`hq/app/db.py`)

- **SQLite (no `DATABASE_URL`):** `hq/app/hq.db` in WAL mode. `_ensure_*` migrations add newer tables and columns.
- **Postgres:** `init_db()` runs the schema in two passes, deferring statements that hit forward foreign-key references. On first boot it seeds stations, containers, crates, assets, procurement targets, physics params, **personnel, expeditions, and opening lots** (`LOT-{sku}-0` / `{sku}-L0`, the same ids the tablet seeds, so FEFO lot frames converge).

## Security

| Layer | Current | Not done |
|-------|---------|----------|
| Wire | AES-GCM with a 32-byte `PSK_HEX` (the GCM tag gives integrity; the CRC32 is framing only). `MAX_WIRE_SIZE` is 2048 B. The gateway validates frames with zod. | TLS on the WS link is up to the deployment |
| Keys | **One shared PSK** for the gateway and all tablets. A tablet is provisioned in Comms (paste or QR, stored in the worker's `kv` table, only a 4-hex fingerprint shown). An unprovisioned tablet runs on the flagged dev key. | Per-device keys, rotation |
| Gateway HTTP | `/dtn/exchange` and `/internal/broadcast_delta` require `X-PSK`, compared with `timingSafeEqual`. The body cap is 512 KB. | — |
| HQ auth | JWT (HS256, 8 h). Elevated roles need an approved device-ID prefix or `ADMIN_KEY`. | **Most HQ endpoints are unauthenticated.** Only 5 routes plus the `POST /sorties` solo branch check roles. `/sync/ingest` and `/dtn/*` on HQ are open, so HQ must not be exposed beyond the gateway network. |
| Field at rest | OPFS (origin-private) plus OS disk encryption. PIN stored only as a salted PBKDF2 hash. | SQLCipher |
| Browser | The camera, OPFS and WebCrypto need a **secure context** (HTTPS or localhost). On plain http to a LAN IP they are unavailable and the app shows INSECURE HTTP. | — |

## Failure modes

- **Link down:** writes continue locally. Unsent frames become BUNDLED and the strip shows DTN STORE-FWD. On reconnect they drain over WS and HQ dedupes by ULID.
- **HQ down or slow:** the gateway answers RETRY and the tablet backs off. Nothing is dead-lettered.
- **Wrong key:** the gateway sends a plaintext KEY_MISMATCH. The tablet stops showing LIVE, and the Brief links to Comms to provision the key.
- **Replay or duplicate channel:** HQ returns `DEDUPED` and the tablet treats it as ACKED.
- **Bad bundle in a batch:** its SAVEPOINT is rolled back, that bundle is marked `FAILED`, and the rest apply.
- **Stock would go negative at HQ:** `CONFLICT_CRITICAL`. The frame is FAILED and visible in Comms.
- **OPFS unavailable (second tab, insecure context):** the database runs in `:memory:` and the UI shows EPHEMERAL · LOST ON RELOAD.
- **ONNX model missing:** the forecast falls back to the physics-only path.
- **AIS or weather feed failure:** cached or `mock` data is labelled as such. `/telemetry/sources` and `/vessels/sources` report the error.

## Known limits

- Most HQ endpoints are unauthenticated.
- A single shared PSK. No per-device keys.
- The DTN "mesh" is a same-origin `BroadcastChannel`. There is no radio transport. Hand-off between devices is by QR or text.
- Locate's LiDAR/camera positioning is simulated (`field/lib/sensors/`) and only visible in drill mode.
- A secure context is required on tablets.
- The HQ sync path does not re-check the indent state machine (the tablet only moves DISPATCHED → RECEIVED).
