import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { toWire, fromWire, ulid, sizeReport, MAX_WIRE_SIZE, deltaFrameSchema, syncInitSchema } from '@polaris/shared';
import type { DownstreamDeltaFrame, SyncInitFrame, SyncInitRespFrame, AckFrame } from '@polaris/shared';
import { ackStatusFor } from './ack.js';

const PORT = Number(process.env.GATEWAY_PORT || 8787);
const HQ_URL = process.env.HQ_URL || 'http://localhost:8000';
const PSK_HEX = process.env.PSK_HEX || 'a'.repeat(64);

if (!/^[0-9a-fA-F]{64}$/.test(PSK_HEX)) {
  console.warn('[polaris-gateway] WARNING: PSK_HEX must be 64 hex chars (32B). Using fallback is insecure for production.');
}

function log(level: string, msg: string, extra: Record<string, unknown> = {}) {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, level, service: 'polaris-gateway', msg, ...extra }));
}

class HttpError extends Error { constructor(public code: number, msg: string) { super(msg); } }

const MAX_BODY = 512 * 1024; // a full mule batch of <2KB bundles fits many times over
async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    n += b.length;
    if (n > MAX_BODY) throw new HttpError(413, `body > ${MAX_BODY}B`);
    chunks.push(b);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid JSON'); }
}

function pskOk(req: http.IncomingMessage): boolean {
  const hdr = Buffer.from(String(req.headers['x-psk'] || req.headers['x-internal-psk'] || ''));
  const want = Buffer.from(process.env.INTERNAL_PSK_HEX || PSK_HEX);
  return hdr.length === want.length && timingSafeEqual(hdr, want);
}

