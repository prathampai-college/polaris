# Start here — POLARIS in 15 minutes

If you are new to this codebase, read this page first, then the guide for the part you work on. You do not need to read everything.

## 1. What POLARIS does (one paragraph)

India runs research stations in Antarctica (Bharati, Maitri) and the Arctic (Himadri). Staff there must track **stock** (fuel, oxygen, medicine), **people** (who is out in the field, who needs help) and **incoming cargo** — often with **no internet** for hours or days. POLARIS gives the station a tablet app that works fully offline and syncs with headquarters (HQ, in India) whenever a link exists. HQ sees everything on a dashboard and sends plans and approvals back.

## 2. The six parts

```
   STATION (Antarctica)                     satellite link (slow, often down)            HQ (India)
 ┌──────────────────────┐                ┌─────────────────┐     HTTP      ┌───────────────────┐
 │ field/  tablet app   │ ── WebSocket ─▶│ sync-gateway/   │ ────────────▶ │ hq/  FastAPI      │
 │ (Next.js, offline DB)│ ◀─ pushes ─────│ (Node relay)    │ ◀──────────── │ + Postgres        │
 └──────────────────────┘                └─────────────────┘  pushes        └─────────┬─────────┘
          ▲ both import                                                              │ HTTP
   shared/  (types, encryption, seed data)                                ┌───────────▼─────────┐
                                                                          │ hq-dashboard/       │
   website/  public marketing site (not part of the running system)       │ (Next.js, HQ staff) │
                                                                          └─────────────────────┘
```

| Folder | What it is | Language | Runs on | Guide |
|---|---|---|---|---|
| `field/` | Tablet app for station staff. Works offline. | TypeScript, Next.js | port 3000 | [guide/01-field.md](guide/01-field.md) |
| `hq/` | HQ server: API, database, forecasts, background jobs | Python, FastAPI | port 8000 | [guide/02-hq.md](guide/02-hq.md) |
| `sync-gateway/` | Relay between tablets and HQ | TypeScript, Node | port 8787 | [guide/03-gateway.md](guide/03-gateway.md) |
| `shared/` | Code both TypeScript apps import: types, encryption, seed data | TypeScript | (library) | [guide/04-shared.md](guide/04-shared.md) |
| `hq-dashboard/` | Web dashboard for HQ staff | TypeScript, Next.js | port 3001 | [guide/05-hq-dashboard.md](guide/05-hq-dashboard.md) |
| `website/` | Public marketing / pitch site | TypeScript, Vite + React | Vercel | [guide/06-website.md](guide/06-website.md) |

Plus `ai/` (trains the small forecasting models), `scripts/` (end-to-end test scripts and tools) and `hq/tests/` — see [guide/07-ai-scripts-tests.md](guide/07-ai-scripts-tests.md).

## 3. Words you will see everywhere

| Word | Meaning |
|---|---|
| **Station** | A research base. Ids: `ST-BHARATI`, `ST-MAITRI`, `ST-HIMADRI`. |
| **Asset** | One stock line, e.g. "Diesel, 4200 L". Table `assets`. |
| **Lot** | One batch of an asset with its own expiry date. An asset's quantity = sum of its lots. Table `lots`. |
| **FEFO** | "First expiry, first out" — when stock is used, the lot that expires soonest is used first. |
| **Indent** | A resupply request from a station to HQ. Goes DRAFT → APPROVED → DISPATCHED → RECEIVED. |
| **Sortie** | A trip outside the station. Needs two people (buddy rule) unless a station lead overrides. |
| **Emergency / SOS** | Raised from the tablet. Triage goes ACTIVE → ACK → RESPONDING → RESOLVED. |
| **Manifest** | One consignment of expedition cargo. Moves GOA → MUMBAI → CAPETOWN → VESSEL → STATION → CRATE. |
| **Outbox** | The tablet's queue of changes not yet confirmed by HQ. Every local write adds a row here. |
| **Frame** | One outbox row sent over the network (encrypted, under 2 KB). |
| **ACK** | HQ's answer to a frame: `APPLIED`, `DEDUPED` (already had it), `RETRY` (try later), `FAILED` (rejected for good). |
| **ULID** | A unique, time-sortable id. Every frame has one, so HQ can ignore duplicates. |
| **DTN** | "Delay-tolerant networking" — when there is no link, frames are packed into **bundles** that can be carried by another tablet or a QR code. |
| **PSK** | The shared secret key used to encrypt frames between tablets and the gateway. |
| **Drill mode** | A setting on the tablet that shows simulators (fake scans, fake link cut). Off in real use. |
| **Downstream / push** | A change that flows HQ → tablet (e.g. HQ approved an indent). |

