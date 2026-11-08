import { timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Classifier } from './classifier.js';
import type { GatewayConfig } from './config.js';
import { Store } from './db.js';
import { EVENT_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, parseSpectrumEvent, verifySpectrumRequest } from './photon.js';
import type { MessagesResponse, Verdict } from './types.js';

/** Path Photon delivers inbound iMessage webhooks to. */
export const WEBHOOK_PATH = '/webhooks/photon';

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface AppDeps {
  db: DatabaseSync;
  classifier: Classifier;
  config: Pick<GatewayConfig, 'photonWebhookSecret' | 'signatureToleranceSeconds' | 'blockThreshold' | 'corsOrigins' | 'debug' | 'debugToken'>;
  logger?: Logger;
  /** Clock for the signature timestamp check. Tests override it. */
  now?: () => Date;
}

export type GatewayApp = Hono & {
  /** Resolves once every classification started so far has finished. For tests and shutdown. */
  idle(): Promise<void>;
  store: Store;
};

const consoleLogger: Logger = {
  info: (m) => console.log(`[gateway] ${m}`),
  warn: (m) => console.warn(`[gateway] ${m}`),
};

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createApp({ db, classifier, config, logger = consoleLogger, now = () => new Date() }: AppDeps): GatewayApp {
  const store = new Store(db);
  const pending = new Set<Promise<void>>();
  const app = new Hono();

  async function classifyAndApply(id: string, body: string, display: string): Promise<void> {
    let verdict: Verdict | null = null;
    try {
      verdict = await classifier.classify({ messageId: id, text: body });
    } catch (err) {
      // Fail open (Tuan, 2026-11-07): deliver, flagged as unverified.
      store.applyDecision(id, 'delivered', 'classifier_unavailable', null);
      logger.warn(`${id} from ${display}: classifier unavailable (${(err as Error).message}); delivered unverified`);
      return;
    }
    const action = verdict.score >= config.blockThreshold ? 'blocked' : 'delivered';
    store.applyDecision(id, action, 'model_verdict', verdict);
    logger.info(`${id} from ${display}: ${action} (score ${verdict.score}, ${verdict.category ?? 'no category'}, ${verdict.model})`);
  }

  function schedule(id: string, body: string, display: string): void {
    // setImmediate so the webhook response goes out before classification starts.
    const job = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => classifyAndApply(id, body, display))
      .catch((err: unknown) => logger.warn(`${id}: failed to record decision: ${(err as Error).message}`))
      .finally(() => pending.delete(job));
    pending.add(job);
  }

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post(WEBHOOK_PATH, async (c) => {
    // Verify over the raw bytes, before any JSON parsing (Photon signs the exact body).
    const raw = await c.req.text();
    const check = verifySpectrumRequest({
      secret: config.photonWebhookSecret,
      signature: c.req.header(SIGNATURE_HEADER),
      timestamp: c.req.header(TIMESTAMP_HEADER),
      rawBody: raw,
      nowSeconds: Math.floor(now().getTime() / 1000),
      toleranceSeconds: config.signatureToleranceSeconds,
    });
    if (!check.ok) {
      logger.warn(`rejected webhook: ${check.error}`);
      return c.text(check.error, check.status);
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return c.text('body is not JSON', 400);
    }
    const parsed = parseSpectrumEvent(json);
    if (parsed.kind === 'invalid') {
      logger.warn(`rejected webhook: ${parsed.error}`);
      return c.text(parsed.error, 400);
    }
    if (parsed.kind === 'ignored') {
      // 2xx so Photon doesn't retry something we'll never handle.
      logger.info(`webhook ignored (${parsed.reason}; X-Spectrum-Event=${c.req.header(EVENT_HEADER) ?? '?'})`);
      return c.text('ok', 200);
    }

    const stored = store.insertInbound(parsed.message);
    if (stored) {
      logger.info(`${stored.id} received from ${stored.display}`);
      schedule(stored.id, stored.body, stored.display);
    } else {
      logger.info('duplicate webhook ignored (already-seen message.id)');
    }
    // Ack fast; classification runs after the response. The gateway never replies to the sender.
    return c.text('ok', 200);
  });

  app.use(
    '/api/*',
    cors({ origin: config.corsOrigins, allowMethods: ['GET'], maxAge: 600 }),
  );

  app.get('/api/messages', (c) => {
    const rawLimit = c.req.query('limit');
    let limit = 100;
    if (rawLimit !== undefined) {
      const n = Number(rawLimit);
      if (!Number.isInteger(n) || n < 1 || n > 200) return c.json({ error: 'limit must be an integer from 1 to 200' }, 400);
      limit = n;
    }
    const res: MessagesResponse = { schema: 't-gate.query-api', version: 1, messages: store.listMessages(limit) };
    c.header('Cache-Control', 'no-store');
    return c.json(res);
  });

  // Developer tool, not part of the contract. The web app must never call it.
  if (config.debug && config.debugToken) {
    const token = config.debugToken;
    app.post('/debug/reset', (c) => {
      const given = c.req.header('X-Debug-Token');
      if (!given) return c.json({ error: 'missing X-Debug-Token' }, 401);
      if (!safeEqual(given, token)) return c.json({ error: 'bad X-Debug-Token' }, 403);
      const cleared = store.count();
      store.reset();
      logger.warn(`debug reset: cleared ${cleared} messages`);
      return c.json({ ok: true, cleared });
    });
  }

  return Object.assign(app, {
    idle: async () => {
      while (pending.size > 0) await Promise.all([...pending]);
    },
    store,
  });
}
