# API — POLARIS HQ (FastAPI :8000) and sync gateway (:8787)

The HQ base URL is `http://localhost:8000` (`hq:8000` inside Docker). The API is JSON and its routes are in `hq/app/main.py`. CORS comes from `ALLOWED_ORIGINS`: `*` is dropped automatically when `DATABASE_URL` is set, falling back to the localhost allowlist. Errors use FastAPI's `{detail}` shape.

> **Auth coverage, stated plainly:** only 5 routes enforce a role (`Depends(require_role(...))`):
> - `PATCH /indents/{id}` (STATION_LEAD)
> - `PUT /freight_rates/{mode}` (DISPATCH)
> - `POST /expeditions/{id}/manifests/bulk` (NCPOR_ADMIN)
> - `PUT /procurement/targets/{sku}` (STATION_LEAD)
> - `POST /assets/bulk` (NCPOR_ADMIN)
>
> The solo branch of `POST /sorties` also checks for STATION_LEAD+. Every other route, including `/sync/ingest` and `/dtn/*`, accepts requests without a token. This is a known gap, not a secret.

## Health and auth

- `GET /health`: `{status:"ok", db:"postgres"|"sqlite-fallback", ts}`.
- `POST /auth/login` takes `{device_id, pin, station_id, role?}` and returns `{token, role, station_id, device_id}`.
  - PINs are per station (`hq/app/config.py` `STATION_PINS`: `BHARATI-2024`, `MAITRI-2024`, `HIMADRI-2024`) and compared with `hmac.compare_digest`.
  - Rate limits: 40 requests/min per IP and 20/min per device, otherwise `429`.
  - A requested elevated role is granted only in these cases, and otherwise downgraded to `FIELD_OP`:
    - the device_id starts with `NCPOR-ADMIN-`, `HQ-COMMAND-` or `TEST-HQ` (any elevated role);
    - the device_id starts with `LEAD-` or `STATION-LEAD-` (STATION_LEAD or DISPATCH only);
    - the pin equals the `ADMIN_KEY` / `ADMIN_PIN` env var.
  - The token is an HS256 JWT signed with `SECRET_KEY` (falls back to `PSK_HEX`). It lasts 8 h by default (`TOKEN_EXPIRY_HOURS`, or `TOKEN_EXPIRY_DAYS`).
- `GET /rbac/me` returns `{role, station_id, device_id, permissions}`. With no bearer token it returns `VIEWER`. The hierarchy (`hq/app/auth.py`) is `NCPOR_ADMIN 5 > HQ_LOGISTICS 4 > DISPATCH 3 = STATION_LEAD 3 > FIELD_OP 2 > VIEWER 1`.

## Assets, lots and audit

- `GET /assets`: every asset joined with crate → container, adding `station_id` and `container_id`. The field tablet filters it by station for "pull stock from HQ".
- `GET /assets/bulk/template` (alias `/assets/template.csv`): a CSV header plus an example row.
- `POST /assets/bulk` (NCPOR_ADMIN) takes `{rows:[{sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode,id?}]}` and returns `{inserted, updated}`. It accepts at most 500 rows, requires `qty >= 0`, and validates the category and criticality enums. `scripts/import_inventory.mjs` uses it.
- `GET /lots`: lot-level stock.
- `GET /audit?limit=`: the append-only audit log, limit clamped to 1–200.

## Indents

- `GET /indents?station_id=`: newest first, joined with `sku` / `name`, and including `vessel_imo`.
- `POST /indents` takes `{station_id, asset_id, qty_requested, urgency, created_by, status=DRAFT}`.
- `PATCH /indents/{id}` (STATION_LEAD) takes `{status, actor_id, vessel_imo?}`.
  - Transitions follow `DRAFT → APPROVED → DISPATCHED → RECEIVED`. The handler still tolerates a direct `DRAFT → RECEIVED`.
  - `vessel_imo` must exist in `vessels`, otherwise `404`.
  - Each change is audited and pushed to tablets through the gateway.
- Field-created indents and field RECEIVED updates arrive through the sync path (`entity=indents`, `op=UPSERT`, see below). That path writes the fields present in the patch and does not re-check the state machine; the tablet only moves DISPATCHED → RECEIVED.

## Stations, forecast and physics

