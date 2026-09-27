# POLARIS Field — station tablet app

Next.js 14 (App Router) PWA for station crews. Every write lands in an on-device SQLite database first and syncs to HQ when a link exists, so the app keeps working with no network.

```powershell
npm --prefix shared run build     # @polaris/shared is a file: dependency
npm --prefix field run dev        # http://localhost:3000
npm --prefix field test           # node lib/db/core.test.ts (needs Node >= 22.18 for type stripping)
```

Under Docker this runs as the `field` service (`field/Dockerfile`, port 3000).

## Routes

All screens are real routes under `app/(field)/`. They share the shell in `app/(field)/layout.tsx`, which sends you to `/login` when no session exists.

| Route | Nav label | What it does |
|-------|-----------|--------------|
| `/` | Brief | An action queue sorted by severity (alert, then caution, then info). It lists open emergencies, overdue sorties, EPHEMERAL storage, a rejected sync key, FAILED frames, expired and expiring lots, dispatched indents waiting to be received, and the HQ diesel forecast (`GET /forecast/{station}`, fetched at most once a minute, with its age shown). |
| `/scan` | Scan | Camera QR scan (`components/QrScanner.tsx`, html5-qrcode) or typed code, then +1 IN / −1 CONSUME quick actions. Drill mode adds preset codes. |
| `/inventory` | Stock | Station stock with live lots (FEFO order), expiry state and a per-asset count of unsynced writes. |
| `/muster` | Muster | Emergency triage (ACTIVE → ACK → RESPONDING → RESOLVED, with optional assignee), sorties (buddy rule; a solo sortie needs the override and a STATION_LEAD session), and a muster board of personnel status. Can pull the roster from HQ. |
| `/indents` | Indents | Create DRAFT indents. Receive DISPATCHED ones (sets RECEIVED and books the stock IN). Approval and dispatch happen at HQ. Can pull indents from HQ. |
| `/expeditions` | Cargo | Manifests for this station with custody stages GOA → MUMBAI → CAPETOWN → VESSEL → STATION → CRATE (`lib/db/stages.ts`). Can advance a stage, print a QR label (100 × 70 mm, `qrcode-generator`) and pull plans from HQ. |
| `/locate` | Locate | 2D store plan (containers by bay, crates by expiry state) and a 3D twin (`components/Container3D.tsx`, React Three Fiber). Drill mode adds a simulated LiDAR/camera fix panel (`lib/sensors/`). It is labelled simulated, and it posts to `/tracking/update` only when you switch that on. |
| `/comms` | Comms | Link state, custody ledger, outbox frame list (retry, retry all, or discard FAILED frames, audited), PSK provisioning (paste or scan QR, fingerprint shown), DTN bundle hand-off (QR / text export and import), "pull stock from HQ" (`GET /assets`, filtered to this station). Drill mode adds "cut satellite link". |
| `/settings` | Settings | Theme (Day / Glare or Polar Night), glove mode (56 px touch targets), larger text, drill mode, lock or forget sign-in, and a hold-to-wipe of local data (reseeds the register). |
| `/login` | — | Station, device ID, PIN and role. |

## Shell (`components/shell/`)

- `CommsStrip.tsx`: a sticky status line. It shows the link (LIVE LINK, CONNECTING, NO LINK / DTN STORE-FWD, KEY MISMATCH, LINK CUT · DRILL), the UNSYNCED and FAILED counts, and the last ACK. It also shows warning flags when they apply: EPHEMERAL, STORAGE FAILED, INSECURE HTTP, DEV KEY and OFFLINE UNLOCK. It carries the SOS and lock buttons.
- `Nav.tsx`: `NavRail` (left rail on large screens) and `BottomBar` (5 primary routes plus a "More" sheet).
- `SosSheet.tsx`: pick a type and a location (active sorties, store containers, free text, or LOCATION UNKNOWN), then hold to transmit. A location is required.
- `AssetSheet.tsx`: a global asset sheet, opened from anywhere. It shows lots and movement history, records IN / OUT / CONSUME / ADJUST (the expired-stock override needs a station lead) and links to raising an indent.
- `ScanWedge.tsx`: catches keystroke bursts from a hardware (keyboard-wedge) scanner outside text fields and opens the asset.
- `Banners.tsx`: the Drill banner, and an Emergency banner shown on every screen until the emergency is resolved.
- `Toaster.tsx` and `SwRegister.tsx`.

The UI kit is in `components/ui/` (button, card, badge, dialog, sheet, tabs, field, hold-button). Design tokens are CSS variables in `app/globals.css` (Day / Glare, Polar Night, and `.glove` / `.bigtext` modifiers), mapped in `tailwind.config.ts`. Fonts are self-hosted through `@fontsource` (Inter, JetBrains Mono, Instrument Serif). An inline script in `app/layout.tsx` applies the saved theme before first paint.

## Data layer (`lib/db/`)

