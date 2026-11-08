// The simulation panel's server side (docs/features/simulation-panel.md).
// GET: whether simulation is on and which gateway it sends to.
// POST: one simulated step, signed here and forwarded to the gateway's webhook.
import { handleSimulate, simConfigFromEnv, simStatus } from "@/lib/server/simulate";

// The Vercel backup classifies before it answers, so a forwarded webhook can take a while.
export const maxDuration = 30;

export function GET() {
  return simStatus(simConfigFromEnv());
}

export async function POST(request: Request) {
  return handleSimulate(request, { cfg: simConfigFromEnv() });
}
