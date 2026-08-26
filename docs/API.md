# API — POLARIS HQ (FastAPI :8000)

Base: `http://localhost:8000` (or `hq:8000` in Docker). All JSON. CORS `*` for field PWA.

## Health

`GET /health` → `{status:"ok", db:"postgres"|"sqlite-fallback", ts}`

## Assets

`GET /assets` → `Asset[] {id, sku, name, category, qty, unit, expiry_date, criticality, crate_id, barcode, version, updated_at}`

## Audit

`GET /audit?limit=20` → `AuditLog[] {id, actor_id, action, entity, before, after, ts}` immutable append-only.

## Indents (Indent Workflow §3.2)

`GET /indents?station_id=ST-BHARATI` → `Indent[] + sku/name join`, ordered `created_at DESC`.

`POST /indents` body `IndentCreate {station_id, asset_id, qty_requested, urgency:LOW|MEDIUM|CRITICAL, created_by, status=DRAFT}` → `{id, status}`. Used by HQ; field creates via sync outbox `entity=indents`.

`PATCH /indents/{id}` body `IndentPatch {status, actor_id}` → `{id, old, new}`. Allowed `DRAFT→APPROVED→DISPATCHED→RECEIVED` (relaxed for demo: any forward). Appends `audit_log`.

## Stations & Forecast

`GET /stations/overview` → `Station[] {id,name,winter_crew_count, containers, assets, critical_low, open_indents, days_to_stockout, forecast_ci:[low,high]}`. Forecast canned 42d for stage.

`GET /forecast/{station_id}?asset_sku=FUEL-DIESEL-001` →

```json
{
  "station_id":"ST-BHARATI", "asset_sku":"FUEL-DIESEL-001", "qty":4200,
  "physics":163.5, "residual":2.59, "total_per_day":166.0,
  "days_to_stockout":42, "ci":[38,47], "used_model":true,
  "tele":{"temp_outside":-15,"wind_speed":5,"pressure":1013,"dg_load":0.7},
  "pure_physics_days":25.6, "note":"canned baseline..."
}
// blizzard tele -38,22,960 → days 18 ci[15,22] pure 18.4
```

`POST /telemetry` body `TelemetryIn {ts,station_id,temp_outside,wind_speed,pressure,dg_load}` → `{ok:true}` + triggers `check_and_escalate` (if `qty/total ≤20` creates `CRITICAL` indent 500 units, `FORECAST_AUTO`, DRAFT).

`GET /telemetry/latest?station_id=ST-BHARATI` → last row or `{}`.

## Sync (PolarNet Micro-Gateway)

`GET /sync/state/{device_id}` → `{device_id, last_acked_ulid, last_server_version}`

`POST /sync/ingest` body `DeltaFrame {ulid(26), device_id, entity:assets|indents, entity_id, op:UPSERT|DELETE, patch:Record, base_version:int, ts}`

- Dedupe: if `ulid` in `dedupe` → `{status:"DEDUPED"}`.
- Assets: `qty<0` → `CONFLICT_CRITICAL`. Else apply `qty,version`, insert `dedupe`+`audit_log`+`sync_state`.
- Indents: upsert `indents` row or status patch, dedupe, audit `SYNC_INDENT_*`.
- Wire: field sends `toWire(frame, PSK)` = `[4B CRC][12B nonce||ciphertext||16B tag]` msgpack+AES-GCM. Gateway validates CRC+decrypt+zod before `POST /sync/ingest`, returns `toWire({ulid,status,server_version})`.

Errors: `404 asset not found`, `500` with rollback.

## RBAC

`GET /rbac/me` → `{role:"FIELD_OP", station_id:"ST-BHARATI", device_id:"BHARATI-TABLET-01", permissions:["CONSUME","IN","READ"]}`

Roles: `NCPOR_ADMIN>STATION_LEAD>FIELD_OP>VIEWER`. Row-level: `device_id→station_id` at provisioning; queries `WHERE station_id=:mine`. Offline JWT 30d + local cache; revocation via `sync_state` on next window.

## Errors

Standard FastAPI `HTTPException` JSON `{detail: string}`. All writes append `audit_log`. Idempotency via `ulid`.

## Example curl

```bash
curl http://localhost:8000/health
curl http://localhost:8000/forecast/ST-BHARATI
curl -X POST http://localhost:8000/telemetry -H "Content-Type: application/json" \
  -d '{"ts":"2026-08-27T00:00:00","station_id":"ST-BHARATI","temp_outside":-38,"wind_speed":22,"pressure":960,"dg_load":0.9}'
curl http://localhost:8000/indents | jq
```

