# API — POLARIS HQ (FastAPI :8000) and sync gateway (:8787)

The HQ base URL is `http://localhost:8000` (`hq:8000` inside Docker). The API is JSON and its routes are in `hq/app/main.py`. CORS comes from `ALLOWED_ORIGINS`: `*` is dropped automatically when `DATABASE_URL` is set, falling back to the localhost allowlist. Errors use FastAPI's `{detail}` shape.

## Auth gate (every route)

One middleware in `hq/app/main.py` (`_auth_gate`) runs before every route:

| Request | Needs |
|---|---|
| `GET` (most reads) | nothing |
| `GET /personnel`, `/audit*`, `/overrides`, `/sync/changes` | a JWT, or `X-PSK` (personal data, the audit log, the change feed) |
| `POST /auth/login` | nothing (rate-limited) |
| `POST /sync/*`, `/dtn/*`, `/telemetry` | `X-PSK` (gateway, DTN relays, weather poller) **or** a JWT |
| any other write | a JWT with at least the role below |

Role floor per path (first match wins, otherwise `FIELD_OP`):

| Path | Minimum role |
|---|---|
| `/expeditions*` (incl. legs, manifests, auto-pack) | `HQ_LOGISTICS` |
| `POST /vessels/poll` | `HQ_LOGISTICS` |
| `POST /sorties/check-overdue` | `DISPATCH` |
| `PATCH /indents/{id}` | `STATION_LEAD` |
| `PUT /procurement/targets/{sku}` | `STATION_LEAD` (route dependency) |
| `POST /assets/bulk` | `NCPOR_ADMIN` (route dependency) |
| solo branch of `POST /sorties` | `STATION_LEAD` (checked in the handler) |

No token → `401`; too low a role → `403`. `X-PSK` is compared timing-safe against `INTERNAL_PSK_HEX`, else `PSK_HEX`. The **audit actor** (`created_by`, `actor_id`) is always taken from the token's `sub`; whatever the request body says is ignored when a token is present. Tokens are **not station-scoped** yet: a Bharati login can write Maitri rows.

## Health and auth

- `GET /health`: `{status:"ok", db:"postgres"|"sqlite-fallback", ts}`.
- `POST /auth/login` takes `{device_id, pin, station_id, role?}` and returns `{token, role, station_id, device_id}`.
  - PINs are per station and compared with `hmac.compare_digest`. Demo defaults are `BHARATI-2024`, `MAITRI-2024`, `HIMADRI-2024` (`hq/app/config.py`); override with `STATION_PINS_JSON='{"ST-BHARATI":"…",…}'`.
  - Rate limits: 40 requests/min per IP and 20/min per device, otherwise `429`.
  - A requested elevated role is granted only in these cases, and otherwise downgraded to `FIELD_OP`:
    - the pin equals the `ADMIN_KEY` / `ADMIN_PIN` env var;
    - the device_id starts with `NCPOR-ADMIN-`, `HQ-COMMAND-` or `TEST-HQ` (any elevated role) — this is the demo shortcut the HQ dashboard's own PIN login relies on (it always sends `device_id=HQ-COMMAND-...`, `role=NCPOR_ADMIN`);
    - the device_id starts with `LEAD-` or `STATION-LEAD-` (STATION_LEAD or DISPATCH only).
  - `POLARIS_ENV=production` always disables both prefix shortcuts. Otherwise set `DISABLE_DEMO_ELEVATION=1` to turn off the two device-id-prefix shortcuts above and require `ADMIN_KEY` for every elevated login — do this only after giving the dashboard/tablets a real admin PIN, since with it unset the dashboard's login stops granting any role above `FIELD_OP`.
  - The token is an HS256 JWT signed with `SECRET_KEY` (falls back to `PSK_HEX` outside production). It lasts 8 h by default (`TOKEN_EXPIRY_HOURS`, or `TOKEN_EXPIRY_DAYS`).
  - **Production guard:** with `POLARIS_ENV=production`, HQ refuses to start unless `SECRET_KEY` is set, ≥32 chars, not the demo key and not equal to `PSK_HEX`; `PSK_HEX` is set and not the demo key; and `STATION_PINS_JSON` is set. The gateway likewise refuses a missing or demo `PSK_HEX`.
