"""Phase 2.2 — Weather via IMD / Open-Meteo poller.
- Free, no-key Open-Meteo primary; optional IMD_API_KEY branch.
- APScheduler replaced with asyncio periodic task (every 15m, ponytail minimal).
- Maps → {temp_outside, wind_speed, pressure, dg_load: 0.7+0.1*sin(hour)} and POSTs to HQ /telemetry internally.
- TELEMETRY_SOURCE=imd|sim|both (default both so fixtures still work for ?demo)
"""
import os
import asyncio
import math
import datetime
import logging

logger = logging.getLogger("polaris.hq.poller")

# Coords per PLAN.md:2.2 (lat, lon)
STATION_COORDS = {
    "ST-BHARATI": (-69.4, 76.18),
    "ST-MAITRI": (-70.75, 11.73),
    "ST-HIMADRI": (78.91, 11.92),
}

TELEMETRY_SOURCE = os.getenv("TELEMETRY_SOURCE", "both")  # imd|sim|both|openmeteo
IMD_API_KEY = os.getenv("IMD_API_KEY", "")
POLL_INTERVAL_SEC = int(os.getenv("TELEMETRY_POLL_SEC", "900"))  # 15m default
HQ_INTERNAL_URL = os.getenv("HQ_INTERNAL_URL", "http://localhost:8000")

_last_poll: dict = {"ts": None, "results": {}, "error": None}
_poller_task: asyncio.Task | None = None

def _dg_load_for_now() -> float:
    try:
        hour = datetime.datetime.now(datetime.timezone.utc).hour
    except Exception:
        hour = datetime.datetime.utcnow().hour
    return round(0.7 + 0.1 * math.sin(hour * math.pi / 12), 3)

async def fetch_open_meteo(station_id: str) -> dict | None:
    coords = STATION_COORDS.get(station_id)
    if not coords:
        return None
    lat, lon = coords
    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,wind_speed_10m,pressure_msl"
    try:
        import httpx
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url)
            r.raise_for_status()
            j = r.json()
            cur = j.get("current", {})
            # Open-Meteo returns temp in C, wind in km/h -> convert to m/s if needed? keep as is, divide km/h by 3.6 approx
            # For polar demo we keep raw wind km/h as m/s approximation is close; divide for correctness
            wind_kmh = cur.get("wind_speed_10m")
            wind_ms = round(float(wind_kmh) / 3.6, 2) if wind_kmh is not None else 5.0
            temp = float(cur.get("temperature_2m", -15))
            pressure = float(cur.get("pressure_msl", 1013))
            return {"temp_outside": temp, "wind_speed": wind_ms, "pressure": pressure, "dg_load": _dg_load_for_now(), "source": "open-meteo"}
    except Exception as e:
        logger.warning(f"[poller] open-meteo {station_id} failed: {e}")
        return None

async def fetch_imd(station_id: str) -> dict | None:
    if not IMD_API_KEY:
        return None
    # Placeholder IMD branch — real endpoint when key provisioned
    # Example: https://mausam.imd.gov.in/api/... (not yet public, stub)
    url = os.getenv("IMD_API_URL", "https://mausam.imd.gov.in/api/current")
    coords = STATION_COORDS.get(station_id)
    if not coords:
        return None
    lat, lon = coords
    try:
        import httpx
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url, params={"lat": lat, "lon": lon, "key": IMD_API_KEY})
            r.raise_for_status()
            j = r.json()
            # Try to map generic fields
            temp = float(j.get("temperature", j.get("temp", -15)))
            wind = float(j.get("wind_speed", j.get("wind", 5)))
            pressure = float(j.get("pressure", 1013))
            return {"temp_outside": temp, "wind_speed": wind, "pressure": pressure, "dg_load": _dg_load_for_now(), "source": "imd"}
    except Exception as e:
        logger.warning(f"[poller] imd {station_id} failed: {e}")
        return None

