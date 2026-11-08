import { timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Blocklist, Fingerprinter } from './blocklist.js';
import type { Classifier } from './classifier.js';
import type { GatewayConfig } from './config.js';
import { Store } from './db.js';
import { EVENT_HEADER, SIGNATURE_HEADER, STANDARD_ID_HEADER, STANDARD_SIGNATURE_HEADER, STANDARD_TIMESTAMP_HEADER, TIMESTAMP_HEADER, isClassifiable, parsePhotonEvent, verifySpectrumRequest, verifyStandardRequest, type InboundMessage } from './photon.js';
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
  config: Pick<
    GatewayConfig,
    | 'photonWebhookSecret'
    | 'signatureToleranceSeconds'
    | 'blockThreshold'
    | 'corsOrigins'
    | 'debug'
    | 'debugToken'
    | 'adminToken'
    | 'senderBlocklist'
  >;
  /**
   * Sender blocklist (docs/features/sender-blocklist.md), a parked option. Used only when
   * `config.senderBlocklist` is true and both are given; otherwise never called, and every message
   * is judged on its own. Errors from the blocklist are logged and ignored (fail open).
   */
  blocklist?: Blocklist;
  fingerprinter?: Fingerprinter;
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

export function createApp({
  db,
  classifier,
  config,
  blocklist,
  fingerprinter,
  logger = consoleLogger,
  now = () => new Date(),
}: AppDeps): GatewayApp {
  const store = new Store(db);
  const pending = new Set<Promise<void>>();
  const app = new Hono();
  // Default (Tuan, 2026-11-08): block the message, not the sender. The blocklist is off unless configured on.
  const bl = config.senderBlocklist && blocklist && fingerprinter ? { list: blocklist, fp: fingerprinter } : null;

  /** True only if the blocklist answered yes. An error counts as "not blocked" (fail open). */
  async function senderIsBlocked(id: string, senderFp: string): Promise<boolean> {
    if (!bl) return false;
    try {
      return await bl.list.isBlocked(senderFp, now());
    } catch (err) {
      logger.warn(`${id}: blocklist unavailable (${(err as Error).message}); judging by the model`);
      return false;
    }
  }

  async function recordScam(id: string, senderFp: string, body: string, verdict: Verdict): Promise<void> {
    if (!bl) return;
    try {
      const res = await bl.list.recordScam(
        { senderFp, textFp: bl.fp.text(body), score: verdict.score, category: verdict.category, model: verdict.model },
        now(),
      );
      if (res.blocked) logger.info(`${id}: sender now on the blocklist (strikes ${res.strikes}, until ${res.blockedUntil?.toISOString()})`);
    } catch (err) {
      logger.warn(`${id}: could not record fingerprint (${(err as Error).message}); ignored`);
    }
  }

  async function decide(id: string, msg: InboundMessage, display: string): Promise<void> {
    const senderFp = bl ? bl.fp.sender(msg.sender) : '';
    // 1. Known scam sender: block without asking the model. Applies to text-less content too.
    if (await senderIsBlocked(id, senderFp)) {
      store.applyDecision(id, 'blocked', 'sender_blocked', null);
      logger.info(`${id} (${msg.kind}) from ${display}: blocked, sender on the blocklist`);
      return;
    }
    // 2. Nothing to judge (attachment, reaction, contact): deliver, marked not classified.
    if (!isClassifiable(msg)) {
      store.applyDecision(id, 'delivered', 'not_classified', null);
      logger.info(`${id} (${msg.kind}) from ${display}: delivered, not classified (no text)`);
      return;
    }
    // 3. Ask the model.
    const body = msg.body;
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
    // 4. Fingerprint every model block; strikes or a very high score put the sender on the blocklist.
    if (action === 'blocked') await recordScam(id, senderFp, body, verdict);
  }

  function schedule(id: string, msg: InboundMessage, display: string): void {
    // setImmediate so the webhook response goes out before the blocklist or classifier is asked.
    const job = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => decide(id, msg, display))
      .catch((err: unknown) => logger.warn(`${id}: failed to record decision: ${(err as Error).message}`))
      .finally(() => pending.delete(job));
    pending.add(job);
  }

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post(WEBHOOK_PATH, async (c) => {
    // Verify over the raw bytes, before any JSON parsing (Photon signs the exact body).
    const raw = await c.req.text();
    const signed = {
      secret: config.photonWebhookSecret,
      rawBody: raw,
      nowSeconds: Math.floor(now().getTime() / 1000),
      toleranceSeconds: config.signatureToleranceSeconds,
    };
    // Photon 2.0 / Beta uses Standard Webhooks headers, Stable uses X-Spectrum-*. Both check the same secret.
    const check = c.req.header(STANDARD_SIGNATURE_HEADER)
      ? verifyStandardRequest({
          ...signed,
          id: c.req.header(STANDARD_ID_HEADER),
          signature: c.req.header(STANDARD_SIGNATURE_HEADER),
          timestamp: c.req.header(STANDARD_TIMESTAMP_HEADER),
        })
      : verifySpectrumRequest({
          ...signed,
          signature: c.req.header(SIGNATURE_HEADER),
          timestamp: c.req.header(TIMESTAMP_HEADER),
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
    const parsed = parsePhotonEvent(json);
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
      logger.info(`${stored.id} (${parsed.message.kind}) received from ${stored.display}`);
      schedule(stored.id, parsed.message, stored.display);
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

  // Admin tool, not part of the contract: "Not a scam" for one message. Exists only when ADMIN_TOKEN is set.
  // Takes an opaque message id, never a handle. The web app must never call it.
  if (config.adminToken) {
    const token = config.adminToken;
    app.post('/admin/messages/restore', async (c) => {
      const given = c.req.header('X-Admin-Token');
      if (!given) return c.json({ error: 'missing X-Admin-Token' }, 401);
      if (!safeEqual(given, token)) return c.json({ error: 'bad X-Admin-Token' }, 403);
      let messageId: unknown;
      try {
        messageId = ((await c.req.json()) as { messageId?: unknown }).messageId;
      } catch {
        return c.json({ error: 'body must be JSON: {"messageId": "msg_..."}' }, 400);
      }
      if (typeof messageId !== 'string' || !messageId) return c.json({ error: 'messageId is required' }, 400);
      const decision = store.decisionOf(messageId);
      if (!decision) return c.json({ error: 'no such message' }, 404);
      if (decision.action !== 'blocked') return c.json({ error: `message is ${decision.action}, not blocked` }, 409);

      // Only with the blocklist on: also allowlist the sender so the blocklist never blocks them again.
      let allowlisted: boolean | null = null;
      if (bl) {
        allowlisted = false;
        try {
          await bl.list.allow(bl.fp.sender(store.senderHandleOf(messageId)!), now());
          allowlisted = true;
        } catch (err) {
          logger.warn(`${messageId}: allowlist write failed (${(err as Error).message})`);
        }
      }
      store.restoreMessage(messageId, now());
      logger.warn(`admin restore: ${messageId} moved to the inbox${allowlisted === null ? '' : ` (sender allowlisted=${allowlisted})`}`);
      return c.json({ ok: true, messageId, allowlisted });
    });
  }

  return Object.assign(app, {
    idle: async () => {
      while (pending.size > 0) await Promise.all([...pending]);
    },
    store,
  });
}
