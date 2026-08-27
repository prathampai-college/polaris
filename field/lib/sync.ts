'use client';
import { encode } from '@msgpack/msgpack';
import { toWire as toWireWeb, fromWire as fromWireWeb } from '@shared/codec.web.js';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'ws://localhost:8787';
const PSK_HEX = process.env.NEXT_PUBLIC_PSK_HEX || 'a'.repeat(64);

export const toWire = (frame: unknown, keyHex = PSK_HEX) => toWireWeb(frame, keyHex);
export const fromWire = (wire: Uint8Array, keyHex = PSK_HEX) => fromWireWeb(wire, keyHex);

export type SyncStats = { sent: number; acked: number; deduped: number; pending: number; savingPct?: number };

export class SyncWorker {
  ws: WebSocket | null = null;
  deviceId: string;
  onAck?: (ack: unknown) => void;
  stats: SyncStats = { sent: 0, acked: 0, deduped: 0, pending: 0 };
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(deviceId: string) {
    this.deviceId = deviceId;
  }
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(GATEWAY_URL);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      console.log('[sync] connected');
      void this.drain();
    };
    ws.onmessage = async (ev: MessageEvent) => {
      const data = new Uint8Array(ev.data as ArrayBuffer);
      try {
        const ack = (await fromWire(data)) as Record<string, unknown>;
        this.stats.acked++;
        if (ack.status === 'DEDUPED') this.stats.deduped++;
        const { getDb } = await import('./db');
        const db = await getDb();
        if (ack.ulid) db.exec({ sql: "UPDATE outbox SET status='ACKED' WHERE ulid=?", bind: [ack.ulid] });
        if (ack.server_version !== undefined)
          db.exec({ sql: 'UPDATE sync_state SET last_acked_ulid=?, last_server_version=? WHERE device_id=?', bind: [ack.ulid, ack.server_version, this.deviceId] });
        this.onAck?.(ack);
      } catch (e) {
        console.error('[sync] ack decode fail', e);
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const { getDb } = await import('./db');
    const db = await getDb();
    const rows = db.selectObjects("SELECT * FROM outbox WHERE status='PENDING' ORDER BY created_at LIMIT 20") as Array<Record<string, unknown>>;
    this.stats.pending = rows.length;
    for (const r of rows) {
      const { decode } = await import('@msgpack/msgpack');
      const patch = decode(r.patch as Uint8Array) as Record<string, unknown>;
      const frame = { ulid: r.ulid, device_id: r.device_id, entity: r.entity, entity_id: r.entity_id, op: r.op, patch, base_version: r.base_version, ts: r.created_at };
      const jsonBytes = new TextEncoder().encode(JSON.stringify(frame)).length;
      const mpBytes = encode(frame as never).length;
      this.stats.savingPct = ((jsonBytes - mpBytes) / jsonBytes) * 100;
      const wire = await toWire(frame);
      if (wire.length > 2048) console.warn('[sync] frame >2KB', wire.length);
      (this.ws as unknown as { send(d: Uint8Array): void }).send(wire);
      this.stats.sent++;
      db.exec({ sql: "UPDATE outbox SET status='SENT' WHERE ulid=?", bind: [r.ulid] });
    }
  }
  async pullFromHQ(hqUrl: string) {
    try {
      const { pullIndentsFromHQ } = await import('./db');
      return await pullIndentsFromHQ(hqUrl);
    } catch (e: unknown) {
      return { pulled: 0, error: (e as Error).message };
    }
  }
  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.ws?.close();
  }
}
