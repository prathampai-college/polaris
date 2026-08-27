import { encode, decode } from '@msgpack/msgpack';
import type { DeltaFrame } from './types.js';
import { crc32 } from './crc.js';
export { crc32 };

export function encodeFrame(frame: DeltaFrame): Uint8Array {
  return encode(frame);
}
export function decodeFrame(buf: Uint8Array): DeltaFrame {
  return decode(buf) as DeltaFrame;
}

/** Size comparison helper for CI logging */
export function sizeReport(frame: DeltaFrame): { jsonBytes: number; msgpackBytes: number; savingPct: number } {
  const jsonBytes = Buffer.byteLength(JSON.stringify(frame), 'utf8');
  const msgpackBytes = encode(frame).length;
  const savingPct = ((jsonBytes - msgpackBytes) / jsonBytes) * 100;
  return { jsonBytes, msgpackBytes, savingPct };
}

// --- AES-GCM helpers (Node crypto) ---
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encryptFrame(plaintext: Uint8Array, keyHex: string): Uint8Array {
  const key = Buffer.from(keyHex, 'hex'); // 32 bytes for AES-256
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // frame: nonce(12) || ciphertext || tag(16)
  return Buffer.concat([nonce, enc, tag]);
}

export function decryptFrame(frame: Uint8Array, keyHex: string): Uint8Array {
  const key = Buffer.from(keyHex, 'hex');
  const nonce = frame.subarray(0, 12);
  const tag = frame.subarray(frame.length - 16);
  const ct = frame.subarray(12, frame.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Wrap encode + encrypt + crc into wire bytes: [4B crc32 BE][encrypted msgpack]  */
export function toWire(frame: DeltaFrame, keyHex: string): Uint8Array {
  const msgpack = encode(frame);
  const encrypted = encryptFrame(msgpack, keyHex);
  const crc = crc32(encrypted);
  const out = new Uint8Array(4 + encrypted.length);
  new DataView(out.buffer).setUint32(0, crc, false);
  out.set(encrypted, 4);
  return out;
}

export function fromWire(wire: Uint8Array, keyHex: string): DeltaFrame {
  if (wire.length < 4 + 12 + 16) throw new Error('wire too short');
  const crcExpected = new DataView(wire.buffer, wire.byteOffset, 4).getUint32(0, false);
  const encrypted = wire.subarray(4);
  const crcActual = crc32(encrypted);
  if (crcActual !== crcExpected) throw new Error(`CRC mismatch: expected ${crcExpected.toString(16)} got ${crcActual.toString(16)}`);
  const msgpack = decryptFrame(encrypted, keyHex);
  return decode(msgpack) as DeltaFrame;
}
