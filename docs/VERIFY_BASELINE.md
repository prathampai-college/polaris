# Verify Baseline — CURRENT 2026-09-14

Captured 2026-09-14 on `main` @ `6d6ac94` (P1–P5 DONE). Prior baseline `b74170c` (2026-09-05) archived below.

## Commands
```
npm --prefix shared test
python -m pytest hq/tests -q
node scripts/m1_verify.mjs
node scripts/m2_verify.mjs
node scripts/m3_verify.mjs
node scripts/m4_verify.mjs
node scripts/m5_verify.mjs
node scripts/dtn_verify.mjs
node scripts/snn_verify.mjs
node scripts/tracking_verify.mjs
npx tsc -p shared/tsconfig.json --noEmit
npx tsc -p sync-gateway/tsconfig.json --noEmit
npx tsc -p field/tsconfig.json --noEmit
npx tsc -p hq-dashboard/tsconfig.json --noEmit
```

## Results — CURRENT (P1–P5 done, B+D+C shipped)
- `npm run typecheck`: 4 workspaces pass
- `shared test`: PASS (msgpack roundtrip, wire CRC+AES 195B <2KB, CRC tamper, **patch-only 95.6% saving** `mpEncode({qty})` vs row)`
- `hq/tests`: **27 passed** (added `test_encoder_scaler_matches_training`)
- `snn_verify`: **PASS 6/6 real ONNX** `1546B <2MB p50 ~0.06ms <200ms input->output` (was Math.random dummy)
- `dtn_verify`: 5 pass, `tracking_verify`: 6 pass (`err <0.8m`, SIM-LIDAR 360pts, whiteout)
- `m1→m5 verify`: green (offline 5 → BUNDLED → DTN → DEDUPED, vessel mock, budgets 1.38MB/10k, 231B frames)
- `verify:extreme` + `verify:all`: green

## Results (pre-refactor 2026-09-05)
- `shared test`: PASS (msgpack roundtrip, wire CRC+AES <2KB, CRC tamper, delta vs row 70.9% hardcoded 53)
- `hq/tests`: 26 passed
- `tsc --noEmit`: all 4 projects pass

## Invariant
Every change must keep `npm run typecheck && npm run verify:all && npm run verify:extreme` green before commit. Today 2026-09-14 `443b9a2..6d6ac94` all green.

## Commit Hygiene
- One commit per mini-task: `fix(sync): BUNDLED`, `feat(db): PG pool`, `fix(hq): async notify`, `fix(test): codec live`, `fix(schema): vector_clock` etc. (`git log --oneline -10` is source of truth).
- `shared/dist` gitignored (built by `npm --prefix shared run build` / Docker).
- `ai/snn/thermo_snn.onnx.data` removed (empty external-data stub) — 1546B single-file ONNX is canonical.
