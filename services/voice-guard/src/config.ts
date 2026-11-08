export interface VoiceGuardConfig {
  captureEnabled: boolean;
  /** Gateway webhook (https://<gateway-host>/webhooks/photon). Unset = transcribe only, send nothing. */
  gatewayWebhookUrl?: string;
  /** The gateway's PHOTON_WEBHOOK_SECRET. Required with gatewayWebhookUrl. */
  gatewayWebhookSecret?: string;
  /** Victim line put in `space.phone`. */
  victimLine: string;
  gatewayTimeoutMs: number;
}

/** Fictional default victim line, the same one the web Simulate panel uses. */
export const DEFAULT_VICTIM_LINE = '+15555550100';

export function readConfig(env: NodeJS.ProcessEnv = process.env): VoiceGuardConfig {
  const gatewayWebhookUrl = env.GATEWAY_WEBHOOK_URL?.trim();
  const gatewayWebhookSecret = env.GATEWAY_WEBHOOK_SECRET?.trim();
  const timeoutValue = env.GATEWAY_TIMEOUT_MS?.trim();
  const gatewayTimeoutMs = timeoutValue ? Number(timeoutValue) : 10_000;

  if ((gatewayWebhookUrl && !gatewayWebhookSecret) || (!gatewayWebhookUrl && gatewayWebhookSecret)) {
    throw new Error('GATEWAY_WEBHOOK_URL and GATEWAY_WEBHOOK_SECRET must be set together');
  }

  if (!Number.isInteger(gatewayTimeoutMs) || gatewayTimeoutMs <= 0) {
    throw new Error('GATEWAY_TIMEOUT_MS must be a positive integer');
  }

  return {
    captureEnabled: env.VOICE_GUARD_CAPTURE_ENABLED === 'true',
    ...(gatewayWebhookUrl ? { gatewayWebhookUrl } : {}),
    ...(gatewayWebhookSecret ? { gatewayWebhookSecret } : {}),
    victimLine: env.VOICE_GUARD_VICTIM_LINE?.trim() || DEFAULT_VICTIM_LINE,
    gatewayTimeoutMs,
  };
}