- `GET /stations/overview`: per-station counts, `days_to_stockout` and `forecast_ci`.
- `GET /forecast/{station_id}?asset_sku=FUEL-DIESEL-001` returns `{qty, physics, residual, total_per_day, days_to_stockout, ci, ci_source:"placeholder_15pct", used_model, tele, pure_physics_days}`.
  - `tele.source` is `live` or `stale_cache` when telemetry exists (with `fetched_at` / `age_sec`).
  - With no telemetry row, it is **`assumed_default`** (−15 °C, 5 m/s, 1013 hPa, 0.7 load), so clients never show nominal values as measured.
  - The field Brief reads this endpoint.
- `GET /forecast/snn/{station_id}` has the same shape with `snn_residual`, `snn_active`, `spike_count`, `saved_pct`, `saved_pct_source` and `model`, and also flags `assumed_default`.
- `GET /physics/{station_id}` (alias `/physics/params/{station_id}`): per-station `T_INSIDE, BASE, K1, K2, K3`, or the global fallback.

## Procurement

- `GET /procurement/targets` / `PUT /procurement/targets/{sku}` (STATION_LEAD).
- `GET /procurement/{station_id}`: `need = max(0, target − qty)` with cost.
- `GET /procurement/mutual-aid`: suggested surplus → need transfers.

## Vessels

- `GET /vessels?station_id=`: each vessel carries `source: live|mock`.
- `GET /vessels/{imo}`, `GET /vessels/sources` (poller health), `POST /vessels/poll` (manual poll).
- The poller is in `hq/app/vessel_poller.py`. It tries AISHub when `LIVE_AIS_ENABLED` is set and `AIS_API_KEY` is present. Otherwise it interpolates `shared/vessel_schedule.json`.

## Telemetry

- `POST /telemetry` takes `{ts, station_id, temp_outside, wind_speed, pressure, dg_load, acoustic_anomaly?}`. It runs `check_and_escalate` and broadcasts on SSE. The escalation tiers are:
  - ≤20 days of diesel left: `FORECAST_AUTO`, CRITICAL, 500 L;
  - ≤60 days: `FORECAST_60D`, MEDIUM, 250 L;
  - acoustic anomaly > 0.90: `ACOUSTIC_AI`, 4 bearings.
- `GET /telemetry/latest?station_id=`, `GET /telemetry/history?station_id=&days=`, `GET /telemetry/sources`, `GET /telemetry/stream` (SSE).

## Tracking (local frame, no GPS)

- `POST /tracking/update` takes `{asset_id, x, y, theta?, conf?, station_id}` and upserts `asset_positions`.
- `GET /tracking/positions?station_id=`.
- `POST /tracking/personnel` / `GET /tracking/personnel?station_id=`.
- The field tablet posts to `/tracking/update` only from Locate's drill-mode **simulated** fix panel, when that is switched on.

## Personnel, sorties and emergencies

- `GET /personnel?station_id=` / `POST /personnel` (roster upsert).
- `GET /sorties?station_id=`.
- `POST /sorties` needs a distinct buddy who is ON_STATION. A solo sortie needs `solo_override` and a STATION_LEAD+ bearer token, otherwise `403`.
- `PATCH /sorties/{id}`: RETURNED restores both people to ON_STATION.
- `POST /sorties/check-overdue` also runs every 60 s. An overdue sortie that is more than 30 minutes late auto-raises `SOS_WHITEOUT`.
- `GET /emergencies` includes `sla_*` fields. `POST /emergency/sos` takes a type of `SOS_MEDICAL|FIRE|WHITEOUT|POWER|VEHICLE`.
- `PATCH /emergency/{id}` moves `ACTIVE → ACK → RESPONDING → RESOLVED`. Regressions return `400`, and every transition writes `decision_overrides`.
- `GET /overrides` (decision audit) and `GET /timeline` (unified command feed).

## Expeditions and cargo

