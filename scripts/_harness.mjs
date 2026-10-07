// Shared verify harness — single source for wire crypto + HQ/gateway spawn/wait (m1/m2/m3/m4).
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import { encode, decode } from '@msgpack/msgpack';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import WebSocket from 'ws';

export const PSK_HEX = 'a'.repeat(64);

export function crc32(buf){ const t=new Uint32Array(256); for(let i=0;i<256;i++){ let c=i; for(let k=0;k<8;k++) c=(c&1)?0xEDB88320^(c>>>1):c>>>1; t[i]=c; } let crc=0xFFFFFFFF; for(let i=0;i<buf.length;i++) crc=t[(crc^buf[i])&0xFF]^(crc>>>8); return (crc^0xFFFFFFFF)>>>0; }
export function encryptFrame(plain, keyHex=PSK_HEX){ const key=Buffer.from(keyHex,'hex'); const nonce=randomBytes(12); const c=createCipheriv('aes-256-gcm', key, nonce); const enc=Buffer.concat([c.update(plain), c.final()]); return Buffer.concat([nonce, enc, c.getAuthTag()]); }
export function decryptFrame(frame, keyHex=PSK_HEX){ const key=Buffer.from(keyHex,'hex'); const d=createDecipheriv('aes-256-gcm', key, frame.subarray(0,12)); d.setAuthTag(frame.subarray(frame.length-16)); return Buffer.concat([d.update(frame.subarray(12, frame.length-16)), d.final()]); }
export function toWire(frame, keyHex=PSK_HEX){ const enc=encryptFrame(encode(frame), keyHex); const out=new Uint8Array(4+enc.length); new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(0, crc32(enc), false); out.set(enc, 4); return out; }
export function fromWire(wire, keyHex=PSK_HEX){ const expected=new DataView(wire.buffer, wire.byteOffset, 4).getUint32(0, false); const enc=wire.subarray(4); if(crc32(enc)!==expected) throw new Error('CRC mismatch'); return decode(decryptFrame(enc, keyHex)); }

export function cleanDbs(files){ for(const f of files) try{ fs.unlinkSync(f); }catch{} }

export async function waitForHQ(port, tries=30){ for(let i=0;i<tries;i++){ await sleep(300); try{ const r=await fetch(`http://localhost:${port}/health`); if(r.ok) return await r.json(); }catch{} } throw new Error(`HQ :${port} failed to start`); }

// Verify runs are deterministic by default: no live weather/AIS pollers (a real
// reading landing mid-run changed forecasts and auto-indents). Override per call.
const QUIET_POLLERS = { TELEMETRY_SOURCE:'sim', LIVE_WEATHER_ENABLED:'false', LIVE_AIS_ENABLED:'false', VESSEL_MODE:'mock' };
export function spawnHQ(port, extraEnv={}){ return spawn('python', ['-m','uvicorn','hq.app.main:app','--port',String(port),'--log-level','warning'], { env:{...process.env, ...QUIET_POLLERS, ...extraEnv}, cwd:process.cwd(), stdio:['ignore','pipe','pipe'] }); }

export async function spawnGateway(gwPort, hqPort, psk=PSK_HEX){ const gw=spawn('node', ['sync-gateway/dist/gateway.js'], { env:{...process.env, HQ_URL:`http://localhost:${hqPort}`, GATEWAY_PORT:String(gwPort), PSK_HEX:psk}, stdio:['ignore','pipe','pipe'] }); await sleep(800); return gw; }

export async function connectWs(gwPort){ const ws=new WebSocket(`ws://localhost:${gwPort}`); await new Promise((res, rej)=>{ ws.on('open', res); ws.on('error', rej); setTimeout(()=>rej(new Error('ws timeout')),5000); }); return ws; }

/** HQ writes need a JWT. Demo-elevated admin login (HQ-COMMAND- device prefix). */
export async function hqAuthHeaders(base){ const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:'HQ-COMMAND-VERIFY',pin:'BHARATI-2024',station_id:'ST-BHARATI',role:'NCPOR_ADMIN'})}); if(!r.ok) throw new Error(`HQ login failed ${r.status}`); const {token}=await r.json(); return {'Content-Type':'application/json', Authorization:`Bearer ${token}`}; }
