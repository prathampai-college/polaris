import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { toWire, fromWire, ulid, sizeReport } from '@polaris/shared';
import type { DownstreamDeltaFrame, SyncInitFrame, SyncInitRespFrame, AckFrame } from '@polaris/shared';

const PORT = Number(process.env.GATEWAY_PORT || 8787);
const HQ_URL = process.env.HQ_URL || 'http://localhost:8000';
const PSK_HEX = process.env.PSK_HEX || 'a'.repeat(64);
const MAX_WIRE_SIZE = 2048; // strict 2KB frame budget

if (!/^[0-9a-fA-F]{64}$/.test(PSK_HEX)) {
  console.warn('[polaris-gateway] WARNING: PSK_HEX must be 64 hex chars (32B). Using fallback is insecure for production.');
}

function log(level: string, msg: string, extra: Record<string, unknown> = {}) {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, level, service: 'polaris-gateway', msg, ...extra }));
}

interface ClientMeta {
  deviceId?: string;
  stationId?: string;
  isAlive: boolean;
}

const clients = new Map<WebSocket, ClientMeta>();

function broadcastDownstream(delta: DownstreamDeltaFrame): number {
  const wire = toWire(delta, PSK_HEX);
  let recipientCount = 0;

  for (const [ws, meta] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      if (!delta.station_id || delta.station_id === 'ALL' || !meta.stationId || meta.stationId === delta.station_id) {
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

  // Internal endpoint for HQ to trigger real-time downstream pushes to connected field tablets
  if (req.method === 'POST' && (req.url === '/internal/broadcast_delta' || req.url === '/api/notify_downstream')) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = JSON.parse(raw);

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
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (e as Error).message }));
      return;
    }
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
  clients.set(ws, { isAlive: true });
  log('info', 'client connected', { clients: clients.size });

  ws.on('pong', () => {
    const meta = clients.get(ws);
    if (meta) meta.isAlive = true;
  });

  ws.on('message', async (data: Buffer) => {
    const t0 = Date.now();
    if (data.length > MAX_WIRE_SIZE) {
      log('warn', 'frame exceeds 2KB budget', { length: data.length, max: MAX_WIRE_SIZE });
      return;
    }

    let frame: unknown;
    try {
      frame = fromWire(new Uint8Array(data), PSK_HEX);
    } catch (e: unknown) {
      log('warn', 'wire decode fail', { error: (e as Error).message });
      return;
    }

    const f = frame as Record<string, unknown>;
    if (typeof f !== 'object' || f === null) {
      log('warn', 'invalid frame type', { type: typeof f });
      return;
    }

    // Handle SYNC_INIT handshake from field tablet on connect/reconnect
    if (f.type === 'SYNC_INIT') {
      const initFrame = f as unknown as SyncInitFrame;
      const meta = clients.get(ws);
      if (meta) {
        meta.deviceId = initFrame.device_id;
        meta.stationId = initFrame.station_id;
      }
      log('info', 'sync init handshake', { device: initFrame.device_id, station: initFrame.station_id });

      try {
        const hqRes = await fetch(`${HQ_URL}/indents?station_id=${initFrame.station_id || 'ST-BHARATI'}`, {
          signal: AbortSignal.timeout(5000)
        });
        const indents = hqRes.ok ? await hqRes.json() : [];
        const resp: SyncInitRespFrame = {
          type: 'SYNC_INIT_RESP',
          station_id: initFrame.station_id || 'ST-BHARATI',
          server_time: new Date().toISOString(),
          indents: indents || [],
        };
        const wireResp = toWire(resp, PSK_HEX);
        try {
          if (ws.readyState === WebSocket.OPEN) ws.send(wireResp);
          log('info', 'sync init responded', { station: initFrame.station_id, indentsCount: indents.length });
        } catch (e: unknown) {
          log('error', 'sync init send fail', { error: (e as Error).message });
        }
      } catch (e: unknown) {
        log('error', 'sync init hq fetch fail', { error: (e as Error).message });
      }
      return;
    }

    // Upstream delta frame ingestion
    if (!f.ulid || !f.device_id || !f.entity) {
      log('warn', 'invalid frame structure', { frame: f });
      return;
    }

    const meta = clients.get(ws);
    if (meta && !meta.deviceId) meta.deviceId = String(f.device_id);

    const { jsonBytes, msgpackBytes: mpBytes, savingPct } = sizeReport(f);
    log('info', 'delta', {
      entity: f.entity,
      id: f.entity_id,
      ulid: String(f.ulid).slice(0, 8),
      device: f.device_id,
      patch: f.patch,
      jsonBytes,
      mpBytes,
      saving: savingPct.toFixed(1) + '%',
      wire: data.length,
    });

    try {
      const res = await fetch(`${HQ_URL}/sync/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
        signal: AbortSignal.timeout(10000)
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const ack: AckFrame = {
        type: 'ACK',
        ulid: String(f.ulid),
        status: (body.status as 'APPLIED' | 'DEDUPED' | 'CONFLICT_CRITICAL') || (res.ok ? 'APPLIED' : 'FAILED'),
        server_version: body.server_version as number | undefined,
        message: body.message as string | undefined,
      };
      const wireAck = toWire(ack, PSK_HEX);
      if (ws.readyState === WebSocket.OPEN) ws.send(wireAck);
      log('info', 'hq ack', { status: ack.status, http: res.status, ms: Date.now() - t0, ulid: String(f.ulid).slice(0, 8) });
    } catch (e: unknown) {
      log('error', 'hq forward fail', { error: (e as Error).message, ulid: String(f.ulid).slice(0, 8) });
      const ack: AckFrame = { type: 'ACK', ulid: String(f.ulid), status: 'FAILED', message: (e as Error).message };
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(toWire(ack, PSK_HEX));
      } catch {}
    }
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