- `GET/POST /expeditions`, `PATCH /expeditions/{id}` (forward-only status).
- `GET/POST /expeditions/{id}/legs`: route, dates and vessel overlap are validated.
- `GET/POST /expeditions/{id}/manifests` and `PATCH /expeditions/{id}/manifests/{mid}`: custody moves `GOA → MUMBAI → CAPETOWN → VESSEL → STATION → CRATE`, gated by customs and biosecurity checks. A regression returns `400`.
- `POST /expeditions/{id}/manifests/bulk` (NCPOR_ADMIN, ≤500 rows), `GET /expeditions/manifests/template`.
- `POST /expeditions/{id}/auto-pack`, `GET /expeditions/{id}/readiness`, `GET /expeditions/{id}/cost`.
- `GET /freight_rates`, `PUT /freight_rates/{mode}` (DISPATCH).
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
- **`assets`:** any of `UPSERT|CONSUME|IN|OUT|ADJUST` applies the absolute `qty` from the patch.
  - A negative qty returns `{status:"CONFLICT_CRITICAL"}` and the write is rolled back.
  - When the vector clocks compare as `gt`, or are concurrent and the patch `updated_at` is not newer, HQ keeps its copy and answers `APPLIED_LOCAL_WINS` ("local" here means HQ's copy; the frame is ACKed but not applied).
  - Otherwise the qty is applied, the vector clocks are merged, and HQ answers `APPLIED`.
  - An unknown asset returns `404`.
- **Other entities:** `indents, personnel, field_sorties, emergencies, expeditions, voyage_legs, manifests, lots` accept `UPSERT` only.
  - An existing row updates **only the columns present in the patch**.
  - A new row needs that entity's required columns, otherwise `400`.
  - A `lots` write recomputes `assets.qty` as the sum of the asset's lots.
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

Takes `{bundles:[…]}` (or a single `bundle`) and returns `{results}`, using the same path. The HQ route itself is unauthenticated; the gateway's route of the same name requires `X-PSK`.

### Other sync reads

- `GET /dtn/bundles?dst_station=&limit=`.
- `GET /dtn/conflicts?limit=`: recent `SYNC_%` audit rows.
- `GET /sync/state/{device_id}`: `{device_id, last_acked_ulid, last_server_version}`.

## Sync gateway (`sync-gateway/src/gateway.ts`, :8787)

- **WebSocket frames:** `[4 B CRC32][12 B nonce ‖ AES-GCM ciphertext ‖ 16 B tag]` over msgpack, using the shared `PSK_HEX` (`shared/src/codec.ts`). A frame over 2048 B gets a FAILED ACK.
- **Key mismatch:** if a frame will not decrypt, the gateway replies with plaintext `{"type":"KEY_MISMATCH"}`, since it cannot encrypt a reply without the right key.
- **`SYNC_INIT`:** records the device and station and replies with `SYNC_INIT_RESP` carrying that station's indents from HQ.
- **Delta frames:** validated with zod (`deltaFrameSchema`). An invalid frame gets a FAILED ACK. Valid frames are forwarded to `HQ /sync/ingest` **one at a time, in order, per connection**. The HQ response maps to an ACK status (`sync-gateway/src/ack.ts`):
  - 2xx with a known status: that status;
  - 5xx, 429, a network error or a 10 s timeout: `RETRY`;
  - other 4xx: `FAILED`.
- **`POST /dtn/exchange`** requires `X-PSK` (compared timing-safe) and caps the body at 512 KB. It proxies to `HQ /dtn/ingest_bulk`.
- **`POST /internal/broadcast_delta`** requires `X-PSK`. HQ calls it via `GATEWAY_INTERNAL_URL` (httpx, 1 s timeout, fire-and-forget). It sends an encrypted `DOWNSTREAM_DELTA` to connected tablets of that `station_id`.
- **`GET /health`.** Ping/pong keepalive runs every 30 s.
- `INTERNAL_PSK_HEX` can override the key used for the `X-PSK` checks.

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
curl -X POST http://localhost:8000/telemetry -H "Content-Type: application/json" \
  -d '{"ts":"2026-08-27T00:00:00","station_id":"ST-BHARATI","temp_outside":-38,"wind_speed":22,"pressure":960,"dg_load":0.9}'
# DTN bundle straight to HQ (ULID-shaped bundleId; entity_id must exist)
curl -X POST http://localhost:8000/dtn/ingest_bulk -H "Content-Type: application/json" \
  -d '{"bundles":[{"bundleId":"01J0000000000000000000TEST","src":"TAB-A","dstStation":"ST-BHARATI","vectorClock":{"TAB-A":1},"payload":{"entity":"assets","entity_id":"A1","op":"CONSUME","patch":{"qty":4000}}}]}'
# via the gateway (needs the PSK)
curl -X POST http://localhost:8787/dtn/exchange -H "X-PSK: $PSK_HEX" -H "Content-Type: application/json" -d '{"bundles":[]}'
```