## 4. Follow one change end to end

This is the most important flow in the project. A station worker uses 5 litres of diesel:

1. **Tablet UI** — the worker opens the diesel item and taps *Consume −5 L* ([field/components/shell/AssetSheet.tsx](../field/components/shell/AssetSheet.tsx)).
2. **Local database** — the UI calls `db.recordTx(...)`. That runs inside a Web Worker which owns an SQLite database stored on the tablet ([field/lib/db/core.ts](../field/lib/db/core.ts), function `recordTx`). In one transaction it takes 5 L from the oldest lot, updates the asset to 4195 L, records a transaction, and adds **outbox rows** (one for the lot, one for the asset). Each carries the change itself (`delta: -5`), not just the new total, so if another tablet also used diesel offline HQ counts both. The screen updates immediately — no network needed.
3. **Sync engine** — every 2 seconds the worker looks at the outbox ([field/lib/db/worker.ts](../field/lib/db/worker.ts), function `tick`).
   - **Link up:** it encrypts each frame and sends it over a WebSocket to the gateway. Emergencies always go first.
   - **Link down** (or silently dead — no reply for 45 s): it copies the frames into DTN bundles and waits. Nothing is lost.
4. **Gateway** — decrypts and checks the frame, forwards it to HQ `POST /sync/ingest` (authenticated with the `X-PSK` header), and sends HQ's answer back to the tablet as an ACK ([sync-gateway/src/gateway.ts](../sync-gateway/src/gateway.ts)).
5. **HQ** — `apply_frame` ([hq/app/sync_apply.py](../hq/app/sync_apply.py)) checks the ULID was not seen before, adds the −5 L to the lot and the asset in Postgres, writes an audit row, and pushes the new total back to the station's tablets.
6. **Back on the tablet** — the ACK marks the outbox row `ACKED`; the item's history shows "At HQ".
7. **HQ dashboard** — the next time someone opens Inventory, it reads the new quantity from HQ.

The reverse direction (HQ → tablet) works like this: when something changes at HQ that tablets care about, HQ writes it to its `change_log` (numbered, in order), then calls the gateway's `/internal/broadcast_delta`; the gateway pushes a `DOWNSTREAM_DELTA` frame to connected tablets, and the tablet applies it — **unless** the tablet still has its own unsynced change to the same record (then the tablet's version wins for now, and HQ's change is replayed once the tablet's edit is acknowledged). A tablet that was offline asks for everything after the last number it saw when it reconnects, so nothing HQ did while it was away is lost.

## 5. "I need to change X — where do I look?"

