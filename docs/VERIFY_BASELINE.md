# Verify Baseline — CURRENT 2026-09-27

Captured after the field-tablet rebuild and sync-backend rework (commits `2ea1c53`, `2cab7b1`, `9ac9520`, `a128183`, `ebd140b`).

## Unit suites (re-run 2026-09-27)

| Command | Result |
|---------|--------|
| `python -m pytest hq/tests -q` | **51 passed** (SQLite fallback). Includes 8 in `hq/tests/test_sync_correctness.py`: CONSUME applies qty, a status patch keeps the name, manifest stage lands, a lot consume keeps expiry, emergency assignee and status timestamp persist, the same ULID over WS + DTN applies once, a bad bundle does not sink the batch, an unknown entity returns 400 |
| `npm --prefix shared test` | PASS: msgpack roundtrip, wire CRC+AES 195 B < 2 KB, CRC tamper detected, patch-only delta 95.6 % smaller than a full row, zod schemas |
| `npm --prefix sync-gateway test` | PASS (4 checks): wire CRC+AES, throttle 20 kbps / 500 ms (5 frames, 865 B → 2.84 s < 5 s), downstream delta wire, ACK mapping (5xx / 429 / network error → RETRY, 4xx → FAILED) |
| `node field/lib/db/core.test.ts` | PASS: seed is idempotent; FEFO consume / IN / ADJUST / insufficient stock; the expired gate applies to CONSUME only; asset and lot frames are queued; ACKED is terminal; RETRY backs off; downstream "unsynced local wins"; HQ stock-take keeps lots summing to qty; bundleId == outbox ULID; station scoping; buddy rule / STATION_LEAD solo override. Needs Node >= 22.18 |

## End-to-end (Docker, 2026-09-27)

- `docker compose up -d --build --wait`: all 5 services (db, hq, gateway, field, hq-dashboard) healthy.
- A tablet CONSUME converged on the Postgres HQ.
- An offline write went to DTN STORE-FWD (BUNDLED). On reconnect it drained and was applied exactly once.
- A wrong key showed KEY MISMATCH. After provisioning the key in Comms, the link went LIVE.
- `node scripts/m1_verify.mjs`: PASS.

These were run by hand and recorded here. CI does not run them. The other `scripts/*_verify.mjs` were not re-run in this capture.

## Commands

```
python -m pytest hq/tests -q
npm --prefix shared test
npm --prefix sync-gateway test
node field/lib/db/core.test.ts          # or: npm --prefix field test
npm run typecheck                       # tsc --noEmit for shared, sync-gateway, field, hq-dashboard
npm run verify                          # m1..m5
npm run verify:extreme                  # shared + hq + dtn/snn/tracking verifies
```

## History

- 2026-09-27 (earlier): `hq/tests` 43 passed. The `POST /sorties` solo-override `await` fix was pinned by `test_sortie_solo_override_requires_station_lead`.
- 2026-09-16: `hq/tests` 34 passed.
- 2026-09-15: real LIF SNN + live-data wiring. `snn_verify` PASS 6/6 (ONNX 375,252 B, p50 ~0.6 ms). `dtn_verify` 5 pass. `tracking_verify` 6 pass. `m3_verify` PASS.
- 2026-09-14 @ `6d6ac94`: `hq/tests` 27 passed. m1–m5 green.
- 2026-09-05: `hq/tests` 26 passed.

## Invariant

Before a commit, keep the unit suites above, plus `npm run typecheck`, green.

## Commit hygiene

- One commit per change (`fix(hq): …`, `feat(field): …`). `git log --oneline` is the source of truth.
- `shared/dist` is gitignored. It is built by `npm --prefix shared run build` or by Docker.
