# Guide: `hq-dashboard/` — the HQ web dashboard

**What it is:** the website HQ logistics staff use in India to see every station, approve indents, watch forecasts, track ships and handle emergencies.
**Tech:** Next.js 14 (App Router), React 18, Tailwind, recharts (charts), react-three-fiber (3D), Leaflet (map).
**Data:** it has no database of its own — every page reads and writes through the HQ API (`hq/`). It always needs HQ online.
**Reference:** [hq-dashboard/README.md](../../hq-dashboard/README.md).

## Folder map

| Path | What's in it |
|---|---|
| `app/layout.tsx` | Root HTML, fonts |
| `app/(dashboard)/layout.tsx` | The shell: top bar, sidebar, emergency banner, toasts. Wraps pages in `DashboardProvider` |
| `app/(dashboard)/page.tsx` | **Overview** — KPIs, station cards, fuel trend, procurement |
| `app/(dashboard)/forecast/` | **Forecast** — fuel burn charts and procurement needs |
| `app/(dashboard)/stations/` | **Stations** — 3D container view per station |
| `app/(dashboard)/inventory/` | **Inventory** — all stock at HQ's view |
| `app/(dashboard)/indents/` | **Indents** — approve → dispatch (attach a vessel) → track |
| `app/(dashboard)/personnel/` | **Personnel** — rosters, sorties, emergency triage |
| `app/(dashboard)/expeditions/` | **Expeditions** — create an expedition, select one to plan: add voyage legs, add and advance cargo manifests through customs/cold-chain gates, auto-pack, per-station readiness + cost, mutual aid |
| `app/(dashboard)/locate/` | **Locate** — ship map and container view |
| `app/(dashboard)/audit/` | **Audit** — append-only log of every change |
| `app/(dashboard)/command/` | **Command** — timeline and decision overrides |
| `components/nav/` | `Sidebar` (page links) and `Topbar` (station picker, live/polling badge, PIN login) |
| `components/ui/` | Buttons, cards, badges, dialogs, tables, tabs, tooltips — same style as the tablet |
| `components/TrendChart.tsx` | Telemetry chart. Shows an empty state instead of inventing data |
| `components/Container3D.tsx`, `VesselMap.tsx` | 3D store view and ship map (map falls back to a drawn schematic offline) |
| `lib/api.ts` | `api.get/post/patch/put` — calls HQ, throws a clear error on failure |
| `lib/auth.ts` | Stores the JWT, reads the role from it |
| `lib/context.tsx` | App-wide state via `useDashboard()`: selected station, login, toasts, live telemetry, active emergencies |

## Which page calls what

| Page | HQ endpoints |
|---|---|
| Overview | `/stations/overview`, `/forecast/{station}`, `/procurement/{station}`, `/indents` |
| Forecast | `/forecast/{station}`, `/procurement/{station}`, `/telemetry` |
| Stations, Inventory | `/assets` |
| Indents | `/indents`, `/assets`, `/vessels`, `PATCH /indents/{id}` |
| Personnel | `/personnel`, `/sorties`, `/emergencies`, `PATCH /emergency/{id}` |
| Expeditions | `/expeditions`, `PATCH /expeditions/{id}`, `/expeditions/{id}/legs`, `/expeditions/{id}/manifests`, `PATCH .../manifests/{mid}`, `.../auto-pack`, `.../readiness`, `/procurement/mutual-aid` |
| Locate | `/assets` (+ vessels inside `VesselMap`) |
| Audit | `/audit` |
| Command | `/timeline`, `/overrides` |

Live telemetry comes from `/telemetry/stream` (server-sent events) inside `lib/context.tsx`; if that drops it falls back to polling, and stops polling again when the stream returns.

## Adding a page

1. Create `app/(dashboard)/<name>/page.tsx` starting with `'use client'`. Copy the pattern from `app/(dashboard)/page.tsx`: `useDashboard()` for the station, `useEffect` + `api.get(...)` for data, a loading state and an error box.
2. Add a link in `components/nav/Sidebar.tsx`.

## Things that confuse people

- **Approve/dispatch need a login.** `PATCH /indents` requires `STATION_LEAD` or higher — sign in with the PIN in the top bar.
- **HQ URL is baked in at build time** (`NEXT_PUBLIC_HQ_URL`). Unlike the tablet, changing it needs a rebuild.
- **Fonts load from Google at runtime** (not `next/font`), because build-time font fetching broke Docker builds.

## Run locally

```bash
npm --prefix shared run build
```

```bash
npm --prefix hq-dashboard run dev
```

Opens on http://localhost:3001; needs HQ on port 8000.