function sendJson(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

interface ClientMeta {
  deviceId?: string;
  stationId?: string;
  isAlive: boolean;
  // Frames from one tablet are forwarded strictly in order: patches carry
  // absolute qty, so concurrent forwarding let an older value land last.
  chain: Promise<void>;
}

const clients = new Map<WebSocket, ClientMeta>();

function broadcastDownstream(delta: DownstreamDeltaFrame): number {
  const wire = toWire(delta, PSK_HEX);
  let recipientCount = 0;

  for (const [ws, meta] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      // A client with no stationId yet (pre-SYNC_INIT) is scoped to nothing —
      // it must not be treated as a match-all and see every station's deltas.
      if (!delta.station_id || delta.station_id === 'ALL' || meta.stationId === delta.station_id) {
        try {
          ws.send(wire);
          recipientCount++;
        } catch (e) {
          log('error', 'broadcast send error', { error: (e as Error).message });
        }
      }
    }
  }

  log('info', 'downstream broadcast', {
    entity: delta.entity,
    entity_id: delta.entity_id,
    op: delta.op,
    station: delta.station_id,
    recipients: recipientCount,
    wireBytes: wire.length,
  });

  return recipientCount;
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health' || req.url === '/api/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'polaris-sync-gateway',
      clients: clients.size,
      ts: new Date().toISOString(),
    }));
    return;
  }

  // DTN exchange: a mule device posts bundles it carried in. Authenticated —
  // this bypasses the per-frame AES path, so it must not be open to the LAN.
  if (req.method === 'POST' && (req.url === '/dtn/exchange' || req.url === '/api/dtn/exchange')) {
    if (!pskOk(req)) return sendJson(res, 401, { error: 'invalid psk' });
    try {
      const body = await readJson(req);
      const bundles = Array.isArray(body.bundles) ? body.bundles : [body.bundle || body];
      const hqRes = await fetch(`${HQ_URL}/dtn/ingest_bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundles }),
        signal: AbortSignal.timeout(10000),
      });
      return sendJson(res, hqRes.status, await hqRes.json().catch(() => ({})));
    } catch (e: unknown) {
      const code = e instanceof HttpError ? e.code : 502;
      log('error', 'dtn exchange error', { error: (e as Error).message });
      return sendJson(res, code, { error: (e as Error).message });
    }
  }

  // Internal endpoint for HQ to trigger real-time downstream pushes to connected field tablets
  if (req.method === 'POST' && (req.url === '/internal/broadcast_delta' || req.url === '/api/notify_downstream')) {
    if (!pskOk(req)) {
      log('warn', 'broadcast_delta unauthorized psk mismatch');
      return sendJson(res, 401, { error: 'invalid psk' });
    }
    try {
      const body = await readJson(req);

      if (!body.entity || !body.entity_id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'entity and entity_id required' }));
        return;
      }

      const deltaFrame: DownstreamDeltaFrame = {
        type: 'DOWNSTREAM_DELTA',
        ulid: body.ulid || ulid(),
        station_id: body.station_id || 'ST-BHARATI',
        entity: body.entity,
        entity_id: body.entity_id,
        op: body.op || 'STATUS_CHANGE',
        patch: body.patch || {},
        ts: body.ts || new Date().toISOString(),
      };

      const recipients = broadcastDownstream(deltaFrame);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'BROADCASTED', recipients, ulid: deltaFrame.ulid }));
      return;
    } catch (e: unknown) {
      log('error', 'broadcast_delta error', { error: (e as Error).message });
      return sendJson(res, e instanceof HttpError ? e.code : 500, { error: (e as Error).message });
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

server.listen(PORT, () => {
  log('info', 'listening', { port: PORT, hq: HQ_URL, psk: PSK_HEX.slice(0, 8) });
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    log('info', `shutting down on ${sig}`);
    clearInterval(interval);
    for (const ws of clients.keys()) ws.terminate(); // wss.close() waits on open clients forever
    wss.close(() => {
      server.close(() => {
        log('info', 'closed');
        process.exit(0);
      });
    });
  });
}

wss.on('connection', (ws: WebSocket) => {
  clients.set(ws, { isAlive: true, chain: Promise.resolve() });
  log('info', 'client connected', { clients: clients.size });

  ws.on('pong', () => {
    const meta = clients.get(ws);
    if (meta) meta.isAlive = true;
  });

  ws.on('message', async (data: Buffer) => {
    const t0 = Date.now();
    if (data.length > MAX_WIRE_SIZE) {
      log('warn', 'frame exceeds 2KB budget', { length: data.length, max: MAX_WIRE_SIZE });
      try {
        // decode ulid if possible to send FAILED ack instead of silent drop
        const tmp = (() => { try { return fromWire(new Uint8Array(data), PSK_HEX) as Record<string, unknown>; } catch { return {}; } })() as Record<string, unknown>;
        const ack: AckFrame = { type: 'ACK', ulid: String(tmp.ulid || 'unknown'), status: 'FAILED', message: `frame >${MAX_WIRE_SIZE}` };
        if (ws.readyState === WebSocket.OPEN) ws.send(toWire(ack, PSK_HEX));
      } catch {}
      return;
    }

    let frame: unknown;
    try {
      frame = fromWire(new Uint8Array(data), PSK_HEX);
    } catch (e: unknown) {
      // Can't encrypt a reply with a key we don't share — plaintext control
      // frame so the tablet can show KEY MISMATCH instead of resending forever.
      log('warn', 'wire decode fail', { error: (e as Error).message });
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KEY_MISMATCH' }));
      return;
    }

    const f = frame as Record<string, unknown>;
    if (typeof f !== 'object' || f === null) {
      log('warn', 'invalid frame type', { type: typeof f });
      return;
    }

    // Handle SYNC_INIT handshake from field tablet on connect/reconnect
    if (f.type === 'SYNC_INIT') {
      const parsedInit = syncInitSchema.safeParse(f);
      if (!parsedInit.success) {
        log('warn', 'invalid sync init frame', { issues: parsedInit.error.issues.slice(0, 3) });
        return;
      }
      const initFrame = parsedInit.data as SyncInitFrame;
      const meta = clients.get(ws);
      if (meta) {
        meta.deviceId = initFrame.device_id;
        meta.stationId = initFrame.station_id;
      }
      log('info', 'sync init handshake', { device: initFrame.device_id, station: initFrame.station_id });

      const station = initFrame.station_id || 'ST-BHARATI';
      try {
        const hqRes = await fetch(`${HQ_URL}/indents?station_id=${encodeURIComponent(station)}`, { signal: AbortSignal.timeout(5000) });
        const indents = hqRes.ok ? await hqRes.json() : [];
        const resp: SyncInitRespFrame = { type: 'SYNC_INIT_RESP', station_id: station, server_time: new Date().toISOString(), indents };
        if (ws.readyState === WebSocket.OPEN) ws.send(toWire(resp, PSK_HEX));
        log('info', 'sync init responded', { station, indentsCount: indents.length });
      } catch (e: unknown) {
        log('error', 'sync init hq fetch fail', { error: (e as Error).message });
      }
      return;
    }

    // Upstream delta frame — validated at the trust boundary before HQ sees it.
    const parsed = deltaFrameSchema.safeParse(f);
    if (!parsed.success) {
      log('warn', 'invalid delta frame', { issues: parsed.error.issues.slice(0, 3) });
      if (typeof f.ulid === 'string' && ws.readyState === WebSocket.OPEN) {
        const nack: AckFrame = { type: 'ACK', ulid: f.ulid, status: 'FAILED', message: 'invalid frame' };
        ws.send(toWire(nack, PSK_HEX));
      }
      return;
    }

    const meta = clients.get(ws)!;
    if (!meta.deviceId) meta.deviceId = String(f.device_id);

    const { jsonBytes, msgpackBytes: mpBytes, savingPct } = sizeReport(f);
    log('info', 'delta', {
      entity: f.entity,
      id: f.entity_id,
      ulid: String(f.ulid).slice(0, 8),
      device: f.device_id,
      jsonBytes,
      mpBytes,
      saving: savingPct.toFixed(1) + '%',
      wire: data.length,
    });

    meta.chain = meta.chain.then(() => forward(ws, f, t0));
  });

  ws.on('error', (err) => {
    log('error', 'websocket client error', { error: err.message });
  });

  ws.on('close', () => {
    clients.delete(ws);
    log('info', 'client disconnected', { clients: clients.size });
  });
});

const interval = setInterval(() => {
  for (const [ws, meta] of clients.entries()) {
    if (meta.isAlive === false) {
      clients.delete(ws);
      ws.terminate();
    } else {
      meta.isAlive = false;
      ws.ping();
    }
  }
}, 30000);

wss.on('close', () => clearInterval(interval));

async function forward(ws: WebSocket, f: Record<string, unknown>, t0: number) {
  let status: number | null = null;
  let body: Record<string, unknown> = {};
  try {
    const res = await fetch(`${HQ_URL}/sync/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(f),
      signal: AbortSignal.timeout(10000),
    });
    status = res.status;
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (e: unknown) {
    log('error', 'hq forward fail', { error: (e as Error).message, ulid: String(f.ulid).slice(0, 8) });
    body = { message: (e as Error).message };
  }
  const ack: AckFrame = {
    type: 'ACK',
    ulid: String(f.ulid),
    status: ackStatusFor(status, body),
    server_version: body.server_version as number | undefined,
    message: (body.message ?? body.detail) as string | undefined,
  };
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(toWire(ack, PSK_HEX));
  } catch {}
  log('info', 'hq ack', { status: ack.status, http: status, ms: Date.now() - t0, ulid: String(f.ulid).slice(0, 8) });
}


