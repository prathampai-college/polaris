# Architecture — POLARIS

> **Problem statement:** "Develop a centralized digital platform for expedition planning, cargo tracking, inventory management, personnel movement and emergency response."

## Services (`docker-compose.yml`)

| Service | Stack | Port | Notes |
|---------|-------|------|-------|
| `db` | TimescaleDB (`timescale/timescaledb:latest-pg15`) | 5432 | The HQ database. Without `DATABASE_URL`, HQ uses the SQLite file `hq/app/hq.db` (or `HQ_DB_PATH`) instead. |
| `hq` | FastAPI, Python 3.11 (`hq/app/`) | 8000 | Env: `DATABASE_URL`, `PSK_HEX`, `SECRET_KEY`, `POLARIS_ENV`, `STATION_PINS_JSON`, and `GATEWAY_INTERNAL_URL=http://gateway:8787` (target for downstream pushes and link status). |
| `gateway` | Node 20 + `ws` (`sync-gateway/src/`) | 8787 | Env: `HQ_URL=http://hq:8000`, `PSK_HEX`, `POLARIS_ENV`. |
| `field` | Next.js 14 PWA (`field/`) | 3000 | Env: `HQ_PUBLIC_URL`, `GATEWAY_PUBLIC_URL`, read at runtime by `/api/config`. Not given the PSK. |
| `hq-dashboard` | Next.js 14 (`hq-dashboard/`) | 3001 | Build arg and env `NEXT_PUBLIC_HQ_URL`. |

`shared/` (`@polaris/shared`) holds the wire codec, zod schemas, seed data, expiry rules, the local map and the DTN types. Both TypeScript apps and the gateway use it. `shared/sql/schema.sql` is HQ's schema, and HQ adapts it for Postgres in `hq/app/db.py`. The field tablet has its own inline schema, a subset in `field/lib/db/core.ts` `SCHEMA_SQL`, with ids and columns aligned to HQ.

## Write path: tablet → HQ

```
Field UI ──RPC──▶ DB Web Worker (field/lib/db/worker.ts)
                   │ core.ts mutation, one BEGIN IMMEDIATE txn:
                   │   domain row + audit_log + outbox frame(s) {ulid, entity, entity_id, op, msgpack patch, vector_clock}
                   │   stock movements carry patch.delta (and the resulting qty)
                   ▼
            sync tick every 2 s — emergencies first, then oldest first
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

**Priority:** both `nextFrames()` and `bundleOffline()` order by `(entity='emergencies') DESC, created_at`, so an SOS never waits behind a stock backlog.

**Dead link:** a satellite link can drop without the socket closing. If frames are `SENT` and nothing (ACK, delta, anything) has arrived for 45 s, the worker marks the link offline, reconnects and falls back to bundling. Reconnect backoff is 3 s doubling to 30 s, multiplied by a random 0.5–1.5 so a fleet doesn't reconnect in lockstep.

**Link simulator (drill mode only):** Comms → Drill can shape this tablet's uplink to 50 / 20 / 9.6 / 2.4 kbps and 0 / 5 / 20 % loss (`simulateLink` in the worker). A byte budget refills at the chosen rate; a frame that doesn't fit waits for the next tick, a "lost" frame is marked SENT but never sent so the 15 s resend recovers it. The card shows bytes sent, frames lost, queue size and drain time.

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

Frames from one connection are forwarded one at a time, in order. Stock movements now carry a delta and commute, but other entities are still absolute last-write-wins, so an older frame must not land last. If a frame fails to decrypt, the gateway replies with plaintext `{"type":"KEY_MISMATCH"}` and the tablet shows KEY MISMATCH.

### HQ apply rules (`hq/app/sync_apply.py`)

- **Dedupe is insert-first** into `dedupe`. The same ULID arriving over WS and over DTN applies once.
- **`assets`, movements** (`CONSUME|IN|OUT|ADJUST` with `patch.delta`): commutative. HQ re-derives `qty` from the SKU's lots (or adds the delta if it has none), merges clocks and returns `APPLIED`. Two tablets each consuming 5 from 100 end at 90. Below zero → `CONFLICT_CRITICAL`.
- **`assets`, absolute** (`UPSERT`, or a legacy frame without `delta`): the patch's `qty`.
  - A negative qty returns `CONFLICT_CRITICAL`.
  - Vector clocks (`hq/app/_vc.py`) decide the rest. When HQ's clock is `gt`, or the clocks are concurrent and HQ's `updated_at` is not older, HQ keeps its copy and returns `APPLIED_LOCAL_WINS`. Otherwise it applies the qty, merges the clocks and returns `APPLIED`.
- Every applied asset frame pushes HQ's resulting row back downstream (see below).
- An unknown asset returns 404.
- **Other entities:** `indents, personnel, field_sorties, emergencies, expeditions, voyage_legs, manifests, lots` accept UPSERT only.
  - An update writes **only the columns present in the patch**, so a status-only patch never clobbers names.
  - Creating a row needs that entity's required columns.
  - A `lots` write recomputes `assets.qty` as the sum of that SKU's lots. A lot frame with `delta` on an existing lot adds instead of overwriting.
- An unknown entity or op returns 400.
- **Bulk DTN** (`hq/app/dtn.py`) wraps each bundle in a `SAVEPOINT`. It checks the TTL first (`EXPIRED`), and turns any DB error into `RETRY` so the sender keeps custody.

## Downstream: HQ → tablet

```
HQ change ─▶ notify_gateway()
               1. INSERT change_log (seq, station_id, entity, entity_id, op, patch)   ← durable
               2. POST gateway /internal/broadcast_delta {…, seq}  (fire-and-forget, 1 s)
                        ▼