- `GET /rbac/me` returns `{role, station_id, device_id, permissions}`. With no bearer token it returns `VIEWER`. The hierarchy (`hq/app/auth.py`) is `NCPOR_ADMIN 5 > HQ_LOGISTICS 4 > DISPATCH 3 = STATION_LEAD 3 > FIELD_OP 2 > VIEWER 1`.

## Assets, lots and audit

- `GET /assets`: every asset joined with crate → container, adding `station_id` and `container_id`. The field tablet filters it by station for "pull stock from HQ".
- `GET /assets/bulk/template` (alias `/assets/template.csv`): a CSV header plus an example row.
- `POST /assets/bulk` (NCPOR_ADMIN) takes `{rows:[{sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode,id?}]}` and returns `{inserted, updated}`. It accepts at most 500 rows, requires `qty >= 0`, and validates the category and criticality enums. `scripts/import_inventory.mjs` uses it.
- `GET /audit?limit=` (token): the audit log, limit clamped to 1–200.
- `GET /audit/verify?limit=`: recomputes the hash chain every `write_audit` insert extends (`hq/app/db.py`) and returns `{verified, checked, total}`, or `{verified:false, broken_at, broken_ts}` for the first row whose hash no longer matches — an edited or deleted row breaks every hash after it. Chained by `ts` order; good enough to catch tampering in a single-writer demo, not a substitute for a real append-only ledger under heavy concurrent writes.

## Indents

- `GET /indents?station_id=`: newest first, joined with `sku` / `name`, and including `vessel_imo`.
- `POST /indents` takes `{station_id, asset_id, qty_requested, urgency, created_by, status=DRAFT}`; `created_by` is replaced by the caller's token identity.
- `PATCH /indents/{id}` (STATION_LEAD) takes `{status, actor_id, vessel_imo?}`; `actor_id` is replaced by the token identity.
  - Transitions follow `DRAFT → APPROVED → DISPATCHED → RECEIVED` strictly (`hq/app/config.py` `ALLOWED`); anything else returns `400`.
  - `vessel_imo` must exist in `vessels`, otherwise `404`.
  - Each change is audited and pushed to tablets through the gateway.
- Field-created indents and field RECEIVED updates arrive through the sync path (`entity=indents`, `op=UPSERT`, see below). That path writes the fields present in the patch and enforces the same `ALLOWED` transitions (an illegal jump is rejected → FAILED on the tablet); the tablet only moves DISPATCHED → RECEIVED.

## Stations, forecast and physics

- `GET /stations/overview`: per-station counts, `days_to_stockout` and `forecast_ci`.
- `GET /forecast/{station_id}?asset_sku=FUEL-DIESEL-001` returns `{qty, physics, residual, total_per_day, days_to_stockout, ci, ci_source:"placeholder_15pct", used_model, tele, pure_physics_days}`.
  - `tele.source` is `live` or `stale_cache` when telemetry exists (with `fetched_at` / `age_sec`).
  - With no telemetry row, it is **`assumed_default`** (−15 °C, 5 m/s, 1013 hPa, 0.7 load), so clients never show nominal values as measured.
  - The field Brief reads this endpoint.
