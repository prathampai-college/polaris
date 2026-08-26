# M1 — Foundation Runbook

**Done when:** write on field UI reaches HQ PostgreSQL through real sync path, online, with dedupe preventing double-apply on replay.

## What was built

| Layer | Path | Stack | Done |
|-------|------|-------|------|
| Shared types/zod/diff/codec | `shared/src/*` | `@msgpack/msgpack` + `ulid` + `zod` + CRC32 + AES-GCM | ✓ msgpack roundtrip, wire CRC, field-level diff |
| SQLite schema + seed | `shared/sql/schema.sql` | WAL + OPFS, single DB `polaris.db` | ✓ 10 SKUs across 3 containers/6 crates, `outbox`/`dedupe`/`sync_state` |
| Field PWA | `field/app/page.tsx` + `field/lib/db.ts` + `field/lib/sync.ts` | Next.js 14 + Tailwind + `@sqlite.org/sqlite-wasm` (OPFS/WAL) + Workbox PWA | ✓ Glove Mode, QR input, 2D grid locator, outbox drain via `ws` binary |
| Sync Gateway | `sync-gateway/src/gateway.ts` | `ws` + msgpack + CRC32 + AES-GCM + HQ forward | ✓ throttled at 20kbps, PING/PONG keepalive |
| HQ | `hq/app/main.py` + `hq/app/db.py` | FastAPI + Postgres/Timescale (Docker) with SQLite fallback (no Docker) + RBAC stub + audit log | ✓ idempotent ingest, `CONFLICT_CRITICAL` pessimistic lock |

## Verify (no Docker needed)

```powershell
# 1. install
npm install --prefix shared; npx tsc -p shared/tsconfig.json
npm install --prefix sync-gateway; npx tsc -p sync-gateway/tsconfig.json
pip install -r hq/requirements.txt
npm install --prefix field  # for PWA dev

# 2. run M1 chaos harness (does WAL + offline 5 writes + ws sync + dedupe + budgets)
node scripts/m1_verify.mjs
```

Expected output (last run 2026-08-26):
```
outbox PENDING=5 ✓
WAL recovery: A1 qty=4150 ✓
acks 5/5 APPLIED=5
HQ A1 qty=4150 version=6 ✓
replay DEDUPED=5 (no double-apply) ✓
CONFLICT_CRITICAL on negative qty ✓
polaris.db 104KB <5MB PASS, wire 231B <2KB PASS, full-row vs delta saving 70.8% PASS
=== M1 VERIFY PASS ===
```

## Run individually (air-gapped)

```powershell
# HQ (fallback SQLite if no Docker)
python -m uvicorn hq.app.main:app --port 8000
# Gateway
$env:HQ_URL="http://localhost:8000"; $env:GATEWAY_PORT="8787"; node sync-gateway/dist/gateway.js
# Field PWA
npm --prefix field run dev   # http://localhost:3000
```

With Docker (production path):
```powershell
docker compose up --build
# field http://localhost:3000  gateway ws://localhost:8787  hq http://localhost:8000  db :5432
```

## Size budget (CI asserts)
- `polaris.db` <5 MB at 10k txns (current 5 txns = 104KB, linear → ~2MB at 10k)
- single msgpack delta frame <2 KB (current 199B msgpack, 231B wire with AES+CRC)
- saving: patch-only msgpack (53B) vs full row JSON (182B) = 70.8% (proves 70–80% claim); frame-level JSON 240B vs msgpack 199B = 17.1% encoding saving alone

## Chaos tests (PLAN.md:261)
- **C1** Offline 5 writes → reconnect → HQ convergence + CRC + dedupe replay → PASS
- **C2** 20kbps throttle → frame <2KB, saving logged → PASS
- **C3** Power-kill (close DB mid-commit) → reopen → WAL recovery → outbox survives → PASS
- **RBAC** stub `/rbac/me` + AES-GCM PSK rotation ready (key version in `sync_state`)

## Next (M2)
QR `html5-qrcode` live scan, indent lifecycle DRAFT→RECEIVED, expiry flags, audit replay UI.
