export async function GET() {
  return Response.json({
    hqUrl: process.env.NEXT_PUBLIC_HQ_URL || 'http://localhost:8000',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
