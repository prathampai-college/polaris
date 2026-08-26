# M2 — Core Logistics Runbook

**Done when:** full workflow scan → consume → indent DRAFT→APPROVED→DISPATCHED→RECEIVED works end-to-end online, and offline.

## What was added on top of M1

| Feature | Path | Detail |
|---------|------|--------|
| QR scanner | `field/components/QrScanner.tsx:1` + `field/package.json:14` | `html5-qrcode` 2.3.8, offline, facingMode environment, fallback text input. Same path as barcode lookup `field/lib/db.ts:99`. |
| Tx IN/OUT/CONSUME/ADJUST | `field/lib/db.ts:120` + `field/app/page.tsx:18` | WAL atomic `BEGIN; UPDATE assets; INSERT transactions; INSERT audit_log; INSERT outbox; COMMIT;`. Quantity + type selector, 48px glove targets `field/app/globals.css:4`. |
| Expiry & cold-chain | `field/lib/db.ts:109` `isExpiringSoon/isExpired` + `field/lib/db.ts:125` guard | `<30d` flag HIGH `field/app/page.tsx:68`, expired MEDICAL/OXYGEN blocks CONSUME without `overrideExpired` + `STATION_LEAD` audit `CONSUME_OVERRIDE_EXPIRED`. HQ also enforces via expiry view `hq/app/main.py:177`. |
| Indents offline | `field/lib/db.ts:150` `createIndent` + `field/lib/db.ts:175` `updateIndentLocal` + `field/lib/db.ts:197` `pullIndentsFromHQ` | Field creates DRAFT → outbox `indents` patch (full row). HQ `POST /indents`, `PATCH /indents/{id}`, `GET /indents` `hq/app/main.py:50`. Sync ingest handles `entity==indents` before asset lookup `hq/app/main.py:214` + `hq/app/main.py:270`, dedupe prevents replay. |
| Sync downstream | `field/lib/sync.ts:76` `SyncWorker.pullFromHQ` polling every 4s `field/app/page.tsx:27` | Field pulls HQ indents and merges LWW. Gateway still `ws` binary delta `231B wire <2KB`. |
| HQ Dashboard | `hq-dashboard/app/page.tsx:1` | Next.js 3001, station overview `GET /stations/overview` `hq/app/main.py:141` (critical_low, open_indents, `42d CI 38-47` placeholder), indent table with Approve/Dispatch, expiring list, audit tail, 2D locator. RBAC `GET /rbac/me`. |
| 2D locator | `field/app/page.tsx:140` `Locator` | CSS grid 7 crates, `{x,y}` coords JSON `field/lib/db.ts:13`, zod validation `shared/src/schemas.ts:14`, highlight on scan `field/app/page.tsx:45`. |
| Audit | `field/lib/db.ts:105` `listAudit` + `hq/app/main.py:28` `GET /audit` | Immutable append-only both SQLite (field) and Postgres (HQ), every indent transition appends `INDENT_CREATE/INDENT_APPROVED/...`. |

## Verify (no Docker)

```powershell
pip install -r hq/requirements.txt
npm install --prefix shared; npx tsc -p shared/tsconfig.json
npm install --prefix sync-gateway; npx tsc -p sync-gateway/tsconfig.json
npm install --prefix field
npm install --prefix hq-dashboard

node scripts/m2_verify.mjs
```

**Last run 2026-08-26:**
```
QR scan FUEL-DIESEL-001 → IN +5 4200→4205 (C1-K1 {0,0})
CONSUME -1 MED-TRAUMA-006 6→5
indent DRAFT A1 qty 200 CRITICAL
expiry: O2 20d FLAG HIGH, Antibiotic 25d HIGH, Expired -602d EXPIRED blocked→override STATION_LEAD ✓
outbox 3 HQ-sync frames <2KB PASS, WAL 4205 ✓
ws 3/3 APPLIED (assets + indent)
HQ A1 qty=4205 ✓, HQ indent DRAFT ✓
HQ APPROVE DRAFT→APPROVED → field pull APPROVED ✓
HQ DISPATCH → field pull DISPATCHED ✓
field RECEIVED → ws → HQ RECEIVED ✓
overview Bharati 3c 10 SKUs low=0 indents=0 forecast 42d CI 38,47 ✓
audit SYNC_INDENT_RECEIVED, INDENT_DISPATCHED, INDENT_APPROVED ✓
dedupe replay 2/2 DEDUPED ✓
=== M2 VERIFY PASS ===
```

Also `node scripts/m1_verify.mjs` still PASS (regression).

## Run

```powershell
# HQ + Gateway + Field + HQ Dashboard
python -m uvicorn hq.app.main:app --port 8000
$env:HQ_URL="http://localhost:8000"; $env:GATEWAY_PORT="8787"; node sync-gateway/dist/gateway.js
npm --prefix field run dev          # http://localhost:3000
npm --prefix hq-dashboard run dev   # http://localhost:3001

# Docker (full fleet air-gapped)
docker compose up --build
# field :3000  hq-dashboard :3001  gateway :8787  hq :8000  db :5432
```

## Demo script (90s)

1. Field tablet (offline): scan QR `FUEL-DIESEL-001` → IN +5 instant, show C1-K1 highlighted `{0,0}`; try CONSUME expired med without override → blocked; with override → audit entry.
2. Create indent DRAFT for diesel 200 CRITICAL offline → outbox PENDING 1.
3. Reconnect → gateway log `3 deltas 231B wire CRC ok`, HQ dashboard shows DRAFT.
4. HQ click Approve → field pulls APPROVED in <4s; HQ Dispatch → field pulls DISPATCHED; field marks RECEIVED → HQ flips RECEIVED live.
5. Show audit tail and station overview `42d (95% CI 38-47)` then M3 will tick to 18d.

## Cut / next (M3)

Thermo ONNX `days_to_stockout` live, telemetry simulator, dynamic horizon auto-escalate. M2 polish stays: HQ trend charts deferred to M5 per PLAN §8.
