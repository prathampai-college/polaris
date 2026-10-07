import { getToken, clearToken } from './auth';

// Next.js bakes NEXT_PUBLIC_* env vars in at build time. If the baked value
// still says "localhost" but the dashboard is opened from a different host
// (LAN IP, tablet), swap in the real hostname so the API call still lands
// on the same host the dashboard itself was loaded from.
const BAKED_HQ = process.env.NEXT_PUBLIC_HQ_URL || 'http://localhost:8000';
function resolveHQ(): string {
  if (typeof window !== 'undefined' && BAKED_HQ.includes('localhost')) {
    const h = window.location.hostname;
    if (h && h !== 'localhost' && h !== '127.0.0.1') {
      try {
        const u = new URL(BAKED_HQ);
        u.hostname = h;
        return u.toString().replace(/\/$/, '');
      } catch {}
    }
  }
  return BAKED_HQ;
}
export const HQ = resolveHQ();

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Distinguishes "request failed" from "server returned an empty result" — the
 *  old dashboard's `.catch(() => [])` on every fetch made those indistinguishable. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  let res: Response;
  try {
    res = await fetch(`${HQ}${path}`, { ...init, headers });
  } catch (e) {
    throw new ApiError(0, e instanceof Error ? e.message : 'network error');
  }
  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('polaris:unauthorized'));
    throw new ApiError(401, 'session expired');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body: body != null ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body: body != null ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body: body != null ? JSON.stringify(body) : undefined }),
};
