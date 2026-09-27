// POLARIS Field offline app shell. Hand-written (no workbox): the app must open
// on a tablet that cannot reach the camp server. Data lives in OPFS SQLite, not here.
const VERSION = 'polaris-field-v1';
const ROUTES = ['/', '/login', '/scan', '/inventory', '/muster', '/indents', '/expeditions', '/locate', '/comms', '/settings'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // One failing route must not abort install (allSettled, not addAll).
    await Promise.allSettled(ROUTES.map((r) => cache.add(new Request(r, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Same-origin GETs only: HQ/gateway traffic and /api/* are never cached.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Content-hashed build assets (JS, CSS, fonts, the sqlite wasm): cache-first, immutable.
  if (url.pathname.startsWith('/_next/static/') || /\.(woff2?|wasm|svg|png)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Pages: network-first so a reachable server always wins; cached copy when offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(url.pathname, res.clone());
        return res;
      } catch {
        return (await cache.match(url.pathname)) || (await cache.match('/')) || Response.error();
      }
    })());
  }
});
