const TOKEN_KEY = 'polaris_hq_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** Decodes the JWT payload without verifying the signature — display/expiry only, never trust for auth decisions. */
function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split('.');
    const unpadded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const b64 = unpadded.padEnd(unpadded.length + ((4 - (unpadded.length % 4)) % 4), '=');
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

export function isExpired(token: string | null): boolean {
  if (!token) return true;
  const payload = decodePayload(token);
  const exp = payload?.exp;
  if (typeof exp !== 'number') return true;
  return Date.now() >= exp * 1000;
}

export function getRole(token: string | null): string | null {
  if (!token) return null;
  const payload = decodePayload(token);
  return typeof payload?.role === 'string' ? payload.role : null;
}