async def _post_telemetry_internal(station_id: str, payload: dict):
    """Internal telemetry ingest — reuse main's DB logic without HTTP loopback where possible."""
    try:
        # Try direct DB + broadcast path (avoid HTTP recursion during lifespan start)
        from .db import get_conn, USE_PG
        from .main import _broadcast_telemetry, check_and_escalate, q
        import datetime as _dt
        try:
            utc = _dt.UTC
        except AttributeError:
            utc = _dt.timezone.utc
        ts = _dt.datetime.now(utc).isoformat()
        # Build TelemetryIn-like object for check_and_escalate
        class _T:
            def __init__(self, d):
                self.temp_outside = d["temp_outside"]
                self.wind_speed = d["wind_speed"]
                self.pressure = d["pressure"]
                self.dg_load = d["dg_load"]
                self.acoustic_anomaly = 0.0
                self.station_id = station_id
                self.ts = ts
        t_obj = _T(payload)
        conn = get_conn()
        if USE_PG:
            import psycopg
            # reuse get_conn PG path
            with conn:
                with conn.cursor() as cur:
                    cur.execute(q("INSERT INTO telemetry VALUES (?,?,?,?,?,?)"), (ts, station_id, payload["temp_outside"], payload["wind_speed"], payload["pressure"], payload["dg_load"]))
                    try:
                        check_and_escalate(station_id, t_obj)
                    except Exception:
                        pass
        else:
            conn.execute("INSERT INTO telemetry VALUES (?,?,?,?,?,?)", (ts, station_id, payload["temp_outside"], payload["wind_speed"], payload["pressure"], payload["dg_load"]))
            conn.commit()
            try:
                check_and_escalate(station_id, t_obj)
            except Exception:
                pass
        # broadcast SSE
        try:
            await _broadcast_telemetry({"ts": ts, "station_id": station_id, **payload})
        except Exception:
            pass
        logger.info(f"[poller] ingested {station_id} {payload} via direct DB")
        return True
    except Exception as e:
        logger.warning(f"[poller] direct ingest failed {station_id}: {e}, trying HTTP fallback")
        # HTTP fallback
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                hdrs = {"Content-Type": "application/json"}
                psk = os.getenv("PSK_HEX", os.getenv("SECRET_KEY", ""))
                if psk:
                    hdrs["X-PSK"] = psk
                url = f"{HQ_INTERNAL_URL}/telemetry"
                body = {"ts": datetime.datetime.now(datetime.timezone.utc).isoformat(), "station_id": station_id, **payload, "acoustic_anomaly": 0.0}
                r = await client.post(url, json=body, headers=hdrs)
                r.raise_for_status()
                logger.info(f"[poller] ingested {station_id} via HTTP {r.status_code}")
                return True
        except Exception as e2:
            logger.warning(f"[poller] HTTP ingest also failed {station_id}: {e2}")
            return False

async def poll_once() -> dict:
    """Poll all stations once per TELEMETRY_SOURCE setting."""
    results = {}
    for sid in STATION_COORDS:
        data = None
        source_used = None
        # IMD first if source includes imd and key present
        if TELEMETRY_SOURCE in ("imd", "both") and IMD_API_KEY:
            data = await fetch_imd(sid)
            if data:
                source_used = "imd"
        # Open-Meteo if still no data and source allows it
        if not data and TELEMETRY_SOURCE in ("both", "openmeteo", "open-meteo", "imd"):
            # also allow "both" to try open-meteo
            if TELEMETRY_SOURCE in ("both", "openmeteo", "open-meteo"):
                data = await fetch_open_meteo(sid)
                if data:
                    source_used = data.get("source", "open-meteo")
        # If TELEMETRY_SOURCE == sim, skip real fetch
        if not data:
            if TELEMETRY_SOURCE == "sim":
                # sim mode — do not poll externally, keep fixtures
                results[sid] = {"skipped": "sim mode"}
                continue
            elif TELEMETRY_SOURCE == "both" and not IMD_API_KEY:
                # both with no IMD key => already tried open-meteo above, if failed record
                if not data:
                    results[sid] = {"error": "open-meteo unavailable"}
                    continue
            else:
                results[sid] = {"error": "no data"}
                continue
        # ingest
        ok = await _post_telemetry_internal(sid, data)
        results[sid] = {"ok": ok, "source": source_used, "temp": data.get("temp_outside"), "wind": data.get("wind_speed")}
    _last_poll["ts"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    _last_poll["results"] = results
    _last_poll["error"] = None
    return results

async def _poller_loop():
    logger.info(f"[poller] starting loop interval={POLL_INTERVAL_SEC}s source={TELEMETRY_SOURCE} imd={'yes' if IMD_API_KEY else 'no'}")
    # initial delay 5s to let DB init
    await asyncio.sleep(5)
    while True:
        try:
            # respect sim-only mode: still run but skip fetches
            await poll_once()
        except Exception as e:
            logger.error(f"[poller] loop error: {e}")
            _last_poll["error"] = str(e)
        await asyncio.sleep(POLL_INTERVAL_SEC)

def start_poller():
    global _poller_task
    if _poller_task and not _poller_task.done():
        return _poller_task
    # only start if source != sim? but keep task for health endpoint even in sim
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None
    _poller_task = loop.create_task(_poller_loop())
    return _poller_task

def get_status() -> dict:
    return {
        "source_setting": TELEMETRY_SOURCE,
        "poll_interval_sec": POLL_INTERVAL_SEC,
        "coords": STATION_COORDS,
        "imd_configured": bool(IMD_API_KEY),
        "last_poll": _last_poll,
    }
