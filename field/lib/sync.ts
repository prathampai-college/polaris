'use client';
import { encode, decode } from '@msgpack/msgpack';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'ws://localhost:8787';
const PSK_HEX = process.env.NEXT_PUBLIC_PSK_HEX || 'a'.repeat(64); // demo PSK 32 bytes hex

function crc32(buf: Uint8Array): number {
  const table = new Uint32Array(256);
  for (let i=0;i<256;i++){ let c=i; for(let k=0;k<8;k++) c=(c&1)?0xEDB88320^(c>>>1):c>>>1; table[i]=c; }
  let crc=0xFFFFFFFF; for(let i=0;i<buf.length;i++) crc=table[(crc^buf[i])&0xFF]^(crc>>>8); return (crc^0xFFFFFFFF)>>>0;
}

function hexToBytes(hex: string): Uint8Array {
  const out=new Uint8Array(hex.length/2);
  for(let i=0;i<hex.length;i+=2) out[i/2]=parseInt(hex.slice(i,i+2),16);
  return out;
}
async function encrypt(plain: Uint8Array, keyHex: string): Promise<Uint8Array> {
  const key = hexToBytes(keyHex);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', key as unknown as BufferSource, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv: nonce as unknown as BufferSource }, cryptoKey, plain as unknown as BufferSource);
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(nonce,0); out.set(new Uint8Array(ct as ArrayBuffer),12); return out;
}
async function decrypt(frame: Uint8Array, keyHex: string): Promise<Uint8Array> {
  const key = hexToBytes(keyHex);
  const nonce = frame.subarray(0,12); const ct = frame.subarray(12);
  const cryptoKey = await crypto.subtle.importKey('raw', key as unknown as BufferSource, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv: nonce as unknown as BufferSource }, cryptoKey, ct as unknown as BufferSource);
  return new Uint8Array(pt as ArrayBuffer);
}

export async function toWire(frame: any, keyHex=PSK_HEX): Promise<Uint8Array> {
  const mp = encode(frame);
  const enc = await encrypt(mp, keyHex);
  const crc = crc32(enc);
  const wire = new Uint8Array(4+enc.length);
  new DataView(wire.buffer).setUint32(0,crc,false); wire.set(enc,4); return wire;
}
export async function fromWire(wire: Uint8Array, keyHex=PSK_HEX): Promise<any> {
  const crcExpected = new DataView(wire.buffer, wire.byteOffset, 4).getUint32(0,false);
  const enc = wire.subarray(4); const crcActual = crc32(enc);
  if (crcActual!==crcExpected) throw new Error(`CRC mismatch ${crcExpected.toString(16)} vs ${crcActual.toString(16)}`);
  const mp = await decrypt(enc, keyHex); return decode(mp);
}

export type SyncStats = { sent: number; acked: number; deduped: number; pending: number; savingPct?: number };

export class SyncWorker {
  ws: WebSocket | null = null;
  deviceId: string;
  onAck?: (ack:any)=>void;
  stats: SyncStats = { sent:0, acked:0, deduped:0, pending:0 };
  private timer: any = null;
  constructor(deviceId: string) { this.deviceId=deviceId; }
  connect() {
    if (this.ws && this.ws.readyState===WebSocket.OPEN) return;
    const ws = new WebSocket(GATEWAY_URL);
    ws.binaryType='arraybuffer';
    ws.onopen=()=>{ console.log('[sync] connected'); this.drain(); };
    ws.onmessage= async (ev)=>{
      const data = new Uint8Array(ev.data);
      try {
        const ack = await fromWire(data);
        this.stats.acked++; if (ack.status==='DEDUPED') this.stats.deduped++;
        // mark outbox ACKED
        const { getDb } = await import('./db');
        const db = await getDb();
        if (ack.ulid) db.exec({ sql: "UPDATE outbox SET status='ACKED' WHERE ulid=?", bind:[ack.ulid] });
        if (ack.server_version!==undefined) db.exec({ sql: "UPDATE sync_state SET last_acked_ulid=?, last_server_version=? WHERE device_id=?", bind:[ack.ulid, ack.server_version, this.deviceId] });
        this.onAck?.(ack);
      } catch(e){ console.error('[sync] ack decode fail', e); }
    };
    ws.onclose=()=>{ console.log('[sync] closed, retry in 3s'); setTimeout(()=>this.connect(),3000); };
    ws.onerror=(e)=>console.error('[sync] ws error',e);
    this.ws=ws;
    if (!this.timer) this.timer=setInterval(()=>this.drain(), 2000);
  }
  async drain() {
    if (!this.ws || this.ws.readyState!==WebSocket.OPEN) return;
    const { getDb } = await import('./db');
    const db = await getDb();
    const rows: any[] = db.selectObjects("SELECT * FROM outbox WHERE status='PENDING' ORDER BY created_at LIMIT 20");
    this.stats.pending = rows.length;
    for (const r of rows) {
      const { decode } = await import('@msgpack/msgpack');
      const patch = decode(r.patch as Uint8Array) as Record<string,unknown>;
      const frame = { ulid: r.ulid, device_id: r.device_id, entity: r.entity, entity_id: r.entity_id, op: r.op, patch, base_version: r.base_version, ts: r.created_at };
      const jsonBytes = new TextEncoder().encode(JSON.stringify(frame)).length;
      const mpBytes = encode(frame).length;
      this.stats.savingPct = ((jsonBytes-mpBytes)/jsonBytes)*100;
      const wire = await toWire(frame);
      if (wire.length > 2048) console.warn('[sync] frame >2KB', wire.length);
      // @ts-ignore ws Uint8Array ok at runtime
      this.ws.send(wire as any);
      this.stats.sent++;
      db.exec({ sql: "UPDATE outbox SET status='SENT' WHERE ulid=?", bind:[r.ulid] });
    }
  }
  async pullFromHQ(hqUrl: string) {
    try { const { pullIndentsFromHQ } = await import('./db'); return await pullIndentsFromHQ(hqUrl); } catch (e:any) { return { pulled:0, error:e.message }; }
  }
  disconnect(){ if(this.timer) clearInterval(this.timer); this.ws?.close(); }
}
