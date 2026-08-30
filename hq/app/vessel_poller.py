"""Phase 4 — Vessel poller: AIS API adaptive + mock schedule fallback.

Modes:
  A (preferred) — AIS_API_KEY set and quota ok → live lat/lon/sog/eta from AISHub/MarineTraffic
  B (fallback) — no key or 429 or error → interpolate shared/vessel_schedule.json along Bharati→Maitri route (Sagar Nidhi etc.)

ENV:
  AIS_API_KEY — optional (AISHub username/key). If unset, mock mode.
  VESSEL_MODE — auto|live|mock (default auto). auto tries live then falls back.
  VESSEL_POLL_SEC — poll interval (default 900s =15m)
"""
import os, asyncio, json, math, pathlib, datetime, logging
logger = logging.getLogger("polaris.hq.vessel_poller")

AIS_API_KEY = os.getenv("AIS_API_KEY", "")
VESSEL_MODE = os.getenv("VESSEL_MODE", "auto").lower()  # auto | live | mock
VESSEL_POLL_SEC = int(os.getenv("VESSEL_POLL_SEC", "900"))
VESSEL_CACHE = pathlib.Path(os.getenv("VESSEL_CACHE", "/tmp/ais_cache.json"))

_last = {"ts": None, "source": None, "results": [], "error": None}
_task: asyncio.Task | None = None

def _load_schedule():
    for p in [
        pathlib.Path(__file__).parent.parent.parent / "shared" / "vessel_schedule.json",
        pathlib.Path("/app/shared/vessel_schedule.json"),
        pathlib.Path(__file__).parent.parent.parent / "shared/vessel_schedule.json",
    ]:
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                pass
    return {"vessels": []}

def _interpolate_schedule(now: datetime.datetime):
    data = _load_schedule()
    out = []
    for v in data.get("vessels", []):
        route = v.get("route", [])
        if not route or len(route) < 2:
            continue
        dep_str = v.get("departure", "2026-08-10T00:00:00Z")
        try:
            dep = datetime.datetime.fromisoformat(dep_str.replace("Z", "+00:00"))
        except Exception:
            dep = now - datetime.timedelta(days=5)
        duration = float(v.get("duration_days", 20))
        elapsed = (now - dep).total_seconds() / 86400
        frac = max(0.0, min(1.0, elapsed / duration))
        # edge arrival
        if frac >= 1.0:
            pt = route[-1]
            lat, lon = float(pt["lat"]), float(pt["lon"])
            eta = pt.get("label", "Arrived")
        else:
            # piecewise linear between waypoints
            seg = frac * (len(route) - 1)
            idx = int(math.floor(seg))
            t = seg - idx
            if idx >= len(route) - 1:
                lat, lon = float(route[-1]["lat"]), float(route[-1]["lon"])
                eta = route[-1].get("label", "")
            else:
                a, b = route[idx], route[idx + 1]
                lat = float(a["lat"]) + (float(b["lat"]) - float(a["lat"])) * t
                lon = float(a["lon"]) + (float(b["lon"]) - float(a["lon"])) * t
                remaining = (1 - frac) * duration
                eta = f"{remaining:.1f}d to {b.get('label','dest')}"
        out.append({
            "imo": v["imo"],
            "name": v["name"],
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "sog": float(v.get("sog", 12.0)),
            "eta": eta,
            "station_id": v.get("station_id", "ST-BHARATI"),
            "last_seen": now.isoformat(),
            "source": "mock",
        })
    return out

def _upsert_vessels(rows):
    try:
        from .db import get_conn, USE_PG
        conn = get_conn()
        if USE_PG:
            with conn:
                with conn.cursor() as cur:
                    for r in rows:
                        cur.execute("INSERT INTO vessels (imo, name, lat, lon, sog, eta, station_id, last_seen) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (imo) DO UPDATE SET name=EXCLUDED.name, lat=EXCLUDED.lat, lon=EXCLUDED.lon, sog=EXCLUDED.sog, eta=EXCLUDED.eta, station_id=EXCLUDED.station_id, last_seen=EXCLUDED.last_seen", (r["imo"], r["name"], r["lat"], r["lon"], r["sog"], r["eta"], r["station_id"], r["last_seen"]))
            try: conn.close()
            except Exception: pass
        else:
            for r in rows:
                conn.execute("INSERT INTO vessels (imo, name, lat, lon, sog, eta, station_id, last_seen) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(imo) DO UPDATE SET name=excluded.name, lat=excluded.lat, lon=excluded.lon, sog=excluded.sog, eta=excluded.eta, station_id=excluded.station_id, last_seen=excluded.last_seen", (r["imo"], r["name"], r["lat"], r["lon"], r["sog"], r["eta"], r["station_id"], r["last_seen"]))
            conn.commit()
        # cache for fallback persistence
        try:
            VESSEL_CACHE.parent.mkdir(parents=True, exist_ok=True)
            VESSEL_CACHE.write_text(json.dumps(rows, indent=2), encoding="utf-8")
        except Exception:
            pass
        # broadcast downstream to field tablets
        try:
            from .main import notify_gateway
            for r in rows:
                notify_gateway(r["station_id"], "vessels", r["imo"], "UPSERT", r)
        except Exception:
            pass
        return True
    except Exception as e:
        logger.warning(f"[vessel_poller] upsert failed: {e}")
        return False

