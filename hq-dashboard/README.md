# POLARIS HQ Dashboard (`hq-dashboard/`)

Next.js 14 App Router SOC (station operations center) view onto the HQ FastAPI backend (`hq/`). Same Polaris Expedition Palette ("tactical brutalism") design system as `website/` — see `website/README.md` for the token table.

## Stack
- **Next.js 14 App Router** + React 18 + Tailwind (tokens in `tailwind.config.ts`, identical to `website/tailwind.config.js`)
- **motion** (`motion/react`) for reveals/transitions
- **Leaflet 1.9.4 + react-leaflet** for the vessel map (`components/VesselMap.tsx`), with an offline schematic + ETA-pill fallback
- Hand-rolled shadcn-style Radix UI primitives in `components/ui/` (button, tabs, tooltip, dialog, table, card, badge, sheet)

## Run
```bash
npm --prefix hq-dashboard install
npm --prefix hq-dashboard run dev     # http://localhost:3001
```
Needs the HQ API reachable (`NEXT_PUBLIC_HQ_URL`, default `http://localhost:8000`) — see the repo-root `README.md` for the full stack (`docker compose up`).

## Routes
Real App Router pages under `app/(dashboard)/`, sharing a persistent shell (`layout.tsx`: `Topbar` + `SidebarNav` + a global emergency-alert banner) instead of the old hash-tab single page:

| Route | Page |
|-------|------|
| `/` | Fleet overview |
| `/forecast` | Thermo forecast (physics + SNN residual) |
| `/stations` | Per-station cards |
| `/inventory` | Lot-level (FEFO) inventory |
| `/indents` | Indent workbench (approval, vessel attach) |
| `/personnel` | Roster, sorties, buddy pairs |
| `/expeditions` | Expedition planner (legs, manifests, readiness, cost) |
| `/audit` | Append-only audit feed |
| `/locate` | Local (non-GPS) position map |
| `/command` | Unified command/timeline feed |

## `lib/`
- `api.ts` — single `HQ` URL resolver (falls back from a baked `localhost` value to `window.location.hostname` on LAN) + a typed `apiFetch`/`api` client that throws `ApiError` with real status/message instead of swallowing failures.
- `auth.ts` — JWT helpers (`getToken`/`setToken`/`clearToken`/`isExpired`/`getRole`).
- `context.tsx` — `DashboardProvider`: selected station, session/login state, telemetry (SSE on `/telemetry/stream` with an 8 s poll fallback — polling now only runs until SSE confirms live, instead of both running forever), and the global active-emergencies feed for the banner.
- `utils.ts` — small shared helpers.

## Components
- `components/nav/{Topbar,Sidebar}.tsx` — the persistent shell chrome.
- `components/ui/*` — design-system primitives shared in spirit (not code) with `website/src/components/ui/`.
- `components/TrendChart.tsx` — shows an honest empty state when telemetry fields are missing; it no longer fabricates fallback data.
- `components/{Container3D,VesselMap,SourceBadge,ErrorBoundary}.tsx` — 3D container X-ray, Leaflet vessel map, live/stale/mock provenance badges, error boundary.

## Notes
- `app/page.tsx` (the old 1,532-line hash-tab single page) is gone — replaced entirely by the `app/(dashboard)/*` routes above.
- `field/` (the polar-camp tablet PWA) has **not** been through this redesign yet and still uses the previous visual language — see the repo-root `README.md`.
