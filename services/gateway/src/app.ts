import { timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import twilio from 'twilio';
import type { Classifier } from './classifier.js';
import type { GatewayConfig } from './config.js';
import { Store } from './db.js';
import type { MessagesResponse, Verdict } from './types.js';

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface AppDeps {
  db: DatabaseSync;
  classifier: Classifier;
  config: Pick<GatewayConfig, 'twilioAuthToken' | 'publicWebhookUrl' | 'blockThreshold' | 'corsOrigins' | 'debug' | 'debugToken'>;
  logger?: Logger;
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

export function createApp({ db, classifier, config, logger = consoleLogger }: AppDeps): GatewayApp {
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

  app.post('/twilio/sms', async (c) => {
    const raw = await c.req.text();
    const params = Object.fromEntries(new URLSearchParams(raw));
    const signature = c.req.header('X-Twilio-Signature') ?? '';
    const url = config.publicWebhookUrl ?? c.req.url;

    if (!signature || !twilio.validateRequest(config.twilioAuthToken, signature, url, params)) {
      logger.warn(`rejected webhook: invalid or missing X-Twilio-Signature (validated against ${url})`);
      return c.text('Forbidden', 403);
    }

    const messageSid = params.MessageSid ?? params.SmsMessageSid;
    const from = params.From;
    if (!messageSid || !from) return c.text('Missing MessageSid or From', 400);

    const stored = store.insertInbound({ messageSid, from, to: params.To ?? null, body: params.Body ?? '' });
    if (stored) {
      logger.info(`${stored.id} received from ${stored.display}`);
      schedule(stored.id, stored.body, stored.display);
    } else {
      logger.info(`duplicate webhook ignored (already-seen MessageSid)`);
    }
    // Never reply to the sender: always empty TwiML.
    return c.body(EMPTY_TWIML, 200, { 'Content-Type': 'text/xml' });
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
