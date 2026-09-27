# Guide: `shared/` — code both TypeScript apps use

**What it is:** a small TypeScript library imported by `field/`, `sync-gateway/` and `hq-dashboard/` as `@polaris/shared`. It keeps the two ends of the wire agreeing on formats.
**Important:** it must be **built** (`npm --prefix shared run build`) before the other apps can compile — they import from `shared/dist/`.

## Files

| File | What's in it |
|---|---|
| `src/types.ts` | TypeScript types for rows and frames (`Asset`, `Indent`, `DeltaFrame`, `AckFrame`, …) |
| `src/schemas.ts` | zod schemas — runtime validation of the same shapes (the gateway uses `deltaFrameSchema`) |
| `src/codec.ts` / `src/codec.web.ts` | Turn a frame into wire bytes and back: msgpack → AES-GCM encrypt → CRC32. `codec.ts` is for Node, `codec.web.ts` for browsers/workers |
| `src/crc.ts`, `src/wire.ts` | CRC32 and the 2 KB frame size limit |
| `src/dtn/bundle.ts` | DTN bundle format and base64 helpers (for QR hand-off) |
| `src/dtn/vector_clock.ts` | Compare/merge vector clocks |
| `src/seed.ts` | Stations, containers, crates and starting stock the **tablet** seeds with |
| `src/containers.ts` | Container and crate layout used by the 3D views |
| `src/expiry.ts` | `isExpired`, `isExpiringSoon` (≤30 days), `expiryStatus` |
| `src/local_map.ts` | Kalman filter + LiDAR/camera fusion maths (simulated tracking) |
| `src/jwt.ts` | JWT helpers for TypeScript |
| `src/physics.ts`, `src/physics.json` | Fuel-burn physics constants (also read by HQ) |
| `src/snn-config.ts`, `src/url.ts` | SNN settings; ws→http URL conversion |
| `sql/schema.sql` | **HQ's** database schema (Postgres + SQLite) |
| `seed.json` | **HQ's** seed data |
| `vessel_schedule.json` | Scripted ship routes used when there's no live AIS data |
| `test/` | Codec and schema tests |

## Rules

- If you change a frame or row shape, update **`types.ts` and `schemas.ts` together**, then check HQ (`hq/app/sync_apply.py`) and the tablet (`field/lib/db/core.ts`) still agree.
- Never import `codec.ts` (Node crypto) into browser code — use `codec.web.ts`.
- In the field app, import sub-paths (e.g. `@polaris/shared/expiry`) rather than the whole package, so Node-only code doesn't end up in the browser bundle.

## Build & test

```bash
npm --prefix shared run build
```

```bash
npm --prefix shared test
```
