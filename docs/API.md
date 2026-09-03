# API — POLARIS HQ (FastAPI :8000) — Production, Extreme-Edge

Base: `http://localhost:8000` (or `hq:8000` in Docker). All JSON. CORS via `ALLOWED_ORIGINS` env (default `*` in dev, restrict in prod). See `hq/app/main.py:156` for `health`.

## Health

`GET /health` → `{status:"ok", db:"postgres"|"sqlite-fallback", ts}`

## Assets

`GET /assets` → `Asset[] {id, sku, name, category, qty, unit, expiry_date, criticality, crate_id, barcode, version, updated_at, station_id, container_id, vector_clock, local_coord}` via `LEFT JOIN crates→containers` `hq/app/main.py:193`.

`GET /assets/bulk/template` → `text/csv` `sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode` + example `hq/app/main.py:539`.

`POST /assets/bulk` body `BulkAssetRequest {rows:[{sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode,id?}]}` → `{inserted, updated}` RBAC `NCPOR_ADMIN` `hq/app/main.py:562` (`INSERT ... ON CONFLICT(sku) DO UPDATE`, validates `category` `FUEL_DIESEL|…|SCIENTIFIC` and `criticality` `CRITICAL|HIGH|LOW`, max 500 rows, `qty>=0`). Used by `scripts/import_inventory.mjs` + `scripts/template_inventory.csv`.

## Audit

`GET /audit?limit=20` → `AuditLog[] {id, actor_id, action, entity, before, after, ts}` immutable append-only. `limit` clamped 1–200 `hq/app/main.py:198`. Includes `vector_clock` merges + `dtn_bundles` custody.

## Indents (Indent Workflow)

`GET /indents?station_id=ST-BHARATI` → `Indent[] {id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at, vessel_imo}` + `sku/name` join, ordered `created_at DESC` `hq/app/main.py:209`. Includes `vessel_imo` when `DISPATCHED`.

`POST /indents` body `IndentCreate {station_id, asset_id, qty_requested, urgency:LOW|MEDIUM|CRITICAL, created_by, status=DRAFT}` → `{id, status}`. Used by HQ; field creates via sync outbox `entity=indents, op=UPSERT, vector_clock VC`. 9-col `vessel_imo` defaults NULL `hq/app/main.py:243`.

`PATCH /indents/{id}` body `IndentPatch {status, actor_id, vessel_imo?}` → `{id, old, new}`. Strict `ALLOWED: DRAFT→APPROVED→DISPATCHED→RECEIVED` — no `DRAFT→RECEIVED` shortcut (except `DRAFT→RECEIVED` tolerated for offline field demo `hq/app/main.py:281`). Requires `Authorization: Bearer <JWT>` with `STATION_LEAD`+ (`require_role("STATION_LEAD")`), validates `vessel_imo` exists in `vessels` `hq/app/main.py:283`, returns `404 vessel not found` if invalid, `401`/`403` otherwise. Appends `audit_log`; triggers `notify_gateway` with `X-PSK` for downstream push (`vessel_imo` included). SQLite fallback still enforces strict.

## Stations & Forecast

`GET /stations/overview` → `Station[] {id,name,winter_crew_count, containers, assets, critical_low, open_indents, days_to_stockout, forecast_ci:[low,high]}`. Computes `predict_total(..., station_id)` per-station physics `hq/app/main.py:323`.

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

Uses `load_physics(station_id)` `hq/app/forecast.py:7` per-station `physics_params` DB else global `shared/src/physics.json`. `hq/app/main.py:484`.

`GET /forecast/snn/{station_id}?asset_sku=FUEL-DIESEL-001` →

```json
{
  "station_id":"ST-BHARATI", "asset_sku":"FUEL-DIESEL-001", "qty":4200,
  "physics":163.5, "snn_residual":1.8, "total_per_day":165.3,
  "days_to_stockout":42, "ci":[38,47],
  "snn_active":true, "spike_count":47, "saved_pct":90.0,
  "tele":{"temp_outside":-15,"wind_speed":5,"pressure":1013,"dg_load":0.7}
}
```

SNN LIF event-gated `hq/app/snn_forecast.py:1` `predict_snn_total()` — if `|Δnorm|<0.12` idle `snn_active:false, snn_residual 0, saved 99%`. `hq/app/main.py:917`.

`GET /physics/{station}` → `{station_id, T_INSIDE, BASE, K1, K2, K3}` per-station `hq/app/main.py:499` or `global_fallback` + `source` flag. Used by `scripts/calibrate_physics.py`.

## Procurement (DB-driven)

`GET /procurement/targets` → `ProcurementTarget[] {sku,target_qty,cost_per_unit,unit,eta}` `hq/app/main.py:513`.

