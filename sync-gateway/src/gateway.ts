import { WebSocketServer, WebSocket } from 'ws';
import { encode, decode } from '@msgpack/msgpack';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PORT = Number(process.env.GATEWAY_PORT || 8787);
const HQ_URL = process.env.HQ_URL || 'http://localhost:8000';
const PSK_HEX = process.env.PSK_HEX || 'a'.repeat(64); // 32-byte hex

// CRC32
const CRC_TABLE = (()=>{ const t=new Uint32Array(256); for(let i=0;i<256;i++){ let c=i; for(let k=0;k<8;k++) c=(c&1)?0xEDB88320^(c>>>1):c>>>1; t[i]=c;} return t;})();
function crc32(buf: Uint8Array){ let crc=0xFFFFFFFF; for(let i=0;i<buf.length;i++) crc=CRC_TABLE[(crc^buf[i])&0xFF]^(crc>>>8); return (crc^0xFFFFFFFF)>>>0; }
function encrypt(plain: Uint8Array, keyHex: string){
  const key=Buffer.from(keyHex,'hex'); const nonce=randomBytes(12);
  const c=createCipheriv('aes-256-gcm', key, nonce); const enc=Buffer.concat([c.update(plain), c.final()]); const tag=c.getAuthTag();
  return Buffer.concat([nonce, enc, tag]);
}
function decrypt(frame: Uint8Array, keyHex: string){
  const key=Buffer.from(keyHex,'hex'); const nonce=frame.subarray(0,12); const tag=frame.subarray(frame.length-16); const ct=frame.subarray(12, frame.length-16);
  const d=createDecipheriv('aes-256-gcm', key, nonce); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]);
}
function toWireAck(ack: any, keyHex: string){
  const mp=encode(ack) as Uint8Array; // encode returns Uint8Array
  const enc=encrypt(mp, keyHex); const crc=crc32(enc); const out=new Uint8Array(4+enc.length);
  new DataView(out.buffer).setUint32(0,crc,false); out.set(enc,4); return out;
}
function fromWire(wire: Uint8Array, keyHex: string){
  if(wire.length<4+12+16) throw new Error('wire too short');
  const crcExpected=new DataView(wire.buffer, wire.byteOffset, 4).getUint32(0,false);
  const enc=wire.subarray(4); const crcActual=crc32(enc);
  if(crcActual!==crcExpected) throw new Error(`CRC mismatch expected ${crcExpected.toString(16)} got ${crcActual.toString(16)}`);
  const mp=decrypt(enc, keyHex); return decode(mp);
}

function log(level: string, msg: string, extra: Record<string,unknown>={}) {
  const ts=new Date().toISOString();
  console.log(JSON.stringify({ ts, level, service:'polaris-gateway', msg, ...extra }));
}

const wss = new WebSocketServer({ port: PORT });
log('info', `listening`, { port: PORT, hq: HQ_URL, psk: PSK_HEX.slice(0,8) });

// graceful shutdown (production)
for (const sig of ['SIGTERM','SIGINT'] as const) {
  process.on(sig, ()=>{ log('info', `shutting down on ${sig}`); clearInterval(interval); wss.close(()=>{ log('info','closed'); process.exit(0); }); });
}

wss.on('connection', (ws: WebSocket) => {
  log('info', 'client connected', { clients: wss.clients.size });
  ws.on('pong', ()=> (ws as any).isAlive=true);
  ws.on('message', async (data: Buffer) => {
    const t0=Date.now();
    let frame: any;
    try {
      frame = fromWire(new Uint8Array(data), PSK_HEX);
    } catch (e:any) {
      log('warn', 'wire decode fail', { error: e.message });
      return;
    }
    // validate minimal (zod-like)
    if (!frame.ulid || !frame.device_id || !frame.entity) {
      log('warn', 'invalid frame', { frame });
      return;
    }
    const jsonBytes = Buffer.byteLength(JSON.stringify(frame),'utf8');
    const mpBytes = (encode(frame) as Uint8Array).length;
    const saving = ((jsonBytes - mpBytes)/jsonBytes*100).toFixed(1);
    log('info', 'delta', { entity: frame.entity, id: frame.entity_id, ulid: String(frame.ulid).slice(0,8), device: frame.device_id, patch: frame.patch, jsonBytes, mpBytes, saving: saving+'%', wire: data.length });

    // Forward to HQ FastAPI
    try {
      const res = await fetch(`${HQ_URL}/sync/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(frame)
      });
      const body = await res.json().catch(()=> ({}));
      const ack = {
        ulid: frame.ulid,
        status: body.status || (res.ok ? 'APPLIED' : 'FAILED'),
        server_version: body.server_version,
        message: body.message
      };
      const wireAck = toWireAck(ack, PSK_HEX);
      if (ws.readyState===WebSocket.OPEN) ws.send(wireAck);
      log('info', 'hq ack', { status: ack.status, http: res.status, ms: Date.now()-t0, ulid: String(frame.ulid).slice(0,8) });
    } catch (e:any) {
      log('error', 'hq forward fail', { error: e.message, ulid: String(frame.ulid).slice(0,8) });
      const ack={ ulid: frame.ulid, status:'FAILED', message: e.message };
      try { if (ws.readyState===WebSocket.OPEN) ws.send(toWireAck(ack, PSK_HEX)); } catch {}
    }
  });
  ws.on('close', ()=>log('info','client disconnected', { clients: wss.clients.size }));
});

// keepalive for satellite dropouts
const interval = setInterval(()=>{
  wss.clients.forEach((ws: any)=>{
    if (ws.isAlive===false) return ws.terminate();
    ws.isAlive=false; ws.ping();
  });
}, 30000);
wss.on('close', ()=>clearInterval(interval));
