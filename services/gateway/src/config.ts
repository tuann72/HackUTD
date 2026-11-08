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
  corsOrigins: string[];
  debug: boolean;
  debugToken: string | null;
  /** Token for admin routes (the "Not a scam" override). Null = admin routes off. */
  adminToken: string | null;
  /**
   * SENDER_BLOCKLIST: off (default) = judge every message on its own, no blocklist calls at all.
   * on = parked option: block known scam senders without the model (docs/features/sender-blocklist.md).
   */
  senderBlocklist: boolean;
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

  const blocklistRaw = (str(env, 'SENDER_BLOCKLIST') ?? 'off').toLowerCase();
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

  return {
    port: num(env, 'PORT', 8787, (n) => Number.isInteger(n) && n > 0 && n < 65536, 'a TCP port'),
    photonWebhookSecret,
    signatureToleranceSeconds: num(env, 'SIGNATURE_TOLERANCE_SECONDS', 300, (n) => Number.isInteger(n) && n > 0, 'a positive integer'),
    dbPath: str(env, 'DB_PATH') ?? './data/gateway.sqlite',
    classifierUrl: str(env, 'CLASSIFIER_URL'),
    classifierToken: str(env, 'CLASSIFIER_TOKEN'),
    classifierTimeoutMs: num(env, 'CLASSIFIER_TIMEOUT_MS', 2500, (n) => Number.isInteger(n) && n > 0, 'a positive integer'),
    blockThreshold: num(env, 'BLOCK_THRESHOLD', 0.5, (n) => n >= 0 && n <= 1, 'a number between 0 and 1'),
    corsOrigins: (str(env, 'CORS_ORIGINS') ?? 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    debug,
    debugToken: debug ? debugToken : null,
    adminToken,
    senderBlocklist,
    mongodbUri,
    mongodbDb: str(env, 'MONGODB_DB') ?? 'tgate',
    dnsServers,
    fingerprintSecret,
    senderBlockStrikes: num(env, 'SENDER_BLOCK_STRIKES', 3, (n) => Number.isInteger(n) && n >= 1, 'an integer of at least 1'),
    senderBlockScore: num(env, 'SENDER_BLOCK_SCORE', 0.95, (n) => n > 0 && n <= 1, 'a number above 0 and at most 1'),
    senderBlockTtlDays: num(env, 'SENDER_BLOCK_TTL_DAYS', 7, (n) => n > 0, 'a positive number'),
  };
}