`PUT /procurement/targets/{sku}` body `ProcurementTargetUpsert {sku,target_qty,cost_per_unit,unit,eta}` → upsert RBAC `STATION_LEAD` `hq/app/main.py:525` `INSERT ... ON CONFLICT DO UPDATE`.

`GET /procurement/{station}` → DB-driven `need=max(0,target-qty)` `₹cost` `hq/app/main.py:541`; `[]` if no targets.

## Vessels (AIS Adaptive)

`GET /vessels?station_id=ST-BHARATI` → `Vessel[] {imo,name,lat,lon,sog,eta,station_id,last_seen,source:live|mock}` `hq/app/main.py:517` filter by station, `source` from `vessel_poller.get_status()` (`mock` when no `AIS_API_KEY` or `429`, `live` when AISHub succeeds). Poller `hq/app/vessel_poller.py:11` every 15m (`VESSEL_POLL_SEC`), cache `/tmp/ais_cache.json`.

`GET /vessels/{imo}` → single vessel `hq/app/main.py:533` with `source`.

`PATCH /indents/{id}` supports `vessel_imo` as above (validated). Dispatch flow: HQ `POST /indents` `DRAFT` → `PATCH APPROVED` → `PATCH DISPATCHED {vessel_imo:9734567}` (Sagar Nidhi) → field `DOWNSTREAM_DELTA vessels` → offline ETA `field/lib/db.ts:278`.

`GET /vessels/sources` → poller health `hq/app/main.py:533` + vessel poller status.

`POST /vessels/poll` → manual trigger `hq/app/main.py:541` `poll_once()`.

## Telemetry

`POST /telemetry` body `TelemetryIn {ts,station_id,temp_outside,wind_speed,pressure,dg_load,acoustic_anomaly?}` → `{ok:true}` + triggers `check_and_escalate` (if `qty/total ≤20` creates `CRITICAL` diesel indent 500 units, `FORECAST_AUTO`; if `acoustic_anomaly > 0.90` creates `CRITICAL` bearing indent 4 pcs, `ACOUSTIC_AI`) + SSE broadcast to `/telemetry/stream` `hq/app/main.py:41`. Also resets SNN event gate `hq/app/snn_forecast.py:1`.

`GET /telemetry/latest?station_id=ST-BHARATI` → last row or `{}` `hq/app/main.py:346`.

`GET /telemetry/history?station_id=ST-BHARATI&days=30` → `[{day, avg_temp, avg_load}]` aggregated history `hq/app/main.py:351`.

`GET /telemetry/sources` → poller health `{source_setting:both|sim|imd|openmeteo, poll_interval_sec, coords, imd_configured, last_poll:{ts,results,error}}` `hq/app/main.py:354` `hq/app/telemetry_poller.py:11` (Open-Meteo free + optional IMD, `TELEMETRY_SOURCE`).

`GET /telemetry/stream` → SSE `text/event-stream` (`event: telemetry`) `hq/app/main.py:363` `asyncio.Queue` 100 keepalive 30s.

## Tracking (Vision-Fused Local)

`POST /tracking/update` body `{asset_id, x, y, theta?, conf?, station_id}` → `{asset_id, x, y, conf}` `hq/app/main.py:903` `INSERT INTO asset_positions ON CONFLICT UPDATE` per `shared/src/local_map.ts:1` `asset_positions` table. Called by `field/lib/sensors/fusion.ts:1` `runFusionCycle()` every 3s; `x,y` in meters local frame (not GPS lat/lon).

`GET /tracking/positions?station_id=ST-BHARATI` → `AssetPosition[] {asset_id, x, y, theta, conf, last_sensor_ts, station_id, sku, name}` via join `hq/app/main.py:917`.

Whiteout demo: `visibility 0.8m` → camera `[]`, LiDAR still tracks `err <0.8m` `scripts/tracking_verify.mjs:1`. GPS `Unavailable` UI but `LOCAL` grid shows.

## DTN (Delay-Tolerant Muling)

`POST /dtn/ingest_bulk` body `{bundles:[{bundleId, src, dstStation, vectorClock, payload:{entity,entity_id,op,patch}}]}` → `{results:[{bundleId,status,cmp}]}`, `count` `hq/app/main.py:844`. Handler `hq/app/dtn.py:1` `ingest_bundle()` — `assets` `compare_vc()` → `gt→APPLIED_LOCAL_WINS`, `concurrent→LWW ts`, else `merge_vc` → `UPDATE assets vector_clock`. `dedupe(bundleId)` + `dtn_bundles` audit. Rate not limited (mule batch).

`GET /dtn/bundles?dst_station=ST-BHARATI&limit=50` → `DtnBundle[] {bundle_id, src, dst_station, vc, custody, created_at, ttl}` `hq/app/main.py:844`.

