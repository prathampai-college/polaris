export async function GET() {
  return Response.json({ status: 'ok', service: 'polaris-hq-dashboard', ts: new Date().toISOString() }, {
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    }
  });
}
