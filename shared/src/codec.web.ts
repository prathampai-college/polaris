import { encode, decode } from '@msgpack/msgpack';
import { crc32 } from './crc.js';
export { crc32 } from './crc.js';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out;
}

async function encrypt(plain: Uint8Array, keyHex: string): Promise<Uint8Array> {
  const key = hexToBytes(keyHex);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', key as unknown as BufferSource, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as unknown as BufferSource }, cryptoKey, plain as unknown as BufferSource);
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(nonce, 0);
  out.set(new Uint8Array(ct as ArrayBuffer), 12);
  return out;
}

async function decrypt(frame: Uint8Array, keyHex: string): Promise<Uint8Array> {
  const key = hexToBytes(keyHex);
  const nonce = frame.subarray(0, 12);
  const ct = frame.subarray(12);
  const cryptoKey = await crypto.subtle.importKey('raw', key as unknown as BufferSource, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as unknown as BufferSource }, cryptoKey, ct as unknown as BufferSource);
  return new Uint8Array(pt as ArrayBuffer);
}

export async function toWire(frame: unknown, keyHex: string): Promise<Uint8Array> {
  const mp = encode(frame as never);
  const enc = await encrypt(mp, keyHex);
  const crc = crc32(enc);
  const wire = new Uint8Array(4 + enc.length);
  new DataView(wire.buffer).setUint32(0, crc, false);
  wire.set(enc, 4);
  return wire;
}

export async function fromWire(wire: Uint8Array, keyHex: string): Promise<unknown> {
  if (wire.length < 4 + 12 + 16) throw new Error('wire too short');
  const crcExpected = new DataView(wire.buffer, wire.byteOffset, 4).getUint32(0, false);
  const enc = wire.subarray(4);
  const crcActual = crc32(enc);
  if (crcActual !== crcExpected) throw new Error(`CRC mismatch ${crcExpected.toString(16)} vs ${crcActual.toString(16)}`);
  const mp = await decrypt(enc, keyHex);
  return decode(mp);
}