`GET /dtn/conflicts?limit=20` → recent `audit_log` where `action LIKE 'SYNC_%'` `hq/app/main.py:854` (proxy for VC concurrent `APPLIED_LOCAL_WINS`).

`POST /dtn/exchange` body `{bundles:[...]}` → same as `ingest_bulk` but via peer exchange `hq/app/main.py:860` (also proxied via `sync-gateway/src/gateway.ts:57` `POST /dtn/exchange` → `HQ /dtn/ingest_bulk`).

Field mule: `field/lib/dtn/mule.ts:1` `createAndSaveMuleBundle()` when `ws !== OPEN` `status BUNDLED`, `BroadcastChannel('polaris-mule')` sim BLE, `exportBundleToQR()` `bundleToBase64()` `shared/src/dtn/bundle.ts:1` for QR handoff, `pushBundlesToHQ()` `POST /dtn/ingest_bulk` when online, `pushBundlesToHQ(HQ_URL)` called in `field/lib/sync.ts:13` `drain()`.

Gateway: `POST /dtn/exchange` → `HQ /dtn/ingest_bulk` `sync-gateway/src/gateway.ts:57`.

## Sync (PolarNet Micro-Gateway)

`GET /sync/state/{device_id}` → `{device_id, last_acked_ulid, last_server_version}` `hq/app/main.py:683`.

`POST /sync/ingest` body `DeltaFrame {ulid(26), device_id, entity:assets|indents|vessels|telemetry|stations|containers|crates, entity_id, op:UPSERT|CONSUME|IN|OUT|ADJUST|DELETE, patch:Record, base_version:int, ts, vector_clock?:VC, local_coord?:[x,y,theta]}` `hq/app/main.py:718`.

- Wire-level `PSK_HEX` validated `64 hex` (32B) via `hexToBytes`/`assertKeyHex` — odd/invalid hex rejected, `DataView` byteOffset-safe. `toWire` = `[4B CRC BE][12B nonce||ciphertext||16B tag]` msgpack+AES-GCM (GCM tag is integrity, CRC is framing). `>2KB` frame returns `{status:"FAILED", message:"frame >2048"}` instead of silent drop `sync-gateway/src/gateway.ts:6`.
- Dedupe: if `ulid` in `dedupe` → `{status:"DEDUPED", server_version}`.
- Assets: `qty<0` → `{status:"CONFLICT_CRITICAL", server_version, message:"would go negative"}`. Else apply `qty,version,vector_clock` merge via `compare_vc`/`merge_vc` LWW+VC `hq/app/dtn.py:1` → `APPLIED` or `APPLIED_LOCAL_WINS` `hq/app/main.py:782`. Else `DEDUPED`.
- Indents: upsert `indents` row or status+vessel_imo patch (strict), dedupe, audit `SYNC_INDENT_*` `hq/app/main.py:734`. Supports `vessel_imo` `hq/app/main.py:734` + `vector_clock` in `DeltaFrame`.
- Vessels: downstream `DOWNSTREAM_DELTA vessels` via `applyDownstreamVessel` `field/lib/db.ts:278`.
- SNN: no separate sync — via `forecast/snn`.
- Gateway validates CRC+decrypt+zod before `POST /sync/ingest`, returns `toWire({ulid,status,server_version,reason})`, logs `jsonBytes vs msgpackBytes` via `sizeReport` (shared).

Errors: `400` ulid length / entity / op allowlist, `404 asset/vessel not found`, `413 patch >2KB`, `500` with rollback.

`GET /sync/ingest` rate-limited `600/min` per `device_id` (`_rate_store` in-memory, 1000-key bound) `hq/app/main.py:689`.

`GET /sync/state/{device_id}` also includes `vector_clock` convergence.

## Auth & RBAC

`POST /auth/login` body `{device_id, pin, station_id, role?}` → `{token, role, station_id, device_id}`. `pin` per-station (`ST-BHARATI: BHARATI-2024` `hq/app/config.py:22`). **`role` is ignored** unless `device_id` contains `ADMIN`/`LEAD`/`TEST`/`HQ` — otherwise always `FIELD_OP` `hq/app/main.py:176`. Prevents PIN-holder escalation to `NCPOR_ADMIN`. Token is HMAC-SHA256 JWT, `64 hex` secret hex-decoded to 32B (`hexToBytes`/`bytes.fromhex`), compact JSON (`separators=(',',':')`) cross-verified Node ↔ Python, `exp` 30d (`TOKEN_EXPIRY_DAYS`).

`GET /rbac/me` → `{role, station_id, device_id, permissions}`. Requires `Authorization: Bearer <JWT>`; when absent returns `{role:"VIEWER", permissions:["READ"]}` (not `FIELD_OP`). Roles `NCPOR_ADMIN(5)>HQ_LOGISTICS(4)>DISPATCH(3)=STATION_LEAD(3)>FIELD_OP(2)>VIEWER(1)` `hq/app/auth.py:8`. Row-level: `device_id→station_id` at provisioning; queries `WHERE station_id=:mine`.

