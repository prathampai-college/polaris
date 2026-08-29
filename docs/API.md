# API — POLARIS HQ (FastAPI :8000)

Base: `http://localhost:8000` (or `hq:8000` in Docker). All JSON. CORS via `ALLOWED_ORIGINS` env (default `*` in dev, restrict in prod).

## Health

`GET /health` → `{status:"ok", db:"postgres"|"sqlite-fallback", ts}`

## Assets

`GET /assets` → `Asset[] {id, sku, name, category, qty, unit, expiry_date, criticality, crate_id, barcode, version, updated_at}`

## Audit

`GET /audit?limit=20` → `AuditLog[] {id, actor_id, action, entity, before, after, ts}` immutable append-only. `limit` clamped 1–200.

## Indents (Indent Workflow §3.2)

`GET /indents?station_id=ST-BHARATI` → `Indent[] + sku/name join`, ordered `created_at DESC`.

`POST /indents` body `IndentCreate {station_id, asset_id, qty_requested, urgency:LOW|MEDIUM|CRITICAL, created_by, status=DRAFT}` → `{id, status}`. Used by HQ; field creates via sync outbox `entity=indents, op=UPSERT`.

`PATCH /indents/{id}` body `IndentPatch {status, actor_id}` → `{id, old, new}`. Strict `ALLOWED: DRAFT→APPROVED→DISPATCHED→RECEIVED` — no `DRAFT→RECEIVED` shortcut. Requires `Authorization: Bearer <JWT>` with `STATION_LEAD`+ (`require_role("STATION_LEAD")`), returns `401`/`403` otherwise. Appends `audit_log`; triggers `notify_gateway` with `X-PSK` header for downstream push. SQLite fallback still enforces strict.

## Stations & Forecast

`GET /stations/overview` → `Station[] {id,name,winter_crew_count, containers, assets, critical_low, open_indents, days_to_stockout, forecast_ci:[low,high]}`.

`GET /forecast/{station_id}?asset_sku=FUEL-DIESEL-001` →

```json
{
  "station_id":"ST-BHARATI", "asset_sku":"FUEL-DIESEL-001", "qty":4200,
  "physics":163.5, "residual":2.59, "total_per_day":166.0,
  "days_to_stockout":42, "ci":[38,47], "used_model":true,
  "tele":{"temp_outside":-15,"wind_speed":5,"pressure":1013,"dg_load":0.7},
  "pure_physics_days":25.6
}
// blizzard tele -38,22,960 → days 18 ci[15,22] pure 18.4
```

`POST /telemetry` body `TelemetryIn {ts,station_id,temp_outside,wind_speed,pressure,dg_load,acoustic_anomaly?}` → `{ok:true}` + triggers `check_and_escalate` (if `qty/total ≤20` creates `CRITICAL` diesel indent 500 units, `FORECAST_AUTO`; if `acoustic_anomaly > 0.90` creates `CRITICAL` bearing indent 4 pcs, `ACOUSTIC_AI`) + SSE broadcast to `/telemetry/stream`. No MQTT (removed — SSE is live path).

`GET /telemetry/latest?station_id=ST-BHARATI` → last row or `{}`.

`GET /telemetry/history?station_id=ST-BHARATI&days=30` → `[{day, avg_temp, avg_load}]` aggregated telemetry history for TimescaleDB trend visualization.

`GET /telemetry/stream` → SSE `text/event-stream` (`event: telemetry`).

## Sync (PolarNet Micro-Gateway)

`GET /sync/state/{device_id}` → `{device_id, last_acked_ulid, last_server_version}`

`POST /sync/ingest` body `DeltaFrame {ulid(26), device_id, entity:assets|indents, entity_id, op:UPSERT|CONSUME|IN|OUT|ADJUST|DELETE, patch:Record, base_version:int, ts}`

- Wire-level `PSK_HEX` validated `64 hex` (32B) via `hexToBytes`/`assertKeyHex` — odd/invalid hex rejected, `DataView` byteOffset-safe. `toWire` = `[4B CRC BE][12B nonce||ciphertext||16B tag]` msgpack+AES-GCM (GCM tag is integrity, CRC is framing). `>2KB` frame returns `{status:"FAILED", message:"frame >2048"}` instead of silent drop.
- Dedupe: if `ulid` in `dedupe` → `{status:"DEDUPED", server_version}`.
- Assets: `qty<0` → `{status:"CONFLICT_CRITICAL", server_version, message:"would go negative"}`. Else apply `qty,version`, insert `dedupe`+`audit_log`+`sync_state` (`PG SELECT FOR UPDATE` / `SQLite BEGIN IMMEDIATE`, TOCTOU-safe).
- Indents: upsert `indents` row or status patch (strict), dedupe, audit `SYNC_INDENT_*`.
- Gateway validates CRC+decrypt+zod before `POST /sync/ingest`, returns `toWire({ulid,status,server_version})`, logs `jsonBytes vs msgpackBytes` via `sizeReport` (shared).

