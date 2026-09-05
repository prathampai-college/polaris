'use client';
import { toWire as toWireWeb, fromWire as fromWireWeb } from '@shared/codec.web.js';
import { sizeReport, MAX_WIRE_SIZE } from '@shared/codec.web.js';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'ws://localhost:8787';
const PSK_HEX = process.env.NEXT_PUBLIC_PSK_HEX || 'a'.repeat(64);

export const toWire = (frame: unknown, keyHex = PSK_HEX) => toWireWeb(frame, keyHex);
export const fromWire = (wire: Uint8Array, keyHex = PSK_HEX) => fromWireWeb(wire, keyHex);

export type SyncStats = { sent: number; acked: number; deduped: number; pending: number; receivedDeltas: number; savingPct?: number; bundled?: number; custody?: number };

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
          const { applyDownstreamIndent, applyDownstreamAsset, applyDownstreamVessel } = await import('./db');
          if (frame.entity === 'indents') {
            await applyDownstreamIndent(String(frame.entity_id), frame.patch as Record<string, unknown>);
          } else if (frame.entity === 'assets') {
            await applyDownstreamAsset(String(frame.entity_id), frame.patch as Record<string, unknown>);
          } else if (frame.entity === 'vessels') {
            await applyDownstreamVessel(String(frame.entity_id), frame.patch as Record<string, unknown>);
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
          // Phase 1: bundles in SYNC_INIT_RESP
          if (Array.isArray((frame as any).bundles) && (frame as any).bundles.length) {
            const { getDb } = await import('./db');
            const db = await getDb();
            for (const b of (frame as any).bundles as any[]) {
              try {
                const payload = typeof b.payload === 'string' ? JSON.parse(b.payload) : b.payload;
                const { applyDownstreamAsset, applyDownstreamIndent } = await import('./db');
                if (payload?.entity === 'assets') await applyDownstreamAsset(String(payload.entity_id), payload.patch as any);
                if (payload?.entity === 'indents') await applyDownstreamIndent(String(payload.entity_id), payload.patch as any);
              } catch {}
            }
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
    if (this.draining) return;
    this.draining = true;
    try {
      const { getDb } = await import('./db');
      const db = await getDb();
      // If offline, bundle instead of send
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        const rows = db.selectObjects("SELECT * FROM outbox WHERE status IN ('PENDING','SENT') ORDER BY created_at LIMIT 20") as Array<Record<string, unknown>>;
        if (rows.length) {
          const { createAndSaveMuleBundle } = await import('./dtn/mule');
          for (const r of rows) {
            const { decode } = await import('@msgpack/msgpack');
            const patch = decode(r.patch as Uint8Array) as Record<string, unknown>;
            const vc = r.vector_clock ? JSON.parse(r.vector_clock as string) : { [String(r.device_id)]: 1 };
            const bundlePayload = { entity: String(r.entity), entity_id: String(r.entity_id), op: String(r.op), patch, base_version: r.base_version as number };
            await createAndSaveMuleBundle({ src: String(r.device_id), dstStation: this.stationId, payload: bundlePayload, vc });
            db.exec({ sql: "UPDATE outbox SET status='BUNDLED' WHERE ulid=?", bind: [r.ulid] });
          }
          this.stats.bundled = (db.selectValue("SELECT COUNT(*) FROM dtn_bundles") as number) || 0;
        }
        return;
      }
      const rows = db.selectObjects("SELECT * FROM outbox WHERE status IN ('PENDING','SENT') ORDER BY created_at LIMIT 20") as Array<Record<string, unknown>>;
      this.stats.pending = db.selectValue("SELECT COUNT(*) FROM outbox WHERE status IN ('PENDING','SENT')") as number;
      this.stats.bundled = db.selectValue("SELECT COUNT(*) FROM dtn_bundles") as number;
      // Try push bundles via HTTP when online (DTN mule flush)
      try {
        const { pushBundlesToHQ } = await import('./dtn/mule');
        const hqUrl = process.env.NEXT_PUBLIC_HQ_URL || 'http://localhost:8000';
        const bundled = db.selectValue("SELECT COUNT(*) FROM dtn_bundles") as number;
        if (bundled > 0) {
          await pushBundlesToHQ(hqUrl).catch(() => {});
        }
      } catch {}
      for (const r of rows) {
        const { decode } = await import('@msgpack/msgpack');
        const patch = decode(r.patch as Uint8Array) as Record<string, unknown>;
        const vc = r.vector_clock ? JSON.parse(r.vector_clock as string) : undefined;
        const frame: Record<string, unknown> = { ulid: r.ulid, device_id: r.device_id, entity: r.entity, entity_id: r.entity_id, op: r.op, patch, base_version: r.base_version, ts: r.created_at };
        if (vc) frame.vector_clock = vc;
        const { savingPct } = sizeReport(frame);
        this.stats.savingPct = savingPct;
        const wire = await toWire(frame);
        if (wire.length > MAX_WIRE_SIZE) { console.warn('[sync] frame >2KB', wire.length); continue; }
        (this.ws as unknown as { send(d: Uint8Array): void }).send(wire);
        this.stats.sent++;
        if (r.status === 'PENDING') db.exec({ sql: "UPDATE outbox SET status='SENT', retry_count=retry_count+1 WHERE ulid=?", bind: [r.ulid] });
      }
    } finally { this.draining = false; }
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.ws?.close();
  }
}

