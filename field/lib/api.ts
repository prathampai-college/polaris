'use client';

export interface Urls { hqUrl: string; gatewayUrl: string }
const URLS_KEY = 'polaris_urls';
const DEFAULTS: Urls = { hqUrl: 'http://localhost:8000', gatewayUrl: 'ws://localhost:8787' };

/** A tablet on the camp LAN loads the app from e.g. 10.0.0.5 — "localhost" in config means that host. */
function swapHost(u: string): string {
  try {
    const url = new URL(u);
    if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      url.hostname = location.hostname;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}

function read<T>(key: string): T | null {
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : null; } catch { return null; }
}
export function store(key: string, v: unknown) {
  try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}
export const load = read;

let urls: Urls = DEFAULTS;

/** Runtime config from the camp server; last good value is cached so an offline boot still knows where HQ is. */
export async function resolveUrls(): Promise<Urls> {
  const cached = read<Urls>(URLS_KEY);
  try {
    const res = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const j = (await res.json()) as Urls;
      store(URLS_KEY, j);
      urls = { hqUrl: swapHost(j.hqUrl), gatewayUrl: swapHost(j.gatewayUrl) };
      return urls;
    }
  } catch { /* offline: fall through to cache */ }
  const base = cached ?? DEFAULTS;
  urls = { hqUrl: swapHost(base.hqUrl), gatewayUrl: swapHost(base.gatewayUrl) };
  return urls;
}

export class ApiError extends Error {
  constructor(message: string, public status: number | null) { super(message); }
  get offline() { return this.status === null; }
}

let token: string | null = null;
export function setToken(t: string | null) { token = t; }

/** HQ HTTP. Never swallows: network failure → ApiError(status=null), HTTP error → ApiError(status). */
export async function hq<T>(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${urls.hqUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError('HQ unreachable — link down', null);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError((body && (body.detail || body.message)) || `HQ ${res.status}`, res.status);
  return body as T;
}
