/**
 * JWT utilities using Web Crypto API (HMAC-SHA256).
 * Works in both Node.js and browser — no external dependencies.
 */
import type { AuthPayload, UserRole } from './types.js';

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  NCPOR_ADMIN: 5,
  HQ_LOGISTICS: 4,
  DISPATCH: 3,
  STATION_LEAD: 3,
  FIELD_OP: 2,
  VIEWER: 1,
};

function base64UrlEncode(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function strToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesToStr(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

async function hmacSign(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign('HMAC', key, data.buffer as ArrayBuffer);
  return new Uint8Array(sig);
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) throw new Error('hex must be even hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out;
}

async function importKey(hex: string): Promise<CryptoKey> {
  const bytes = hexToBytes(hex);
  return crypto.subtle.importKey('raw', bytes.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function b64url(obj: unknown): string {
  return base64UrlEncode(strToBytes(JSON.stringify(obj)));
}

function parseJwtPayload(token: string): AuthPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(bytesToStr(base64UrlDecode(parts[1])));
    return payload as AuthPayload;
  } catch {
    return null;
  }
}

/**
 * Sign a JWT with HMAC-SHA256.
 * @param payload - token claims (sub, role, station_id, device_id)
 * @param secretHex - hex-encoded secret key (at least 32 bytes)
 * @param expiresInDays - token expiry in days (default 30)
 */
export async function signJwt(
  payload: Omit<AuthPayload, 'iat' | 'exp'>,
  secretHex: string,
  expiresInDays: number = 30
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: AuthPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInDays * 86400,
  };
  const header = { alg: 'HS256', typ: 'JWT' };
  const data = `${b64url(header)}.${b64url(fullPayload)}`;
  const key = await importKey(secretHex);
  const sig = await hmacSign(key, strToBytes(data));
  return `${data}.${base64UrlEncode(sig)}`;
}

/**
 * Verify a JWT signature and check expiry.
 * Returns the decoded payload if valid, null otherwise.
 */
export async function verifyJwt(token: string, secretHex: string): Promise<AuthPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const key = await importKey(secretHex);
    const data = `${parts[0]}.${parts[1]}`;
    const sig = base64UrlDecode(parts[2]);
    const valid = await crypto.subtle.verify('HMAC', key, sig.buffer as ArrayBuffer, strToBytes(data).buffer as ArrayBuffer);
    if (!valid) return null;
    const payload = parseJwtPayload(token);
    if (!payload) return null;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Decode JWT payload without verification (for offline use).
 * Field tablets can use this when no server is available.
 */
export function decodeJwtPayload(token: string): AuthPayload | null {
  return parseJwtPayload(token);
}

/**
 * Check if a role has at least the required permission level.
 */
export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0);
}
