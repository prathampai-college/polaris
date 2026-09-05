/** Convert WS gateway URL to HTTP HQ URL (replaces fragile .replace('8787','8000')). */
export function toHttpUrl(wsUrl: string, fallback = 'http://localhost:8000'): string {
  try {
    const u = new URL(wsUrl);
    if (u.protocol === 'ws:' || u.protocol === 'wss:') {
      u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
      if (u.port === '8787') u.port = '8000';
      u.pathname = '';
      u.search = '';
      return u.toString().replace(/\/$/, '');
    }
    return wsUrl;
  } catch { return fallback; }
}
