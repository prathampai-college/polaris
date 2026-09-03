import { encode, decode } from '@msgpack/msgpack';
import { ulid } from 'ulid';
import type { VC } from './vector_clock.js';

export interface Bundle {
  bundleId: string; // ulid 26
  src: string; // deviceId
  dstStation: string; // ST-BHARATI etc
  ttlSec: number;
  createdAt: string; // ISO
  vectorClock: VC;
  payload: {
    entity: string;
    entity_id: string;
    op: string;
    patch: Record<string, unknown>;
    base_version?: number;
  };
  custody: boolean;
}

export function createBundle(opts: { src: string; dstStation: string; payload: Bundle['payload']; vc: VC; ttlSec?: number }): Bundle {
  return {
    bundleId: ulid(),
    src: opts.src,
    dstStation: opts.dstStation,
    ttlSec: opts.ttlSec ?? 86400,
    createdAt: new Date().toISOString(),
    vectorClock: opts.vc,
    payload: opts.payload,
    custody: true,
  };
}

export function encodeBundle(b: Bundle): Uint8Array { return encode(b as never); }
export function decodeBundle(buf: Uint8Array): Bundle { return decode(buf) as Bundle; }

export function bundleToBase64(b: Bundle): string {
  const bytes = encodeBundle(b);
  // node + browser safe
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = ''; bytes.forEach(x => s += String.fromCharCode(x));
  return btoa(s);
}
export function bundleFromBase64(b64: string): Bundle {
  let bytes: Uint8Array;
  if (typeof Buffer !== 'undefined') bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  else { const s = atob(b64); bytes = new Uint8Array(s.length); for (let i=0;i<s.length;i++) bytes[i]=s.charCodeAt(i); }
  return decodeBundle(bytes);
}

export function isBundleExpired(b: Bundle): boolean {
  const t = Date.parse(b.createdAt);
  return Date.now() - t > b.ttlSec * 1000;
}
