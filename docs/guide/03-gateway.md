# Guide: `sync-gateway/` — the relay

**What it is:** a small Node server that sits between station tablets and HQ. Tablets keep a WebSocket open to it; it forwards their changes to HQ and pushes HQ's changes back.
**Why it exists:** tablets talk in small encrypted binary frames suited to a slow satellite link; HQ speaks plain JSON over HTTP. The gateway translates, and gives HQ one place to push updates to every connected tablet.
**Tech:** Node 20, TypeScript, the `ws` WebSocket library. No database — it keeps nothing on disk.

## Files

| File | What's in it |
|---|---|
| `src/gateway.ts` | The whole server: HTTP routes, WebSocket handling, forwarding to HQ |
| `src/ack.ts` | `ackStatusFor()` — turns HQ's HTTP reply into the ACK status the tablet acts on |
| `test/gateway.test.mjs` | Checks encryption round-trips and the ACK mapping |

## What it does, step by step

**Tablet connects** → sends `SYNC_INIT` (device id, station, and `since_seq` — the last HQ change it applied). The gateway remembers which station this socket belongs to, then **replays what the tablet missed**: it pages `GET /sync/changes?station_id=…&since=…` from HQ and sends each change as a `DOWNSTREAM_DELTA` with its `seq` and `replay: true`, oldest first. It finishes with `SYNC_INIT_RESP` carrying the station's indents and `caught_up_to` (the last seq sent).

**Tablet sends a change:**
1. Decrypt and check the CRC. If it can't decrypt (wrong key), it sends back a plain `{"type":"KEY_MISMATCH"}` so the tablet can show it.
2. Validate the frame's shape (zod schema from `shared`). Bad shape → `FAILED` ACK.
3. Forward to HQ `POST /sync/ingest` (with the `X-PSK` header — HQ rejects unauthenticated writes). Frames from one tablet are forwarded **one at a time, in order**, so an older value can never overwrite a newer one.
4. Send HQ's answer back as an encrypted ACK:

| HQ replied | Tablet receives | Tablet does |
|---|---|---|
| 200 with a status | that status (`APPLIED`, `DEDUPED`, …) | marks the frame done |
| 5xx, 429, timeout, unreachable | `RETRY` | tries again later |
| other 4xx | `FAILED` | shows it in Comms for a person to handle |

**HQ pushes a change** → `POST /internal/broadcast_delta` (needs the `X-PSK` header). The gateway sends a `DOWNSTREAM_DELTA` (with HQ's `seq`) to every tablet connected for that station. If none is connected nothing is lost: the change is in HQ's `change_log` and replays on the next `SYNC_INIT`.

**HQ asks who is online** → `GET /internal/status` (needs `X-PSK`). Per station: tablets connected now, last time seen, last frame, frames forwarded since start. Kept in memory only. HQ's `/stations/link-health` combines it with DTN arrivals for the dashboard's Link Health page.

**Carried DTN bundles** → `POST /dtn/exchange` (needs `X-PSK`, max 512 KB). Forwarded to HQ `/dtn/ingest_bulk`.

`GET /health` for Docker's health check. A ping every 30 s drops dead connections.

## Configuration

| Env var | Meaning | Default |
|---|---|---|
| `GATEWAY_PORT` | Port to listen on | 8787 |
| `HQ_URL` | Where HQ is | `http://localhost:8000` |
| `PSK_HEX` | 64-hex shared key. Must match HQ and the provisioned tablets | `aaaa…` (dev key — insecure) |
| `INTERNAL_PSK_HEX` | Optional separate key for the HTTP `X-PSK` checks between HQ and the gateway (both directions) | `PSK_HEX` |
| `POLARIS_ENV` | `production` makes the gateway exit on a missing or demo `PSK_HEX` | — |

## Run locally

```bash
npm --prefix sync-gateway run build
```

```bash
node sync-gateway/dist/gateway.js
```

Test:

```bash
npm --prefix sync-gateway test
```
