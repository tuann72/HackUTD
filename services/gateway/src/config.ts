export interface GatewayConfig {
  port: number;
  twilioAuthToken: string;
  /** Exact URL Twilio signs against. Null = use the URL the request arrived on. */
  publicWebhookUrl: string | null;
  dbPath: string;
  classifierUrl: string | null;
  classifierToken: string | null;
  classifierTimeoutMs: number;
  blockThreshold: number;
  corsOrigins: string[];
  debug: boolean;
  debugToken: string | null;
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
  const twilioAuthToken = str(env, 'TWILIO_AUTH_TOKEN');
  if (!twilioAuthToken) {
    throw new Error('TWILIO_AUTH_TOKEN is required (see .env.example). The signature check cannot be disabled.');
  }

  const debug = str(env, 'GATEWAY_DEBUG') === '1';
  const debugToken = str(env, 'DEBUG_TOKEN');
  if (debug && !debugToken) {
    throw new Error('GATEWAY_DEBUG=1 requires a non-empty DEBUG_TOKEN. Refusing to enable debug routes without one.');
  }

  return {
    port: num(env, 'PORT', 8787, (n) => Number.isInteger(n) && n > 0 && n < 65536, 'a TCP port'),
    twilioAuthToken,
    publicWebhookUrl: str(env, 'PUBLIC_WEBHOOK_URL'),
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
  };
}
