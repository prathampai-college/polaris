'use client';
import { toWire as toWireWeb, fromWire as fromWireWeb } from '@shared/codec.web.js';
import { sizeReport } from '@shared/codec.web.js';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'ws://localhost:8787';
const PSK_HEX = process.env.NEXT_PUBLIC_PSK_HEX || 'a'.repeat(64);

export const toWire = (frame: unknown, keyHex = PSK_HEX) => toWireWeb(frame, keyHex);
export const fromWire = (wire: Uint8Array, keyHex = PSK_HEX) => fromWireWeb(wire, keyHex);

export type SyncStats = { sent: number; acked: number; deduped: number; pending: number; receivedDeltas: number; savingPct?: number };

export class SyncWorker {
  ws: WebSocket | null = null;
  deviceId: string;
  stationId: string;
  onAck?: (ack: unknown) => void;
  onDownstreamDelta?: (delta: unknown) => void;
  stats: SyncStats = { sent: 0, acked: 0, deduped: 0, pending: 0, receivedDeltas: 0 };
  private timer: ReturnType<typeof setInterval> | null = null;
  private draining = false;

  constructor(deviceId: string, stationId = 'ST-BHARATI') {
    this.deviceId = deviceId;
    this.stationId = stationId;
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(GATEWAY_URL);
    ws.binaryType = 'arraybuffer';

    ws.onopen = async () => {
      console.log('[sync] connected, sending SYNC_INIT');
      try {
        const initFrame = {
          type: 'SYNC_INIT',
          device_id: this.deviceId,
          station_id: this.stationId,
        };
        const wireInit = await toWire(initFrame);
        ws.send(wireInit);
      } catch (e) {
        console.error('[sync] SYNC_INIT failed', e);
      }
      void this.drain();
    };

    ws.onmessage = async (ev: MessageEvent) => {
      const data = new Uint8Array(ev.data as ArrayBuffer);
      try {
        const frame = (await fromWire(data)) as Record<string, unknown>;

        // 1. Handle downstream real-time delta pushes (HQ -> Field via Gateway)
        if (frame.type === 'DOWNSTREAM_DELTA') {
          this.stats.receivedDeltas++;
          const { applyDownstreamIndent, applyDownstreamAsset } = await import('./db');
          if (frame.entity === 'indents') {
            await applyDownstreamIndent(String(frame.entity_id), frame.patch as Record<string, unknown>);
          } else if (frame.entity === 'assets') {
            await applyDownstreamAsset(String(frame.entity_id), frame.patch as Record<string, unknown>);
          }
          this.onDownstreamDelta?.(frame);
          return;
        }

        // 2. Handle initial catch-up sync handshake response
        if (frame.type === 'SYNC_INIT_RESP') {
          const { applyDownstreamSyncInit } = await import('./db');
          if (Array.isArray(frame.indents)) {
            await applyDownstreamSyncInit(frame.indents);
          }
          this.onDownstreamDelta?.(frame);
          return;
        }

        // 3. Handle upstream ACK
        this.stats.acked++;
        if (frame.status === 'DEDUPED') this.stats.deduped++;
        const { getDb } = await import('./db');
        const db = await getDb();
        if (frame.ulid) db.exec({ sql: "UPDATE outbox SET status='ACKED' WHERE ulid=?", bind: [frame.ulid] });
        if (frame.server_version !== undefined) {
          db.exec({
            sql: 'UPDATE sync_state SET last_acked_ulid=?, last_server_version=? WHERE device_id=?',
            bind: [frame.ulid, frame.server_version, this.deviceId],
          });
        }
        this.onAck?.(frame);
      } catch (e) {
        console.error('[sync] message decode fail', e);
      }
    };

    ws.onclose = () => {
      console.log('[sync] closed, retry in 3s');
      setTimeout(() => this.connect(), 3000);
    };

    ws.onerror = (e: Event) => console.error('[sync] ws error', e);
    this.ws = ws;
    if (!this.timer) this.timer = setInterval(() => void this.drain(), 2000);
  }

  async drain() {
    if (this.draining || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.draining = true;
    try {
      const { getDb } = await import('./db');
      const db = await getDb();
      const rows = db.selectObjects("SELECT * FROM outbox WHERE status IN ('PENDING','SENT') ORDER BY created_at LIMIT 20") as Array<Record<string, unknown>>;
      this.stats.pending = db.selectValue("SELECT COUNT(*) FROM outbox WHERE status IN ('PENDING','SENT')") as number;
      for (const r of rows) {
        const { decode } = await import('@msgpack/msgpack');
        const patch = decode(r.patch as Uint8Array) as Record<string, unknown>;
        const frame = { ulid: r.ulid, device_id: r.device_id, entity: r.entity, entity_id: r.entity_id, op: r.op, patch, base_version: r.base_version, ts: r.created_at };
        const { savingPct } = sizeReport(frame);
        this.stats.savingPct = savingPct;
        const wire = await toWire(frame);
        if (wire.length > 2048) { console.warn('[sync] frame >2KB', wire.length); continue; }
        (this.ws as unknown as { send(d: Uint8Array): void }).send(wire);
        this.stats.sent++;
        // keep PENDING until ACK (DEDUPED at HQ ensures idempotency); mark SENT for visibility but retry on next drain
        if (r.status === 'PENDING') db.exec({ sql: "UPDATE outbox SET status='SENT', retry_count=retry_count+1 WHERE ulid=?", bind: [r.ulid] });
      }
    } finally { this.draining = false; }
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.ws?.close();
  }
}

