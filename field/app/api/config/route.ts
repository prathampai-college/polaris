export const dynamic = 'force-dynamic';

// Runtime endpoints for tablets. Read from non-NEXT_PUBLIC env so a built image
// can be re-pointed without rebuilding (NEXT_PUBLIC_* are frozen at build time).
// The client swaps "localhost" for the host it loaded the app from, so LAN
// tablets reach the camp server instead of themselves. PSK is never served here.
export function GET() {
  return Response.json(
    {
      hqUrl: process.env.HQ_PUBLIC_URL || 'http://localhost:8000',
      gatewayUrl: process.env.GATEWAY_PUBLIC_URL || 'ws://localhost:8787',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
