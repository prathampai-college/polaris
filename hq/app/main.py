from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import Any, Dict
import os, logging, time, uuid, asyncio, hmac, json as _json
from contextlib import asynccontextmanager

from .db import init_db, get_conn, USE_PG, utc_now
from .forecast import load_forecast_model, physics_pred, predict_total
from .config import ALLOWED, SECRET_KEY, TOKEN_EXPIRY_DAYS, STATION_PINS
from .auth import sign_jwt, get_current_user, require_role

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("polaris.hq")

_raw_origins = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]
# Hardening: wildcard is dev-only. In production (DATABASE_URL set) drop '*' and fall back to localhost allowlist.
if os.getenv("DATABASE_URL") and "*" in ALLOWED_ORIGINS:
    logger.warning("CORS allow * in production – set ALLOWED_ORIGINS (dropping * for safety)")
    ALLOWED_ORIGINS = [o for o in ALLOWED_ORIGINS if o != "*"]
    if not ALLOWED_ORIGINS:
        ALLOWED_ORIGINS = ["http://localhost:3000", "http://localhost:3001"]
if not ALLOWED_ORIGINS:
    ALLOWED_ORIGINS = ["http://localhost:3000", "http://localhost:3001"]

# in-memory bounded rate limiter
_rate_store: dict = {}
def check_rate_limit(key: str, limit: int = 120, window: int = 60) -> bool:
    now = time.time()
    if len(_rate_store) > 1000:
        for k in list(_rate_store.keys()):
            _rate_store[k] = [t for t in _rate_store[k] if now - t < window]
            if not _rate_store[k]:
                _rate_store.pop(k, None)
    bucket = [t for t in _rate_store.get(key, []) if now - t < window]
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    _rate_store[key] = bucket
    return True

# --- SSE telemetry stream subscribers ---
_sse_subscribers: list[asyncio.Queue] = []

async def _broadcast_telemetry(tele: dict):
    """Push telemetry event to all connected SSE clients."""
    dead = []
    for q in _sse_subscribers:
        try:
            q.put_nowait(tele)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _sse_subscribers.remove(q)

GATEWAY_INTERNAL_URL = os.getenv("GATEWAY_INTERNAL_URL", os.getenv("GATEWAY_URL", "http://localhost:8787"))

async def _notify_gateway_async(station_id: str, entity: str, entity_id: str, op: str, patch: dict):
    """Async gateway push — never blocks event loop (httpx, 1s timeout)."""
    try:
        import httpx
        url = f"{GATEWAY_INTERNAL_URL}/internal/broadcast_delta"
        psk = os.getenv("PSK_HEX", os.getenv("SECRET_KEY", "a" * 64))
        async with httpx.AsyncClient(timeout=1.0) as client:
            await client.post(url, json={"station_id": station_id, "entity": entity, "entity_id": entity_id, "op": op, "patch": patch}, headers={"X-PSK": psk})
    except Exception as e:
        logger.debug(f"Gateway downstream notification ignored: {e}")

def notify_gateway(station_id: str, entity: str, entity_id: str, op: str, patch: dict):
    """Fire-and-forget gateway notify — sync callers stay non-blocking."""
    try:
        loop = asyncio.get_running_loop()
        if loop.is_running():
            loop.create_task(_notify_gateway_async(station_id, entity, entity_id, op, patch))
            return
    except RuntimeError:
        pass
    # no running loop (e.g. sync test) — run in background thread so request never blocks
    try:
        import threading
        threading.Thread(target=lambda: asyncio.run(_notify_gateway_async(station_id, entity, entity_id, op, patch)), daemon=True).start()
    except Exception as e:
        logger.debug(f"Gateway notify thread ignored: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try: load_forecast_model()
    except Exception as e: print("[hq forecast] model fallback", e)
    # Phase 2.2: start weather poller (Open-Meteo / IMD) if not sim-only disabled
    try:
        from .telemetry_poller import start_poller
        start_poller()
    except Exception as e:
        logger.warning(f"[poller] start failed: {e}")
    # Phase 4: vessel poller (AIS adaptive + mock fallback)
    try:
        from .vessel_poller import start_poller as start_vessel_poller
        start_vessel_poller()
    except Exception as e:
        logger.warning(f"[vessel_poller] start failed: {e}")
    yield

app = FastAPI(title="POLARIS HQ — NCPOR Command", version="0.1.0", docs_url="/docs", redoc_url="/redoc", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["*"], allow_headers=["*"], allow_credentials=False)

@app.middleware("http")
async def add_security_headers_and_logging(request: Request, call_next):
    start = time.time()
    req_id = str(uuid.uuid4())[:8]
    logger.info(f"[{req_id}] {request.method} {request.url.path} device={request.headers.get('x-device-id','-')}")
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none';"
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["X-Request-ID"] = req_id
    logger.info(f"[{req_id}] {response.status_code} {time.time()-start:.3f}s")
    return response

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    logger.warning(f"HTTP {exc.status_code} {request.url.path} detail={exc.detail}")
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail, "request_id": request.headers.get("x-request-id","")})

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled {request.url.path} {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "internal error", "type": type(exc).__name__})

# --- helpers to collapse PG/SQLite branching ---
def q(sql: str) -> str:
    return sql.replace("?", "%s") if USE_PG else sql.replace("%s", "?")

def _fetch_all(sql: str, params=()):
    conn = get_conn()
    sql = q(sql)
    close_after = USE_PG
    try:
        if USE_PG:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(sql, params)
                    cols = [d[0] for d in cur.description] if cur.description else []
                    return [dict(zip(cols, r)) for r in cur.fetchall()] if cols else []
        else:
            cur = conn.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
    finally:
        if close_after:
            try:
                from .db import release_conn
                release_conn(conn)
            except Exception:
                try: conn.close()
                except Exception: pass

def _fetch_one(sql: str, params=()):
    rows = _fetch_all(sql, params)
    return rows[0] if rows else None

class DeltaFrame(BaseModel):
    ulid: str
    device_id: str
    entity: str
    entity_id: str
    op: str
    patch: Dict[str, Any]
    base_version: int
    ts: str
    vector_clock: Dict[str, Any] | None = None
    local_coord: list | None = None

@app.get("/health")
def health():
    return {"status":"ok", "db": "postgres" if USE_PG else "sqlite-fallback", "ts": utc_now()}

class LoginRequest(BaseModel):
    device_id: str
    pin: str
    station_id: str
    role: str | None = None

@app.post("/auth/login")
async def auth_login(body: LoginRequest, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"login_ip:{client_ip}", limit=40, window=60):
        raise HTTPException(429, "too many login attempts: rate limited")
    if not check_rate_limit(f"login_dev:{body.device_id}", limit=20, window=60):
        raise HTTPException(429, "too many login attempts for device: rate limited")

    expected_pin = STATION_PINS.get(body.station_id)
    if not expected_pin or not hmac.compare_digest(str(body.pin).strip(), str(expected_pin).strip()):
        raise HTTPException(401, "invalid station or pin")

    requested = (body.role or "FIELD_OP").upper()
    valid_roles = ["FIELD_OP", "STATION_LEAD", "DISPATCH", "HQ_LOGISTICS", "NCPOR_ADMIN"]
    if requested not in valid_roles:
        requested = "FIELD_OP"

    # Elevated roles require authorized device prefix or admin credentials
    if requested in ("STATION_LEAD", "DISPATCH", "HQ_LOGISTICS", "NCPOR_ADMIN"):
        admin_secret = os.getenv("ADMIN_KEY") or os.getenv("ADMIN_PIN")
        is_admin_auth = False
        if admin_secret and body.pin == admin_secret:
            is_admin_auth = True
        elif any(body.device_id.startswith(pfx) for pfx in ("NCPOR-ADMIN-", "HQ-COMMAND-", "TEST-HQ")):
            is_admin_auth = True
        elif requested in ("STATION_LEAD", "DISPATCH") and any(body.device_id.startswith(pfx) for pfx in ("LEAD-", "STATION-LEAD-")):
            is_admin_auth = True

        if not is_admin_auth:
            requested = "FIELD_OP"

    role = requested
    token = sign_jwt({"sub": body.device_id, "role": role, "station_id": body.station_id, "device_id": body.device_id}, SECRET_KEY, TOKEN_EXPIRY_DAYS)
    return {"token": token, "role": role, "station_id": body.station_id, "device_id": body.device_id}

@app.get("/rbac/me")
async def rbac_me(request: Request):
    user = await get_current_user(request)
    if user:
        return {"role": user["role"], "station_id": user["station_id"], "device_id": user["device_id"], "permissions": ["CONSUME", "IN", "READ"]}
    return {"role": "VIEWER", "station_id": "ST-BHARATI", "device_id": "BHARATI-TABLET-01", "permissions": ["READ"]}

@app.get("/assets")
def list_assets():
    # Phase 1.2: include station_id/container_id via join so client can scope without STATION_CRATES
    return _fetch_all("SELECT a.id, a.sku, a.name, a.category, a.qty, a.unit, a.expiry_date, a.criticality, a.crate_id, a.barcode, a.version, a.updated_at, c.station_id, cr.container_id FROM assets a LEFT JOIN crates cr ON a.crate_id=cr.id LEFT JOIN containers c ON cr.container_id=c.id ORDER BY a.sku")

@app.get("/audit")
def list_audit(limit: int=50):
    limit = max(1, min(limit, 200))
    return _fetch_all("SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?", (limit,))

@app.get("/indents")
def list_indents(station_id: str = None):
    if station_id:
        return _fetch_all("SELECT i.*, a.sku, a.name FROM indents i LEFT JOIN assets a ON a.id=i.asset_id WHERE i.station_id=? ORDER BY i.created_at DESC", (station_id,))
    return _fetch_all("SELECT i.*, a.sku, a.name FROM indents i LEFT JOIN assets a ON a.id=i.asset_id ORDER BY i.created_at DESC")

