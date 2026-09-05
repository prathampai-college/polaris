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
# Explicit gate: live AIS only when AIS_ENABLED=true (avoids quota burn in demo/mock)
LIVE_AIS_ENABLED = os.getenv("LIVE_AIS_ENABLED", os.getenv("AIS_ENABLED", "false")).lower() in ("1", "true", "yes", "on")

_last = {"ts": None, "source": None, "results": [], "error": None}
_task: asyncio.Task | None = None

def _load_schedule():
    for p in [
        pathlib.Path(__file__).parent.parent.parent / "shared" / "vessel_schedule.json",
        pathlib.Path(__file__).parent.parent / "shared" / "vessel_schedule.json",
        pathlib.Path("/app/shared/vessel_schedule.json"),
        pathlib.Path("shared/vessel_schedule.json"),
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

_last_live_fetch: float = 0.0

async def _fetch_live():
    global _last_live_fetch
    if not LIVE_AIS_ENABLED:
        return None, "live_disabled"
    if not AIS_API_KEY:
        return None, "no_key"
    # Enforce AISHub 1/min throttle (spec: Don't access more frequently than once per minute)
    import time
    if time.time() - _last_live_fetch < 60:
        return None, "throttled_60s"
    _last_live_fetch = time.time()
    # Build AISHub URL per spec: https://data.aishub.net/ws.php?username=A&format=B&output=C&compress=D&imo=J
    # B=1 human readable (degrees/knots), C=json, D=0 no compression, J=our fleet IMOs to save quota
    schedule = _load_schedule()
    fleet_imos = ",".join(v.get("imo","") for v in schedule.get("vessels", []) if v.get("imo"))
    # Use B=1 (human readable), output=json, compress=0 (plain JSON, no ZIP/GZIP), imo filter if available
    url = f"https://data.aishub.net/ws.php?username={AIS_API_KEY}&format=1&output=json&compress=0"
    if fleet_imos:
        url += f"&imo={fleet_imos}"
    # Mapping IMO -> station_id from schedule for station assignment
    imo_to_station = {v["imo"]: v.get("station_id", "ST-BHARATI") for v in schedule.get("vessels", []) if "imo" in v}
    try:
        import httpx
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(url)
            if r.status_code == 429:
                return None, "429"
            # AISHub returns nothing (empty body) if polled too frequently — treat as throttled
            if not r.content or len(r.content) < 5:
                return None, "empty_throttled"
            r.raise_for_status()
            # Handle possible compressed response if server ignores compress=0? Try JSON first
            try:
                j = r.json()
            except Exception:
                # Try decompress if it was ZIP/GZIP despite compress=0
                import gzip, zipfile, io
                raw = r.content
                try:
                    raw = gzip.decompress(raw)
                    j = json.loads(raw.decode())
                except Exception:
                    try:
                        with zipfile.ZipFile(io.BytesIO(raw)) as z:
                            j = json.loads(z.read(z.namelist()[0]).decode())
                    except Exception:
                        return None, "parse_error"
            # AISHub JSON: with B=1 => [{MMSI, TIME/TSTAMP, LONGITUDE, LATITUDE, COG, SOG, HEADING, IMO, NAME, ... ETA}]
            # With B=0 => same keys but LONGITUDE/LATITUDE encoded *600000, SOG*10 etc.
            # Response may be list, or {"data": [...]}, or {"error":...}
            items = None
            if isinstance(j, list):
                items = j
            elif isinstance(j, dict):
                items = j.get("data") or j.get("vessels") or j.get("result") or []
                # If dict is single vessel, wrap
                if isinstance(items, dict):
                    items = [items]
                if not items and "MMSI" in j:
                    items = [j]
            else:
                items = []
            rows = []
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            for it in items[:20]:
                try:
                    # IMO fallback to MMSI if IMO 0/missing (some vessels have no IMO)
                    raw_imo = it.get("IMO") or it.get("imo")
                    mmsi = str(it.get("MMSI") or it.get("mmsi") or "")
                    if raw_imo and str(raw_imo) != "0":
                        imo = str(raw_imo)
                    elif mmsi:
                        imo = f"MMSI-{mmsi}"
                    else:
                        continue
                    name = (it.get("NAME") or it.get("name") or "Unknown").strip()
                    # LONGITUDE/LATITUDE: B=1 => degrees, B=0 => *600000
                    lon_raw = it.get("LONGITUDE") or it.get("lon") or it.get("LON") or it.get("LONG")
                    lat_raw = it.get("LATITUDE") or it.get("lat") or it.get("LAT")
                    if lon_raw is None or lat_raw is None:
                        continue
                    try:
                        lon_f = float(lon_raw)
                        lat_f = float(lat_raw)
                    except Exception:
                        continue
                    # Detect AIS encoding B=0: values > 1000 (e.g., 3022820) need /600000
                    if abs(lon_f) > 1800 or abs(lat_f) > 900:
                        lon_f = lon_f / 600000.0
                        lat_f = lat_f / 600000.0
                    # SOG: B=1 => knots, B=0 => *10
                    sog_raw = it.get("SOG") or it.get("sog") or 0
                    try:
                        sog_f = float(sog_raw)
                    except Exception:
                        sog_f = 0.0
                    if sog_f > 200:  # likely B=0 *10 (e.g., 125 => 12.5 knots) or 1024 not available
                        if sog_f >= 1024:
                            sog_f = 0.0
                        else:
                            sog_f = sog_f / 10.0
                    if sog_f >= 102.4:  # B=1 not available sentinel
                        sog_f = 0.0
                    # ETA
                    eta = str(it.get("ETA") or it.get("eta") or it.get("DEST") or it.get("dest") or "")
                    if eta in ("0", "1596", "24:60"):
                        eta = ""
                    # TIME: B=1 => "2021-07-09 08:06:53 GMT", B=0 => unix timestamp string
                    t_raw = it.get("TIME") or it.get("TSTAMP") or it.get("time") or it.get("timestamp") or now_iso
                    if isinstance(t_raw, (int, float)) or (isinstance(t_raw, str) and t_raw.isdigit()):
                        try:
                            last_seen = datetime.datetime.fromtimestamp(int(t_raw), tz=datetime.timezone.utc).isoformat()
                        except Exception:
                            last_seen = now_iso
                    else:
                        last_seen = str(t_raw)
                    # Validate lat/lon sensible for southern ocean
                    if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
                        continue
                    station_id = imo_to_station.get(imo, it.get("station_id") or "ST-BHARATI")
                    rows.append({"imo": imo, "name": name, "lat": round(lat_f, 4), "lon": round(lon_f, 4), "sog": round(sog_f, 1), "eta": eta, "station_id": station_id, "last_seen": last_seen, "source": "live"})
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
    return {"mode": VESSEL_MODE, "poll_interval_sec": VESSEL_POLL_SEC, "ais_configured": bool(AIS_API_KEY), "live_enabled": LIVE_AIS_ENABLED, "cache": str(VESSEL_CACHE), "last": _last}
