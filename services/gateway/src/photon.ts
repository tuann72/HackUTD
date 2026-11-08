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

export type MessageKind = 'text' | 'link' | 'attachment' | 'reaction' | 'contact' | 'album';

export interface AttachmentMeta {
  name: string | null;
  mimeType: string | null;
  size: number | null;
}

/** What the gateway stores and classifies. Raw values; db.ts masks before anything leaves it. */
export interface InboundMessage {
  providerMessageId: string;
  /** iMessage handle: E.164 number or an Apple ID email. */
  sender: string;
  /** The victim line (`space.phone`), or null. */
  line: string | null;
  /** Photon's `space.id` (raw, contains handles) and whether it's a DM or a group chat. */
  conversation: { spaceId: string; type: 'dm' | 'group' };
  kind: MessageKind;
  /** Classifiable text: the text, the link URL, or an album's text items. "" if there is none. */
  body: string;
  /** Metadata only: Photon sends no bytes or URLs. */
  attachments: AttachmentMeta[];
  reaction: { emoji: string; targetPreview: string | null } | null;
  /** Shared contact card. Phones are raw here. */
  contact: { name: string | null; phones: string[] } | null;
  sentAt: string | null;
}

export type ParseResult =
  | { kind: 'message'; message: InboundMessage }
  | { kind: 'ignored'; reason: string }
  | { kind: 'invalid'; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function attachmentMeta(c: Record<string, unknown>): AttachmentMeta {
  return {
    name: strOrNull(c.name),
    mimeType: strOrNull(c.mimeType),
    size: typeof c.size === 'number' && Number.isFinite(c.size) ? c.size : null,
  };
}

type Content = Pick<InboundMessage, 'kind' | 'body' | 'attachments' | 'reaction' | 'contact'>;

/** Maps one content block; null for an unknown type or a block with nothing in it. */
export function parseContent(content: unknown): Content | null {
  if (!isObj(content)) return null;
  const empty = { body: '', attachments: [], reaction: null, contact: null };
  switch (content.type) {
    case 'text':
      return typeof content.text === 'string' && content.text.trim() ? { ...empty, kind: 'text', body: content.text } : null;
    case 'richlink':
      return typeof content.url === 'string' && content.url ? { ...empty, kind: 'link', body: content.url } : null;
    case 'attachment':
      return { ...empty, kind: 'attachment', attachments: [attachmentMeta(content)] };
    case 'reaction': {
      if (typeof content.emoji !== 'string' || !content.emoji) return null;
      const target = isObj(content.target) ? content.target : {};
      return { ...empty, kind: 'reaction', reaction: { emoji: content.emoji, targetPreview: strOrNull(target.contentPreview) } };
    }
    case 'contact': {
      const phones = Array.isArray(content.phones) ? content.phones.filter((p): p is string => typeof p === 'string') : [];
      return { ...empty, kind: 'contact', contact: { name: strOrNull(content.name), phones } };
    }
    case 'group': {
      // An album: text items become the body, attachments are listed.
      const parts = (Array.isArray(content.items) ? content.items : []).map((it) => (isObj(it) ? parseContent(it.content) : null));
      const body = parts.filter((p) => p && (p.kind === 'text' || p.kind === 'link')).map((p) => p!.body).join('\n');
      const attachments = parts.flatMap((p) => p?.attachments ?? []);
      if (!body && attachments.length === 0) return null;
      return { ...empty, kind: 'album', body, attachments };
    }
    default:
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

  const space = isObj(raw.space) ? raw.space : isObj(msg.space) ? msg.space : {};
  const platform = typeof msg.platform === 'string' ? msg.platform : space.platform;
  if (platform !== 'imessage') return { kind: 'ignored', reason: `platform ${JSON.stringify(platform)}` };
  if (msg.direction !== undefined && msg.direction !== 'inbound') return { kind: 'ignored', reason: `direction ${String(msg.direction)}` };

  const content = parseContent(msg.content);
  if (!content) return { kind: 'ignored', reason: `content type ${isObj(msg.content) ? String(msg.content.type) : 'none'}` };

  return {
    kind: 'message',
    message: {
      providerMessageId: msg.id,
      sender,
      line: typeof space.phone === 'string' ? space.phone : null,
      conversation: {
        // A DM's space is one per sender; fall back to that if Photon omits the id.
        spaceId: typeof space.id === 'string' && space.id ? space.id : `dm:${sender}`,
        type: space.type === 'group' ? 'group' : 'dm',
      },
      ...content,
      sentAt: typeof msg.timestamp === 'string' ? msg.timestamp : null,
    },
  };
}

/** Text worth sending to the classifier. Attachments, reactions and contact cards have none. */
export function isClassifiable(m: InboundMessage): boolean {
  return (m.kind === 'text' || m.kind === 'link' || m.kind === 'album') && m.body.trim().length > 0;
}
