"""The one place an upstream field write is applied — WS frames (via gateway →
/sync/ingest) and DTN bundles (/dtn/ingest_bulk, /dtn/exchange) both land here,
so a write that travels both channels under the same ULID applies exactly once.

Dialect-agnostic: `cur` is a sqlite3 Connection or a psycopg Cursor; both expose
.execute(sql, params) -> cursor with fetchone()/rowcount. Caller owns the
transaction (and a SAVEPOINT for bulk)."""
import json

from ._vc import compare_vc, merge_vc
from .db import USE_PG, utc_now

ASSET_OPS = {"UPSERT", "CONSUME", "IN", "OUT", "ADJUST"}

# entity -> (columns a patch may write, columns required to CREATE the row, insert defaults)
ENTITIES = {
    "indents": (("station_id", "asset_id", "qty_requested", "urgency", "status", "created_by", "created_at", "vessel_imo"), ("station_id", "asset_id"), {"urgency": "MEDIUM", "status": "DRAFT"}),
    "personnel": (("station_id", "name", "role", "blood_group", "emergency_contact", "status", "program"), ("station_id", "name"), {"status": "ON_STATION"}),
    "field_sorties": (("station_id", "lead_personnel_id", "destination", "departure_time", "expected_return_time", "actual_return_time", "safety_status", "expedition_id", "buddy_personnel_id"), ("station_id", "lead_personnel_id"), {"safety_status": "ACTIVE"}),
    "emergencies": (("station_id", "type", "reported_by", "status", "ts", "location_coord", "assignee", "sortie_id", "status_entered_ts"), ("station_id", "type"), {"status": "ACTIVE"}),
    "expeditions": (("program", "name", "season", "status", "created_by", "created_at"), ("name",), {}),
    "voyage_legs": (("expedition_id", "seq", "from_point", "to_point", "mode", "vessel_imo", "eta_depart", "eta_arrive", "status"), ("expedition_id",), {}),
    "manifests": (("expedition_id", "owner_org", "project_code", "destination_station", "sku", "description", "qty", "unit", "weight_kg", "hazmat_class", "temp_zone", "customs_status", "biosecurity_status", "labelling_code", "container_id", "crate_id", "stage"), ("expedition_id",), {}),
    "lots": (("asset_sku", "lot_code", "qty", "expiry_date", "crate_id", "received_ts"), ("asset_sku", "lot_code", "qty"), {}),
}
# Entities other tablets at the same station must see promptly (pushed via gateway).
NOTIFY = {"personnel", "field_sorties", "emergencies"}


class Rejected(Exception):
    """Frame can never apply as sent (bad entity/op/shape) — permanent, 4xx."""


class NotFound(Rejected):
    pass


class Conflict(Exception):
    """Frame rejected by a business rule; caller rolls back and returns .ack."""

    def __init__(self, ack: dict):
        super().__init__(ack.get("message", "conflict"))
        self.ack = ack


def q(sql: str) -> str:
    return sql.replace("?", "%s") if USE_PG else sql


def _loads(s) -> dict:
    if isinstance(s, dict):
        return s
    try:
        return json.loads(s) if s else {}
    except Exception:
        return {}


def _ack_state(cur, device_id: str, ulid: str, server_version=None):
    if server_version is None:
        cur.execute(q("INSERT INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,0) ON CONFLICT (device_id) DO UPDATE SET last_acked_ulid=EXCLUDED.last_acked_ulid"), (device_id, ulid))
    else:
        cur.execute(q("INSERT INTO sync_state (device_id, last_acked_ulid, last_server_version) VALUES (?,?,?) ON CONFLICT (device_id) DO UPDATE SET last_acked_ulid=EXCLUDED.last_acked_ulid, last_server_version=EXCLUDED.last_server_version"), (device_id, ulid, server_version))


def _audit(cur, ulid, device_id, action, entity, before, after, now):
    cur.execute(q("INSERT INTO audit_log (id, actor_id, action, entity, before, after, ts) VALUES (?,?,?,?,?,?,?)"), (ulid, device_id, action, entity, before, after, now))