- `GET /forecast/snn/{station_id}` has the same shape with `snn_residual`, `snn_active`, `spike_count`, `saved_pct`, `saved_pct_source` and `model`, and also flags `assumed_default`.
- `GET /physics/params/{station_id}`: per-station `T_INSIDE, BASE, K1, K2, K3`, or the global fallback.
- `GET /stations/link-health`: can HQ hear each station right now? Returns `{gateway_reachable, checked_at, stations:[{station_id, name, status, tablets_connected, last_frame_at, frames_since_gateway_start, dtn_bundles_24h, last_dtn_at, last_contact_at, quiet_minutes, open_sos}]}`.
  - `status`: `LIVE` (a tablet is connected to the gateway) · `STORE_FWD` (no live tablet; last contact <1 h ago was a DTN bundle) · `QUIET` (heard from <1 h ago, nothing connected now) · `SILENT` (no contact for ≥1 h, or never) · `UNKNOWN` (gateway unreachable and no contact on record).
  - Live numbers come from the gateway's `GET /internal/status` (in memory, reset when the gateway restarts); DTN numbers from `dtn_bundles`. The HQ dashboard's **Link Health** page renders it.

## Procurement

- `GET /procurement/targets` / `PUT /procurement/targets/{sku}` (STATION_LEAD).
- `GET /procurement/{station_id}`: `need = max(0, target − qty)` with cost.
- `GET /procurement/mutual-aid`: suggested surplus → need transfers.

## Vessels

- `GET /vessels?station_id=`: each vessel carries `source: live|mock`.
- `GET /vessels/{imo}`, `GET /vessels/sources` (poller health), `POST /vessels/poll` (manual poll).
- The poller is in `hq/app/vessel_poller.py`. It tries AISHub when `LIVE_AIS_ENABLED` is set and `AIS_API_KEY` is present. Otherwise it interpolates `shared/vessel_schedule.json`.

## Telemetry

- `POST /telemetry` (`X-PSK` or a JWT) takes `{ts, station_id, temp_outside, wind_speed, pressure, dg_load, acoustic_anomaly?}`. It runs `check_and_escalate` and broadcasts on SSE. The escalation tiers are:
  - ≤20 days of diesel left: `FORECAST_AUTO`, CRITICAL, 500 L;
  - ≤60 days: `FORECAST_60D`, MEDIUM, 250 L;
  - acoustic anomaly > 0.90: `ACOUSTIC_AI`, 4 bearings.
  - There is one open auto-indent per asset and station. If the open one is a `FORECAST_60D` DRAFT and the forecast drops to ≤20 days, that draft is **escalated in place** to CRITICAL / 500 L / `FORECAST_AUTO` (audited `INDENT_ESCALATED_CRITICAL`) instead of blocking the critical alert.
- `GET /telemetry/latest?station_id=`, `GET /telemetry/history?station_id=&days=`, `GET /telemetry/sources`, `GET /telemetry/stream` (SSE).

## Tracking (local frame, no GPS)

- `POST /tracking/update` takes `{asset_id, x, y, theta?, conf?, station_id}` and upserts `asset_positions`.
- `GET /tracking/positions?station_id=`.
- `POST /tracking/personnel` / `GET /tracking/personnel?station_id=`.
- The field tablet posts to `/tracking/update` only from Locate's drill-mode **simulated** fix panel, when that is switched on.

## Personnel, sorties and emergencies

- `GET /personnel?station_id=` (token: blood groups and phone numbers) / `POST /personnel` (roster upsert).
- `GET /sorties?station_id=`.
- `POST /sorties` needs a distinct buddy who is ON_STATION. A solo sortie needs `solo_override` and a STATION_LEAD+ bearer token, otherwise `403`.
- `PATCH /sorties/{id}`: RETURNED restores both people to ON_STATION.
- `POST /sorties/check-overdue` (DISPATCH) also runs every 60 s inside HQ. It scans `ACTIVE` and `OVERDUE` sorties: the first tick past the due time flips `ACTIVE → OVERDUE` (audited once); once a sortie is ≥30 minutes late, a later tick auto-raises `SOS_WHITEOUT` and moves the sortie to `EMERGENCY`, so it is never raised twice. Returns `{marked_overdue, auto_sos, checked_at}`.
- `GET /emergencies` includes `sla_*` fields. `POST /emergency/sos` takes a type of `SOS_MEDICAL|FIRE|WHITEOUT|POWER|VEHICLE`.
- `PATCH /emergency/{id}` moves `ACTIVE → ACK → RESPONDING → RESOLVED`. Regressions return `400`, and every transition writes `decision_overrides`.
- `GET /overrides` (decision audit) and `GET /timeline` (unified command feed).

