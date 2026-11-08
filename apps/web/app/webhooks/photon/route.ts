// Photon (Spectrum) webhook on Vercel: register https://<site>/webhooks/photon with
// `npm run photon:webhook -- register` (services/gateway) and set PHOTON_WEBHOOK_SECRET in Vercel.
import { configFromEnv, getStore, handleWebhook, storeUnavailable } from "@/lib/server/inbox";

// Photon waits up to 30 s per attempt; classification runs before the response.
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    return await handleWebhook(request, { cfg: configFromEnv(), store: await getStore() });
  } catch (err) {
    return storeUnavailable("webhook", err);
  }
}
