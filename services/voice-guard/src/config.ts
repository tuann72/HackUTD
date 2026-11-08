export interface VoiceGuardConfig {
  captureEnabled: boolean;
  /** Gateway webhook (https://<gateway-host>/webhooks/photon). Unset = transcribe only, send nothing. */
  gatewayWebhookUrl?: string;
  /** The gateway's PHOTON_WEBHOOK_SECRET. Required with gatewayWebhookUrl. */
  gatewayWebhookSecret?: string;
  /** Victim line put in `space.phone`. */
  victimLine: string;
  gatewayTimeoutMs: number;
  /** Live call (docs/features/voice-scam-guard.md, "Live call design"). Absent = no victim is dialed. */
  liveCall?: LiveCallConfig;
  /** Live scoring during the call. Absent = no live scoring and no whisper. */
  liveScore?: LiveScoreConfig;
}

export interface LiveCallConfig {
  /** Victim's real phone, E.164. */
  victimPhone: string;
  /** LiveKit outbound SIP trunk id (ST_...). */
  outboundTrunkId: string;
  /** Optional caller ID shown to the victim; the trunk's number when unset. */
  fromNumber?: string;
  /** Seconds to let the victim's phone ring. */
  ringingTimeoutSeconds: number;
}

export interface LiveScoreConfig {
  /** Gateway scoring endpoint, https://<gateway-host>/voice/score. */
  url: string;
  /** The gateway's VOICE_SCORE_TOKEN. */
  token: string;
  /** Minimum time between two scoring requests. */
  intervalMs: number;
  timeoutMs: number;
  /** What the victim hears. */
  whisperText: string;
  ttsModel: string;
  ttsVoice?: string;
}

/** Fictional default victim line, the same one the web Simulate panel uses. */
export const DEFAULT_VICTIM_LINE = '+15555550100';

export const DEFAULT_WHISPER_TEXT =
  'T-Guard warning. This caller may be a potential scam. Do not share codes, passwords, or send money. You can hang up at any time.';

const E164 = /^\+[1-9]\d{6,14}$/;

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function pair(env: NodeJS.ProcessEnv, a: string, b: string): [string, string] | undefined {
  const va = env[a]?.trim();
  const vb = env[b]?.trim();
  if (!va && !vb) return undefined;
  if (!va || !vb) throw new Error(`${a} and ${b} must be set together`);
  return [va, vb];
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): VoiceGuardConfig {
  const gateway = pair(env, 'GATEWAY_WEBHOOK_URL', 'GATEWAY_WEBHOOK_SECRET');
  const gatewayTimeoutMs = positiveInt(env, 'GATEWAY_TIMEOUT_MS', 10_000);

  let liveCall: LiveCallConfig | undefined;
  const dial = pair(env, 'VOICE_GUARD_VICTIM_PHONE', 'LIVEKIT_SIP_OUTBOUND_TRUNK_ID');
  if (dial) {
    const [victimPhone, outboundTrunkId] = dial;
    if (!E164.test(victimPhone)) throw new Error('VOICE_GUARD_VICTIM_PHONE must be an E.164 number like +12145550123');
    const fromNumber = env.VOICE_GUARD_CALLER_ID?.trim();
    liveCall = {
      victimPhone,
      outboundTrunkId,
      ...(fromNumber ? { fromNumber } : {}),
      ringingTimeoutSeconds: positiveInt(env, 'VOICE_GUARD_RING_SECONDS', 30),
    };
  }

  let liveScore: LiveScoreConfig | undefined;
  const score = pair(env, 'VOICE_SCORE_URL', 'VOICE_SCORE_TOKEN');
  if (score) {
    const ttsVoice = env.VOICE_GUARD_TTS_VOICE?.trim();
    liveScore = {
      url: score[0],
      token: score[1],
      intervalMs: positiveInt(env, 'VOICE_SCORE_INTERVAL_MS', 5_000),
      timeoutMs: positiveInt(env, 'VOICE_SCORE_TIMEOUT_MS', 4_000),
      whisperText: env.VOICE_GUARD_WHISPER_TEXT?.trim() || DEFAULT_WHISPER_TEXT,
      ttsModel: env.VOICE_GUARD_TTS_MODEL?.trim() || 'cartesia/sonic-3',
      ...(ttsVoice ? { ttsVoice } : {}),
    };
  }

  return {
    captureEnabled: env.VOICE_GUARD_CAPTURE_ENABLED === 'true',
    ...(gateway ? { gatewayWebhookUrl: gateway[0], gatewayWebhookSecret: gateway[1] } : {}),
    victimLine: env.VOICE_GUARD_VICTIM_LINE?.trim() || DEFAULT_VICTIM_LINE,
    gatewayTimeoutMs,
    ...(liveCall ? { liveCall } : {}),
    ...(liveScore ? { liveScore } : {}),
  };
}