async def _fetch_live():
    if not AIS_API_KEY:
        return None, "no_key"
    # AISHub example: https://data.aishub.net/ws.php?username={key}&format=1&output=json
    # Generic handling: try AISHub then MarineTraffic pattern if fails
    url = f"https://data.aishub.net/ws.php?username={AIS_API_KEY}&format=1&output=json"
    try:
        import httpx
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url)
            if r.status_code == 429:
                return None, "429"
            r.raise_for_status()
            j = r.json()
            # Try to parse AISHub: {"error": false, "data": [{"IMO":..., "NAME":..., "LAT":..., "LON":..., "SOG":..., "ETA":...}]}
            rows = []
            items = j.get("data") or j.get("vessels") or (j if isinstance(j, list) else [])
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()
            for it in items[:10]:
                try:
                    imo = str(it.get("IMO") or it.get("imo") or it.get("mmsi") or "unknown")
                    name = it.get("NAME") or it.get("name") or "Unknown"
                    lat = float(it.get("LAT") or it.get("lat") or 0)
                    lon = float(it.get("LON") or it.get("lon") or 0)
                    sog = float(it.get("SOG") or it.get("sog") or 10)
                    eta = str(it.get("ETA") or it.get("eta") or "")
                    station_id = it.get("station_id") or "ST-BHARATI"
                    rows.append({"imo": imo, "name": name, "lat": lat, "lon": lon, "sog": sog, "eta": eta, "station_id": station_id, "last_seen": now, "source": "live"})
                except Exception:
                    continue
            if rows:
                return rows, "live"
            return None, "empty"
    except Exception as e:
        msg = str(e)
        if "429" in msg:
            return None, "429"
        logger.warning(f"[vessel_poller] live fetch failed: {e}")
        return None, "error"

async def poll_once():
    now = datetime.datetime.now(datetime.timezone.utc)
    source = "mock"
    rows = None
    reason = None
    if VESSEL_MODE == "mock":
        rows = _interpolate_schedule(now)
        source = "mock"
    elif VESSEL_MODE == "live":
        live_rows, reason = await _fetch_live()
        if live_rows:
            rows = live_rows
            source = "live"
        else:
            rows = _interpolate_schedule(now)
            source = "mock"
            _last["error"] = f"live failed {reason}, fallback mock"
    else:  # auto
        if AIS_API_KEY:
            live_rows, reason = await _fetch_live()
            if live_rows:
                rows = live_rows
                source = "live"
            else:
                # 429 or no_key or empty -> fallback
                rows = _interpolate_schedule(now)
                source = "mock"
                if reason == "429":
                    _last["error"] = "429 quota exceeded, fallback mock"
                elif reason:
                    _last["error"] = f"live {reason}, fallback mock"
        else:
            rows = _interpolate_schedule(now)
            source = "mock"
            _last["error"] = None if rows else "no schedule"
    if rows:
        _upsert_vessels(rows)
        _last["ts"] = now.isoformat()
        _last["source"] = source
        _last["results"] = rows
        if source == "mock":
            # keep prior error if 429, else clear
            pass
        else:
            _last["error"] = None
        logger.info(f"[vessel_poller] {source} {len(rows)} vessels")
    else:
        _last["ts"] = now.isoformat()
        _last["source"] = "none"
        _last["results"] = []
    return _last

async def _loop():
    logger.info(f"[vessel_poller] start mode={VESSEL_MODE} interval={VESSEL_POLL_SEC}s aishub={'yes' if AIS_API_KEY else 'no'}")
    await asyncio.sleep(5)
    while True:
        try:
            await poll_once()
        except Exception as e:
            logger.error(f"[vessel_poller] loop error: {e}")
            _last["error"] = str(e)
        await asyncio.sleep(VESSEL_POLL_SEC)

def start_poller():
    global _task
    if _task and not _task.done():
        return _task
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None
    _task = loop.create_task(_loop())
    return _task

def get_status():
    return {"mode": VESSEL_MODE, "poll_interval_sec": VESSEL_POLL_SEC, "ais_configured": bool(AIS_API_KEY), "cache": str(VESSEL_CACHE), "last": _last}