gateway ─▶ DOWNSTREAM_DELTA{seq} to that station's connected tablets
                        ▼
tablet worker: applyDownstreamDelta(entity, id, patch, seq)
   'held'    unsynced local edits on that row  → skip, freeze resume cursor
   'stale'   down_seq[row] ≥ seq               → skip (older than what we have)
   'applied' write it, record down_seq[row] = seq

reconnect: SYNC_INIT{since_seq = kv.down_seq}
gateway pages GET /sync/changes?since=… ─▶ DOWNSTREAM_DELTA{seq, replay:true} … ─▶ SYNC_INIT_RESP{caught_up_to}
```

`notify_gateway()` runs when these change: indent status and auto-indents; personnel, sorties and emergencies (from the dashboard, the API or arriving through sync); every applied asset frame (HQ's resulting row — this is how a tablet whose stale frame got `APPLIED_LOCAL_WINS` learns HQ's value, and how other tablets see a movement); watchdog auto-SOS; bulk asset imports.

**Why a log:** pushes are fire-and-forget, so a tablet that was offline used to miss everything except indents. Now every push is in `change_log` first and is replayable by `seq`.

**Resume cursor** (`kv['down_seq']` on the tablet): advances on replayed deltas, on live deltas once the replay for this connection has finished, and to `caught_up_to`. It never advances past a `held` delta. When the outbox has drained and a delta was held, the tablet sends `SYNC_INIT` again and the held change replays and applies.

**Ordering:** replayed and live deltas can interleave right after a reconnect. The per-row `down_seq` table means an older seq never overwrites a newer one, whatever order they arrive in.

**Conflict rule:** if the tablet has unsynced writes for a row, the local copy wins for now (and HQ's change is replayed later). Otherwise the server copy wins. An asset qty from HQ is treated as absolute and reconciled into the tablet's lots FEFO-first.

Screens can also pull on demand, and the same merge applies: stock (`GET /assets`), personnel, indents, and expeditions with their manifests. An `emergencies` delta with status ACTIVE triggers a haptic alert and a toast on the tablet.

## Field tablet

Details are in `field/README.md`. In short:

- **Storage:** sqlite-wasm on the OPFS SyncAccessHandle pool, running in a Web Worker. On boot it calls `navigator.storage.persist()` so the browser doesn't evict months of station data. It falls back to `:memory:` with a visible EPHEMERAL warning (writes still work, so an SOS can always be raised).
- **RPC:** every page → worker call times out after 20 s, and if the worker crashes every waiting call fails immediately instead of hanging.
- **SOS:** location is required. A one-tap **GPS fix** fills it when the device has one (15 s timeout; never blocks transmitting). Each emergency card says `NOT YET AT HQ — queued`, `HQ RECEIVED <time>` or `RAISED BY HQ`, from the outbox state.
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
check_and_escalate(): ≤20 d → CRITICAL indent · ≤60 d → MEDIUM watch (escalated in place if it worsens) · acoustic > 0.90 → bearings
```

