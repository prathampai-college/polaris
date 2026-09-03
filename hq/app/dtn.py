import json, datetime, os
from typing import Any

from .db import get_conn, USE_PG

def _now_iso():
    try:
        import datetime as dt
        utc = dt.UTC
    except AttributeError:
        utc = dt.timezone.utc
    return dt.datetime.now(utc).isoformat()

def compare_vc(a: dict, b: dict) -> str:
    keys = set(list(a.keys()) + list(b.keys()))
    a_gt = any((a.get(k,0) > b.get(k,0)) for k in keys)
    b_gt = any((b.get(k,0) > a.get(k,0)) for k in keys)
    if not a_gt and not b_gt: return "equal"
    if a_gt and not b_gt: return "gt"
    if not a_gt and b_gt: return "lt"
    return "concurrent"

def merge_vc(a: dict, b: dict) -> dict:
    out = dict(a)
    for k,v in b.items():
        out[k] = max(out.get(k,0), v)
    return out

def ingest_bundle(bundle: dict, cur) -> dict:
    """
    bundle: {bundleId, src, dstStation, vectorClock, payload:{entity, entity_id, op, patch}}
    cur: DB cursor (PG or sqlite)
    Returns {bundleId, status}
    """
    bid = bundle.get("bundleId") or bundle.get("bundle_id") or bundle.get("ulid") or "unknown"
    vc = bundle.get("vectorClock") or bundle.get("vc") or {}
    if isinstance(vc, str):
        try: vc = json.loads(vc)
        except: vc = {}
    payload = bundle.get("payload") or {}
    entity = payload.get("entity")
    entity_id = payload.get("entity_id") or payload.get("entityId")
    op = payload.get("op", "UPSERT")
    patch = payload.get("patch") or {}
    src = bundle.get("src", "mule")
    dst = bundle.get("dstStation") or bundle.get("dst_station") or "ST-BHARATI"

    # dedupe via bundleId in dedupe table
    try:
        if USE_PG:
            cur.execute("SELECT 1 FROM dedupe WHERE ulid=%s", (bid,))
            if cur.fetchone():
                return {"bundleId": bid, "status": "DEDUPED"}
        else:
            # need conn; cur is connection cursor? handle both
            pass
    except: pass

    now = _now_iso()

    # Handle assets LWW+VC
    if entity == "assets":
        # fetch existing VC
        existing = None
        existing_vc = {}
        existing_ts = ""
        try:
            if USE_PG:
                cur.execute("SELECT vector_clock, updated_at, qty, version FROM assets WHERE id=%s", (entity_id,))
                row = cur.fetchone()
                if row:
                    # psycopg returns tuple
                    cols = [d[0] for d in cur.description] if cur.description else []
                    if cols:
                        d = dict(zip(cols, row))
                        existing_vc = json.loads(d.get("vector_clock") or "{}") if isinstance(d.get("vector_clock"), str) else (d.get("vector_clock") or {})
                        existing_ts = d.get("updated_at") or ""
                        existing = d
                    else:
                        existing_vc = {}
            else:
                # sqlite path uses conn.execute directly; cur is conn
                conn = get_conn()
                r = conn.execute("SELECT vector_clock, updated_at, qty, version FROM assets WHERE id=?", (entity_id,)).fetchone()
                if r:
                    try: existing_vc = json.loads(r["vector_clock"]) if r["vector_clock"] else {}
                    except: existing_vc = {}
                    existing_ts = r["updated_at"] or ""
                    existing = dict(r)
        except Exception as e:
            existing_vc = {}

        cmp = compare_vc(existing_vc or {}, vc or {})
        winner = "remote"
        if cmp == "gt":
            winner = "local"
        elif cmp == "lt":
            winner = "remote"
        elif cmp == "equal":
            winner = "local"  # tie keep local
        else: # concurrent -> LWW
            patch_ts = patch.get("updated_at") or bundle.get("createdAt") or now
            if patch_ts > existing_ts:
                winner = "remote"
            else:
                winner = "local"

        # persist even if local wins? still store bundle and update VC merge
        merged = merge_vc(existing_vc or {}, vc or {})
        merged_s = json.dumps(merged)

        if winner == "remote":
            new_qty = patch.get("qty")
            new_ver = patch.get("version")
            if new_qty is not None:
                try:
                    if USE_PG:
                        cur.execute("UPDATE assets SET qty=%s, version=%s, updated_at=%s, vector_clock=%s WHERE id=%s", (new_qty, new_ver or 1, now, merged_s, entity_id))
                        cur.execute("INSERT INTO dedupe (ulid, processed_at) VALUES (%s,%s) ON CONFLICT DO NOTHING", (bid, now))
                        cur.execute("INSERT INTO dtn_bundles (bundle_id, src, dst_station, payload, vc, custody, created_at, ttl) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", (bid, src, dst, json.dumps(payload), merged_s, 0, now, 86400))
                    else:
                        conn = get_conn()
                        conn.execute("UPDATE assets SET qty=?, version=?, updated_at=?, vector_clock=? WHERE id=?", (new_qty, new_ver or 1, now, merged_s, entity_id))
                        conn.execute("INSERT OR IGNORE INTO dedupe (ulid, processed_at) VALUES (?,?)", (bid, now))
                        conn.execute("INSERT OR IGNORE INTO dtn_bundles (bundle_id, src, dst_station, payload, vc, custody, created_at, ttl) VALUES (?,?,?,?,?,?,?,?)", (bid, src, dst, json.dumps(payload), merged_s, 0, now, 86400))
                except Exception as e:
                    return {"bundleId": bid, "status": "FAILED", "error": str(e)}
            return {"bundleId": bid, "status": "APPLIED", "winner": winner, "cmp": cmp}
        else:
            # local wins — still dedupe but no overwrite
            try:
                if USE_PG:
                    cur.execute("INSERT INTO dedupe (ulid, processed_at) VALUES (%s,%s) ON CONFLICT DO NOTHING", (bid, now))
                    cur.execute("UPDATE assets SET vector_clock=%s WHERE id=%s", (merged_s, entity_id))
                else:
                    conn = get_conn()
                    conn.execute("INSERT OR IGNORE INTO dedupe (ulid, processed_at) VALUES (?,?)", (bid, now))
                    conn.execute("UPDATE assets SET vector_clock=? WHERE id=?", (merged_s, entity_id))
                    conn.commit()
            except: pass
            return {"bundleId": bid, "status": "APPLIED_LOCAL_WINS", "cmp": cmp}

    # indents: simple upsert with VC merge (last wins if concurrent)
    if entity == "indents":
        try:
            if USE_PG:
                # check exists
                cur.execute("SELECT 1 FROM indents WHERE id=%s", (entity_id,))
                exists = cur.fetchone()
                if not exists and "station_id" in patch:
                    cur.execute("INSERT INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at, vessel_imo) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                                (entity_id, patch.get("station_id"), patch.get("asset_id"), patch.get("qty_requested"), patch.get("urgency","MEDIUM"), patch.get("status","DRAFT"), patch.get("created_by", src), patch.get("created_at", now), patch.get("vessel_imo")))
                elif exists and "status" in patch:
                    cur.execute("UPDATE indents SET status=%s WHERE id=%s", (patch.get("status"), entity_id))
                cur.execute("INSERT INTO dedupe (ulid, processed_at) VALUES (%s,%s) ON CONFLICT DO NOTHING", (bid, now))
            else:
                conn = get_conn()
                r = conn.execute("SELECT 1 FROM indents WHERE id=?", (entity_id,)).fetchone()
                if not r and "station_id" in patch:
                    conn.execute("INSERT OR IGNORE INTO indents (id, station_id, asset_id, qty_requested, urgency, status, created_by, created_at, vessel_imo) VALUES (?,?,?,?,?,?,?,?,?)",
                                 (entity_id, patch.get("station_id"), patch.get("asset_id"), patch.get("qty_requested"), patch.get("urgency","MEDIUM"), patch.get("status","DRAFT"), patch.get("created_by", src), patch.get("created_at", now), patch.get("vessel_imo")))
                elif r and "status" in patch:
                    conn.execute("UPDATE indents SET status=? WHERE id=?", (patch.get("status"), entity_id))
                conn.execute("INSERT OR IGNORE INTO dedupe (ulid, processed_at) VALUES (?,?)", (bid, now))
                conn.commit()
            return {"bundleId": bid, "status": "APPLIED"}
        except Exception as e:
            return {"bundleId": bid, "status": "FAILED", "error": str(e)}

    return {"bundleId": bid, "status": "UNSUPPORTED_ENTITY"}
