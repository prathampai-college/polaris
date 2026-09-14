# POLARIS Website — Independent Showcase (`website/`)

Standalone, zero-dependency-on-monorepo marketing + mission-control site for POLARIS.
Lives 100% under `website/` — no imports from `../shared`, `../field`, `../hq`. Own Vite + React + Tailwind + anime.js + motion.dev stack.

## Stack
- **Vite 5 + React 18 + Tailwind 3** — isolated, no Next.js, no workspace links
- **anime.js 3** — hero kicker/title stagger, stat pop
- **motion.dev (framer-motion 11)** — scroll progress, hero parallax (`useScroll`/`useTransform`), `whileInView` reveals, DTN stagger
- **Kokonut UI language** — recreated dependency-free: bento grids, glass/gradient borders, beam auroras, spotlight glows, pill badges, dual marquees
- **lucide-react** — icons
- **Custom canvas** — Aurora, LiDAR 360-pt sweep + Kalman dot, SNN 5→32→16→1 spikes, 24h burn chart, DTN custody flow

## Run
```bash
cd website
npm install
npm run dev      # http://localhost:5174
npm run build    # dist/ (static, deploy anywhere)
npm run preview  # serve dist on :5174
```

Verified: `npx tsc --noEmit` clean, `npm run build` ✓ (~378 kB / ~117 kB gzip), `vite preview` → HTML/JS/CSS all HTTP 200.

## Deploy to Vercel (independent)

Yes — this site is 100% Vercel-deployable and fully independent:

- **Zero coupling**: no `file:../shared` links, no `../field` / `../hq` imports (grep-verified), own `package.json` + lockfile, own Tailwind/Vite configs.
- **Zero backend**: pure static SPA — `npm run build` emits `dist/index.html` + hashed JS/CSS. No env vars, no serverless functions, no routing config needed beyond the included SPA fallback.
- **`vercel.json` included**: pins `framework: vite`, `buildCommand: npm run build`, `outputDirectory: dist`, plus an SPA rewrite.

**Steps** (either works):

1. **Dashboard**: Vercel → Add New Project → import repo → set **Root Directory** to `website` → Deploy. (Framework preset auto-detects Vite; `vercel.json` covers the rest.)
2. **CLI**: `cd website && npx vercel --prod`.

No monorepo settings, no build ignore rules, no environment variables required.

## Sections
| # | Section | What's inside |
|---|---------|---------------|
| 0 | Status + Nav | LIVE polar-night pill, Iridium health, PSK/VC/CRC, station switcher (Bharati/Maitri/Himadri) |
| 1 | Hero | Instrument Serif headline, aurora canvas, azimuthal polar SVG map (pulsing active station + Sagar Nidhi), days-to-stockout card (thermal hybrid + SNN watts), 24h burn chart |
| 2 | Marquee | DTN/SNN/LiDAR/vessel ticker |
| 3 | Survival Equation | Why cloud dies at −40°C; 95.6% wire saving; `wire.ts` + audit cards |
| 4 | Three Pillars | I — LiDAR canvas + whiteout toggle (CONF 0.79→0.75); II — SNN canvas + active/idle (0.82→0.08 mW); III — DTN custody flow + add/remove bundles |
| 5 | Live Ops Simulator | Temp −40→−8 + wind 2→26 sliders, calm/blizzard presets, real `physics = 110+0.012(18−T)²+0.9W`, hybrid forecast, vessel-risk pill, inventory table |
| 6 | Field Tablet | Phone-frame PWA mock with 5 working tabs (Today/Inventory/Scan/Indents/Locate) wired to the same live state |
| 7 | HQ Dashboard | SOC mock: 5 KPIs, thermo-hero + burn chart, DB-driven procurement (`need = target − qty`) |
| 8 | Vessels | 3 vessel cards with route SVGs, ETA/SOG pills, provenance (`no_key`/`429`) |
| 9 | Architecture | Edge → SAT → HQ wire diagram, 6 bays / 12 crates / 20 SKUs, single-DDL note |
| 10 | API Playground | Searchable route table + live curl/JQ panel reflecting current temp/wind/station/SNN state |
| 11 | Fleet | 3 station cards with per-station forecasts + provision command |
| 12 | Trust | No-silent-mocks badges, ₹0 hardware, verify:all |
| 13 | CTA + Footer | `docker compose up`, air-gapped proof, sitemap footer |

## Design system
Ink `#020a12`, cyan `#22f0d8`, amber `#ffb84d`, violet `#8b8eff`. Instrument Serif display + Inter + JetBrains Mono. Grain + blueprint grid + cursor glow + rounded-[22px] bento + mono pills.

## File map
```
website/
  index.html  src/main.tsx  src/index.css
  src/lib/data.ts  src/lib/physics.ts
  src/components/chrome.tsx  src/components/DtnFlow.tsx
  src/components/canvas/{Aurora,LidarCanvas,SnnCanvas,BurnChart}.tsx
  src/App.tsx  tailwind.config.js  vite.config.ts  tsconfig.json
```

## Independence proof
- `grep -rn "@polaris/shared|\.\./shared|\.\./field|\.\./hq" src/` → clean (comment only)
- Own `package.json`, `tailwind.config.js`, `vite.config.ts`, `dist/` static
