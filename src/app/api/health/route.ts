// Health check for the hosting platform (Coolify / Docker / uptime monitors).
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ ok: true, time: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
