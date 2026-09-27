import datetime
import json

from ._vc import compare_vc, merge_vc  # noqa: F401  (re-exported; tests import from here)
from .db import utc_now
from .sync_apply import Conflict, Rejected, apply_frame, q


def ingest_bundle(bundle: dict, cur):
    """Apply one DTN bundle inside a SAVEPOINT so a bad bundle never poisons the
    batch (PG aborts the whole txn on any error otherwise). Bundle id == the
    field outbox ULID, so a write that also went over WS dedupes here.

    Returns (result, notify)."""
    bid = bundle.get("bundleId") or bundle.get("bundle_id") or bundle.get("ulid") or ""
    if not bid:
        return {"bundleId": bid, "status": "FAILED", "error": "bundleId required"}, None
    src = bundle.get("src") or bundle.get("device_id") or "mule"
    dst = bundle.get("dstStation") or bundle.get("dst_station")
    vc = bundle.get("vectorClock") or bundle.get("vc") or bundle.get("vector_clock") or {}
    payload = bundle.get("payload") or bundle
    created_at = bundle.get("createdAt") or bundle.get("created_at")
    try:
        ttl = int(bundle.get("ttlSec", bundle.get("ttl", 86400)))
    except (TypeError, ValueError):
        ttl = 86400

    # TTL (mirrors shared/src/dtn/bundle.ts isBundleExpired); unparseable createdAt = unexpired.
    if created_at:
        try:
            ref = datetime.datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
            if ref.tzinfo is None:
                ref = ref.replace(tzinfo=datetime.timezone.utc)
            if (datetime.datetime.now(datetime.timezone.utc) - ref).total_seconds() > ttl:
                return {"bundleId": bid, "status": "EXPIRED"}, None
        except ValueError:
            pass

    cur.execute("SAVEPOINT bundle")
    try:
        ack, notify = apply_frame(
            cur, ulid=bid, device_id=src, entity=payload.get("entity"),
            entity_id=payload.get("entity_id") or payload.get("entityId"),
            op=payload.get("op", "UPSERT"), patch=payload.get("patch") or {},
            vector_clock=vc, ts=created_at,
        )
        if ack["status"] != "DEDUPED":
            cur.execute(q("INSERT INTO dtn_bundles (bundle_id, src, dst_station, payload, vc, custody, created_at, ttl) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING"),
                        (bid, src, dst, json.dumps(payload).encode(), json.dumps(vc), 1 if bundle.get("custody", True) else 0, created_at or utc_now(), ttl))
        cur.execute("RELEASE SAVEPOINT bundle")
        return {"bundleId": bid, **ack}, notify
    except Conflict as c:
        cur.execute("ROLLBACK TO SAVEPOINT bundle")
        return {"bundleId": bid, **c.ack}, None
    except Rejected as e:
        cur.execute("ROLLBACK TO SAVEPOINT bundle")
        return {"bundleId": bid, "status": "FAILED", "error": str(e)}, None
    except Exception as e:
        # DB hiccup — sender keeps custody and retries.
        cur.execute("ROLLBACK TO SAVEPOINT bundle")
        return {"bundleId": bid, "status": "RETRY", "error": str(e)}, None