## Expeditions and cargo

- `GET/POST /expeditions`, `PATCH /expeditions/{id}` (forward-only status).
- `GET/POST /expeditions/{id}/legs`: route, dates and vessel overlap are validated.
- `GET/POST /expeditions/{id}/manifests` and `PATCH /expeditions/{id}/manifests/{mid}`: custody moves `GOA → MUMBAI → CAPETOWN → VESSEL → STATION → CRATE`, gated by customs and biosecurity checks. A regression returns `400`.
- `POST /expeditions/{id}/auto-pack`: first-fit decreasing by `weight_kg` (a manifest line's total weight) into the destination station's containers. COLD needs a `ColdStore`; HAZMAT (or any `hazmat_class`) needs a `Hazmat` box and never falls back; ambient goes into `ISO_20ft`. Payload limits are per type (`CONTAINER_PAYLOAD_KG`: 28 t ISO/Hazmat, 27 t ColdStore) minus weight already assigned. Returns `{placements:[{manifest_id, labelling_code, container_id, kg}], warnings, count, utilisation_pct:{container_id: %}}`; items that fit nowhere stay unassigned with a warning. A cold/hazmat zone override on `PATCH …/manifests/{mid}` (`override_temp`) is audited as `MANIFEST_TEMP_OVERRIDE`.
- `GET /expeditions/{id}/readiness`, `GET /expeditions/{id}/cost` (reads `freight_rates` — no endpoint to edit it, seeded from `hq/app/db.py::DEFAULT_FREIGHT_RATES`).
- The field Cargo screen pulls `/expeditions` and `/expeditions/{id}/manifests?destination_station=`, and sends stage advances back through sync.

## Sync — one apply path

`hq/app/sync_apply.py` `apply_frame()` is the only place an upstream field write is applied. It works on both the SQLite and Postgres dialects, and the caller owns the transaction. Three endpoints use it.

### `POST /sync/ingest`

The gateway forwards each validated WS frame here. The body is a `DeltaFrame`:

```
{ulid(26), device_id, entity, entity_id, op, patch, base_version, ts, vector_clock?, local_coord?}
```

- **Rate limit:** 600 requests/min per `device_id`, otherwise `429`. A patch over 2 KB returns `413`, and a ULID that is not 26 characters returns `400`.
- **Dedupe:** the ULID is inserted into `dedupe` first (`ON CONFLICT DO NOTHING`). A replay returns `{status:"DEDUPED"}`, even if the same ULID arrived over DTN.
- **`assets`, movement frames** (`CONSUME|IN|OUT|ADJUST` with a numeric `patch.delta`, which the tablet always sends): movements commute, so there is no last-write-wins. If HQ tracks lots for the SKU, `assets.qty` is re-derived as the sum of its lots (the lot delta frames queued just before have already moved it); otherwise `qty += delta`. A result below zero → `CONFLICT_CRITICAL`. Vector clocks are merged, the version is bumped, `APPLIED`.
- **`assets`, absolute frames** (`UPSERT`, or a movement frame without `delta` from an older tablet) apply `qty` from the patch.
  - A negative qty returns `{status:"CONFLICT_CRITICAL"}` and the write is rolled back.
  - When the vector clocks compare as `gt`, or are concurrent and the patch `updated_at` is not newer, HQ keeps its copy and answers `APPLIED_LOCAL_WINS` ("local" here means HQ's copy; the frame is ACKed but not applied).
  - Otherwise the qty is applied, the vector clocks are merged, and HQ answers `APPLIED`.
- **Every applied asset frame** (including `APPLIED_LOCAL_WINS`) pushes HQ's resulting row `{id, sku, qty, version, crate_id}` to the station's tablets, so the sender learns HQ's value and other tablets see the movement.
- An unknown asset returns `404`.
- **Other entities:** `indents, personnel, field_sorties, emergencies, expeditions, voyage_legs, manifests, lots` accept `UPSERT` only.
  - An existing row updates **only the columns present in the patch**.
  - A new row needs that entity's required columns, otherwise `400`.
  - A `lots` write recomputes `assets.qty` as the sum of the asset's lots. If the lot exists and the patch has a numeric `delta`, HQ does `qty = qty + delta` instead of taking the absolute `qty` (two tablets each consuming 5 from 100 → 90, not 95); a lot that would go negative → `CONFLICT_CRITICAL`.
  - Changes to personnel, field_sorties and emergencies are pushed to the station's other tablets through the gateway.
- **Errors:** an unknown entity or op returns `400`.
- Every write is audited as `SYNC_<ENTITY>_<status|op>` and advances `sync_state`.

### `POST /dtn/ingest_bulk`

Takes `{bundles:[{bundleId, src, dstStation, vectorClock, createdAt, ttlSec, payload:{entity, entity_id, op, patch}}]}` and returns `{results:[{bundleId, status, ...}], count}`.

`hq/app/dtn.py` `ingest_bundle()` applies each bundle through `apply_frame` inside its own `SAVEPOINT`, so one bad bundle never aborts the batch. Per-bundle status is one of:

- `APPLIED`, `DEDUPED`, `APPLIED_LOCAL_WINS` or `CONFLICT_CRITICAL`;
- `FAILED` (permanently rejected);
- `RETRY` (DB error: the sender keeps custody);
- `EXPIRED` (the TTL from `createdAt` has passed).

The field sets `bundleId` to the outbox ULID, so a write sent over both WS and DTN applies once. Applied bundles are recorded in `dtn_bundles`.

### `POST /dtn/exchange` (HQ)

Takes `{bundles:[…]}` (or a single `bundle`) and returns `{results}`, using the same path. Both the HQ route and the gateway's route of the same name require `X-PSK` (or, on HQ, a JWT).

### `GET /sync/changes?station_id=&since=&limit=` (`X-PSK` or token)

The downstream change feed. Every `notify_gateway()` call first appends `{seq, station_id, entity, entity_id, op, patch, ts}` to `change_log` (`seq` is monotonic). Returns that station's rows (plus `station_id='ALL'`) with `seq > since`, oldest first, `limit` 1–1000 (default 500). The gateway uses it to replay what a reconnecting tablet missed.

### Other sync reads

- `GET /dtn/bundles?dst_station=&limit=`.
- Recent conflicts/dedupes: filter `GET /audit?limit=` for `action LIKE 'SYNC_%'`.

## Sync gateway (`sync-gateway/src/gateway.ts`, :8787)

- **WebSocket frames:** `[4 B CRC32][12 B nonce ‖ AES-GCM ciphertext ‖ 16 B tag]` over msgpack, using the shared `PSK_HEX` (`shared/src/codec.ts`). A frame over 2048 B gets a FAILED ACK.
- **Key mismatch:** if a frame will not decrypt, the gateway replies with plaintext `{"type":"KEY_MISMATCH"}`, since it cannot encrypt a reply without the right key.
- **`SYNC_INIT {device_id, station_id, since_seq?}`:** records the device and station. If `since_seq` is present, the gateway pages `HQ /sync/changes` (500 per page, up to 20 pages) and sends each row as a `DOWNSTREAM_DELTA` with `seq` and `replay:true`, oldest first. Then it replies `SYNC_INIT_RESP {station_id, server_time, indents, caught_up_to?}` (`caught_up_to` = highest replayed seq, or `since_seq` if nothing was missed).
- **Delta frames:** validated with zod (`deltaFrameSchema`). An invalid frame gets a FAILED ACK. Valid frames are forwarded to `HQ /sync/ingest` **one at a time, in order, per connection**. The HQ response maps to an ACK status (`sync-gateway/src/ack.ts`):
  - 2xx with a known status: that status;
  - 5xx, 429, a network error or a 10 s timeout: `RETRY`;
  - other 4xx: `FAILED`.
- **`POST /dtn/exchange`** requires `X-PSK` (compared timing-safe) and caps the body at 512 KB. It proxies to `HQ /dtn/ingest_bulk`.
- **`POST /internal/broadcast_delta`** requires `X-PSK`. HQ calls it via `GATEWAY_INTERNAL_URL` (httpx, 1 s timeout, fire-and-forget) with `{station_id, entity, entity_id, op, patch, seq}`. It sends an encrypted `DOWNSTREAM_DELTA` (carrying `seq`) to connected tablets of that `station_id`.
- **`GET /internal/status`** requires `X-PSK`: `{stations:{[station_id]:{tablets, lastSeenAt, lastFrameAt, frames}}, ts}` — the live half of `/stations/link-health`. In memory only.
- **Gateway → HQ** calls (`/sync/ingest`, `/dtn/ingest_bulk`, `/sync/changes`) send `X-PSK`.
- **`GET /health`.** Ping/pong keepalive runs every 30 s.
- `INTERNAL_PSK_HEX` can override the key used for the `X-PSK` checks (both directions). `POLARIS_ENV=production` makes the gateway exit on a missing or demo `PSK_HEX`; it never logs the key.

## Example curl

```bash
curl http://localhost:8000/health
curl http://localhost:8000/forecast/ST-BHARATI | jq '.days_to_stockout, .tele.source'
curl http://localhost:8000/assets | jq '.[0] | {sku,qty,station_id}'
curl -X POST http://localhost:8000/auth/login -H "Content-Type: application/json" \
  -d '{"device_id":"TAB-01","pin":"BHARATI-2024","station_id":"ST-BHARATI","role":"STATION_LEAD"}'
# → role:"FIELD_OP" (device id lacks a LEAD-/admin prefix)
TOKEN=$(curl -s http://localhost:8000/auth/login -H "Content-Type: application/json" \
  -d '{"device_id":"NCPOR-ADMIN-01","pin":"BHARATI-2024","station_id":"ST-BHARATI","role":"NCPOR_ADMIN"}' | jq -r .token)
curl -X POST http://localhost:8000/assets/bulk -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"rows":[{"sku":"TEST-SKU-999","name":"Test","category":"FOOD","qty":42,"unit":"packs","criticality":"HIGH","crate_id":"C1-K1"}]}'
# machine paths take the wire PSK instead of a JWT
curl -X POST http://localhost:8000/telemetry -H "X-PSK: $PSK_HEX" -H "Content-Type: application/json" \
  -d '{"ts":"2026-08-27T00:00:00","station_id":"ST-BHARATI","temp_outside":-38,"wind_speed":22,"pressure":960,"dg_load":0.9}'
# any other write needs the token; without one -> 401
curl -X POST http://localhost:8000/emergency/sos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"station_id":"ST-BHARATI","type":"SOS_MEDICAL","location_coord":"Fuel farm"}'
# DTN bundle straight to HQ (ULID-shaped bundleId; entity_id must exist; movement frames carry delta)
curl -X POST http://localhost:8000/dtn/ingest_bulk -H "X-PSK: $PSK_HEX" -H "Content-Type: application/json" \
  -d '{"bundles":[{"bundleId":"01J0000000000000000000TEST","src":"TAB-A","dstStation":"ST-BHARATI","vectorClock":{"TAB-A":1},"payload":{"entity":"assets","entity_id":"A1","op":"CONSUME","patch":{"qty":4000,"delta":-5}}}]}'
# what did Maitri miss since change 120?
curl "http://localhost:8000/sync/changes?station_id=ST-MAITRI&since=120" -H "X-PSK: $PSK_HEX"
curl http://localhost:8000/stations/link-health | jq '.stations[] | {name,status,quiet_minutes}'
# via the gateway (needs the PSK)
curl -X POST http://localhost:8787/dtn/exchange -H "X-PSK: $PSK_HEX" -H "Content-Type: application/json" -d '{"bundles":[]}'
```
