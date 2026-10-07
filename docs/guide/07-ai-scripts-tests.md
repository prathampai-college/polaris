# Guide: `ai/`, `scripts/`, tests and CI

## `ai/` — training the forecast models

You only need this folder to **retrain** models. HQ uses the finished model files at runtime and does not install the training libraries.

**The idea:** fuel use is predicted by a physics formula (colder, windier = more diesel) plus a small neural network that learns the difference between the formula and reality (the "residual").

| Path | What's in it |
|---|---|
| `training/generate.py` | Makes a synthetic year of weather + fuel data per station (`weather_fuel_history.csv`, not committed) |
| `training/train.py` | Trains the residual model and exports `ai/thermo_residual.onnx` + `ai/scaler.json` |
| `thermo_residual.onnx`, `scaler.json`/`.npz` | The finished model HQ loads (`hq/app/forecast.py`) |
| `snn/train_snn.py` | Trains the alternative spiking-neural-network model (snnTorch) |
| `snn/encoder.py` | Turns inputs into spike trains |
| `runner/infer.mjs`, `runner/telemetry_sim.mjs` | Node versions of inference and a telemetry simulator, used by some verify scripts |
| `requirements.txt` | Training dependencies (torch, snntorch, onnx) |

Retrain:

```bash
pip install -r ai/requirements.txt
```

```bash
python ai/training/generate.py
```

```bash
python ai/training/train.py
```

After training the SNN, run `python scripts/export_snn_config.py` to copy its weights into `shared/src/snn-config.ts`.

**Honest caveat:** the training data is synthetic. The models are a working pipeline, not calibrated against real station fuel logs.

## `scripts/` — tools and end-to-end checks

| Script | What it does | Needs |
|---|---|---|
| `m1_verify.mjs` | Offline writes → reconnect → HQ converges; replay is deduped; negative qty rejected; size budgets | nothing running (starts its own HQ + gateway; port 8787 must be free) |
| `m2_verify.mjs` | Full indent workflow scan → consume → indent → approve → dispatch → receive | same as m1 |
| `m3_verify.mjs` | Forecast + telemetry + auto-critical indent. Every check is a hard assertion (non-zero exit on any FAIL) | same as m1 |
| `m4_verify.mjs` | Chaos tests, RBAC, encryption, audit replay | same as m1 |
| `m5_verify.mjs` | Checks the deliverable files (models, Dockerfiles, pitch docs) exist | nothing |
| `dtn_verify.mjs` | Two offline nodes edit concurrently; bundles merge deterministically | nothing |
| `snn_verify.mjs`, `tracking_verify.mjs` | SNN encoding/power; simulated tracking | nothing |
| `catchup_verify.mjs` | A tablet offline while HQ raises and ACKs an SOS gets both changes on reconnect, in order, station-scoped | nothing running (own HQ :8772 + gateway :8792) |
| `expedition_verify.mjs`, `watchdog_verify.mjs` | Expedition planner; overdue-sortie watchdog (log in via `hqAuthHeaders`) | HQ running on 8000 (or `HQ_URL`) |
| `_harness.mjs` | Shared helpers: spawn HQ/gateway, encrypt frames, `hqAuthHeaders(base)` (demo admin login) | — |
| `import_inventory.mjs` + `template_inventory.csv` | Bulk-load stock into HQ from a CSV | HQ running |
| `template_manifest.csv` | Template for bulk manifest upload | — |
| `provision_station.mjs` | Generates a PSK and a QR code for it | — |
| `calibrate_physics.py` | Fits per-station physics constants | — |
| `record_fallback.ps1` | Records a demo video if a live demo fails | ffmpeg/OBS |

Note: the `m*` scripts simulate a tablet with Node's built-in SQLite and hand-built frames. They test HQ + gateway, **not** the field app's code — that is covered by `field/lib/db/core.test.ts`.

**Verify scripts are isolated and deterministic.** Each spawned HQ gets its own temp database (`HQ_DB_PATH` in the OS temp dir — the dev `hq/app/hq.db` is never touched), and `spawnHQ()` turns the live weather and AIS pollers off by default (`TELEMETRY_SOURCE=sim`, `LIVE_WEATHER_ENABLED=false`, `LIVE_AIS_ENABLED=false`, `VESSEL_MODE=mock`). A real Open-Meteo reading landing mid-run used to change forecasts and make m3 flaky. Pass extra env to `spawnHQ(port, {...})` to override.

## Tests

| What | Command | Covers |
|---|---|---|
| HQ | `python -m pytest hq/tests -q` (from repo root) | API endpoints, sync apply rules (deltas, concurrent consumes, change log), DTN, auth gate, production boot guard, watchdog escalation, auto-pack, link health |
| Python lint | `ruff check .` (config `ruff.toml`) | Undefined names, unused imports/variables, bare `except`, shadowed imports. Not formatting |
| Tablet data core | `node field/lib/db/core.test.ts` (Node ≥ 22.18) | Stock/FEFO, ACK state machine, downstream rule and seq guard, SOS-first ordering, buddy rule, SOS |
| Gateway | `npm --prefix sync-gateway test` | Encryption round-trip, ACK mapping |
| Shared | `npm --prefix shared test` | Codec, schemas |
| Type checks | `npx --prefix field tsc -p field/tsconfig.json --noEmit` (same for `hq-dashboard`, `sync-gateway`) | TypeScript errors |
| Whole stack | `docker compose up -d --build --wait` | All 5 services start healthy |

## CI (`.github/workflows/ci.yml`)

On every push, GitHub Actions runs these jobs:

| Job | Steps |
|---|---|
| `shared` | tests, type check |
| `gateway` | tests, type check |
| `field` | type check, `core.test.ts`, production build |
| `hq` | **ruff**, pytest, compile check, model-size budget |
| `hq-dashboard` | type check, production build |
| `chaos` | m1–m5, watchdog verify (against a live HQ), catch-up verify |
| `docker` | `docker compose up --wait` and health checks on all 5 services |

If CI fails, run the same command locally — the table above has them all. The HQ test conftest also seeds an admin token, so a new write endpoint that forgets a role rule will still pass tests; add a case to `hq/tests/test_auth_gate.py`.
