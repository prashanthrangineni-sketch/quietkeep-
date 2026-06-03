// GET /api/protocol-selftest — adoption proof (hit once, then retire).
// Exercises governance.preflight() + evidence.emit() through the engine gateway.
// Single shared web app serves both Personal and Business shells -> project is the single
// "quietkeep" token identity. Per-shell attribution (personal|business) belongs in the
// evidence "proves" string via NEXT_PUBLIC_APP_TYPE, not a separate token.
import { protocol } from "@/lib/protocol-core";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!protocol) {
    return Response.json({ ok: false, error: "protocol disabled" }, { status: 503 });
  }
  const appType = process.env.NEXT_PUBLIC_APP_TYPE || "personal";
  const preflight = await protocol.governance.preflight("adoption_selftest", {
    artifact: "protocol-selftest",
  });
  const evidence = await protocol.evidence.emit({
    proves: `quietkeep adoption protocol selftest app_type:${appType}`,
    type: "selftest",
    success: true,
  });
  return Response.json({ ok: true, appType, preflight, evidence });
}
