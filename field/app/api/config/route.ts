export async function GET(request: Request) {
  // LAN fallback: if NEXT_PUBLIC_* env was not baked, field can fetch /api/config at runtime.
  // PSK is never exposed here — it lives in IndexedDB after QR provisioning.
  const url = new URL(request.url);
  const host = url.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const hqUrl = process.env.NEXT_PUBLIC_HQ_URL || (isLocal ? 'http://localhost:8000' : `http://${host}:8000`);
  const gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || (isLocal ? 'ws://localhost:8787' : `ws://${host}:8787`);
  return Response.json({ hqUrl, gatewayUrl }, { headers: { 'Cache-Control': 'no-store' } });
}