| Task | Start here |
|---|---|
| Change a tablet screen | `field/app/(field)/<screen>/page.tsx` |
| Change the tablet's top bar, nav, SOS button | `field/components/shell/` |
| Add a button/input style used everywhere on the tablet | `field/components/ui/` |
| Change what happens when stock is used / an indent is received / an SOS is raised | `field/lib/db/core.ts` → `mutations` |
| Add a new local query for a screen | `field/lib/db/core.ts` → `queries` (then call `db.yourQuery()` from the page) |
| Change retry/offline behaviour | `field/lib/db/worker.ts` (sync engine) |
| Add or change an HQ API endpoint | `hq/app/main.py` (find the route with Ctrl+F on the path) |
| Change how HQ applies a synced change | `hq/app/sync_apply.py` |
| Change who may call an HQ endpoint | `_ROLE_RULES` / `_PRIVATE_READS` / `_PSK_PATHS` in `hq/app/main.py` (the auth gate), tests in `hq/tests/test_auth_gate.py` |
| Push something new from HQ to tablets | call `notify_gateway(...)` in `hq/app/main.py` (it logs the change for offline tablets too) |
| Change the database tables | `shared/sql/schema.sql` (HQ) **and** `SCHEMA_SQL` in `field/lib/db/core.ts` (tablet) |
| Change seed data (stations, stock) | `shared/src/seed.ts` (tablet) and `shared/seed.json` / `hq/app/db.py` (HQ) |
| Change fuel forecasting | `hq/app/forecast.py`, `hq/app/snn_forecast.py`, models in `ai/` |
| Change an HQ dashboard page | `hq-dashboard/app/(dashboard)/<page>/page.tsx` |
| Change colours / fonts | `tailwind.config.*` and `app/globals.css` in each app (same palette everywhere) |
| Change ports, URLs, keys | `docker-compose.yml`, `.env` (copy from `.env.example`) |

## 6. Run it

Everything at once (needs Docker Desktop):

```bash
docker compose up -d --build --wait
```

Then open the tablet at http://localhost:3000 (PIN for Bharati: `BHARATI-2024`) and the HQ dashboard at http://localhost:3001 (sign in with the same PIN — every page is behind the login). HQ's API docs are at http://localhost:8000/docs.

These are demo secrets. For a real deployment set `POLARIS_ENV=production` plus your own `SECRET_KEY`, `PSK_HEX` and `STATION_PINS_JSON` in `.env` — HQ and the gateway refuse to start on the demo ones.

To work on one part without Docker, see "Run locally" in that part's guide.

Run the tests and lint before you push (CI runs the same):

```bash
python -m pytest hq/tests -q
```

```bash
ruff check .
```

```bash
node field/lib/db/core.test.ts
```

```bash
npm --prefix sync-gateway test
```

```bash
npm run verify
```

The last one runs the end-to-end scripts m1–m5; each starts its own HQ (and gateway) on a temp database, so nothing needs to be running.

## 7. Rules the whole codebase follows

- **Offline first.** The tablet never waits for the network to show a result. Every write goes to the local DB and the outbox first.
- **Never fake data.** If a value is missing, show `—` and say why. Simulators only appear in drill mode.
- **One way to apply a change at HQ.** Every synced write goes through `apply_frame`. Don't add a second path.
- **Every HQ write is authenticated, and the audit log names the token, not the request.** Use `_actor(...)` for `created_by`/`actor_id`; never trust a name from the body.
- **Stock moves as deltas.** Send the change (`delta`), not only the new total, so concurrent movements both count.
- **Same palette everywhere.** Colours are tokens (`canvas`, `ink`, `cobalt`, `flare`…), never raw hex in components. `flare` (orange) is only for alerts.
- **Big touch targets.** Tablet controls use `min-h-tap` (44 px, 56 px in glove mode).

## 8. Suggested split for a team of six

| Person | Owns | Main folders |
|---|---|---|
| 1 | Tablet screens & design | `field/app`, `field/components` |
| 2 | Tablet data & sync | `field/lib`, `shared/` |
| 3 | HQ API & database | `hq/app/main.py`, `hq/app/db.py`, `hq/app/sync_apply.py` |
| 4 | Gateway, Docker, CI, scripts | `sync-gateway/`, `docker-compose.yml`, `.github/`, `scripts/` |
| 5 | HQ dashboard | `hq-dashboard/` |
| 6 | Forecasting & website | `ai/`, `hq/app/forecast.py`, `website/` |

## 9. Where the deeper docs are

- [ARCHITECTURE.md](ARCHITECTURE.md) — detailed design, failure modes, security
- [API.md](API.md) — every HQ endpoint
- [VERIFY_BASELINE.md](VERIFY_BASELINE.md) — current test results
- [field/README.md](../field/README.md), [hq-dashboard/README.md](../hq-dashboard/README.md), [website/README.md](../website/README.md) — per-app reference
