export async function GET() {
  return Response.json({
    hqUrl: process.env.NEXT_PUBLIC_HQ_URL || 'http://localhost:8000',
    gatewayUrl: process.env.NEXT_PUBLIC_GATEWAY_URL || 'ws://localhost:8787',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
