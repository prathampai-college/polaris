export async function GET() {
  return Response.json({ status: 'ok', service: 'polaris-hq-dashboard', ts: new Date().toISOString() });
}
