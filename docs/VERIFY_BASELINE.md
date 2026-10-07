# Verify Baseline — CURRENT 2026-10-07

Captured after the bug-fix, security, sync-robustness and feature work (commits `227504f`, `0106f6c`, `fe1eb72`, `9ac496b`) plus the m3/lint/docs commit that follows them. Every job below was run in a **clean checkout** (a fresh `git worktree` with fresh `npm install`s), the way CI runs it.

## Unit suites and lint

| Command | Result |
|---------|--------|
| `ruff check .` | **All checks passed** (`ruff.toml`: real-bug rules — `E4/E7/E9`, `F`, `B006/B008` — not formatting) |
| `python -m pytest hq/tests -q` | **67 passed** (temp SQLite per run via `hq/tests/conftest.py`). New since the last baseline: auth gate (401/403, role floors, private reads, `X-PSK` on sync, actor from token, production boot guard), watchdog escalation on a later tick, concurrent delta consumes (100 − 5 − 5 = 90, replay exactly-once, negative rejected), change-log catch-up, per-station SNN gate, auto-pack capacity and zones, link health, WATCH → CRITICAL indent escalation |
| `npm --prefix shared test` | PASS: msgpack roundtrip, wire CRC+AES < 2 KB, CRC tamper detected, patch-only delta smaller than a full row, zod schemas |
| `npm --prefix sync-gateway test` | PASS: wire CRC+AES, throttle 20 kbps / 500 ms, downstream delta wire, ACK mapping (5xx / 429 / network → RETRY, 4xx → FAILED) |
| `npm --prefix field test` (`node field/lib/db/core.test.ts`) | PASS. Adds: SOS frame jumps the stock backlog; downstream seq guard (`applied` / `stale` / `held`, then applies after the outbox drains). Needs Node ≥ 22.18 |
| Type checks (`tsc --noEmit`) | shared, sync-gateway, field, hq-dashboard: clean |
| Production builds | `field` and `hq-dashboard`: compiled successfully |

## End-to-end scripts (each spawns its own HQ/gateway on a temp DB, pollers off)

| Script | Result |
|---|---|
| `node scripts/m1_verify.mjs` | PASS |
| `node scripts/m2_verify.mjs` | PASS |
| `node scripts/m3_verify.mjs` | PASS, **6/6 identical runs** (calm > 20 d, blizzard 18.2 d, CRITICAL indent filed). Now fails with a non-zero exit on any check |
| `node scripts/m4_verify.mjs` | PASS |
| `node scripts/m5_verify.mjs` | PASS |
| `node scripts/watchdog_verify.mjs` (live HQ) | PASS — 3 groups |
| `node scripts/expedition_verify.mjs` (live HQ) | PASS — 4 groups |
| `node scripts/catchup_verify.mjs` | PASS — offline tablet receives the SOS + ACK it missed, in seq order, station-scoped |

CI (`.github/workflows/ci.yml`) runs all of the above except `expedition_verify`. Not re-run in this capture: the `docker` job (Docker daemon unavailable on the capture machine) and `dtn_verify` / `snn_verify` / `tracking_verify`. No browser-level UI test exists; the new dashboard and tablet screens were verified by type check and build only.

## Commands

```
ruff check .
python -m pytest hq/tests -q
npm --prefix shared test
npm --prefix sync-gateway test
npm --prefix field test                 # node field/lib/db/core.test.ts
npm run typecheck                       # tsc --noEmit for shared, sync-gateway, field, hq-dashboard
npm run verify                          # m1..m5
node scripts/catchup_verify.mjs
npm run verify:extreme                  # shared + hq + dtn/snn/tracking verifies
```

## History

- 2026-09-27: `hq/tests` 51 passed; m1 PASS; Docker end-to-end healthy (hand-run).
- 2026-09-27 (earlier): `hq/tests` 43 passed. The `POST /sorties` solo-override `await` fix was pinned by `test_sortie_solo_override_requires_station_lead`.
- 2026-09-16: `hq/tests` 34 passed.
- 2026-09-15: real LIF SNN + live-data wiring. `snn_verify` PASS 6/6 (ONNX 375,252 B, p50 ~0.6 ms). `dtn_verify` 5 pass. `tracking_verify` 6 pass. `m3_verify` PASS.
- 2026-09-14 @ `6d6ac94`: `hq/tests` 27 passed. m1–m5 green.
- 2026-09-05: `hq/tests` 26 passed.

## Invariant

Before a commit, keep `ruff check .`, the unit suites above and `npm run typecheck` green.

## Commit hygiene

- One commit per change (`fix(hq): …`, `feat(field): …`). `git log --oneline` is the source of truth.
- `shared/dist` is gitignored. It is built by `npm --prefix shared run build` or by Docker.
