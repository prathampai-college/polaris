# POLARIS Website — Independent Showcase (`website/`)

Standalone, zero-dependency-on-monorepo marketing + mission-control site for POLARIS.
Lives 100% under `website/` — no imports from `../shared`, `../field`, `../hq`. Own Vite + React + Tailwind stack.

## Design system — Polaris Expedition Palette ("tactical brutalism")

Hard edges, offset panel shadows (no blur/glow), instrument-panel chrome. Tokens live in `tailwind.config.js` and are shared verbatim with `hq-dashboard/tailwind.config.ts`:

| Token | Hex | Use |
|-------|-----|-----|
| `canvas` — Glacial Sheet | `#EEF2F6` | page background |
| `surface` — Lab Pure White | `#FFFFFF` | cards/panels |
| `structure` — Technical Navy-Charcoal | `#101928` | borders, panel shadow |
| `ink` — Deep Cold Carbon | `#0B0F19` | body text |
| `slate` — Radar Slate | `#5B6776` | secondary text |
| `cobalt` — Antarctic Cobalt | `#0047FF` | primary accent |
| `phosphor` — Cryo Phosphor | `#00C2FF` | telemetry values only |
| `flare` — Hazard Flare | `#FF4800` | alerts only |

Fonts: **Instrument Serif** (display) / **Inter** (sans) / **JetBrains Mono** (data). `boxShadow.panel` = `4px 4px 0 0 #101928` — a hard offset, never a blur.

## Stack
- **Vite 5 + React 18 + Tailwind 3** — isolated, no Next.js, no workspace links
- **motion** (`motion/react`, the successor to framer-motion) — scroll progress (`useScroll`), reveals
- **GSAP + ScrollTrigger** — the scroll-driven tick-rail spine in `App.tsx` (fills top→bottom with scroll progress)
- Hand-rolled shadcn-style Radix UI primitives in `src/components/ui/` (button, tabs, tooltip, dialog)
- **lucide-react** — icons
- **Custom canvas** — LiDAR 360-pt sweep + Kalman dot, SNN 5→32→16→1 spikes, 24h burn chart (`src/components/canvas/`)

`animejs` and the old `framer-motion` package have been removed in favor of `motion` + `gsap`.

## Run
```bash
cd website
npm install
npm run dev      # http://localhost:5174
npm run build    # dist/ (static, deploy anywhere)
npm run preview  # serve dist on :5174
```

## Deploy to Vercel (independent)

Yes — this site is 100% Vercel-deployable and fully independent:

- **Zero coupling**: no `file:../shared` links, no `../field` / `../hq` imports (grep-verified), own `package.json` + lockfile, own Tailwind/Vite configs.
- **Zero backend**: pure static SPA — `npm run build` emits `dist/index.html` + hashed JS/CSS. No env vars, no serverless functions, no routing config needed beyond the included SPA fallback.
- **`vercel.json` included**: pins `framework: vite`, `buildCommand: npm run build`, `outputDirectory: dist`, plus an SPA rewrite.

**Steps** (either works):

1. **Dashboard**: Vercel → Add New Project → import repo → set **Root Directory** to `website` → Deploy. (Framework preset auto-detects Vite; `vercel.json` covers the rest.)
2. **CLI**: `cd website && npx vercel --prod`.

No monorepo settings, no build ignore rules, no environment variables required.

## Sections (`App.tsx` composes `src/sections/*.tsx`)
| # | Component | What's inside |
|---|-----------|----------------|
| — | `chrome.tsx` (`Nav` / `Footer`) | Station switcher (Bharati/Maitri/Himadri), sitemap footer |
| 1 | `Hero.tsx` | Instrument Serif headline, mouse-tracked `CrosshairField` backdrop, days-to-stockout card (hybrid physics + SNN watts), live temp/wind sliders |
| 2 | `Marquee.tsx` | DTN/SNN/LiDAR/vessel ticker |
| 3 | `Context.tsx` | The problem: why a cloud dashboard fails at −40°C and 20–50 kbps |
| 4 | `Capabilities.tsx` | Three edge pillars — LiDAR canvas + whiteout toggle, SNN canvas + active/idle watts, DTN custody flow (add/remove bundles) |
| 5 | `Simulator.tsx` | Live temp/wind sliders driving `thermoHybrid()` (`src/lib/physics.ts`), calm/blizzard presets, vessel-risk pill |
| 6 | `FieldInterface.tsx` | Phone-frame PWA mock, 5 tabs (Today/Inventory/Scan/Indents/Locate) wired to the same live state |
| 7 | `OperationsOverview.tsx` | HQ-style overview: KPIs, burn chart, DB-driven procurement (`need = target − qty`) |
| 8 | `Vessels.tsx` | Vessel cards with route SVGs, ETA/SOG pills, provenance (`no_key`/`429`) |
| 9 | `Architecture.tsx` | Edge → SAT → HQ wire diagram, station/container/SKU counts, single-DDL note |
| 10 | `ApiExplorer.tsx` | Searchable route table + live curl/JQ panel reflecting current temp/wind/station/SNN state |
| 11 | `Trust.tsx` | No-silent-mocks badges, ₹0 hardware, verify:all |
| 12 | `Cta.tsx` | `docker compose up`, air-gapped proof |

## File map
```
website/
  index.html  src/main.tsx  src/index.css
  src/lib/data.ts  src/lib/physics.ts
  src/components/chrome.tsx  src/components/CrosshairField.tsx  src/components/DtnFlow.tsx
  src/components/ui/{button,tabs,tooltip,dialog}.tsx
  src/components/canvas/{LidarCanvas,SnnCanvas,BurnChart}.tsx
  src/sections/{Hero,Marquee,Context,Capabilities,Simulator,FieldInterface,
                OperationsOverview,Vessels,Architecture,ApiExplorer,Trust,Cta}.tsx
  src/App.tsx  tailwind.config.js  vite.config.ts  tsconfig.json
```

## Independence proof
- `grep -rn "@polaris/shared|\.\./shared|\.\./field|\.\./hq" src/` → clean (comment only)
- Own `package.json`, `tailwind.config.js`, `vite.config.ts`, `dist/` static
