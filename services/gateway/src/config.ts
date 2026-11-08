import { isIP } from 'node:net';

export interface GatewayConfig {
  port: number;
  /** Photon webhook signing secret (shown once when the webhook is registered). */
  photonWebhookSecret: string;
  /** Reject deliveries whose X-Spectrum-Timestamp is further than this from now. */
  signatureToleranceSeconds: number;
  dbPath: string;
  classifierUrl: string | null;
  classifierToken: string | null;
  classifierTimeoutMs: number;
  blockThreshold: number;
  /** Warn on delivered messages asking for at least this many dollars. 0 turns it off. */
  moneyWarnAmount: number;
  corsOrigins: string[];
  debug: boolean;
  debugToken: string | null;
  /** Token for admin routes (the "Not a scam" override). Null = admin routes off. */
  adminToken: string | null;
  /**
   * SENDER_BLOCKLIST: on (default since 2026-11-08, Tuan) = block known scam senders without the model
   * (docs/features/sender-blocklist.md). off = judge every message on its own, no blocklist calls at all.
   */
  senderBlocklist: boolean;
  /** UI_ACTION_PASSWORD: the X-Action-Password the web UI's Unblock and Clear blocks buttons must send. Default "4321". */
  uiActionPassword: string;
  /** MongoDB Atlas connection string. Null = in-process blocklist (lost on restart). */
  mongodbUri: string | null;
  mongodbDb: string;
  /** DNS servers for Node's own lookups (e.g. Atlas `mongodb+srv://`). Empty = the OS default. */
  dnsServers: string[];
  /** HMAC key for sender and text fingerprints. Null = a random per-process key (only allowed without Atlas). */
  fingerprintSecret: string | null;
  senderBlockStrikes: number;
  senderBlockScore: number;
  senderBlockTtlDays: number;
  /** REVIEWER=on: Nemotron reviews scores in the band below. Off (default) changes nothing. */
  reviewer: boolean;
  reviewBandLow: number;
  reviewBandHigh: number;
  reviewTimeoutMs: number;
  nvidiaApiKey: string | null;
  nemotronModel: string;
  nvidiaBaseUrl: string;
  nessieApiKey: string | null;
  nessieAccountId: string | null;
  nessieBaseUrl: string;
  /** Bearer token for POST /voice/score (live-call scoring). Null = route off. */
  voiceScoreToken: string | null;
  /** Warn the call when verdict.score >= this. Defaults to blockThreshold. */
  voiceWarnThreshold: number;
}

type Env = Record<string, string | undefined>;

function str(env: Env, key: string): string | null {
  const v = env[key]?.trim();
  return v ? v : null;
}

function num(env: Env, key: string, fallback: number, check: (n: number) => boolean, hint: string): number {
  const raw = str(env, key);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !check(n)) throw new Error(`${key} must be ${hint}, got "${raw}"`);
  return n;
}