class IndentCreate(BaseModel):
    station_id: str
    asset_id: str
    qty_requested: float
    urgency: str = "MEDIUM"
    created_by: str
    status: str = "DRAFT"

@app.post("/indents")
def create_indent(body: IndentCreate):
    if body.qty_requested <= 0:
        raise HTTPException(400, "qty_requested must be >0")
    if body.urgency not in ["LOW","MEDIUM","CRITICAL"]:
        raise HTTPException(400, "invalid urgency")
    if body.status not in ["DRAFT","APPROVED","DISPATCHED","RECEIVED"]:
        body.status = "DRAFT"
    conn=get_conn()
    now = utc_now()
    try:
        try:
            from ulid import ULID
            iid=str(ULID())
        except Exception:
            iid=str(uuid.uuid4())[:8]+"-"+body.asset_id
        if USE_PG:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(q("INSERT INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at, vessel_imo) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING"), (iid, body.station_id, body.asset_id, body.qty_requested, body.urgency, body.status, body.created_by, now, None))
                    cur.execute(q("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)"), (iid, body.created_by, "INDENT_CREATE_HQ", "indents", None, str(body.model_dump()), now))
        else:
            conn.execute("INSERT OR IGNORE INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at, vessel_imo) VALUES (?,?,?,?,?,?,?,?,?)", (iid, body.station_id, body.asset_id, body.qty_requested, body.urgency, body.status, body.created_by, now, None))
            conn.execute("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)", (iid, body.created_by, "INDENT_CREATE_HQ", "indents", None, str(body.model_dump()), now))
            conn.commit()
    finally:
        if USE_PG:
            try:
                from .db import release_conn as _release
                _release(conn)
            except Exception:
                pass
    notify_gateway(body.station_id, "indents", iid, "UPSERT", {
        "id": iid,
        "station_id": body.station_id,
        "asset_id": body.asset_id,
        "qty_requested": body.qty_requested,
        "urgency": body.urgency,
        "status": body.status,
        "created_by": body.created_by,
        "created_at": now
    })
    return {"id": iid, "status": body.status}

class IndentPatch(BaseModel):
    status: str
    actor_id: str = "NCPOR_ADMIN"
    vessel_imo: str | None = None

@app.patch("/indents/{indent_id}")
async def patch_indent(indent_id: str, body: IndentPatch, user: dict = Depends(require_role("STATION_LEAD"))):
    conn=get_conn()
    now = utc_now()
    try:
        row=_fetch_one("SELECT id, station_id, asset_id, status, vessel_imo FROM indents WHERE id=?", (indent_id,))
        if not row: raise HTTPException(404, "indent not found")
        cur_status=row["status"]
        station_id=row.get("station_id") or "ST-BHARATI"
        allowed = ALLOWED.get(cur_status, [])
        # allow DRAFT->RECEIVED for offline field demo (tolerant), otherwise enforce state machine
        is_offline_shortcut = (cur_status == "DRAFT" and body.status == "RECEIVED")
        if body.status not in allowed and not is_offline_shortcut:
            raise HTTPException(400, f"invalid transition {cur_status}->{body.status}")
        # Phase 4: validate vessel_imo if provided
        if body.vessel_imo is not None:
            v = _fetch_one("SELECT imo FROM vessels WHERE imo=?", (body.vessel_imo,))
            if not v:
                raise HTTPException(404, f"vessel {body.vessel_imo} not found")
        if USE_PG:
            with conn:
                with conn.cursor() as cur:
                    if body.vessel_imo is not None:
                        cur.execute(q("UPDATE indents SET status=?, vessel_imo=? WHERE id=?"), (body.status, body.vessel_imo, indent_id))
                    else:
                        cur.execute(q("UPDATE indents SET status=? WHERE id=?"), (body.status, indent_id))
                    cur.execute(q("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)"), (indent_id+body.status, body.actor_id, f"INDENT_{body.status}", "indents", str({"status":cur_status}), str({"status":body.status, "vessel_imo": body.vessel_imo}), now))
        else:
            # relaxed for M2 demo: allow any forward in SQLite fallback
            if body.vessel_imo is not None:
                conn.execute("UPDATE indents SET status=?, vessel_imo=? WHERE id=?", (body.status, body.vessel_imo, indent_id))
            else:
                conn.execute("UPDATE indents SET status=? WHERE id=?", (body.status, indent_id))
            conn.execute("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)", (indent_id+body.status, body.actor_id, f"INDENT_{body.status}", "indents", str({"status":cur_status}), str({"status":body.status, "vessel_imo": body.vessel_imo}), now))
            conn.commit()
    finally:
        if USE_PG:
            try:
                from .db import release_conn as _release2
                _release2(conn)
            except Exception:
                pass
    notify_gateway(station_id, "indents", indent_id, "STATUS_CHANGE", {
        "id": indent_id,
        "status": body.status,
        "vessel_imo": body.vessel_imo,
        "updated_at": now
    })
    return {"id": indent_id, "old": cur_status, "new": body.status}


@app.get("/stations/overview")
def stations_overview():
    stations=_fetch_all("SELECT id, name, winter_crew_count FROM stations")
    for s in stations:
        sid = s["id"]
        s["containers"]=_fetch_one("SELECT COUNT(*) as c FROM containers WHERE station_id=?", (sid,))["c"]
        s["assets"]=_fetch_one("SELECT COUNT(*) as c FROM assets a JOIN crates cr ON a.crate_id=cr.id JOIN containers c ON cr.container_id=c.id WHERE c.station_id=?", (sid,))["c"]
        s["critical_low"]=_fetch_one("SELECT COUNT(*) as c FROM assets a JOIN crates cr ON a.crate_id=cr.id JOIN containers c ON cr.container_id=c.id WHERE c.station_id=? AND a.criticality='CRITICAL' AND a.qty<5", (sid,))["c"]
        s["open_indents"]=_fetch_one("SELECT COUNT(*) as c FROM indents WHERE station_id=? AND status IN ('DRAFT','APPROVED','DISPATCHED')",(sid,))["c"]
        diesel=_fetch_one("SELECT a.qty FROM assets a JOIN crates cr ON a.crate_id=cr.id JOIN containers c ON cr.container_id=c.id WHERE c.station_id=? AND a.sku='FUEL-DIESEL-001' LIMIT 1", (sid,))
        tele=_fetch_one("SELECT temp_outside, wind_speed, pressure, dg_load FROM telemetry WHERE station_id=? ORDER BY ts DESC LIMIT 1", (sid,))
        if diesel and diesel["qty"]:
            crew=s["winter_crew_count"]
            t=tele or {"temp_outside": -15, "wind_speed": 5, "pressure": 1013, "dg_load": 0.7}
            phys,res,total,used=predict_total(t["temp_outside"], t["wind_speed"], t["pressure"], crew, t["dg_load"], sid)
            s["days_to_stockout"]=round(diesel["qty"]/total,1) if total>0 else 999
            s["forecast_ci"]=[round(s["days_to_stockout"]*0.85), round(s["days_to_stockout"]*1.15)]
            # honest placeholder: ±15% until 30d live burn lands (see scripts/calibrate_physics.py)
            s["forecast_ci_source"]="placeholder_15pct"
        else:
            s["days_to_stockout"]=0
            s["forecast_ci"]=[0,0]
    return stations

class TelemetryIn(BaseModel):
    ts: str
    station_id: str
    temp_outside: float
    wind_speed: float
    pressure: float
    dg_load: float
    acoustic_anomaly: float = 0.0 # Phase 4: acoustic prognostics score

@app.post("/telemetry")
async def post_telemetry(t: TelemetryIn):
    conn=get_conn()
    try:
        if USE_PG:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(q("INSERT INTO telemetry VALUES (?,?,?,?,?,?)"), (t.ts, t.station_id, t.temp_outside, t.wind_speed, t.pressure, t.dg_load))
                    try: check_and_escalate(t.station_id, t)
                    except Exception: pass
        else:
            conn.execute("INSERT INTO telemetry VALUES (?,?,?,?,?,?)", (t.ts, t.station_id, t.temp_outside, t.wind_speed, t.pressure, t.dg_load))
            conn.commit()
            try: check_and_escalate(t.station_id, t)
            except: pass
    finally:
        if USE_PG:
            try:
                from .db import release_conn as _release3
                _release3(conn)
            except Exception:
                pass
    await _broadcast_telemetry(t.model_dump())
    return {"ok": True}

@app.get("/telemetry/latest")
def latest_telemetry(station_id: str = "ST-BHARATI"):
    row = _fetch_one("SELECT * FROM telemetry WHERE station_id=? ORDER BY ts DESC LIMIT 1", (station_id,)) or {}
    if not row:
        return row
    # freshness proof for the badge: age of newest telemetry row + poller status
    try:
        import datetime as _dt
        ts = row.get("ts")
        age = None
        if ts:
            now = _dt.datetime.now(_dt.timezone.utc)
            try:
                ref = _dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            except Exception:
                ref = None
            if ref is not None:
                if ref.tzinfo is None:
                    ref = ref.replace(tzinfo=_dt.timezone.utc)
                age = max(0, int((now - ref).total_seconds()))
        row["fetched_at"] = ts
        row["age_sec"] = age
    except Exception:
        pass
    try:
        from .telemetry_poller import get_status as _wx_status
        st = _wx_status()
        row["source"] = "live" if (st.get("live_enabled") and (row.get("age_sec") or 0) < 2 * st.get("poll_interval_sec", 900)) else "stale_cache"
        row["poller"] = {"live_enabled": st.get("live_enabled"), "imd_status": st.get("imd_status")}
    except Exception:
        row.setdefault("source", "stale_cache")
    return row

