// Thin shared layer — talks to the Pranix Agent Engine gateway, NOT the control plane directly.
// Requires only PRANIX_PROTOCOL_ENDPOINT + PRANIX_PROTOCOL_TOKEN. Inert (no-op) until both set.
// No control-plane credential ever lives in this product.
//
// QuietKeep note: this layer is placed but NOT yet wired to verifier routes or call sites.
// QuietKeep has a dual build (Vercel SSR + Capacitor static export via CAPACITOR_BUILD=1).
// Verifier API routes must be designed to survive the static-export build before being added.
// This module is route-free and inert, so it is safe under both build targets.

const endpoint = process.env.PRANIX_PROTOCOL_ENDPOINT; // e.g. https://pranix-agent-engine.vercel.app/api/protocol
const token = process.env.PRANIX_PROTOCOL_TOKEN;

export const protocolEnabled = Boolean(endpoint && token);

type GatewayResult = { ok: boolean; [k: string]: unknown };

async function call(op: string, payload: Record<string, unknown> = {}): Promise<GatewayResult> {
  if (!endpoint || !token) return { ok: false, error: "protocol disabled" };
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ op, ...payload }),
    });
    return (await r.json()) as GatewayResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type EvidenceInput = {
  proves: string;
  artifactRef?: string;
  type?: string;
  sourceTable?: string;
  sourceId?: string;
  success?: boolean;
};

export const protocol = protocolEnabled
  ? {
      evidence: { emit: (input: EvidenceInput) => call("evidence.emit", input) },
      governance: {
        preflight: (action: string, input?: Record<string, unknown>) =>
          call("governance.preflight", { action, input }),
      },
      credentials: {
        health: (names?: string[]) => call("credentials.health", names ? { names } : {}),
      },
    }
  : null;