`ci` is a placeholder ±15 % band, and responses say so (`ci_source: placeholder_15pct`). `dg_load` is synthetic unless `DG_SOURCE=meter`. The vessel poller (`hq/app/vessel_poller.py`) uses AISHub when enabled and keyed, and otherwise interpolates `shared/vessel_schedule.json` (labelled `mock`). SNN inference runs at HQ only. The field tablet shows the HQ forecast on its Brief.

## HQ database init (`hq/app/db.py`)

`shared/sql/schema.sql` is the single schema source for both dialects — every `CREATE` is `IF NOT EXISTS`, so re-applying it against an existing database only ever adds what's missing. `init_db()` runs the same three steps on both:
- **`_run_schema`** applies `schema.sql` (SQLite: one `executescript`; Postgres: statement-by-statement, retrying once for forward foreign-key references, e.g. `field_sorties` → `expeditions`).
- **`_run_migrations`** backfills a short explicit `ALTER TABLE ADD COLUMN` list — columns added to a table after its `CREATE TABLE` first shipped, for a database created from an older revision of `schema.sql`.
- **`_seed_if_empty`** seeds stations, containers, crates, assets, procurement targets, physics params, personnel, expeditions, and opening lots (`LOT-{sku}-0` / `{sku}-L0`, the same ids the tablet seeds, so FEFO lot frames converge) — one insert list per table, each `ON CONFLICT DO NOTHING`, run only while that table is empty.

`change_log.seq` is `INTEGER PRIMARY KEY` in SQLite and becomes `BIGSERIAL` on Postgres (`_pg_schema_sql`).

**SQLite (no `DATABASE_URL`):** `hq/app/hq.db` (override with `HQ_DB_PATH`; tests and verify scripts use a temp file) in WAL mode; `get_sqlite()` self-heals a thread-local connection that lands on an empty file by re-running the three steps above.

## Security

