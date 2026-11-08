import { createHmac, timingSafeEqual } from 'node:crypto';

// Photon (Spectrum) inbound webhooks. Docs:
//   https://photon.codes/docs/webhooks/events
//   https://photon.codes/docs/webhooks/verifying-signatures

export const SIGNATURE_HEADER = 'X-Spectrum-Signature';
export const TIMESTAMP_HEADER = 'X-Spectrum-Timestamp';
export const EVENT_HEADER = 'X-Spectrum-Event';
export const WEBHOOK_ID_HEADER = 'X-Spectrum-Webhook-Id';

/** Photon's recommended replay window. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** `v0=` + lowercase hex HMAC-SHA256 over `v0:<timestamp>:<rawBody>`. */
export function spectrumSignature(secret: string, timestamp: string, rawBody: string): string {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; status: 400 | 401; error: string };

export function verifySpectrumRequest(opts: {
  secret: string;
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): VerifyResult {
  const { signature, timestamp } = opts;
  if (!signature || !timestamp) return { ok: false, status: 400, error: `missing ${SIGNATURE_HEADER} or ${TIMESTAMP_HEADER}` };
  if (!/^\d+$/.test(timestamp)) return { ok: false, status: 400, error: 'malformed timestamp' };
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(opts.nowSeconds - Number(timestamp)) > tolerance) {
    return { ok: false, status: 400, error: 'stale timestamp' };
  }
  const expected = Buffer.from(spectrumSignature(opts.secret, timestamp, opts.rawBody));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, status: 401, error: 'bad signature' };
  }
  return { ok: true };
}

// --- Payload ---------------------------------------------------------------

export interface SpectrumSpace {
  id: string;
  platform: string;
  type?: 'dm' | 'group' | string;
  /** E.164 number of the line, or "shared" for a pooled line. */
  phone?: string;
}

export type SpectrumContent =
  | { type: 'text'; text: string }
  | { type: 'richlink'; url: string }
  | { type: 'attachment'; id: string; name?: string; mimeType?: string; size?: number }
  | { type: 'reaction'; emoji: string; target: unknown }
  | { type: 'contact'; name?: string; phones?: string[] }
  | { type: 'group'; items: SpectrumMessage[] }
  | { type: string; [k: string]: unknown };

export interface SpectrumMessage {
  id: string;
  platform: string;
  direction?: string;
  timestamp?: string;
  sender: { id: string; platform: string };
  space?: SpectrumSpace;
  content: SpectrumContent;
}

export interface SpectrumEvent {
  event: string;
  space: SpectrumSpace;
  message: SpectrumMessage;
}

/** What the gateway stores and classifies. */
export interface InboundMessage {
  providerMessageId: string;
  /** iMessage handle: E.164 number or an Apple ID email. */
  sender: string;
  /** The victim line (`space.phone`), or null. */
  line: string | null;
  spaceType: string | null;
  body: string;
  sentAt: string | null;
}

export type ParseResult =
  | { kind: 'message'; message: InboundMessage }
  | { kind: 'ignored'; reason: string }
  | { kind: 'invalid'; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Classifiable text for a content block, or null if it has none. */
export function contentText(content: unknown): string | null {
  if (!isObj(content)) return null;
  switch (content.type) {
    case 'text':
      return typeof content.text === 'string' && content.text.trim() ? content.text : null;
    case 'richlink':
      return typeof content.url === 'string' && content.url ? content.url : null;
    case 'group': {
      const items = Array.isArray(content.items) ? content.items : [];
      const parts = items.map((it) => (isObj(it) ? contentText(it.content) : null)).filter((t): t is string => !!t);
      return parts.length ? parts.join('\n') : null;
    }
    default:
      // attachment, reaction, contact and future types: nothing to classify yet (TBD in the plan).
      return null;
  }
}

export function parseSpectrumEvent(raw: unknown): ParseResult {
  if (!isObj(raw)) return { kind: 'invalid', error: 'body is not a JSON object' };
  if (raw.event !== 'messages') return { kind: 'ignored', reason: `event ${JSON.stringify(raw.event)}` };
  const msg = raw.message;
  if (!isObj(msg) || typeof msg.id !== 'string' || !msg.id) return { kind: 'invalid', error: 'missing message.id' };
  const sender = isObj(msg.sender) && typeof msg.sender.id === 'string' ? msg.sender.id : '';
  if (!sender) return { kind: 'invalid', error: 'missing message.sender.id' };

  const platform = typeof msg.platform === 'string' ? msg.platform : isObj(raw.space) ? raw.space.platform : undefined;
  if (platform !== 'imessage') return { kind: 'ignored', reason: `platform ${JSON.stringify(platform)}` };
  if (msg.direction !== undefined && msg.direction !== 'inbound') return { kind: 'ignored', reason: `direction ${String(msg.direction)}` };

  const contentType = isObj(msg.content) ? String(msg.content.type) : 'none';
  const body = contentText(msg.content);
  if (body === null) return { kind: 'ignored', reason: `content type ${contentType}` };

  const space = isObj(raw.space) ? raw.space : isObj(msg.space) ? msg.space : {};
  return {
    kind: 'message',
    message: {
      providerMessageId: msg.id,
      sender,
      line: typeof space.phone === 'string' ? space.phone : null,
      spaceType: typeof space.type === 'string' ? space.type : null,
      body,
      sentAt: typeof msg.timestamp === 'string' ? msg.timestamp : null,
    },
  };
}
