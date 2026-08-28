from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import Any, Dict
import os, datetime, logging, time, uuid, asyncio, json as _json
from contextlib import asynccontextmanager

from .db import init_db, get_conn, USE_PG
from .forecast import load_forecast_model, physics_pred, predict_total
from .config import DEMO_FORECAST, ALLOWED, SECRET_KEY, TOKEN_EXPIRY_DAYS, STATION_PINS
from .mqtt_client import init_mqtt, publish_telemetry as mqtt_publish, shutdown_mqtt
from .auth import sign_jwt, get_current_user, require_role

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("polaris.hq")

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")
# sanitize wildcard in prod – if PSK is set, restrict to known origins
if os.getenv("DATABASE_URL") and ALLOWED_ORIGINS == ["*"]:
    logger.warning("CORS allow * in production – set ALLOWED_ORIGINS")

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

def notify_gateway(station_id: str, entity: str, entity_id: str, op: str, patch: dict):
    """Notify Sync Gateway to broadcast a downstream delta frame to active station tablets."""
    import urllib.request, json
    try:
        url = f"{GATEWAY_INTERNAL_URL}/internal/broadcast_delta"
        data = json.dumps({
            "station_id": station_id,
            "entity": entity,
            "entity_id": entity_id,
            "op": op,
            "patch": patch
        }).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            pass
    except Exception as e:
        logger.debug(f"Gateway downstream notification ignored: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try: load_forecast_model()
    except Exception as e: print("[hq forecast] model fallback", e)

    def _on_mqtt_telemetry(tele):
        """Handle incoming MQTT telemetry — insert into DB and run escalation."""
        try:
            conn = get_conn()
            if USE_PG:
                with conn:
                    with conn.cursor() as cur:
                        cur.execute(q("INSERT INTO telemetry VALUES (?,?,?,?,?,?)"), (
                            tele.get("ts", datetime.datetime.now(datetime.timezone.utc).isoformat()),
                            tele.get("station_id", "ST-BHARATI"),
                            tele.get("temp_outside", 0), tele.get("wind_speed", 0),
                            tele.get("pressure", 1013), tele.get("dg_load", 0.7),
                        ))
            else:
                conn.execute("INSERT INTO telemetry VALUES (?,?,?,?,?,?)", (
                    tele.get("ts", datetime.datetime.now(datetime.timezone.utc).isoformat()),
                    tele.get("station_id", "ST-BHARATI"),
                    tele.get("temp_outside", 0), tele.get("wind_speed", 0),
                    tele.get("pressure", 1013), tele.get("dg_load", 0.7),
                ))
                conn.commit()
            try:
                station_id = tele.get("station_id", "ST-BHARATI")
                class _TeleObj:
                    pass
                t = _TeleObj()
                t.temp_outside = tele.get("temp_outside", 0)
                t.wind_speed = tele.get("wind_speed", 0)
                t.pressure = tele.get("pressure", 1013)
                t.dg_load = tele.get("dg_load", 0.7)
                t.acoustic_anomaly = tele.get("acoustic_anomaly", 0.0)
                check_and_escalate(station_id, t)
            except Exception as e:
                logger.warning(f"[mqtt] escalation error: {e}")
            try:
                loop = asyncio.get_event_loop()
                loop.call_soon_threadsafe(asyncio.ensure_future, _broadcast_telemetry(tele))
            except Exception:
                pass
        except Exception as e:
            logger.warning(f"[mqtt] telemetry insert error: {e}")

    init_mqtt(_on_mqtt_telemetry)
    yield
    shutdown_mqtt()

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

@app.get("/health")
def health():
    # datetime.UTC is 3.11+, fallback to timezone.utc
    try:
        utc = datetime.UTC
    except AttributeError:
        utc = datetime.timezone.utc
    return {"status":"ok", "db": "postgres" if USE_PG else "sqlite-fallback", "ts": datetime.datetime.now(utc).isoformat()}

class LoginRequest(BaseModel):
    device_id: str
    pin: str
    station_id: str

@app.post("/auth/login")
async def auth_login(body: LoginRequest):
    expected_pin = STATION_PINS.get(body.station_id)
    if not expected_pin or body.pin != expected_pin:
        raise HTTPException(401, "invalid station or pin")
    role = "FIELD_OP"
    token = await sign_jwt({"sub": body.device_id, "role": role, "station_id": body.station_id, "device_id": body.device_id}, SECRET_KEY, TOKEN_EXPIRY_DAYS)
    return {"token": token, "role": role, "station_id": body.station_id, "device_id": body.device_id}

@app.get("/rbac/me")
async def rbac_me(request: Request):
    user = await get_current_user(request)
    if user:
        return {"role": user["role"], "station_id": user["station_id"], "device_id": user["device_id"], "permissions": ["CONSUME", "IN", "READ"]}
    return {"role": "FIELD_OP", "station_id": "ST-BHARATI", "device_id": "BHARATI-TABLET-01", "permissions": ["CONSUME", "IN", "READ"]}

@app.get("/assets")
def list_assets():
    return _fetch_all("SELECT id, sku, name, category, qty, unit, expiry_date, criticality, crate_id, barcode, version, updated_at FROM assets ORDER BY sku")

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
    try:
        utc = datetime.UTC
    except AttributeError:
        utc = datetime.timezone.utc
    now=datetime.datetime.now(utc).isoformat()
    try:
        from ulid import ULID
        iid=str(ULID())
    except Exception:
        iid=str(uuid.uuid4())[:8]+"-"+body.asset_id
    if USE_PG:
        with conn:
            with conn.cursor() as cur:
                cur.execute(q("INSERT INTO indents VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING"), (iid, body.station_id, body.asset_id, body.qty_requested, body.urgency, body.status, body.created_by, now))
                cur.execute(q("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)"), (iid, body.created_by, "INDENT_CREATE_HQ", "indents", None, str(body.model_dump()), now))
    else:
        conn.execute("INSERT OR IGNORE INTO indents VALUES (?,?,?,?,?,?,?,?)", (iid, body.station_id, body.asset_id, body.qty_requested, body.urgency, body.status, body.created_by, now))
        conn.execute("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)", (iid, body.created_by, "INDENT_CREATE_HQ", "indents", None, str(body.model_dump()), now))
        conn.commit()
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

@app.patch("/indents/{indent_id}")
async def patch_indent(indent_id: str, body: IndentPatch, user: dict = Depends(require_role("STATION_LEAD"))):
    conn=get_conn()
    try:
        utc = datetime.UTC
    except AttributeError:
        utc = datetime.timezone.utc
    now=datetime.datetime.now(utc).isoformat()
    row=_fetch_one("SELECT id, station_id, asset_id, status FROM indents WHERE id=?", (indent_id,))
    if not row: raise HTTPException(404, "indent not found")
    cur_status=row["status"]
    station_id=row.get("station_id") or "ST-BHARATI"
    allowed = ALLOWED.get(cur_status, [])
    # allow DRAFT->RECEIVED for offline field demo (tolerant), otherwise enforce state machine
    is_offline_shortcut = (cur_status == "DRAFT" and body.status == "RECEIVED")
    if body.status not in allowed and not is_offline_shortcut:
        raise HTTPException(400, f"invalid transition {cur_status}->{body.status}")
    if USE_PG:
        with conn:
            with conn.cursor() as cur:
                cur.execute(q("UPDATE indents SET status=? WHERE id=?"), (body.status, indent_id))
                cur.execute(q("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)"), (indent_id+body.status, body.actor_id, f"INDENT_{body.status}", "indents", str({"status":cur_status}), str({"status":body.status}), now))
    else:
        # relaxed for M2 demo: allow any forward in SQLite fallback
        conn.execute("UPDATE indents SET status=? WHERE id=?", (body.status, indent_id))
        conn.execute("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)", (indent_id+body.status, body.actor_id, f"INDENT_{body.status}", "indents", str({"status":cur_status}), str({"status":body.status}), now))
        conn.commit()
    notify_gateway(station_id, "indents", indent_id, "STATUS_CHANGE", {
        "id": indent_id,
        "status": body.status,
        "updated_at": now
    })
    return {"id": indent_id, "old": cur_status, "new": body.status}


@app.get("/stations/overview")
def stations_overview():
    conn=get_conn()
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
            phys,res,total,used=predict_total(t["temp_outside"], t["wind_speed"], t["pressure"], crew, t["dg_load"])
            s["days_to_stockout"]=round(diesel["qty"]/total,1) if total>0 else 999
            s["forecast_ci"]=[round(s["days_to_stockout"]*0.85), round(s["days_to_stockout"]*1.15)]
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
    mqtt_publish(t.model_dump())
    await _broadcast_telemetry(t.model_dump())
    return {"ok": True}

@app.get("/telemetry/latest")
def latest_telemetry(station_id: str = "ST-BHARATI"):
    return _fetch_one("SELECT * FROM telemetry WHERE station_id=? ORDER BY ts DESC LIMIT 1", (station_id,)) or {}

@app.get("/telemetry/history")
def history_telemetry(station_id: str = "ST-BHARATI", days: int = 30):
    # Phase 3: TimescaleDB trend history endpoint
    return _fetch_all("SELECT date(ts) as day, AVG(temp_outside) as avg_temp, AVG(dg_load) as avg_load FROM telemetry WHERE station_id=? GROUP BY date(ts) ORDER BY day DESC LIMIT ?", (station_id, days))

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

def check_and_escalate(station_id: str, tele):
    conn=get_conn()
    row=_fetch_one("SELECT id, qty FROM assets WHERE sku='FUEL-DIESEL-001' LIMIT 1")
    if not row: return
    asset_id, qty=row["id"], row["qty"]
    cr=_fetch_one("SELECT winter_crew_count FROM stations WHERE id=?", (station_id,))
    crew=cr["winter_crew_count"] if cr else 24
    phys,res,total,used=predict_total(tele.temp_outside, tele.wind_speed, tele.pressure, crew, tele.dg_load)
    days=qty/total if total>0 else 999
    if days <= 20:
        exists=_fetch_one("SELECT 1 as c FROM indents WHERE asset_id=? AND station_id=? AND status IN ('DRAFT','APPROVED','DISPATCHED')", (asset_id, station_id))
        if not exists:
            try:
                from ulid import ULID
                iid=str(ULID())
            except Exception:
                iid=str(uuid.uuid4())[:8]+"-auto"
            try:
                utc = datetime.UTC
            except AttributeError:
                utc = datetime.timezone.utc
            now=datetime.datetime.now(utc).isoformat()
            if USE_PG:
                with conn:
                    with conn.cursor() as cur:
                        cur.execute(q("INSERT INTO indents VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING"), (iid, station_id, asset_id, 500, "CRITICAL", "DRAFT", "FORECAST_AUTO", now))
                        cur.execute(q("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)"), (iid, "FORECAST_AUTO", "INDENT_AUTO_CRITICAL", "indents", None, f"forecast {days:.1f}d", now))
            else:
                conn.execute("INSERT OR IGNORE INTO indents VALUES (?,?,?,?,?,?,?,?)", (iid, station_id, asset_id, 500, "CRITICAL", "DRAFT", "FORECAST_AUTO", now))
                conn.execute("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)", (iid, "FORECAST_AUTO", "INDENT_AUTO_CRITICAL", "indents", None, f"forecast {days:.1f}d", now))
                conn.commit()
            notify_gateway(station_id, "indents", iid, "UPSERT", {
                "id": iid,
                "station_id": station_id,
                "asset_id": asset_id,
                "qty_requested": 500,
                "urgency": "CRITICAL",
                "status": "DRAFT",
                "created_by": "FORECAST_AUTO",
                "created_at": now
            })

    # Phase 4: Acoustic Prognostics Escalation
    if getattr(tele, 'acoustic_anomaly', 0.0) > 0.90:
        row = _fetch_one("SELECT id FROM assets WHERE sku='SPARE-BRG-6205-007' LIMIT 1")
        if row:
            brg_id = row["id"]
            exists = _fetch_one("SELECT 1 as c FROM indents WHERE asset_id=? AND station_id=? AND status IN ('DRAFT','APPROVED','DISPATCHED')", (brg_id, station_id))
            if not exists:
                try:
                    from ulid import ULID
                    iid = str(ULID())
                except Exception:
                    iid = str(uuid.uuid4())[:8]+"-ac"
                if USE_PG:
                    with conn:
                        with conn.cursor() as cur:
                            cur.execute(q("INSERT INTO indents VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING"), (iid, station_id, brg_id, 4, "CRITICAL", "DRAFT", "ACOUSTIC_AI", now))
                            cur.execute(q("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)"), (iid, "ACOUSTIC_AI", "INDENT_ACOUSTIC_CRITICAL", "indents", None, "bearing whine > 90%", now))
                else:
                    conn.execute("INSERT OR IGNORE INTO indents VALUES (?,?,?,?,?,?,?,?)", (iid, station_id, brg_id, 4, "CRITICAL", "DRAFT", "ACOUSTIC_AI", now))
                    conn.execute("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)", (iid, "ACOUSTIC_AI", "INDENT_ACOUSTIC_CRITICAL", "indents", None, "bearing whine > 90%", now))
                    conn.commit()
                notify_gateway(station_id, "indents", iid, "UPSERT", {
                    "id": iid,
                    "station_id": station_id,
                    "asset_id": brg_id,
                    "qty_requested": 4,
                    "urgency": "CRITICAL",
                    "status": "DRAFT",
                    "created_by": "ACOUSTIC_AI",
                    "created_at": now
                })


@app.get("/forecast/{station_id}")
def forecast(station_id: str, asset_sku: str = "FUEL-DIESEL-001"):
    tele=_fetch_one("SELECT temp_outside, wind_speed, pressure, dg_load FROM telemetry WHERE station_id=? ORDER BY ts DESC LIMIT 1", (station_id,))
    qty_row=_fetch_one("SELECT a.qty FROM assets a JOIN crates cr ON a.crate_id=cr.id JOIN containers c ON cr.container_id=c.id WHERE c.station_id=? AND a.sku=? LIMIT 1", (station_id, asset_sku))
    cr=_fetch_one("SELECT winter_crew_count FROM stations WHERE id=?", (station_id,))
    if not qty_row: raise HTTPException(404, "asset")
    qty=qty_row["qty"]; crew=cr["winter_crew_count"] if cr else 24
    if not tele:
        tele={"temp_outside": -15, "wind_speed": 5, "pressure": 1013, "dg_load": 0.7}
    phys,res,total,used=predict_total(tele["temp_outside"], tele["wind_speed"], tele["pressure"], crew, tele["dg_load"])
    days=qty/total if total>0 else 999
    ci=[round(days*0.85), round(days*1.15)]
    return {"station_id": station_id, "asset_sku": asset_sku, "qty": qty, "physics": round(phys,1), "residual": round(res,2), "total_per_day": round(total,1), "days_to_stockout": round(days,1), "ci": ci, "used_model": used, "tele": tele,
            "pure_physics_days": round(qty/phys,1) if phys>0 else 999}

@app.get("/procurement/{station_id}")
def procurement(station_id: str):
    """Compute procurement needs from current inventory levels vs season targets."""
    SEASON_TARGETS = {"FUEL-DIESEL-001": 5000, "O2-CYL-47L-003": 30, "SPARE-BRG-6205-007": 10}
    UNIT_MAP = {"FUEL-DIESEL-001": ("L", 1200), "O2-CYL-47L-003": ("cyl", 200), "SPARE-BRG-6205-007": ("pcs", 80)}
    rows = _fetch_all("SELECT a.sku, a.name, a.qty, a.unit FROM assets a JOIN crates cr ON a.crate_id=cr.id JOIN containers c ON cr.container_id=c.id WHERE c.station_id=? AND a.sku IN ('FUEL-DIESEL-001','O2-CYL-47L-003','SPARE-BRG-6205-007')", (station_id,))
    result = []
    for r in rows:
        target = SEASON_TARGETS.get(r["sku"], 0)
        need = max(0, target - r["qty"])
        _, cost_per_unit = UNIT_MAP.get(r["sku"], (r["unit"], 0))
        result.append({"sku": r["sku"], "name": r["name"], "need": need, "unit": r["unit"], "eta": "30d before freeze", "cost": f"\u20b9{round(need*cost_per_unit/100000,1)}L"})
    return result

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
    if len(frame.ulid) < 20 or len(frame.ulid) > 30:
        raise HTTPException(400, "ulid must be 26 chars")
    if frame.entity not in ["assets", "indents", "telemetry", "stations", "containers", "crates"]:
        raise HTTPException(400, f"unsupported entity {frame.entity}")
    if frame.op not in ["UPSERT", "DELETE", "CONSUME", "IN", "ADJUST"]:
        raise HTTPException(400, f"unsupported op {frame.op}")
    conn=get_conn()
    ulid=frame.ulid
    try:
        utc = datetime.UTC
    except AttributeError:
        utc = datetime.timezone.utc
    now=datetime.datetime.now(utc).isoformat()
    if USE_PG:
        import psycopg
        with psycopg.connect(os.getenv("DATABASE_URL"), autocommit=False) as c:
            with c.cursor() as cur:
                cur.execute(q("SELECT 1 FROM dedupe WHERE ulid=?"), (ulid,))
                if cur.fetchone():
                    cur.execute(q("SELECT last_server_version FROM sync_state WHERE device_id=?"), (frame.device_id,))
                    r=cur.fetchone()
                    ver=r[0] if r else 0
                    return {"status":"DEDUPED", "server_version": ver, "message":"duplicate ULID, already applied"}
                if frame.entity=="indents" and frame.op=="UPSERT":
                    p=frame.patch
                    indent_id=frame.entity_id
                    cur.execute(q("SELECT 1 FROM indents WHERE id=?"), (indent_id,))
                    exists=cur.fetchone()
                    if not exists and "station_id" in p:
                        cur.execute(q("INSERT INTO indents VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING"), (indent_id, p.get("station_id"), p.get("asset_id"), p.get("qty_requested"), p.get("urgency","MEDIUM"), p.get("status","DRAFT"), p.get("created_by", frame.device_id), p.get("created_at", now)))
                    elif exists and "status" in p:
                        cur.execute(q("UPDATE indents SET status=? WHERE id=?"), (p["status"], indent_id))
                    cur.execute(q("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)"), (ulid, now))
                    cur.execute(q("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)"), (ulid, frame.device_id, f"SYNC_INDENT_{p.get('status','UPSERT')}", "indents", None, str(p), now))
                    cur.execute(q("SELECT last_server_version FROM sync_state WHERE device_id=?"), (frame.device_id,))
                    rv=cur.fetchone()
                    ver=rv[0] if rv else 0
                    cur.execute(q("INSERT INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,?) ON CONFLICT (device_id) DO UPDATE SET last_acked_ulid=EXCLUDED.last_acked_ulid"), (frame.device_id, ulid, ver))
                    c.commit()
                    return {"status":"APPLIED", "server_version": ver}
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
                    conn.execute("INSERT OR IGNORE INTO indents VALUES (?,?,?,?,?,?,?,?)", (indent_id, p.get("station_id"), p.get("asset_id"), p.get("qty_requested"), p.get("urgency","MEDIUM"), p.get("status","DRAFT"), p.get("created_by", frame.device_id), p.get("created_at", now)))
                elif exists and "status" in p:
                    conn.execute("UPDATE indents SET status=? WHERE id=?", (p["status"], indent_id))
                conn.execute("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?)", (ulid, now))
                conn.execute("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)", (ulid, frame.device_id, f"SYNC_INDENT_{p.get('status','UPSERT')}", "indents", None, str(p), now))
                conn.execute("INSERT OR IGNORE INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,?)", (frame.device_id, ulid, 0))
                conn.execute("UPDATE sync_state SET last_acked_ulid=? WHERE device_id=?", (ulid, frame.device_id))
                conn.execute("COMMIT")
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
