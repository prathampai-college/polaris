# Guide: `website/` — the public site

**What it is:** a one-page marketing / pitch site explaining POLARIS. It is **not** part of the running system — nothing else depends on it, and it never talks to HQ. Deployed on Vercel from `main`.
**Tech:** Vite + React 18, Tailwind, Motion and GSAP for animation, Radix UI primitives.
**Reference:** [website/README.md](../../website/README.md).

## Folder map

| Path | What's in it |
|---|---|
| `index.html` | Page shell; loads Google Fonts |
| `src/main.tsx`, `src/App.tsx` | Entry point; `App` lists the sections in page order |
| `src/sections/` | One file per page section: `Hero`, `Context`, `Capabilities`, `FieldInterface`, `OperationsOverview`, `Vessels`, `Architecture`, `Simulator`, `ApiExplorer`, `Trust`, `Marquee`, `Cta` |
| `src/components/` | `chrome.tsx` (nav + footer), `DtnFlow.tsx` (animated sync diagram), `CrosshairField.tsx` (mouse-tracking background), `canvas/` (burn chart, LiDAR and SNN animations) |
| `src/components/ui/` | Button, dialog, tabs, tooltip |
| `src/lib/data.ts` | All the copy/figures shown on the page (edit text here, not in sections) |
| `src/lib/physics.ts` | The fuel formula used by the interactive simulator |
| `src/lib/tokens.ts`, `tailwind.config.js` | The shared colour palette |

## Common tasks

- **Change wording or numbers** → `src/lib/data.ts`.
- **Reorder or remove a section** → `src/App.tsx`.
- **New section** → add a file to `src/sections/`, then include it in `App.tsx`.

Keep claims honest: the site should only describe things the real system does (see [../ARCHITECTURE.md](../ARCHITECTURE.md) "Known limits").

## Run locally

```bash
npm --prefix website install
```

```bash
npm --prefix website run dev
```