| Layer | Current | Not done |
|-------|---------|----------|
| Wire | AES-GCM with a 32-byte `PSK_HEX` (the GCM tag gives integrity; the CRC32 is framing only). `MAX_WIRE_SIZE` is 2048 B. The gateway validates frames with zod. | TLS on the WS link is up to the deployment |
| Keys | **One shared PSK** for the gateway and all tablets. A tablet is provisioned in Comms (paste or QR, stored in the worker's `kv` table, only a 4-hex fingerprint shown). An unprovisioned tablet runs on the flagged dev key. `POLARIS_ENV=production` refuses the dev key on HQ and the gateway. | Per-device keys, rotation, a key id on the wire |
| Replay | Upstream: every frame's ULID is deduped at HQ, so a replayed frame is `DEDUPED`. Downstream: the per-row `seq` guard ignores any delta older than what the tablet already applied. | A per-device counter in the AEAD |
| Gateway HTTP | `/dtn/exchange`, `/internal/broadcast_delta` and `/internal/status` require `X-PSK`, compared with `timingSafeEqual`. The body cap is 512 KB. The gateway sends `X-PSK` on its own calls to HQ. | — |
| HQ auth | An auth gate on every write: JWT (HS256, 8 h) with a role floor per path (`FIELD_OP` default, `HQ_LOGISTICS` for expeditions/vessel polls, `DISPATCH` for the watchdog trigger, `STATION_LEAD` for indent transitions). Machine paths (`/sync/*`, `/dtn/*`, `/telemetry`) also accept `X-PSK`. `/personnel`, `/audit` and `/overrides` reads need a token. Audit actor comes from the token, not the request body. `POLARIS_ENV=production` refuses to boot on demo secrets/PINs and disables device-prefix elevation. | Station scoping (a token for one station can still write another station's rows); per-user accounts (logins are per station PIN) |
| Dashboard | Every page is behind the sign-in gate; any `401` from HQ drops back to it. Resolving an SOS asks for confirmation. | Per-user accounts |
| Field at rest | OPFS (origin-private) plus OS disk encryption. PIN stored only as a salted PBKDF2 hash. | SQLCipher; encrypted QR bundles (QR/text hand-off is plaintext) |
| Browser | The camera, OPFS and WebCrypto need a **secure context** (HTTPS or localhost). On plain http to a LAN IP they are unavailable and the app shows INSECURE HTTP. | — |

## Failure modes

- **Link down:** writes continue locally. Unsent frames become BUNDLED and the strip shows DTN STORE-FWD. On reconnect they drain over WS and HQ dedupes by ULID. HQ's **Link Health** page shows the station as STORE_FWD / QUIET / SILENT.
- **HQ down or slow:** the gateway answers RETRY and the tablet backs off. Nothing is dead-lettered.
- **Wrong key:** the gateway sends a plaintext KEY_MISMATCH. The tablet stops showing LIVE, and the Brief links to Comms to provision the key.
- **Replay or duplicate channel:** HQ returns `DEDUPED` and the tablet treats it as ACKED.
- **Tablet offline while HQ changes things:** every downstream push is first written to HQ's `change_log` with a monotonic `seq`. On reconnect the tablet sends `SYNC_INIT{since_seq}` and the gateway replays what it missed, oldest first, then `SYNC_INIT_RESP{caught_up_to}`. A per-row seq guard (`down_seq`) stops an older replayed delta overwriting a newer live one. A delta held back by unsynced local edits freezes the cursor; once the outbox drains the tablet resyncs and it applies.
- **Satellite drops silently (socket still "open"):** if frames are in flight and nothing is heard back for 45 s, the tablet declares the link dead, reconnects, and falls back to DTN bundling. Reconnect backoff is jittered.
- **Concurrent stock movements on two tablets:** lot and asset frames carry `delta`; HQ adds rather than overwrites, so both count. ULID dedupe keeps each delta exactly-once.
- **Bad bundle in a batch:** its SAVEPOINT is rolled back, that bundle is marked `FAILED`, and the rest apply.
- **Stock would go negative at HQ:** `CONFLICT_CRITICAL`. The frame is FAILED and visible in Comms.
- **OPFS unavailable (second tab, insecure context):** the database runs in `:memory:` and the UI shows EPHEMERAL · LOST ON RELOAD.
- **ONNX model missing:** the forecast falls back to the physics-only path.
- **AIS or weather feed failure:** cached or `mock` data is labelled as such. `/telemetry/sources` and `/vessels/sources` report the error.

## Known limits

- HQ writes are authenticated, but not station-scoped: logins are per station PIN, not per person.
- A single shared PSK. No per-device keys.
- The DTN "mesh" is a same-origin `BroadcastChannel`. There is no radio transport. Hand-off between devices is by QR or text, and those bundles are not encrypted.
- `change_log` grows forever (no compaction yet); a tablet offline for a very long time replays at most 20 × 500 changes per reconnect and picks up the rest on the next one.
- Link Health's live numbers live in gateway memory and reset when the gateway restarts.
- Locate's LiDAR/camera positioning is simulated (`field/lib/sensors/`) and only visible in drill mode.
- A secure context is required on tablets.
- Vector-clock merge (concurrent-edit resolution) applies to asset quantities only; every other synced table (personnel, sorties, emergencies, expeditions, manifests) is last-write-wins by timestamp.
- `/tracking/personnel` and `/tracking/positions` exist and are written to, but no HQ dashboard page renders them yet — there's no live personnel-position map.
- The dashboard has no push channel except telemetry SSE: the Stations 3D view fetches once on load, and the vessel map, emergencies banner and Link Health poll (15–20 s).
