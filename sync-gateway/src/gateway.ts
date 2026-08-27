import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { encode } from '@msgpack/msgpack';
import { toWire, fromWire } from '@polaris/shared';

const PORT = Number(process.env.GATEWAY_PORT || 8787);
const HQ_URL = process.env.HQ_URL || 'http://localhost:8000';
const PSK_HEX = process.env.PSK_HEX || 'a'.repeat(64);
const MAX_WIRE_SIZE = 2048; // strict 2KB frame budget

if (!/^[0-9a-fA-F]{64}$/.test(PSK_HEX)) {
  console.warn('[polaris-gateway] WARNING: PSK_HEX must be 64 hex chars (32B). Using fallback is insecure for production.');
}

function toWireAck(ack: unknown, keyHex: string) {
  return toWire(ack as never, keyHex);
}

function log(level: string, msg: string, extra: Record<string, unknown> = {}) {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, level, service: 'polaris-gateway', msg, ...extra }));
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/api/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ status: 'ok', service: 'polaris-sync-gateway', clients: wss.clients.size, ts: new Date().toISOString() }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  log('info', 'listening', { port: PORT, hq: HQ_URL, psk: PSK_HEX.slice(0, 8) });
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    log('info', `shutting down on ${sig}`);
    clearInterval(interval);
    wss.close(() => {
      server.close(() => {
        log('info', 'closed');
        process.exit(0);
      });
    });
  });
}

wss.on('connection', (ws: WebSocket) => {
  log('info', 'client connected', { clients: wss.clients.size });
  ws.on('pong', () => ((ws as unknown as Record<string, unknown>).isAlive = true));
  ws.on('message', async (data: Buffer) => {
    const t0 = Date.now();
    if (data.length > MAX_WIRE_SIZE) {
      log('warn', 'frame exceeds 2KB budget', { length: data.length, max: MAX_WIRE_SIZE });
      return;
    }
    let frame: unknown;
    try {
      frame = fromWire(new Uint8Array(data), PSK_HEX) as unknown;
    } catch (e: unknown) {
      log('warn', 'wire decode fail', { error: (e as Error).message });
      return;
    }
    const f = frame as Record<string, unknown>;
    if (!f.ulid || !f.device_id || !f.entity) {
      log('warn', 'invalid frame structure', { frame: f });
      return;
    }
    const jsonBytes = Buffer.byteLength(JSON.stringify(f), 'utf8');
    const mpBytes = (encode(f) as Uint8Array).length;
    const saving = (((jsonBytes - mpBytes) / jsonBytes) * 100).toFixed(1);
    log('info', 'delta', { entity: f.entity, id: f.entity_id, ulid: String(f.ulid).slice(0, 8), device: f.device_id, patch: f.patch, jsonBytes, mpBytes, saving: saving + '%', wire: data.length });

    try {
      const res = await fetch(`${HQ_URL}/sync/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const ack = {
        ulid: f.ulid,
        status: (body.status as string) || (res.ok ? 'APPLIED' : 'FAILED'),
        server_version: body.server_version,
        message: body.message,
      };
      const wireAck = toWireAck(ack, PSK_HEX);
      if (ws.readyState === WebSocket.OPEN) ws.send(wireAck);
      log('info', 'hq ack', { status: ack.status, http: res.status, ms: Date.now() - t0, ulid: String(f.ulid).slice(0, 8) });
    } catch (e: unknown) {
      log('error', 'hq forward fail', { error: (e as Error).message, ulid: String(f.ulid).slice(0, 8) });
      const ack = { ulid: f.ulid, status: 'FAILED', message: (e as Error).message };
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(toWireAck(ack, PSK_HEX));
      } catch {}
    }
  });
  ws.on('error', (err) => {
    log('error', 'websocket client error', { error: err.message });
  });
  ws.on('close', () => log('info', 'client disconnected', { clients: wss.clients.size }));
});

const interval = setInterval(() => {
  wss.clients.forEach((ws: unknown) => {
    const w = ws as { isAlive?: boolean; terminate(): void; ping(): void };
    if (w.isAlive === false) return w.terminate();
    w.isAlive = false;
    w.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(interval));