export function loadConfig(env: Env = process.env): GatewayConfig {
  const photonWebhookSecret = str(env, 'PHOTON_WEBHOOK_SECRET');
  if (!photonWebhookSecret) {
    throw new Error('PHOTON_WEBHOOK_SECRET is required (see .env.example). The signature check cannot be disabled.');
  }

  const debug = str(env, 'GATEWAY_DEBUG') === '1';
  const debugToken = str(env, 'DEBUG_TOKEN');
  if (debug && !debugToken) {
    throw new Error('GATEWAY_DEBUG=1 requires a non-empty DEBUG_TOKEN. Refusing to enable debug routes without one.');
  }

  const adminToken = str(env, 'ADMIN_TOKEN');
  if (adminToken && adminToken.length < 16) {
    throw new Error('ADMIN_TOKEN must be at least 16 characters (make one with: openssl rand -hex 24).');
  }

  const blocklistRaw = (str(env, 'SENDER_BLOCKLIST') ?? 'on').toLowerCase();
  if (blocklistRaw !== 'off' && blocklistRaw !== 'on') {
    throw new Error(`SENDER_BLOCKLIST must be "off" or "on", got "${blocklistRaw}"`);
  }
  const senderBlocklist = blocklistRaw === 'on';

  const mongodbUri = str(env, 'MONGODB_URI');
  const fingerprintSecret = str(env, 'FINGERPRINT_SECRET');
  // Only checked when the blocklist is on: with it off, these are never used.
  if (senderBlocklist && mongodbUri && !fingerprintSecret) {
    throw new Error('MONGODB_URI requires FINGERPRINT_SECRET (make one with: openssl rand -hex 32).');
  }
  if (senderBlocklist && fingerprintSecret && fingerprintSecret.length < 32) {
    throw new Error('FINGERPRINT_SECRET must be at least 32 characters.');
  }

  const dnsServers = (str(env, 'DNS_SERVERS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of dnsServers) {
    if (!isIP(s)) throw new Error(`DNS_SERVERS must be comma-separated IP addresses, got "${s}"`);
  }

  const reviewerRaw = (str(env, 'REVIEWER') ?? 'off').toLowerCase();
  if (reviewerRaw !== 'off' && reviewerRaw !== 'on') {
    throw new Error(`REVIEWER must be "off" or "on", got "${reviewerRaw}"`);
  }
  const unit = (n: number) => n >= 0 && n <= 1;
  const reviewBandLow = num(env, 'REVIEW_BAND_LOW', 0.22, unit, 'a number between 0 and 1');
  const reviewBandHigh = num(env, 'REVIEW_BAND_HIGH', 0.77, unit, 'a number between 0 and 1');
  if (reviewBandLow >= reviewBandHigh) throw new Error('REVIEW_BAND_LOW must be below REVIEW_BAND_HIGH');

  const blockThreshold = num(env, 'BLOCK_THRESHOLD', 0.5, (n) => n >= 0 && n <= 1, 'a number between 0 and 1');

  return {
    port: num(env, 'PORT', 8787, (n) => Number.isInteger(n) && n > 0 && n < 65536, 'a TCP port'),
    photonWebhookSecret,
    signatureToleranceSeconds: num(env, 'SIGNATURE_TOLERANCE_SECONDS', 300, (n) => Number.isInteger(n) && n > 0, 'a positive integer'),
    dbPath: str(env, 'DB_PATH') ?? './data/gateway.sqlite',
    classifierUrl: str(env, 'CLASSIFIER_URL'),
    classifierToken: str(env, 'CLASSIFIER_TOKEN'),
    classifierTimeoutMs: num(env, 'CLASSIFIER_TIMEOUT_MS', 2500, (n) => Number.isInteger(n) && n > 0, 'a positive integer'),
    blockThreshold,
    moneyWarnAmount: num(env, 'MONEY_WARN_AMOUNT', 500, (n) => n >= 0, 'a number, 0 or more'),
    corsOrigins: (str(env, 'CORS_ORIGINS') ?? 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    debug,
    debugToken: debug ? debugToken : null,
    adminToken,
    senderBlocklist,
    // Any non-empty string; unset or blank falls back to the demo default.
    uiActionPassword: str(env, 'UI_ACTION_PASSWORD') ?? '4321',
    mongodbUri,
    mongodbDb: str(env, 'MONGODB_DB') ?? 'tgate',
    dnsServers,
    fingerprintSecret,
    senderBlockStrikes: num(env, 'SENDER_BLOCK_STRIKES', 3, (n) => Number.isInteger(n) && n >= 1, 'an integer of at least 1'),
    senderBlockScore: num(env, 'SENDER_BLOCK_SCORE', 0.95, (n) => n > 0 && n <= 1, 'a number above 0 and at most 1'),
    senderBlockTtlDays: num(env, 'SENDER_BLOCK_TTL_DAYS', 7, (n) => n > 0, 'a positive number'),
    reviewer: reviewerRaw === 'on',
    reviewBandLow,
    reviewBandHigh,
    reviewTimeoutMs: num(env, 'REVIEW_TIMEOUT_MS', 12000, (n) => Number.isInteger(n) && n > 0, 'a positive integer'),
    nvidiaApiKey: str(env, 'NVIDIA_API_KEY'),
    nemotronModel: str(env, 'NEMOTRON_MODEL') ?? 'nvidia/nemotron-3.5-lightning-30b-a3b',
    nvidiaBaseUrl: str(env, 'NVIDIA_BASE_URL') ?? 'https://integrate.api.nvidia.com/v1',
    nessieApiKey: str(env, 'NESSIE_API_KEY'),
    nessieAccountId: str(env, 'NESSIE_ACCOUNT_ID'),
    nessieBaseUrl: str(env, 'NESSIE_BASE_URL') ?? 'https://api.nessieisreal.com',
    voiceScoreToken: str(env, 'VOICE_SCORE_TOKEN'),
    voiceWarnThreshold: num(env, 'VOICE_WARN_THRESHOLD', blockThreshold, unit, 'a number between 0 and 1'),
  };
}
