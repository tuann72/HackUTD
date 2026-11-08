import { existsSync } from "node:fs";

export interface SimConfig {
  webhookUrl: string;
  authToken: string;
  accountSid: string;
  victimNumber: string;
}

export const DEFAULTS: SimConfig = {
  webhookUrl: "http://localhost:8787/twilio/sms",
  authToken: "dev-auth-token-change-me",
  accountSid: "AC00000000000000000000000000000000",
  victimNumber: "+15555550100",
};

/** Load `.env` from the given path into process.env, if the file exists. */
export function loadDotEnv(path = ".env"): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): SimConfig {
  return {
    webhookUrl: env.GATEWAY_WEBHOOK_URL || DEFAULTS.webhookUrl,
    authToken: env.TWILIO_AUTH_TOKEN || DEFAULTS.authToken,
    accountSid: env.TWILIO_ACCOUNT_SID || DEFAULTS.accountSid,
    victimNumber: env.VICTIM_NUMBER || DEFAULTS.victimNumber,
  };
}