| File | Role |
|------|------|
| `worker.ts` | A Web Worker that owns the sqlite-wasm database and the gateway WebSocket. Storage is the OPFS SyncAccessHandle pool (`installOpfsSAHPoolVfs`, file `/polaris.db`), which persists and does not need COOP/COEP headers. If that fails (the usual cause is the app being open in another tab), it falls back to `:memory:` and the UI shows **EPHEMERAL · LOST ON RELOAD**. |
| `core.ts` | The pure data core, which runs in the worker and under plain Node in tests. It holds the schema (`SCHEMA_SQL`) and seed data (stations, containers, crates, assets, and an opening lot `LOT-{sku}-0` / `{sku}-L0` per asset, with the same ids HQ seeds, plus personnel). It also holds the queries, the mutations (with an audit row and outbox frames inside one `BEGIN IMMEDIATE` transaction), FEFO lot consumption, downstream apply, the ACK state machine and DTN bundling. |
| `client.ts` | A typed RPC proxy (`db.recordTx(...)`) and `useLiveQuery(fn, tables)`. The worker posts `changed` events per table and queries re-run on them, with no polling. |
| `stages.ts` | The manifest custody stages, kept dependency-free for UI imports. |

Rules in `core.ts`:

- **FEFO:** CONSUME / OUT draw from lots with the earliest expiry first. Only CONSUME is blocked on expired stock, unless the override is set (audited as `*_OVERRIDE_EXPIRED`). IN creates a new lot. A positive ADJUST folds into the opening lot. `assets.qty` is always the sum of the asset's lots.
- **Outbox frames:** each asset write queues `lots` UPSERT frames plus one `assets` frame. The assets frame carries the resulting absolute `qty`, the version and a vector clock. Other entities (indents, personnel, field_sorties, emergencies, manifests) queue UPSERT patches that contain only the changed fields.
- **Downstream apply** (`applyDownstream`): if this tablet still has unsynced frames (PENDING / SENT / BUNDLED) for that entity row, local wins and the row is skipped. Otherwise the server wins. An asset `qty` from HQ is treated as absolute and reconciled by correcting the opening lot.
- **ACK state machine** (`applyAck`): PENDING → SENT (resent if no ACK within 15 s, `RESEND_AFTER_MS`) → ACKED. ACKED is terminal, and a late FAILED or RETRY never downgrades it. RETRY returns the frame to PENDING with exponential backoff (2 s × 2ⁿ, capped at 120 s). FAILED is permanent until you retry or discard it in Comms. When offline, unsent rows become BUNDLED.
- **DTN:** `bundleOffline` wraps each PENDING / SENT row in a bundle whose `bundleId` is the outbox ULID, so HQ dedupes a write that arrives over both WS and DTN. The TTL is 7 days.

Sync engine (in `worker.ts`):

- It connects to the gateway and sends an encrypted `SYNC_INIT`. On `SYNC_INIT_RESP` it applies the station's indents.
- Every 2 s it sends up to 8 due frames (`toWire`: msgpack, then AES-GCM with the PSK, then CRC32). A frame over `MAX_WIRE_SIZE` (2048 B) is marked FAILED locally.
- If the link is down, it bundles instead and posts each bundle on `BroadcastChannel('polaris-mule')`, where other same-origin tabs take custody.
- Every 30 s, bundles held for *other* devices are forwarded to the gateway's `POST /dtn/exchange` with `X-PSK`. The tablet's own BUNDLED rows are resent over the WebSocket when the link returns.
- If the gateway replies with plaintext `{"type":"KEY_MISMATCH"}`, or a frame fails to decrypt, the link state becomes `key_mismatch`.
- The PSK is stored in the worker's `kv` table. Until you provision one, the tablet uses the dev key `'a' * 64` and shows DEV KEY. Only the last 4 hex characters are exposed, as a fingerprint.

## Runtime config and sign-in

- `app/api/config/route.ts` serves `{hqUrl, gatewayUrl}` from the env vars `HQ_PUBLIC_URL` and `GATEWAY_PUBLIC_URL`, read at runtime. There are no `NEXT_PUBLIC_*` build args and the PSK is never served. `lib/api.ts` caches the last good value for offline boots, and swaps `localhost` for the host the page was loaded from, so LAN tablets reach the camp server.
- `lib/session.ts`: the first sign-in must reach HQ (`POST /auth/login`). The tablet then stores a salted PBKDF2-SHA256 hash of the PIN (150k iterations), so the same tablet can later unlock offline for its enrolled station with that PIN. **Lock** keeps the enrolment. **Forget** removes it. HQ decides the role, and only device IDs starting with `LEAD-` / `STATION-LEAD-` (or an admin prefix) get STATION_LEAD.
- `lib/field-context.tsx` holds the session, preferences, storage state, sync info, outbox counts, toasts and the global sheet state.

## Offline shell

`public/sw.js` is a hand-written service worker (no Workbox). It precaches every route on install. `/_next/static/`, fonts, wasm and images are served cache-first. Page navigations are network-first with a cached fallback. `/api/*` and cross-origin traffic (HQ, gateway) are never cached. The app also ships `public/manifest.json` and icons (`icon.svg`, `icon-192.png`, `icon-512.png`).

## Known limits

- **Secure context required.** The camera, OPFS and WebCrypto (for PBKDF2 and AES) need HTTPS or `localhost`. On plain `http://<LAN-IP>` they are unavailable and the strip shows **INSECURE HTTP**.
- **One shared PSK** is used by all tablets and the gateway. There are no per-device keys.
- **No real radio.** The DTN "mesh" is `BroadcastChannel`, which only reaches tabs of the same origin on one device. Hand-off between devices is by QR or text.
- **Simulated positions.** Locate's LiDAR/camera fixes are simulated and only appear in drill mode.
- **One tab at a time.** The OPFS SAH pool is exclusive, so a second tab gets EPHEMERAL storage.