`GET /internal/broadcast_delta` (gateway, HQ→field push) → requires header `X-PSK: <PSK_HEX>` equal to gateway `PSK_HEX` `sync-gateway/src/gateway.ts:73`, else `401`. Broadcasts `DOWNSTREAM_DELTA` `ulid, station_id, entity, entity_id, op, patch, vector_clock` to `station_id` tablets.

`POST /dtn/exchange` gateway also requires `X-PSK` if present (mule batch).

## Errors

Standard FastAPI `HTTPException` JSON `{detail: string, request_id}`. Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `CSP default-src 'self'`, `Cache-Control: no-store`. All writes append `audit_log` + `dedupe` + `vector_clock`. Idempotency via `ulid` + `dedupe` + `vector_clock` merge.

## Wire

Field `SyncWorker` (`field/lib/sync.ts:13`) maintains full-duplex socket: `connect()` sends `SYNC_INIT` encrypted wire, `drain()` every 2s sends `outbox` `PENDING|SENT`→`BUNDLED` when offline else `ws.send`, `pushBundlesToHQ()` when `dtn_bundles` pending, `onmessage` handles `DOWNSTREAM_DELTA` (assets/indents/vessels)/`SYNC_INIT_RESP` (`indents` + `bundles`)/`ACK` (`APPLIED|DEDUPED|APPLIED_LOCAL_WINS|CONFLICT_CRITICAL|FAILED`), updates `outbox SET ACKED` + `sync_state` + `applyDownstreamAsset` VC merge. `PING/PONG` keepalive 30s. Verify scripts use same `toWire`/`fromWire` with `PSK_HEX="a"*64` demo key + VC.

## Example curl

```bash
curl http://localhost:8000/health
curl http://localhost:8000/forecast/ST-BHARATI
curl http://localhost:8000/forecast/snn/ST-BHARATI | jq
curl http://localhost:8000/assets | jq '.[0] | {sku,qty,station_id,vector_clock}'
curl http://localhost:8000/vessels | jq '.[0] | {imo,name,lat,source}'
curl http://localhost:8000/dtn/bundles | jq
curl http://localhost:8000/tracking/positions | jq
curl -X POST http://localhost:8000/auth/login -H "Content-Type: application/json" \
  -d '{"device_id":"BHARATI-TABLET-01","pin":"BHARATI-2024","station_id":"ST-BHARATI"}'
# → {token, role:"FIELD_OP", ...}  (requesting role:"NCPOR_ADMIN" without ADMIN device_id still returns FIELD_OP)
TOKEN=$(curl -s http://localhost:8000/auth/login -H "Content-Type: application/json" \
  -d '{"device_id":"HQ-ADMIN-01","pin":"BHARATI-2024","station_id":"ST-BHARATI","role":"NCPOR_ADMIN"}' | jq -r .token)
curl http://localhost:8000/assets/bulk/template
curl -X POST http://localhost:8000/assets/bulk -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"rows":[{"sku":"TEST-SKU-999","name":"Test","category":"FOOD","qty":42,"unit":"packs","criticality":"HIGH","crate_id":"C1-K1"}]}'
curl http://localhost:8000/telemetry/sources | jq
curl http://localhost:8000/physics/ST-BHARATI | jq
curl -H "Authorization: Bearer $TOKEN" -X PATCH http://localhost:8000/indents/$ID \
  -H "Content-Type: application/json" -d '{"status":"DISPATCHED","actor_id":"LEAD_01","vessel_imo":"9734567"}'
curl -X POST http://localhost:8000/telemetry -H "Content-Type: application/json" \
  -d '{"ts":"2026-08-27T00:00:00","station_id":"ST-BHARATI","temp_outside":-38,"wind_speed":22,"pressure":960,"dg_load":0.9}'
# gateway internal push (requires X-PSK)
curl -X POST http://localhost:8787/internal/broadcast_delta -H "X-PSK: $PSK_HEX" -H "Content-Type: application/json" \
  -d '{"station_id":"ST-BHARATI","entity":"indents","entity_id":"...","op":"STATUS_CHANGE","patch":{"status":"APPROVED"}}'
# DTN mule bulk (via HQ or gateway)
curl -X POST http://localhost:8000/dtn/ingest_bulk -H "Content-Type: application/json" \
  -d '{"bundles":[{"bundleId":"01...","src":"TAB-A","dstStation":"ST-BHARATI","vectorClock":{"TAB-A":1},"payload":{"entity":"assets","entity_id":"A1","op":"UPSERT","patch":{"qty":4000}}}]}'
```