@app.get("/telemetry/history")
def history_telemetry(station_id: str = "ST-BHARATI", days: int = 30):
    # Phase 3: TimescaleDB trend history endpoint
    return _fetch_all("SELECT SUBSTR(ts, 1, 10) as day, AVG(temp_outside) as avg_temp, AVG(dg_load) as avg_load FROM telemetry WHERE station_id=? GROUP BY SUBSTR(ts, 1, 10) ORDER BY day DESC LIMIT ?", (station_id, days))

@app.get("/telemetry/sources")
def telemetry_sources():
    """Health of weather poller sources (Phase 2.2)."""
    try:
        from .telemetry_poller import get_status
        return get_status()
    except Exception as e:
        return {"source_setting": os.getenv("TELEMETRY_SOURCE", "both"), "error": str(e), "last_poll": None}

@app.get("/telemetry/stream")
async def telemetry_stream():
    """SSE endpoint — streams telemetry events in real-time to connected dashboards."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _sse_subscribers.append(queue)

    async def event_generator():
        try:
            yield f"data: {_json.dumps({'type': 'connected', 'subscribers': len(_sse_subscribers)})}\n\n"
            while True:
                try:
                    tele = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"event: telemetry\ndata: {_json.dumps(tele)}\n\n"
                except asyncio.TimeoutError:
                    yield f": keepalive {_json.dumps({'ts': time.time()})}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if queue in _sse_subscribers:
                _sse_subscribers.remove(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })

def _auto_indent(conn, station_id: str, asset_id: str, qty_needed: float, creator: str, audit_action: str, audit_detail: str, suffix: str, now: str):
    exists = _fetch_one("SELECT 1 as c FROM indents WHERE asset_id=? AND station_id=? AND status IN ('DRAFT','APPROVED','DISPATCHED')", (asset_id, station_id))
    if exists:
        return
    try:
        from ulid import ULID
        iid = str(ULID())
    except Exception:
        iid = str(uuid.uuid4())[:8] + suffix
    if USE_PG:
        with conn:
            with conn.cursor() as cur:
                cur.execute(q("INSERT INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at, vessel_imo) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING"), (iid, station_id, asset_id, qty_needed, "CRITICAL", "DRAFT", creator, now, None))
                cur.execute(q("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)"), (iid, creator, audit_action, "indents", None, audit_detail, now))
    else:
        conn.execute("INSERT OR IGNORE INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at, vessel_imo) VALUES (?,?,?,?,?,?,?,?,?)", (iid, station_id, asset_id, qty_needed, "CRITICAL", "DRAFT", creator, now, None))
        conn.execute("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)", (iid, creator, audit_action, "indents", None, audit_detail, now))
        conn.commit()
    notify_gateway(station_id, "indents", iid, "UPSERT", {
        "id": iid, "station_id": station_id, "asset_id": asset_id,
        "qty_requested": qty_needed, "urgency": "CRITICAL", "status": "DRAFT",
        "created_by": creator, "created_at": now
    })

def check_and_escalate(station_id: str, tele):
    conn=get_conn()
    try:
        # BUGFIX: scope diesel qty to station (was global LIMIT 1 → wrong station days_to_stockout)
        row=_fetch_one("SELECT a.id, a.qty FROM assets a JOIN crates cr ON a.crate_id=cr.id JOIN containers c ON cr.container_id=c.id WHERE c.station_id=? AND a.sku='FUEL-DIESEL-001' LIMIT 1", (station_id,))
        if not row:
            row=_fetch_one("SELECT id, qty FROM assets WHERE sku='FUEL-DIESEL-001' LIMIT 1")
        if not row: return
        asset_id, qty=row["id"], row["qty"]
        cr=_fetch_one("SELECT winter_crew_count FROM stations WHERE id=?", (station_id,))
        crew=cr["winter_crew_count"] if cr else 24
        phys,res,total,used=predict_total(tele.temp_outside, tele.wind_speed, tele.pressure, crew, tele.dg_load, station_id)
        days=qty/total if total>0 else 999
        now=utc_now()
        if days <= 20:
            _auto_indent(conn, station_id, asset_id, 500, "FORECAST_AUTO", "INDENT_AUTO_CRITICAL", f"forecast {days:.1f}d", "-auto", now)
        # Phase 4: Acoustic Prognostics Escalation
        if getattr(tele, 'acoustic_anomaly', 0.0) > 0.90:
            row = _fetch_one("SELECT a.id FROM assets a JOIN crates cr ON a.crate_id=cr.id JOIN containers c ON cr.container_id=c.id WHERE c.station_id=? AND a.sku='SPARE-BRG-6205-007' LIMIT 1", (station_id,))
            if not row:
                row = _fetch_one("SELECT id FROM assets WHERE sku='SPARE-BRG-6205-007' LIMIT 1")
            if row:
                _auto_indent(conn, station_id, row["id"], 4, "ACOUSTIC_AI", "INDENT_ACOUSTIC_CRITICAL", "bearing whine > 90%", "-ac", now)
    finally:
        if USE_PG:
            try:
                from .db import release_conn as _release_ce
                _release_ce(conn)
            except Exception:
                pass


@app.get("/forecast/{station_id}")
def forecast(station_id: str, asset_sku: str = "FUEL-DIESEL-001"):
    tele=_fetch_one("SELECT temp_outside, wind_speed, pressure, dg_load, ts FROM telemetry WHERE station_id=? ORDER BY ts DESC LIMIT 1", (station_id,))
    qty_row=_fetch_one("SELECT a.qty FROM assets a JOIN crates cr ON a.crate_id=cr.id JOIN containers c ON cr.container_id=c.id WHERE c.station_id=? AND a.sku=? LIMIT 1", (station_id, asset_sku))
    cr=_fetch_one("SELECT winter_crew_count FROM stations WHERE id=?", (station_id,))
    if not qty_row: raise HTTPException(404, "asset")
    qty=qty_row["qty"]; crew=cr["winter_crew_count"] if cr else 24
    if not tele:
        tele={"temp_outside": -15, "wind_speed": 5, "pressure": 1013, "dg_load": 0.7}
    else:
        # freshness proof for the field badge (same clock as /telemetry/latest)
        try:
            from .telemetry_poller import get_status as _wx
            _st = _wx()
            _ts = tele.get("ts")
            _age = None
            if _ts:
                import datetime as _dt2
                try:
                    _ref = _dt2.datetime.fromisoformat(str(_ts).replace("Z", "+00:00"))
                    if _ref.tzinfo is None:
                        _ref = _ref.replace(tzinfo=_dt2.timezone.utc)
                    _age = max(0, int((_dt2.datetime.now(_dt2.timezone.utc) - _ref).total_seconds()))
                except Exception:
                    _age = None
            tele["fetched_at"] = _ts
            tele["age_sec"] = _age
            tele["source"] = "live" if (_st.get("live_enabled") and (_age or 0) < 2 * _st.get("poll_interval_sec", 900)) else "stale_cache"
        except Exception:
            tele.setdefault("source", "stale_cache")
    phys,res,total,used=predict_total(tele["temp_outside"], tele["wind_speed"], tele["pressure"], crew, tele["dg_load"], station_id)
    days=qty/total if total>0 else 999
    ci=[round(days*0.85), round(days*1.15)]
    return {"station_id": station_id, "asset_sku": asset_sku, "qty": qty, "physics": round(phys,1), "residual": round(res,2), "total_per_day": round(total,1), "days_to_stockout": round(days,1), "ci": ci, "ci_source": "placeholder_15pct", "used_model": used, "tele": tele,
            "pure_physics_days": round(qty/phys,1) if phys>0 else 999}

@app.get("/physics/{station_id}")
@app.get("/physics/params/{station_id}")
def get_physics(station_id: str):
    """Per-station physics params (Phase 2.3). Falls back to global physics.json if no DB row."""
    row = _fetch_one("SELECT station_id, T_INSIDE, BASE, K1, K2, K3 FROM physics_params WHERE station_id=?", (station_id,))
    if row:
        return row
    # fallback global
    try:
        from .forecast import load_physics
        ph = load_physics()
        return {"station_id": station_id, "T_INSIDE": ph["T_INSIDE"], "BASE": ph["BASE"], "K1": ph["K1"], "K2": ph["K2"], "K3": ph["K3"], "source": "global_fallback"}
    except Exception as e:
        raise HTTPException(404, f"physics not found for {station_id}")

# --- Phase 4: Vessel tracking (AIS adaptive + mock fallback) ---
@app.get("/vessels")
def list_vessels(station_id: str | None = None):
    """List vessels. Filter by station_id if given. Returns source:live|stale_cache|mock + fetched_at + age_sec."""
    if station_id:
        rows = _fetch_all("SELECT imo, name, lat, lon, sog, eta, station_id, last_seen FROM vessels WHERE station_id=? ORDER BY last_seen DESC", (station_id,))
    else:
        rows = _fetch_all("SELECT imo, name, lat, lon, sog, eta, station_id, last_seen FROM vessels ORDER BY last_seen DESC")
    # annotate freshness proof based on recent poller status
    try:
        from .vessel_poller import get_status
        st = get_status()
        raw = st.get("last", {}).get("source", "mock")
        src = "live" if raw == "live" else ("stale_cache" if rows else "mock")
        fetched = st.get("fetched_at")
        age = st.get("age_sec")
        reason = st.get("reason")
    except Exception:
        src, fetched, age, reason = ("mock", None, None, None)
    for r in rows:
        r["source"] = src
        r["fetched_at"] = r.get("last_seen") or fetched
        r["age_sec"] = age
        if reason:
            r["reason"] = reason
    return rows

@app.get("/vessels/sources")
def vessel_sources():
    """Health and status of AIS / mock vessel poller."""
    try:
        from .vessel_poller import get_status
        return get_status()
    except Exception as e:
        return {"error": str(e)}

@app.post("/vessels/poll")
async def trigger_vessel_poll():
    """Trigger manual vessel poll and upsert."""
    try:
        from .vessel_poller import poll_once
        return await poll_once()
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/vessels/{imo}")
def get_vessel(imo: str):
    row = _fetch_one("SELECT imo, name, lat, lon, sog, eta, station_id, last_seen FROM vessels WHERE imo=?", (imo,))
    if not row:
        raise HTTPException(404, "vessel not found")
    try:
        from .vessel_poller import get_status
        st = get_status()
        row["source"] = st.get("last", {}).get("source", "mock")
    except Exception:
        row["source"] = "mock"
    return row

# --- Pillar 4 & 5: Personnel Roster, Field Sorties & Emergency SOS ---

class PersonnelUpsert(BaseModel):
    id: str
    station_id: str
    name: str
    role: str
    blood_group: str = "O+"
    emergency_contact: str = ""
    status: str = "ON_STATION"

@app.get("/personnel")
def list_personnel(station_id: str = None):
    if station_id:
        return _fetch_all("SELECT * FROM personnel WHERE station_id=? ORDER BY name", (station_id,))
    return _fetch_all("SELECT * FROM personnel ORDER BY station_id, name")

@app.post("/personnel")
def upsert_personnel(body: PersonnelUpsert):
    conn = get_conn()
    if USE_PG:
        with conn:
            with conn.cursor() as cur:
                cur.execute(q("INSERT INTO personnel (id, station_id, name, role, blood_group, emergency_contact, status) VALUES (?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET station_id=EXCLUDED.station_id, name=EXCLUDED.name, role=EXCLUDED.role, blood_group=EXCLUDED.blood_group, emergency_contact=EXCLUDED.emergency_contact, status=EXCLUDED.status"), (body.id, body.station_id, body.name, body.role, body.blood_group, body.emergency_contact, body.status))
    else:
        conn.execute("INSERT INTO personnel (id, station_id, name, role, blood_group, emergency_contact, status) VALUES (?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET station_id=excluded.station_id, name=excluded.name, role=excluded.role, blood_group=excluded.blood_group, emergency_contact=excluded.emergency_contact, status=excluded.status", (body.id, body.station_id, body.name, body.role, body.blood_group, body.emergency_contact, body.status))
        conn.commit()
    notify_gateway(body.station_id, "personnel", body.id, "UPSERT", getattr(body, "model_dump", body.dict)())
    return {"status": "ok", "id": body.id}

class SortieCreate(BaseModel):
    id: str | None = None
    station_id: str
    lead_personnel_id: str
    destination: str
    departure_time: str | None = None
    expected_return_time: str
    safety_status: str = "ACTIVE"

@app.get("/sorties")
def list_sorties(station_id: str = None):
    if station_id:
        return _fetch_all("SELECT s.*, p.name as lead_name, p.role as lead_role FROM field_sorties s LEFT JOIN personnel p ON p.id=s.lead_personnel_id WHERE s.station_id=? ORDER BY s.departure_time DESC", (station_id,))
    return _fetch_all("SELECT s.*, p.name as lead_name, p.role as lead_role FROM field_sorties s LEFT JOIN personnel p ON p.id=s.lead_personnel_id ORDER BY s.departure_time DESC")

@app.post("/sorties")
def create_sortie(body: SortieCreate):
    conn = get_conn()
    now = utc_now()
    sortie_id = body.id or f"SORTIE-{uuid.uuid4().hex[:8]}"
    dep_time = body.departure_time or now
    if USE_PG:
        with conn:
            with conn.cursor() as cur:
                cur.execute(q("INSERT INTO field_sorties (id, station_id, lead_personnel_id, destination, departure_time, expected_return_time, safety_status) VALUES (?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET safety_status=EXCLUDED.safety_status"), (sortie_id, body.station_id, body.lead_personnel_id, body.destination, dep_time, body.expected_return_time, body.safety_status))
                cur.execute(q("UPDATE personnel SET status='FIELD_SORTIE' WHERE id=?"), (body.lead_personnel_id,))
    else:
        conn.execute("INSERT INTO field_sorties (id, station_id, lead_personnel_id, destination, departure_time, expected_return_time, safety_status) VALUES (?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET safety_status=excluded.safety_status", (sortie_id, body.station_id, body.lead_personnel_id, body.destination, dep_time, body.expected_return_time, body.safety_status))
        conn.execute("UPDATE personnel SET status='FIELD_SORTIE' WHERE id=?", (body.lead_personnel_id,))
        conn.commit()
    notify_gateway(body.station_id, "field_sorties", sortie_id, "UPSERT", {"id": sortie_id, "station_id": body.station_id, "lead_personnel_id": body.lead_personnel_id, "destination": body.destination, "departure_time": dep_time, "expected_return_time": body.expected_return_time, "safety_status": body.safety_status})
    return {"status": "ok", "id": sortie_id}

@app.patch("/sorties/{sortie_id}")
def update_sortie(sortie_id: str, patch: dict):
    conn = get_conn()
    now = utc_now()
    status = patch.get("safety_status")
    actual_return = now if status == "RETURNED" else patch.get("actual_return_time")
    if USE_PG:
        with conn:
            with conn.cursor() as cur:
                if actual_return:
                    cur.execute(q("UPDATE field_sorties SET safety_status=?, actual_return_time=? WHERE id=?"), (status, actual_return, sortie_id))
                else:
                    cur.execute(q("UPDATE field_sorties SET safety_status=? WHERE id=?"), (status, sortie_id))
                if status == "RETURNED":
                    cur.execute(q("SELECT lead_personnel_id FROM field_sorties WHERE id=?"), (sortie_id,))
                    r = cur.fetchone()
                    if r and r[0]:
                        cur.execute(q("UPDATE personnel SET status='ON_STATION' WHERE id=?"), (r[0],))
    else:
        if actual_return:
            conn.execute("UPDATE field_sorties SET safety_status=?, actual_return_time=? WHERE id=?", (status, actual_return, sortie_id))
        else:
            conn.execute("UPDATE field_sorties SET safety_status=? WHERE id=?", (status, sortie_id))
        if status == "RETURNED":
            cur = conn.execute("SELECT lead_personnel_id FROM field_sorties WHERE id=?", (sortie_id,))
            r = cur.fetchone()
            if r and r[0]:
                conn.execute("UPDATE personnel SET status='ON_STATION' WHERE id=?", (r[0],))
        conn.commit()
    row = _fetch_one("SELECT * FROM field_sorties WHERE id=?", (sortie_id,))
    if row:
        notify_gateway(row.get("station_id", "ST-BHARATI"), "field_sorties", sortie_id, "STATUS_CHANGE", row)
    return {"status": "ok", "id": sortie_id}

class EmergencyCreate(BaseModel):
    id: str | None = None
    station_id: str
    type: str = "SOS_MEDICAL"
    reported_by: str = "HQ_COMMAND"
    status: str = "ACTIVE"
    location_coord: str | None = None

@app.get("/emergencies")
def list_emergencies(station_id: str = None, active_only: bool = False):
    sql = "SELECT * FROM emergencies"
    params = []
    conditions = []
    if station_id:
        conditions.append("station_id=?")
        params.append(station_id)
    if active_only:
        conditions.append("status='ACTIVE'")
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY ts DESC"
    return _fetch_all(sql, tuple(params))

@app.post("/emergency/sos")
def trigger_sos(body: EmergencyCreate):
    conn = get_conn()
    now = utc_now()
    em_id = body.id or f"SOS-{uuid.uuid4().hex[:8]}"
    if USE_PG:
        with conn:
            with conn.cursor() as cur:
                cur.execute(q("INSERT INTO emergencies (id, station_id, type, reported_by, status, ts, location_coord) VALUES (?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status"), (em_id, body.station_id, body.type, body.reported_by, body.status, now, body.location_coord))
                cur.execute(q("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)"), (str(uuid.uuid4())[:8], body.reported_by, f"EMERGENCY_SOS_{body.type}", "emergencies", None, em_id, now))
    else:
        conn.execute("INSERT INTO emergencies (id, station_id, type, reported_by, status, ts, location_coord) VALUES (?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET status=excluded.status", (em_id, body.station_id, body.type, body.reported_by, body.status, now, body.location_coord))
        conn.execute("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)", (str(uuid.uuid4())[:8], body.reported_by, f"EMERGENCY_SOS_{body.type}", "emergencies", None, em_id, now))
        conn.commit()
    data = {"id": em_id, "station_id": body.station_id, "type": body.type, "reported_by": body.reported_by, "status": body.status, "ts": now, "location_coord": body.location_coord}
    notify_gateway(body.station_id, "emergencies", em_id, "STATUS_CHANGE", data)
    return {"status": "ok", "emergency": data}

@app.patch("/emergency/{emergency_id}")
def update_emergency(emergency_id: str, patch: dict):
    conn = get_conn()
    status = patch.get("status", "RESOLVED")
    if USE_PG:
        with conn:
            with conn.cursor() as cur:
                cur.execute(q("UPDATE emergencies SET status=? WHERE id=?"), (status, emergency_id))
    else:
        conn.execute("UPDATE emergencies SET status=? WHERE id=?", (status, emergency_id))
        conn.commit()
    row = _fetch_one("SELECT * FROM emergencies WHERE id=?", (emergency_id,))
    if row:
        notify_gateway(row.get("station_id", "ST-BHARATI"), "emergencies", emergency_id, "STATUS_CHANGE", row)
    return {"status": "ok", "id": emergency_id}

@app.get("/procurement/targets")
def list_procurement_targets():
    """List all procurement targets (DB-driven, Phase 1.1)."""
    return _fetch_all("SELECT sku, target_qty, cost_per_unit, unit, eta FROM procurement_targets ORDER BY sku")

class ProcurementTargetUpsert(BaseModel):
    sku: str
    target_qty: float
    cost_per_unit: float
    unit: str
    eta: str = "30d before freeze"

@app.put("/procurement/targets/{sku}")
async def upsert_procurement_target(sku: str, body: ProcurementTargetUpsert, user: dict = Depends(require_role("STATION_LEAD"))):
    if body.target_qty < 0 or body.cost_per_unit < 0:
        raise HTTPException(400, "target_qty and cost_per_unit must be >=0")
    conn = get_conn()
    try:
        if USE_PG:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(q("INSERT INTO procurement_targets (sku, target_qty, cost_per_unit, unit, eta) VALUES (?,?,?,?,?) ON CONFLICT (sku) DO UPDATE SET target_qty=EXCLUDED.target_qty, cost_per_unit=EXCLUDED.cost_per_unit, unit=EXCLUDED.unit, eta=EXCLUDED.eta"), (sku, body.target_qty, body.cost_per_unit, body.unit, body.eta))
        else:
            conn.execute("INSERT INTO procurement_targets (sku, target_qty, cost_per_unit, unit, eta) VALUES (?,?,?,?,?) ON CONFLICT(sku) DO UPDATE SET target_qty=excluded.target_qty, cost_per_unit=excluded.cost_per_unit, unit=excluded.unit, eta=excluded.eta", (sku, body.target_qty, body.cost_per_unit, body.unit, body.eta))
            conn.commit()
    finally:
        if USE_PG:
            try:
                from .db import release_conn as _release4
                _release4(conn)
            except Exception:
                pass
    return {"sku": sku, "target_qty": body.target_qty, "cost_per_unit": body.cost_per_unit, "unit": body.unit, "eta": body.eta}

@app.get("/procurement/{station_id}")
def procurement(station_id: str):
    """Compute procurement needs from current inventory levels vs DB targets (Phase 1.1)."""
    targets = {r["sku"]: r for r in _fetch_all("SELECT sku, target_qty, cost_per_unit, unit, eta FROM procurement_targets")}
    if not targets:
        return []
    skus = list(targets.keys())
    placeholders = ",".join(["?"] * len(skus))
    rows = _fetch_all(f"SELECT a.sku, a.name, a.qty, a.unit FROM assets a JOIN crates cr ON a.crate_id=cr.id JOIN containers c ON cr.container_id=c.id WHERE c.station_id=? AND a.sku IN ({placeholders})", (station_id, *skus))
    result = []
    for r in rows:
        t = targets.get(r["sku"])
        if not t:
            continue
        need = max(0, float(t["target_qty"]) - float(r["qty"]))
        result.append({"sku": r["sku"], "name": r["name"], "need": need, "unit": r["unit"], "eta": t["eta"], "cost": f"\u20b9{round(need*float(t['cost_per_unit'])/100000,1)}L"})
    return result

# --- Phase 2.1: Inventory bulk import scaffold (no NCPOR data needed; seed fallback stays if COUNT=0) ---
@app.get("/assets/bulk/template")
@app.get("/assets/template.csv")
def assets_bulk_template():
    """Return CSV header template for bulk import. Mirrors shared/seed.json asset shape."""
    from fastapi.responses import PlainTextResponse
    header = "sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode"
    example = "FUEL-DIESEL-001,Diesel (Winter Grade),FUEL_DIESEL,4200,L,,CRITICAL,C1-K1,FUEL-DIESEL-001"
    return PlainTextResponse(content=f"{header}\n{example}\n", media_type="text/csv", headers={"Content-Disposition": "attachment; filename=template_inventory.csv"})

class BulkAssetRow(BaseModel):
    sku: str
    name: str
    category: str
    qty: float
    unit: str
    expiry_date: str | None = None
    criticality: str = "LOW"
    crate_id: str
    barcode: str | None = None
    id: str | None = None

class BulkAssetRequest(BaseModel):
    rows: list[BulkAssetRow]

@app.post("/assets/bulk")
async def bulk_upsert_assets(body: BulkAssetRequest, user: dict = Depends(require_role("NCPOR_ADMIN"))):
    """Bulk CSV/JSON importer. Idempotent upsert on sku. Returns {inserted, updated}. Seed stays fallback iff COUNT=0."""
    if not body.rows:
        raise HTTPException(400, "rows empty")
    if len(body.rows) > 500:
        raise HTTPException(400, "max 500 rows per request")
    allowed_cat = {"FUEL_DIESEL","FUEL_KEROSENE","OXYGEN","FOOD","MEDICAL","SPARES_DG","SPARES_HVAC","SCIENTIFIC"}
    allowed_crit = {"CRITICAL","HIGH","LOW"}
    inserted = 0
    updated = 0
    conn = get_conn()
    now = utc_now()
    try:
        if USE_PG:
            with conn:
                with conn.cursor() as cur:
                    for r in body.rows:
                        if r.category not in allowed_cat:
                            raise HTTPException(400, f"invalid category {r.category} for {r.sku}")
                        if r.criticality not in allowed_crit:
                            raise HTTPException(400, f"invalid criticality {r.criticality} for {r.sku}")
                        if r.qty < 0:
                            raise HTTPException(400, f"qty must be >=0 for {r.sku}")
                        cur.execute(q("SELECT id FROM assets WHERE sku=?"), (r.sku,))
                        exists = cur.fetchone()
                        barcode = r.barcode or r.sku
                        aid = r.id or r.sku
                        if exists:
                            cur.execute(q("UPDATE assets SET name=?, category=?, qty=?, unit=?, expiry_date=?, criticality=?, crate_id=?, barcode=?, version=version+1, updated_at=? WHERE sku=?"), (r.name, r.category, r.qty, r.unit, r.expiry_date, r.criticality, r.crate_id, barcode, now, r.sku))
                            updated += 1
                        else:
                            cur.execute(q("INSERT INTO assets (id, sku, name, category, qty, unit, expiry_date, criticality, crate_id, barcode, version, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)"), (aid, r.sku, r.name, r.category, r.qty, r.unit, r.expiry_date, r.criticality, r.crate_id, barcode, now))
                            inserted += 1
                        # notify field tablets via gateway
                        try:
                            cr = _fetch_one("SELECT container_id FROM crates WHERE id=?", (r.crate_id,))
                            station_id = None
                            if cr and cr.get("container_id"):
                                c = _fetch_one("SELECT station_id FROM containers WHERE id=?", (cr["container_id"],))
                                station_id = c.get("station_id") if c else None
                            if station_id:
                                notify_gateway(station_id, "assets", aid, "UPSERT", {"id": aid, "sku": r.sku, "qty": r.qty, "crate_id": r.crate_id})
                        except Exception:
                            pass
        else:
            # SQLite
            for r in body.rows:
                if r.category not in allowed_cat:
                    raise HTTPException(400, f"invalid category {r.category} for {r.sku}")
                if r.criticality not in allowed_crit:
                    raise HTTPException(400, f"invalid criticality {r.criticality} for {r.sku}")
                if r.qty < 0:
                    raise HTTPException(400, f"qty must be >=0 for {r.sku}")
                cur = conn.execute("SELECT id FROM assets WHERE sku=?", (r.sku,))
                exists = cur.fetchone()
                barcode = r.barcode or r.sku
                aid = r.id or r.sku
                if exists:
                    conn.execute("UPDATE assets SET name=?, category=?, qty=?, unit=?, expiry_date=?, criticality=?, crate_id=?, barcode=?, version=version+1, updated_at=? WHERE sku=?", (r.name, r.category, r.qty, r.unit, r.expiry_date, r.criticality, r.crate_id, barcode, now, r.sku))
                    updated += 1
                else:
                    conn.execute("INSERT INTO assets (id, sku, name, category, qty, unit, expiry_date, criticality, crate_id, barcode, version, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)", (aid, r.sku, r.name, r.category, r.qty, r.unit, r.expiry_date, r.criticality, r.crate_id, barcode, now))
                    inserted += 1
                try:
                    cr = conn.execute("SELECT container_id FROM crates WHERE id=?", (r.crate_id,)).fetchone()
                    if cr and cr["container_id"]:
                        c = conn.execute("SELECT station_id FROM containers WHERE id=?", (cr["container_id"],)).fetchone()
                        station_id = c["station_id"] if c else None
                        if station_id:
                            notify_gateway(station_id, "assets", aid, "UPSERT", {"id": aid, "sku": r.sku, "qty": r.qty, "crate_id": r.crate_id})
                except Exception:
                    pass
            conn.commit()
    finally:
        if USE_PG:
            try:
                from .db import release_conn as _release5
                _release5(conn)
            except Exception:
                pass
    return {"inserted": inserted, "updated": updated}

@app.get("/sync/state/{device_id}")
def sync_state(device_id: str):
    row=_fetch_one("SELECT * FROM sync_state WHERE device_id=?", (device_id,))
    if not row: return {"device_id": device_id, "last_acked_ulid": None, "last_server_version": 0}
    return row

@app.post("/sync/ingest")
def ingest(frame: DeltaFrame, request: Request):
    if not check_rate_limit(f"ingest:{frame.device_id}", limit=600, window=60):
        logger.warning(f"rate limited {frame.device_id}")
        raise HTTPException(429, "rate limited: 600/min")
    # size guard: patch dict size approximation; wire budget already <2KB
    import json as _json
    try:
        patch_bytes_len = len(_json.dumps(frame.patch).encode())
    except Exception:
        patch_bytes_len = 0
    if patch_bytes_len > 2048:
        raise HTTPException(413, "patch too large >2KB")
    if len(frame.ulid) != 26:
        raise HTTPException(400, "ulid must be 26 chars")
    if frame.entity not in ["assets", "indents", "telemetry", "stations", "containers", "crates", "personnel", "field_sorties", "emergencies"]:
        raise HTTPException(400, f"unsupported entity {frame.entity}")
    # keep in sync with shared/src/schemas.ts deltaFrameSchema op enum + outbox CHECK
    if frame.op not in ["UPSERT", "DELETE", "CONSUME", "IN", "OUT", "ADJUST"]:
        raise HTTPException(400, f"unsupported op {frame.op}")
    ulid=frame.ulid
    now = utc_now()
    if USE_PG:
        import psycopg
        with psycopg.connect(os.getenv("DATABASE_URL"), autocommit=False) as c:
            with c.cursor() as cur:
                cur.execute(q("SELECT 1 FROM dedupe WHERE ulid=?"), (ulid,))
                if cur.fetchone():
                    cur.execute(q("SELECT last_server_version FROM sync_state WHERE device_id=?"), (frame.device_id,))
                    r=cur.fetchone()
                    ver=r[0] if r and r[0] is not None else 0
                    return {"status":"DEDUPED", "server_version": ver, "message":"duplicate ULID, already applied"}
                if frame.entity=="indents" and frame.op=="UPSERT":
                    p=frame.patch
                    indent_id=frame.entity_id
                    cur.execute(q("SELECT 1 FROM indents WHERE id=?"), (indent_id,))
                    exists=cur.fetchone()
                    if not exists and "station_id" in p:
                        cur.execute(q("INSERT INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at, vessel_imo) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING"), (indent_id, p.get("station_id"), p.get("asset_id"), p.get("qty_requested"), p.get("urgency","MEDIUM"), p.get("status","DRAFT"), p.get("created_by", frame.device_id), p.get("created_at", now), p.get("vessel_imo")))
                    elif exists:
                        if "vessel_imo" in p and "status" in p:
                            cur.execute(q("UPDATE indents SET status=?, vessel_imo=? WHERE id=?"), (p["status"], p["vessel_imo"], indent_id))
                        elif "vessel_imo" in p:
                            cur.execute(q("UPDATE indents SET vessel_imo=? WHERE id=?"), (p["vessel_imo"], indent_id))
                        elif "status" in p:
                            cur.execute(q("UPDATE indents SET status=? WHERE id=?"), (p["status"], indent_id))
                    cur.execute(q("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)"), (ulid, now))
                    cur.execute(q("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)"), (ulid, frame.device_id, f"SYNC_INDENT_{p.get('status','UPSERT')}", "indents", None, str(p), now))
                    cur.execute(q("SELECT last_server_version FROM sync_state WHERE device_id=?"), (frame.device_id,))
                    rv=cur.fetchone()
                    ver=rv[0] if rv and rv[0] is not None else 0
                    cur.execute(q("INSERT INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,?) ON CONFLICT (device_id) DO UPDATE SET last_acked_ulid=EXCLUDED.last_acked_ulid"), (frame.device_id, ulid, ver))
                    c.commit()
                    return {"status":"APPLIED", "server_version": ver}
                if frame.entity=="personnel" and frame.op=="UPSERT":
                    p=frame.patch
                    cur.execute(q("INSERT INTO personnel (id, station_id, name, role, blood_group, emergency_contact, status) VALUES (?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, name=COALESCE(EXCLUDED.name, personnel.name)"), (frame.entity_id, p.get("station_id","ST-BHARATI"), p.get("name","Expeditioner"), p.get("role","Field Op"), p.get("blood_group","O+"), p.get("emergency_contact",""), p.get("status","ON_STATION")))
                    cur.execute(q("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)"), (ulid, now))
                    cur.execute(q("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)"), (ulid, frame.device_id, f"SYNC_PERSONNEL_{p.get('status','UPDATE')}", "personnel", None, str(p), now))
                    cur.execute(q("INSERT INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,0) ON CONFLICT (device_id) DO UPDATE SET last_acked_ulid=EXCLUDED.last_acked_ulid"), (frame.device_id, ulid))
                    c.commit()
                    notify_gateway(p.get("station_id","ST-BHARATI"), "personnel", frame.entity_id, "STATUS_CHANGE", p)
                    return {"status":"APPLIED", "server_version": 0}
                if frame.entity=="field_sorties" and frame.op=="UPSERT":
                    p=frame.patch
                    cur.execute(q("INSERT INTO field_sorties (id, station_id, lead_personnel_id, destination, departure_time, expected_return_time, actual_return_time, safety_status) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET safety_status=EXCLUDED.safety_status, actual_return_time=EXCLUDED.actual_return_time"), (frame.entity_id, p.get("station_id","ST-BHARATI"), p.get("lead_personnel_id",""), p.get("destination","Field"), p.get("departure_time", now), p.get("expected_return_time",""), p.get("actual_return_time"), p.get("safety_status","ACTIVE")))
                    cur.execute(q("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)"), (ulid, now))
                    cur.execute(q("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)"), (ulid, frame.device_id, f"SYNC_SORTIE_{p.get('safety_status','ACTIVE')}", "field_sorties", None, str(p), now))
                    cur.execute(q("INSERT INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,0) ON CONFLICT (device_id) DO UPDATE SET last_acked_ulid=EXCLUDED.last_acked_ulid"), (frame.device_id, ulid))
                    c.commit()
                    notify_gateway(p.get("station_id","ST-BHARATI"), "field_sorties", frame.entity_id, "STATUS_CHANGE", p)
                    return {"status":"APPLIED", "server_version": 0}
                if frame.entity=="emergencies" and frame.op=="UPSERT":
                    p=frame.patch
                    cur.execute(q("INSERT INTO emergencies (id, station_id, type, reported_by, status, ts, location_coord) VALUES (?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status"), (frame.entity_id, p.get("station_id","ST-BHARATI"), p.get("type","SOS_MEDICAL"), p.get("reported_by", frame.device_id), p.get("status","ACTIVE"), p.get("ts", now), p.get("location_coord")))
                    cur.execute(q("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)"), (ulid, now))
                    cur.execute(q("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)"), (ulid, frame.device_id, f"SYNC_EMERGENCY_{p.get('type','SOS')}", "emergencies", None, str(p), now))
                    cur.execute(q("INSERT INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,0) ON CONFLICT (device_id) DO UPDATE SET last_acked_ulid=EXCLUDED.last_acked_ulid"), (frame.device_id, ulid))
                    c.commit()
                    notify_gateway(p.get("station_id","ST-BHARATI"), "emergencies", frame.entity_id, "STATUS_CHANGE", p)
                    return {"status":"APPLIED", "server_version": 0}
                cur.execute(q("SELECT qty, version, criticality FROM assets WHERE id=? FOR UPDATE"), (frame.entity_id,))
                row=cur.fetchone()
                if not row:
                    c.rollback()
                    raise HTTPException(404, f"asset {frame.entity_id} not found")
                qty, version, criticality = row
                if frame.entity=="assets" and frame.op=="UPSERT":
                    new_qty = frame.patch.get("qty", qty)
                    new_version = frame.patch.get("version", version+1)
                    if new_qty is not None and float(new_qty) < 0:
                        c.rollback()
                        return {"status":"CONFLICT_CRITICAL", "server_version": version, "message":"would go negative, rejected"}
                    # LWW+VC: fetch existing vector_clock
                    try:
                        cur.execute(q("SELECT vector_clock, updated_at FROM assets WHERE id=?"), (frame.entity_id,))
                        vc_row = cur.fetchone()
                        existing_vc = {}
                        existing_ts = ""
                        if vc_row:
                            # handle tuple vs dict
                            if isinstance(vc_row, tuple):
                                existing_vc = {}
                                try:
                                    import json as _j; existing_vc = _j.loads(vc_row[0] or "{}") if vc_row[0] else {}
                                except: existing_vc = {}
                                existing_ts = vc_row[1] or ""
                            else:
                                try:
                                    import json as _j; existing_vc = _j.loads(vc_row[0] or "{}") if len(vc_row)>0 and vc_row[0] else {}
                                except: existing_vc = {}
                        remote_vc = frame.vector_clock or {}
                        from .dtn import compare_vc, merge_vc
                        cmp = compare_vc(existing_vc, remote_vc)
                        if cmp == "gt":
                            c.rollback()
                            return {"status":"APPLIED_LOCAL_WINS", "server_version": version, "reason":"vc_local_newer"}
                        if cmp == "concurrent":
                            patch_ts = frame.patch.get("updated_at") or frame.ts
                            if patch_ts and existing_ts and patch_ts <= existing_ts:
                                c.rollback()
                                return {"status":"APPLIED_LOCAL_WINS", "server_version": version, "reason":"lww_local_newer"}
                        merged_vc = merge_vc(existing_vc, remote_vc) if remote_vc else existing_vc
                        import json as _j2; merged_s = _j2.dumps(merged_vc)
                    except Exception:
                        merged_s = None
                    if merged_s:
                        cur.execute(q("UPDATE assets SET qty=?, version=?, updated_at=?, vector_clock=? WHERE id=?"), (new_qty, new_version, now, merged_s, frame.entity_id))
                    else:
                        cur.execute(q("UPDATE assets SET qty=?, version=?, updated_at=? WHERE id=?"), (new_qty, new_version, now, frame.entity_id))
                    cur.execute(q("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)"), (ulid, now))
                    cur.execute(q("INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)"), (ulid, frame.device_id, f"SYNC_{frame.op}", frame.entity, str({"qty":qty,"version":version}), str(frame.patch), now))
                    cur.execute(q("INSERT INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,?) ON CONFLICT (device_id) DO UPDATE SET last_acked_ulid=EXCLUDED.last_acked_ulid, last_server_version=EXCLUDED.last_server_version"), (frame.device_id, ulid, new_version))
                else:
                    cur.execute(q("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)"), (ulid, now))
                    cur.execute(q("INSERT INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,?) ON CONFLICT (device_id) DO UPDATE SET last_acked_ulid=EXCLUDED.last_acked_ulid"), (frame.device_id, ulid, version))
                c.commit()
                return {"status":"APPLIED", "server_version": frame.patch.get("version", version+1) if frame.entity=="assets" else version}
    else:
        conn=get_conn()
        conn.execute("BEGIN IMMEDIATE")
        try:
            cur=conn.execute("SELECT 1 FROM dedupe WHERE ulid=?", (ulid,))
            if cur.fetchone():
                cur2=conn.execute("SELECT last_server_version FROM sync_state WHERE device_id=?", (frame.device_id,))
                r=cur2.fetchone()
                ver=r[0] if r and r[0] is not None else 0
                conn.execute("ROLLBACK")
                return {"status":"DEDUPED", "server_version": ver, "message":"duplicate ULID"}
            if frame.entity=="indents" and frame.op=="UPSERT":
                p=frame.patch
                indent_id=frame.entity_id
                cur2=conn.execute("SELECT 1 FROM indents WHERE id=?", (indent_id,))
                exists=cur2.fetchone()
                if not exists and "station_id" in p:
                    conn.execute("INSERT OR IGNORE INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at, vessel_imo) VALUES (?,?,?,?,?,?,?,?,?)", (indent_id, p.get("station_id"), p.get("asset_id"), p.get("qty_requested"), p.get("urgency","MEDIUM"), p.get("status","DRAFT"), p.get("created_by", frame.device_id), p.get("created_at", now), p.get("vessel_imo")))
                elif exists:
                    if "vessel_imo" in p and "status" in p:
                        conn.execute("UPDATE indents SET status=?, vessel_imo=? WHERE id=?", (p["status"], p["vessel_imo"], indent_id))
                    elif "vessel_imo" in p:
                        conn.execute("UPDATE indents SET vessel_imo=? WHERE id=?", (p["vessel_imo"], indent_id))
                    elif "status" in p:
                        conn.execute("UPDATE indents SET status=? WHERE id=?", (p["status"], indent_id))
                conn.execute("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)", (ulid, now))
                conn.execute("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)", (ulid, frame.device_id, f"SYNC_INDENT_{p.get('status','UPSERT')}", "indents", None, str(p), now))
                conn.execute("INSERT OR IGNORE INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,?)", (frame.device_id, ulid, 0))
                conn.execute("UPDATE sync_state SET last_acked_ulid=? WHERE device_id=?", (ulid, frame.device_id))
                conn.execute("COMMIT")
                return {"status":"APPLIED", "server_version": 0}
            if frame.entity=="personnel" and frame.op=="UPSERT":
                p=frame.patch
                conn.execute("INSERT INTO personnel (id, station_id, name, role, blood_group, emergency_contact, status) VALUES (?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET status=excluded.status, name=coalesce(excluded.name, personnel.name)", (frame.entity_id, p.get("station_id","ST-BHARATI"), p.get("name","Expeditioner"), p.get("role","Field Op"), p.get("blood_group","O+"), p.get("emergency_contact",""), p.get("status","ON_STATION")))
                conn.execute("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)", (ulid, now))
                conn.execute("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)", (ulid, frame.device_id, f"SYNC_PERSONNEL_{p.get('status','UPDATE')}", "personnel", None, str(p), now))
                conn.execute("INSERT OR IGNORE INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,?)", (frame.device_id, ulid, 0))
                conn.execute("UPDATE sync_state SET last_acked_ulid=? WHERE device_id=?", (ulid, frame.device_id))
                conn.execute("COMMIT")
                notify_gateway(p.get("station_id","ST-BHARATI"), "personnel", frame.entity_id, "STATUS_CHANGE", p)
                return {"status":"APPLIED", "server_version": 0}
            if frame.entity=="field_sorties" and frame.op=="UPSERT":
                p=frame.patch
                conn.execute("INSERT INTO field_sorties (id, station_id, lead_personnel_id, destination, departure_time, expected_return_time, actual_return_time, safety_status) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET safety_status=excluded.safety_status, actual_return_time=excluded.actual_return_time", (frame.entity_id, p.get("station_id","ST-BHARATI"), p.get("lead_personnel_id",""), p.get("destination","Field"), p.get("departure_time", now), p.get("expected_return_time",""), p.get("actual_return_time"), p.get("safety_status","ACTIVE")))
                conn.execute("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)", (ulid, now))
                conn.execute("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)", (ulid, frame.device_id, f"SYNC_SORTIE_{p.get('safety_status','ACTIVE')}", "field_sorties", None, str(p), now))
                conn.execute("INSERT OR IGNORE INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,?)", (frame.device_id, ulid, 0))
                conn.execute("UPDATE sync_state SET last_acked_ulid=? WHERE device_id=?", (ulid, frame.device_id))
                conn.execute("COMMIT")
                notify_gateway(p.get("station_id","ST-BHARATI"), "field_sorties", frame.entity_id, "STATUS_CHANGE", p)
                return {"status":"APPLIED", "server_version": 0}
            if frame.entity=="emergencies" and frame.op=="UPSERT":
                p=frame.patch
                conn.execute("INSERT INTO emergencies (id, station_id, type, reported_by, status, ts, location_coord) VALUES (?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET status=excluded.status", (frame.entity_id, p.get("station_id","ST-BHARATI"), p.get("type","SOS_MEDICAL"), p.get("reported_by", frame.device_id), p.get("status","ACTIVE"), p.get("ts", now), p.get("location_coord")))
                conn.execute("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)", (ulid, now))
                conn.execute("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)", (ulid, frame.device_id, f"SYNC_EMERGENCY_{p.get('type','SOS')}", "emergencies", None, str(p), now))
                conn.execute("INSERT OR IGNORE INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,?)", (frame.device_id, ulid, 0))
                conn.execute("UPDATE sync_state SET last_acked_ulid=? WHERE device_id=?", (ulid, frame.device_id))
                conn.execute("COMMIT")
                notify_gateway(p.get("station_id","ST-BHARATI"), "emergencies", frame.entity_id, "STATUS_CHANGE", p)
                return {"status":"APPLIED", "server_version": 0}
            cur=conn.execute("SELECT qty, version, criticality FROM assets WHERE id=?", (frame.entity_id,))
            row=cur.fetchone()
            if not row:
                conn.execute("ROLLBACK")
                raise HTTPException(404, f"asset {frame.entity_id} not found")
            qty, version, criticality = row["qty"], row["version"], row["criticality"]
            if frame.entity=="assets" and frame.op=="UPSERT":
                new_qty = frame.patch.get("qty", qty)
                new_version = frame.patch.get("version", (version or 1)+1)
                if new_qty is not None and float(new_qty) < 0:
                    conn.execute("ROLLBACK")
                    return {"status":"CONFLICT_CRITICAL", "server_version": version, "message":"would go negative"}
                # LWW+VC
                try:
                    vc_row = conn.execute("SELECT vector_clock, updated_at FROM assets WHERE id=?", (frame.entity_id,)).fetchone()
                    existing_vc = {}
                    existing_ts = ""
                    if vc_row and vc_row["vector_clock"]:
                        import json as _j; existing_vc = _j.loads(vc_row["vector_clock"])
                        existing_ts = vc_row["updated_at"] or ""
                    remote_vc = frame.vector_clock or {}
                    from .dtn import compare_vc, merge_vc
                    cmp = compare_vc(existing_vc, remote_vc)
                    if cmp == "gt":
                        conn.execute("ROLLBACK")
                        return {"status":"APPLIED_LOCAL_WINS", "server_version": version, "reason":"vc_local_newer"}
                    if cmp == "concurrent":
                        patch_ts = frame.patch.get("updated_at") or frame.ts
                        if patch_ts and existing_ts and patch_ts <= existing_ts:
                            conn.execute("ROLLBACK")
                            return {"status":"APPLIED_LOCAL_WINS", "server_version": version, "reason":"lww_local_newer"}
                    # BUGFIX: always persist merged VC (was None when remote_vc empty → SQLite skipped update, PG always merged)
                    import json as _j2
                    merged_vc2 = merge_vc(existing_vc, remote_vc) if remote_vc else existing_vc
                    merged_s = _j2.dumps(merged_vc2) if merged_vc2 else None
                except Exception:
                    merged_s = None
                if merged_s:
                    conn.execute("UPDATE assets SET qty=?, version=?, updated_at=?, vector_clock=? WHERE id=?", (new_qty, new_version, now, merged_s, frame.entity_id))
                else:
                    conn.execute("UPDATE assets SET qty=?, version=?, updated_at=? WHERE id=?", (new_qty, new_version, now, frame.entity_id))
                conn.execute("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)", (ulid, now))
                conn.execute("INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)", (ulid, frame.device_id, f"SYNC_{frame.op}", frame.entity, str({"qty":qty,"version":version}), str(frame.patch), now))
                conn.execute("INSERT INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,?) ON CONFLICT(device_id) DO UPDATE SET last_acked_ulid=excluded.last_acked_ulid, last_server_version=excluded.last_server_version", (frame.device_id, ulid, new_version))
            else:
                conn.execute("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)", (ulid, now))
                conn.execute("INSERT OR IGNORE INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,?)", (frame.device_id, ulid, version or 0))
            conn.execute("COMMIT")
            return {"status":"APPLIED", "server_version": frame.patch.get("version", (version or 1)+1) if frame.entity=="assets" else version}
        except HTTPException:
            raise
        except Exception as e:
            try: conn.execute("ROLLBACK")
            except Exception: pass
            raise HTTPException(500, str(e))

# --- DTN Bundle Endpoints (Phase 1) ---
class BundleIn(BaseModel):
    bundleId: str | None = None
    bundle_id: str | None = None
    src: str = "unknown"
    dstStation: str | None = None
    dst_station: str | None = None
    ttlSec: int | None = None
    createdAt: str | None = None
    created_at: str | None = None
    vectorClock: Dict[str, Any] | None = None
    vc: Dict[str, Any] | None = None
    payload: Dict[str, Any] = {}
    custody: bool | None = True

class BulkIn(BaseModel):
    bundles: list[Dict[str, Any]]

@app.post("/dtn/ingest_bulk")
def dtn_ingest_bulk(body: BulkIn):
    results = []
    if USE_PG:
        import psycopg
        with psycopg.connect(os.getenv("DATABASE_URL"), autocommit=False) as c:
            with c.cursor() as cur:
                from .dtn import ingest_bundle
                for b in body.bundles:
                    # normalize
                    nb = {
                        "bundleId": b.get("bundleId") or b.get("bundle_id") or b.get("ulid"),
                        "src": b.get("src") or b.get("device_id") or "mule",
                        "dstStation": b.get("dstStation") or b.get("dst_station") or "ST-BHARATI",
                        "vectorClock": b.get("vectorClock") or b.get("vc") or b.get("vector_clock") or {},
                        "payload": b.get("payload") or b,
                        "createdAt": b.get("createdAt") or b.get("created_at"),
                        "ttlSec": b.get("ttlSec", b.get("ttl", 86400)),
                        "custody": b.get("custody", True),
                    }
                    r = ingest_bundle(nb, cur)
                    results.append(r)
                c.commit()
    else:
        conn = get_conn()
        conn.execute("BEGIN IMMEDIATE")
        try:
            from .dtn import ingest_bundle
            for b in body.bundles:
                nb = {
                    "bundleId": b.get("bundleId") or b.get("bundle_id") or b.get("ulid"),
                    "src": b.get("src") or b.get("device_id") or "mule",
                    "dstStation": b.get("dstStation") or b.get("dst_station") or "ST-BHARATI",
                    "vectorClock": b.get("vectorClock") or b.get("vc") or b.get("vector_clock") or {},
                    "payload": b.get("payload") or b,
                    "createdAt": b.get("createdAt") or b.get("created_at"),
                    "ttlSec": b.get("ttlSec", b.get("ttl", 86400)),
                    "custody": b.get("custody", True),
                }
                # need cursor-like; pass conn
                r = ingest_bundle(nb, conn)
                results.append(r)
            conn.execute("COMMIT")
        except Exception as e:
            try: conn.execute("ROLLBACK")
            except: pass
            raise HTTPException(500, str(e))
    return {"results": results, "count": len(results)}

@app.get("/dtn/bundles")
def dtn_list_bundles(dst_station: str | None = None, limit: int = 50):
    limit = max(1, min(limit, 200))
    if dst_station:
        return _fetch_all("SELECT bundle_id, src, dst_station, vc, custody, created_at, ttl FROM dtn_bundles WHERE dst_station=? ORDER BY created_at DESC LIMIT ?", (dst_station, limit))
    return _fetch_all("SELECT bundle_id, src, dst_station, vc, custody, created_at, ttl FROM dtn_bundles ORDER BY created_at DESC LIMIT ?", (limit,))

@app.get("/dtn/conflicts")
def dtn_conflicts(limit: int = 20):
    # recent deduped/local-wins as conflicts proxy
    return _fetch_all("SELECT * FROM audit_log WHERE action LIKE 'SYNC_%' ORDER BY ts DESC LIMIT ?", (limit,))

@app.post("/dtn/exchange")
async def dtn_exchange(request: Request):
    body = await request.json()
    bundles = body.get("bundles") or body.get("bundle") or []
    if isinstance(bundles, dict): bundles = [bundles]
    results = []
    if USE_PG:
        import psycopg
        with psycopg.connect(os.getenv("DATABASE_URL"), autocommit=False) as c:
            with c.cursor() as cur:
                from .dtn import ingest_bundle
                for b in bundles:
                    nb = {
                        "bundleId": b.get("bundleId") or b.get("bundle_id"),
                        "src": b.get("src") or "mule",
                        "dstStation": b.get("dstStation") or b.get("dst_station") or "ST-BHARATI",
                        "vectorClock": b.get("vectorClock") or b.get("vc") or {},
                        "payload": b.get("payload") or b,
                        "createdAt": b.get("createdAt") or b.get("created_at"),
                        "ttlSec": b.get("ttlSec", b.get("ttl", 86400)),
                        "custody": b.get("custody", True),
                    }
                    results.append(ingest_bundle(nb, cur))
                c.commit()
    else:
        conn = get_conn()
        conn.execute("BEGIN")
        try:
            from .dtn import ingest_bundle
            for b in bundles:
                nb = {
                    "bundleId": b.get("bundleId") or b.get("bundle_id"),
                    "src": b.get("src") or "mule",
                    "dstStation": b.get("dstStation") or b.get("dst_station") or "ST-BHARATI",
                    "vectorClock": b.get("vectorClock") or b.get("vc") or {},
                    "payload": b.get("payload") or b,
                    "createdAt": b.get("createdAt") or b.get("created_at"),
                    "ttlSec": b.get("ttlSec", b.get("ttl", 86400)),
                    "custody": b.get("custody", True),
                }
                results.append(ingest_bundle(nb, conn))
            conn.execute("COMMIT")
        except Exception as e:
            try: conn.execute("ROLLBACK")
            except: pass
            raise HTTPException(500, str(e))
    return {"results": results}

# --- Tracking endpoints (Phase 3) ---
@app.post("/tracking/update")
def tracking_update(body: Dict[str, Any]):
    asset_id = body.get("asset_id") or body.get("assetId")
    if not asset_id: raise HTTPException(400, "asset_id required")
    x = body.get("x", 0); y = body.get("y", 0); theta = body.get("theta", 0); conf = body.get("conf", 0.75)
    station_id = body.get("station_id") or body.get("stationId") or "ST-BHARATI"
    now = utc_now()
    if USE_PG:
        import psycopg
        with psycopg.connect(os.getenv("DATABASE_URL"), autocommit=True) as c:
            with c.cursor() as cur:
                cur.execute("INSERT INTO asset_positions (asset_id, x, y, theta, conf, last_sensor_ts, station_id) VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (asset_id) DO UPDATE SET x=EXCLUDED.x, y=EXCLUDED.y, theta=EXCLUDED.theta, conf=EXCLUDED.conf, last_sensor_ts=EXCLUDED.last_sensor_ts, station_id=EXCLUDED.station_id", (asset_id, x, y, theta, conf, now, station_id))
    else:
        conn = get_conn()
        conn.execute("INSERT INTO asset_positions (asset_id, x, y, theta, conf, last_sensor_ts, station_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET x=excluded.x, y=excluded.y, theta=excluded.theta, conf=excluded.conf, last_sensor_ts=excluded.last_sensor_ts, station_id=excluded.station_id", (asset_id, x, y, theta, conf, now, station_id))
        conn.commit()
    return {"asset_id": asset_id, "x": x, "y": y, "conf": conf}

@app.get("/tracking/positions")
def tracking_positions(station_id: str | None = None):
    if station_id:
        return _fetch_all("SELECT ap.*, a.sku, a.name FROM asset_positions ap LEFT JOIN assets a ON a.id=ap.asset_id WHERE ap.station_id=? ORDER BY ap.last_sensor_ts DESC", (station_id,))
    return _fetch_all("SELECT ap.*, a.sku, a.name FROM asset_positions ap LEFT JOIN assets a ON a.id=ap.asset_id ORDER BY ap.last_sensor_ts DESC")

# --- SNN forecast endpoint (Phase 2) ---
@app.get("/forecast/snn/{station_id}")
def forecast_snn(station_id: str, asset_sku: str = "FUEL-DIESEL-001"):
    try:
        from .snn_forecast import predict_snn_total
        tele = _fetch_one("SELECT temp_outside, wind_speed, pressure, dg_load FROM telemetry WHERE station_id=? ORDER BY ts DESC LIMIT 1", (station_id,))
        qty_row = _fetch_one("SELECT a.qty FROM assets a JOIN crates cr ON a.crate_id=cr.id JOIN containers c ON cr.container_id=c.id WHERE c.station_id=? AND a.sku=? LIMIT 1", (station_id, asset_sku))
        cr = _fetch_one("SELECT winter_crew_count FROM stations WHERE id=?", (station_id,))
        if not qty_row: raise HTTPException(404, "asset")
        qty = qty_row["qty"]; crew = cr["winter_crew_count"] if cr else 24
        if not tele: tele = {"temp_outside": -15, "wind_speed": 5, "pressure": 1013, "dg_load": 0.7}
        phys, snn_res, total, active, spike_count = predict_snn_total(tele["temp_outside"], tele["wind_speed"], tele["pressure"], crew, tele["dg_load"], station_id)
        from .snn_forecast import _SNN_MODEL, snn_energy_stats
        saved_pct, saved_src = snn_energy_stats(spike_count, active)
        days = qty/total if total>0 else 999
        return {"station_id": station_id, "asset_sku": asset_sku, "qty": qty, "physics": round(phys,1), "snn_residual": round(snn_res,2), "total_per_day": round(total,1), "days_to_stockout": round(days,1), "ci": [round(days*0.85), round(days*1.15)], "ci_source": "placeholder_15pct", "snn_active": active, "spike_count": spike_count, "tele": tele, "saved_pct": saved_pct, "saved_pct_source": saved_src, "model": _SNN_MODEL}
    except ImportError as e:
        raise HTTPException(501, f"snn not available: {e}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