Errors: `400` ulid length / entity / op allowlist, `404 asset not found`, `413 patch >2KB`, `500` with rollback.

`GET /sync/ingest` rate-limited `600/min` per `device_id` (`_rate_store` in-memory, 1000-key bound).

## Auth & RBAC

`POST /auth/login` body `{device_id, pin, station_id, role?}` → `{token, role, station_id, device_id}`. `pin` per-station (`ST-BHARATI: BHARATI-2024` in `config.py:STATION_PINS`). **`role` is ignored** unless `device_id` contains `ADMIN`/`LEAD`/`TEST`/`HQ` — otherwise always `FIELD_OP`. Prevents PIN-holder escalation to `NCPOR_ADMIN`. Token is HMAC-SHA256 JWT, `64 hex` secret hex-decoded to 32B (`hexToBytes`/`bytes.fromhex`), compact JSON (`separators=(',',':')`) cross-verified Node ↔ Python, `exp` 30d (`TOKEN_EXPIRY_DAYS`).

`GET /rbac/me` → `{role, station_id, device_id, permissions}`. Requires `Authorization: Bearer <JWT>`; when absent returns `{role:"VIEWER", permissions:["READ"]}` (not `FIELD_OP`). Roles `NCPOR_ADMIN(5)>HQ_LOGISTICS(4)>DISPATCH(3)=STATION_LEAD(3)>FIELD_OP(2)>VIEWER(1)`. Row-level: `device_id→station_id` at provisioning; queries `WHERE station_id=:mine`.

`GET /internal/broadcast_delta` (gateway, HQ→field push) → requires header `X-PSK: <PSK_HEX>` equal to gateway `PSK_HEX`, else `401`.

## Errors

Standard FastAPI `HTTPException` JSON `{detail: string, request_id}`. Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `CSP default-src 'self'`, `Cache-Control: no-store`. All writes append `audit_log`. Idempotency via `ulid` + `dedupe`.

## Wire

Field `SyncWorker` (`field/lib/sync.ts`) maintains full-duplex socket: `connect()` sends `SYNC_INIT` encrypted wire, `drain()` every 2s sends `outbox` `PENDING|SENT` (retry until `ACKED`, `draining` guard prevents concurrent dup), `onmessage` handles `DOWNSTREAM_DELTA`/`SYNC_INIT_RESP`/`ACK`, updates `outbox SET ACKED` + `sync_state`. `PING/PONG` keepalive 30s. Verify scripts use same `toWire`/`fromWire` with `PSK_HEX="a"*64` demo key.

## Example curl

```bash
curl http://localhost:8000/health
curl http://localhost:8000/forecast/ST-BHARATI
curl -X POST http://localhost:8000/auth/login -H "Content-Type: application/json" \
  -d '{"device_id":"BHARATI-TABLET-01","pin":"BHARATI-2024","station_id":"ST-BHARATI"}'
# → {token, role:"FIELD_OP", ...}  (requesting role:"NCPOR_ADMIN" without ADMIN device_id still returns FIELD_OP)
curl -H "Authorization: Bearer $TOKEN" -X PATCH http://localhost:8000/indents/$ID \
  -H "Content-Type: application/json" -d '{"status":"APPROVED","actor_id":"LEAD_01"}'
curl -X POST http://localhost:8000/telemetry -H "Content-Type: application/json" \
  -d '{"ts":"2026-08-27T00:00:00","station_id":"ST-BHARATI","temp_outside":-38,"wind_speed":22,"pressure":960,"dg_load":0.9}'
curl http://localhost:8000/indents | jq
# gateway internal push (requires X-PSK)
curl -X POST http://localhost:8787/internal/broadcast_delta -H "X-PSK: $PSK_HEX" -H "Content-Type: application/json" \
  -d '{"station_id":"ST-BHARATI","entity":"indents","entity_id":"...","op":"STATUS_CHANGE","patch":{"status":"APPROVED"}}'
```
