# Guide: `field/` — the station tablet app

**What it is:** the app station staff use on a tablet. It must work with no internet, with gloves on, in bright snow or total darkness.
**Tech:** Next.js 14 (App Router), React 18, Tailwind, SQLite compiled to WebAssembly (`@sqlite.org/sqlite-wasm`).
**Deep reference:** [field/README.md](../../field/README.md). This page is the simple version.

## The three layers

```
 Screens (React pages)           field/app/(field)/*/page.tsx
        │  call  db.something()  and  useLiveQuery(...)
        ▼
 Client proxy                     field/lib/db/client.ts     ← runs in the page
        │  postMessage
        ▼
 Web Worker                       field/lib/db/worker.ts     ← runs in a background thread
   ├─ SQLite database on disk     (OPFS = browser's private file storage)
   ├─ data rules                  field/lib/db/core.ts
   └─ sync engine                 WebSocket to the gateway
```

Why a worker? Browsers only allow durable SQLite storage (OPFS) inside a worker. Putting the sync engine in the same worker means database writes and network sends never fight each other.

## Folder map

| Path | What's in it |
|---|---|
| `app/layout.tsx` | Root HTML: fonts, theme script, wraps everything in `FieldProvider` |
| `app/login/page.tsx` | Sign-in screen (station + PIN) |
| `app/(field)/layout.tsx` | The "shell" around every screen: top bar, nav, SOS sheet, asset sheet, toasts. Redirects to `/login` if not signed in |
| `app/(field)/page.tsx` | **Brief** — the home screen: a list of what needs attention, most urgent first |
| `app/(field)/scan/` | **Scan** — camera or typed barcode lookup |
| `app/(field)/inventory/` | **Stock** — searchable list of all stock at this station |
| `app/(field)/muster/` | **Muster** — emergencies, sorties, who is where |
| `app/(field)/indents/` | **Indents** — request resupply from HQ, mark deliveries received |
| `app/(field)/expeditions/` | **Cargo** — incoming expedition cargo and printable crate labels |
| `app/(field)/locate/` | **Locate** — store plan and 3D view of containers and crates |
| `app/(field)/comms/` | **Comms** — sync status, failed frames, sync key, DTN bundles |
| `app/(field)/settings/` | **Settings** — theme, glove mode, drill mode, sign-out, wipe |
| `app/api/config/route.ts` | Tells the tablet where HQ and the gateway are (read from env at runtime) |
| `components/shell/` | Pieces of the shell: `CommsStrip` (top status bar), `Nav`, `SosSheet`, `AssetSheet`, `Banners`, `Toaster`, `ScanWedge` |
| `components/ui/` | Reusable building blocks: `Button`, `Card`, `Badge`, `Dialog`, `Sheet`, `Field`/`Input`/`Stepper`, `HoldButton` |
| `components/Container3D.tsx` | The 3D store view (react-three-fiber) |
| `components/QrScanner.tsx` | Camera barcode scanner |
| `lib/db/core.ts` | **The heart.** Database schema, seed data, every query and every write, sync bookkeeping |
| `lib/db/worker.ts` | Starts SQLite, answers calls from pages, runs the sync engine |
| `lib/db/client.ts` | `db` object pages use + the `useLiveQuery` hook |
| `lib/db/core.test.ts` | Test for core.ts, runs in plain Node |
| `lib/field-context.tsx` | App-wide state: session, preferences, sync status, toasts. Use via `useField()` |
| `lib/session.ts` | Login, logout, offline unlock |
| `lib/api.ts` | Talking to HQ over HTTP (`hq('/path')`) and URL config |
| `lib/labels.ts` | Human names for codes (e.g. `SOS_FIRE` → "Fire") |
| `lib/utils.ts` | Small helpers: `cn` (class names), `ago` ("3m ago"), `clock`, `haptic` |
| `lib/sensors/` | **Simulated** LiDAR tracking, used only in drill mode |
| `public/sw.js` | Service worker: lets the app open with no server connection |

## How a screen gets and changes data

Reading — use `useLiveQuery`. It re-runs automatically when the listed tables change, so there is no polling:

```tsx
const { data: people } = useLiveQuery(() => db.listPersonnel(), ['personnel'], [session.stationId]);
```

Writing — call a mutation and show a toast:

```tsx
try {
  await db.startSortie({ leadId, buddyId, destination, expectedReturn, role: session.role });
  toast('Sortie started', 'ok');
} catch (e) {
  toast((e as Error).message, 'alert');
}
```

You never pass the station or device id — the worker adds them from the signed-in session.

## Adding something new

**A new query** (e.g. "list lots expiring this week"):
1. Add a function to `queries` in `lib/db/core.ts`. Its first two arguments are always `(db, ctx)`.
2. Call it from a page as `db.yourFunction()`. TypeScript picks up the type automatically.

**A new write** (e.g. "mark crate inspected"):
1. Add a function to `mutations` in `lib/db/core.ts`. Inside `withTx(...)`: change the local tables, call `queue(...)` to add an outbox frame, call `audit(...)`.
2. Add the function name and the tables it touches to `TOUCH` in `lib/db/worker.ts`, so screens refresh.
3. Make sure HQ knows the entity and its columns (`ENTITIES` in `hq/app/sync_apply.py`).
4. Add a line to `lib/db/core.test.ts`.

**A new screen:** create `app/(field)/<name>/page.tsx` (copy the structure of `app/(field)/page.tsx`), then add it to `NAV` in `components/shell/Nav.tsx`.

## Sync in plain words

Every outbox row has a status:

| Status | Meaning | Next |
|---|---|---|
| `PENDING` | Saved, not sent yet | Sent when the link is up |
| `SENT` | On the wire, waiting for HQ | Re-sent if no answer in 15 s |
| `BUNDLED` | No link — packed into a DTN bundle | Sent as soon as the link returns |
| `ACKED` | HQ has it. Final. | — |
| `FAILED` | HQ rejected it for good | Someone must retry or discard it in **Comms** |

If HQ is just busy, it answers `RETRY` and the row goes back to `PENDING` with a growing wait.

## Things that confuse people

- **It only works on `https://` or `localhost`.** Browsers switch off OPFS storage, the camera and encryption on plain `http://` LAN addresses. The top bar shows `INSECURE HTTP` when that happens.
- **Only one tab can own the database.** Open a second tab and it falls back to temporary memory storage and shows `EPHEMERAL` in red.
- **The schema lives in two places.** Tablet: `SCHEMA_SQL` in `lib/db/core.ts`. HQ: `shared/sql/schema.sql`. Change both.
- **The seed lives in two places.** Tablet: `shared/src/seed.ts`. HQ: `shared/seed.json`. Keep ids identical (e.g. opening lot `LOT-<sku>-0`).
- **The service worker only runs in production builds** (`next build && next start`), never in `next dev`.
- **`KEY MISMATCH`** means the tablet's sync key differs from the gateway's. Fix it in Comms → Provision key.

## Run locally

```bash
npm --prefix shared run build
```

```bash
npm --prefix field run dev
```

Needs HQ (port 8000) and the gateway (port 8787) running for sync; everything else works without them.

Test:

```bash
node field/lib/db/core.test.ts
```

```bash
npx --prefix field tsc -p field/tsconfig.json --noEmit
```