def apply_frame(cur, *, ulid: str, device_id: str, entity: str, entity_id: str, op: str, patch: dict, vector_clock=None, ts=None):
    """Returns (ack, notify) where notify is (station_id, entity, id, op, patch) or None."""
    if entity == "assets":
        if op not in ASSET_OPS:
            raise Rejected(f"unsupported op {op} for assets")
    elif entity in ENTITIES:
        if op != "UPSERT":
            raise Rejected(f"unsupported op {op} for {entity}")
    else:
        raise Rejected(f"unsupported entity {entity}")
    if not entity_id:
        raise Rejected("entity_id required")
    patch = patch or {}
    now = utc_now()

    # Insert-first dedupe: atomic under concurrency (check-then-insert raced into a
    # unique-key 500 on PG when the same ULID arrived on two channels at once).
    if cur.execute(q("INSERT INTO dedupe (ulid, processed_at) VALUES (?,?) ON CONFLICT DO NOTHING"), (ulid, now)).rowcount == 0:
        r = cur.execute(q("SELECT last_server_version FROM sync_state WHERE device_id=?"), (device_id,)).fetchone()
        return {"status": "DEDUPED", "server_version": (r[0] if r and r[0] is not None else 0), "message": "duplicate ULID, already applied"}, None

    if entity == "assets":
        return _apply_asset(cur, ulid, device_id, entity_id, op, patch, vector_clock, ts, now), None

    cols, required, defaults = ENTITIES[entity]
    fields = {k: patch[k] for k in cols if k in patch}
    if entity == "emergencies" and "status" in fields and "status_entered_ts" not in fields:
        fields["status_entered_ts"] = now  # triage-SLA watchdog clocks from this
    exists = cur.execute(q(f"SELECT 1 FROM {entity} WHERE id=?"), (entity_id,)).fetchone()
    if exists:
        # Only columns present in the patch — a status-only patch must never
        # clobber name/role/expiry with defaults (old COALESCE(default, …) bug).
        if fields:
            sets = ", ".join(f"{k}=?" for k in fields)
            cur.execute(q(f"UPDATE {entity} SET {sets} WHERE id=?"), (*fields.values(), entity_id))
    else:
        missing = [c for c in required if fields.get(c) is None]
        if missing:
            raise Rejected(f"cannot create {entity} {entity_id}: missing {', '.join(missing)}")
        row = {**defaults, **fields}
        if entity == "emergencies":
            row.setdefault("ts", now)
            row.setdefault("status_entered_ts", now)
            row.setdefault("reported_by", device_id)
        if entity == "indents":
            row.setdefault("created_by", device_id)
            row.setdefault("created_at", now)
        if entity == "lots":
            row.setdefault("received_ts", now)
        names = ", ".join(["id", *row])
        cur.execute(q(f"INSERT INTO {entity} ({names}) VALUES ({','.join('?' * (len(row) + 1))})"), (entity_id, *row.values()))

    if entity == "lots":
        sku = fields.get("asset_sku") or (cur.execute(q("SELECT asset_sku FROM lots WHERE id=?"), (entity_id,)).fetchone() or [None])[0]
        if sku:
            # Derived total: must NOT touch updated_at, or the asset frame that follows
            # (same write, same tablet) loses the LWW comparison to its own lot frame.
            cur.execute(q("UPDATE assets SET qty=(SELECT COALESCE(SUM(qty),0) FROM lots WHERE asset_sku=?) WHERE sku=?"), (sku, sku))

    _audit(cur, ulid, device_id, f"SYNC_{entity.upper()}_{patch.get('status') or patch.get('safety_status') or patch.get('stage') or op}", entity, None, json.dumps(patch), now)
    _ack_state(cur, device_id, ulid)

    notify = None
    if entity in NOTIFY:
        r = cur.execute(q(f"SELECT station_id FROM {entity} WHERE id=?"), (entity_id,)).fetchone()
        if r and r[0]:
            notify = (r[0], entity, entity_id, "STATUS_CHANGE", patch)
    return {"status": "APPLIED", "server_version": 0}, notify


def _apply_asset(cur, ulid, device_id, entity_id, op, patch, vector_clock, ts, now):
    row = cur.execute(q("SELECT qty, version, vector_clock, updated_at FROM assets WHERE id=?" + (" FOR UPDATE" if USE_PG else "")), (entity_id,)).fetchone()
    if not row:
        raise NotFound(f"asset {entity_id} not found")
    qty, version, existing_vc, existing_ts = row[0], row[1] or 1, _loads(row[2]), row[3] or ""
    # Field frames carry the resulting absolute qty for every op (CONSUME/IN/OUT/
    # ADJUST included) — previously only UPSERT was applied and the rest ACKed
    # APPLIED without touching stock.
    new_qty = patch.get("qty", qty)
    new_version = patch.get("version", version + 1)
    if new_qty is not None and float(new_qty) < 0:
        raise Conflict({"status": "CONFLICT_CRITICAL", "server_version": version, "message": "would go negative, rejected"})
    remote_vc = _loads(vector_clock)
    cmp = compare_vc(existing_vc, remote_vc)
    patch_ts = patch.get("updated_at") or ts or ""
    if cmp == "gt" or (cmp == "concurrent" and existing_ts and patch_ts <= existing_ts):
        _audit(cur, ulid, device_id, f"SYNC_{op}_LOCAL_WINS", "assets", json.dumps({"qty": qty, "version": version}), json.dumps(patch), now)
        _ack_state(cur, device_id, ulid)
        return {"status": "APPLIED_LOCAL_WINS", "server_version": version, "reason": "vc_local_newer" if cmp == "gt" else "lww_local_newer"}
    merged = json.dumps(merge_vc(existing_vc, remote_vc))
    cur.execute(q("UPDATE assets SET qty=?, version=?, updated_at=?, vector_clock=? WHERE id=?"), (new_qty, new_version, now, merged, entity_id))
    _audit(cur, ulid, device_id, f"SYNC_{op}", "assets", json.dumps({"qty": qty, "version": version}), json.dumps(patch), now)
    _ack_state(cur, device_id, ulid, new_version)
    return {"status": "APPLIED", "server_version": new_version}
