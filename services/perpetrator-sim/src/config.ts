import { existsSync } from "node:fs";

export interface SimConfig {
  webhookUrl: string;
  /** Photon webhook signing secret. Must match the gateway's PHOTON_WEBHOOK_SECRET. */
  webhookSecret: string;
  /** The protected victim line (`space.phone` in the payload). */
  victimNumber: string;
}

export const DEFAULTS: SimConfig = {
  webhookUrl: "http://localhost:8787/webhooks/photon",
  webhookSecret: "dev-photon-webhook-secret-change-me",
  victimNumber: "+15555550100",
};

/** Load `.env` from the given path into process.env, if the file exists. */
export function loadDotEnv(path = ".env"): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): SimConfig {
  return {
    webhookUrl: env.GATEWAY_WEBHOOK_URL || DEFAULTS.webhookUrl,
    webhookSecret: env.PHOTON_WEBHOOK_SECRET || DEFAULTS.webhookSecret,
    victimNumber: env.VICTIM_NUMBER || DEFAULTS.victimNumber,
  };
}
