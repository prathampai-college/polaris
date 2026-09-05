# Verify Baseline — Phase 0

Captured 2026-09-05 on `main` @ `b74170c`.

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

## Results (pre-refactor)
- `shared test`: PASS (msgpack roundtrip, wire CRC+AES <2KB, CRC tamper, delta vs row 70.9%)
- `hq/tests`: 26 passed
- `tsc --noEmit`: all 4 projects pass

## Invariant
Every subsequent phase must re-run `npm run verify:all` + `npm run verify:extreme` and keep green before commit. Diff must be deletion-biased, no behavior change.

## Commit Hygiene
- One commit per phase, message `refactor(phase-N): <slug>`
- Stage only intended files, `git diff --stat` + `git show --stat HEAD` after commit
- Branch: `main` linear for this execution, PR-per-phase simulated as commits
