// GET /api/protocol-health — read-only verifier.
// Calls protocol.credentials.health() through the engine gateway. No writes.
// Dynamic .js handler, same convention as the other 56 API routes (safe under both
// Vercel SSR and the Capacitor output:'export' APK build — APK calls it over HTTPS, never embeds it).
import { protocol } from "@/lib/protocol-core";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!protocol) {
    return Response.json({ ok: false, error: "protocol disabled" }, { status: 503 });
  }
  const result = await protocol.credentials.health();
  return Response.json(result);
}
