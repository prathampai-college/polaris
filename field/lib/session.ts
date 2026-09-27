'use client';
import { hq, ApiError, load, store } from './api';

export type Role = 'FIELD_OP' | 'STATION_LEAD';
export interface Session { stationId: string; deviceId: string; role: Role; token: string | null; exp: number | null; offlineUnlock: boolean }
interface Enrolment { stationId: string; deviceId: string; role: Role; token: string; exp: number | null; salt: string; hash: string }

const SESSION = 'polaris_session';
const ENROL = 'polaris_enrol';
const DEVICE = 'polaris_device';

export const STATIONS = [
  { id: 'ST-BHARATI', name: 'Bharati', region: 'Antarctica · Larsemann Hills' },
  { id: 'ST-MAITRI', name: 'Maitri', region: 'Antarctica · Schirmacher Oasis' },
  { id: 'ST-HIMADRI', name: 'Himadri', region: 'Arctic · Ny-Ålesund' },
] as const;
export const stationName = (id: string) => STATIONS.find((s) => s.id === id)?.name ?? id;

/** One stable id per tablet (not per login) so HQ audit and the outbox line up across shifts. */
export function deviceId(): string {
  const existing = load<string>(DEVICE);
  if (existing) return existing;
  const id = `TAB-${Math.random().toString(36).slice(2, 6).toUpperCase()}${Date.now().toString(36).slice(-3).toUpperCase()}`;
  store(DEVICE, id);
  return id;
}
export function setDeviceId(id: string) { store(DEVICE, id.trim()); }

export const currentSession = () => load<Session>(SESSION);
export const enrolledStation = () => load<Enrolment>(ENROL)?.stationId ?? null;

function jwtExp(token: string): number | null {
  try {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const exp = JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4))).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

async function pinHash(pin: string, salt: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null; // insecure context (plain http on LAN)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 150_000 }, key, 256);
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Online: HQ verifies the PIN and issues a JWT; a salted PBKDF2 of the PIN is kept
 * so the SAME tablet can unlock later with no link. Offline: only the enrolled
 * station/device, only with that PIN. HQ still gates every server-side action.
 */
export async function login(o: { stationId: string; pin: string; role: Role; deviceId: string }): Promise<Session> {
  try {
    const r = await hq<{ token: string; role: Role; station_id: string; device_id: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ station_id: o.stationId, pin: o.pin.trim(), role: o.role, device_id: o.deviceId }),
    });
    const s: Session = { stationId: r.station_id, deviceId: r.device_id, role: r.role === 'STATION_LEAD' ? 'STATION_LEAD' : 'FIELD_OP', token: r.token, exp: jwtExp(r.token), offlineUnlock: false };
    const salt = `${s.deviceId}:${s.stationId}:${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
    const hash = await pinHash(o.pin.trim(), salt);
    if (hash) store(ENROL, { stationId: s.stationId, deviceId: s.deviceId, role: s.role, token: r.token, exp: s.exp, salt, hash } satisfies Enrolment);
    store(SESSION, s);
    return s;
  } catch (e) {
    if (!(e instanceof ApiError) || !e.offline) throw e;
    const en = load<Enrolment>(ENROL);
    if (!en) throw new Error('HQ unreachable and this tablet has never signed in online — connect once to enrol it');
    if (en.stationId !== o.stationId) throw new Error(`HQ unreachable — this tablet is enrolled to ${stationName(en.stationId)} only`);
    const hash = await pinHash(o.pin.trim(), en.salt);
    if (!hash || hash !== en.hash) throw new Error('Incorrect PIN');
    const s: Session = { stationId: en.stationId, deviceId: en.deviceId, role: en.role, token: en.token, exp: en.exp, offlineUnlock: true };
    store(SESSION, s);
    return s;
  }
}

/** Lock keeps enrolment (offline unlock still works); forget also drops it. */
export function logout(forget = false) {
  store(SESSION, null);
  if (forget) store(ENROL, null);
}
