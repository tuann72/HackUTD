// Sends a finished call's transcript to the T-Guard gateway on the VM, the same way the
// perpetrator simulator and the web Simulate panel do: a Photon (Spectrum) inbound-iMessage
// webhook, signed with X-Spectrum-Signature, POSTed to /webhooks/photon. The gateway then
// classifies it, applies its block/deliver policy and stores it, and the web UI shows it
// through GET /api/messages like any other message. Nothing goes through Photon.
import { createHmac } from 'node:crypto';

export interface GatewayOptions {
  /** Full webhook URL, for example https://<gateway-host>/webhooks/photon. */
  url: string;
  /** The gateway's PHOTON_WEBHOOK_SECRET (Spectrum signing secret). */
  secret: string;
  /** The victim line shown as `space.phone`. */
  line: string;
  timeoutMs: number;
}

export interface TranscriptMessage {
  /** Opaque per-call id. Used as Photon's message.id, so a retried POST is deduplicated. */
  callId: string;
  /** Caller handle (E.164 number from the SIP participant, or a placeholder). Stored raw only in the gateway DB. */
  caller: string;
  transcript: string;
  /** When the call ended. */
  endedAt: Date;
}

/** `v0=` + lowercase hex HMAC-SHA256 over `v0:<timestamp>:<rawBody>` (services/gateway/src/photon.ts). */
export function spectrumSignature(secret: string, timestamp: string, rawBody: string): string {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
}

/** The Photon `messages` event the gateway's parseSpectrumEvent accepts, carrying the transcript as text. */
export function buildTranscriptPayload(msg: TranscriptMessage, line: string) {
  // A space of its own per caller, so calls don't merge into that number's iMessage chat.
  const space = { id: `voice;-;${msg.caller}`, platform: 'imessage', type: 'dm', phone: line };
  return {
    event: 'messages',
    space,
    message: {
      id: `voice-${msg.callId}`,
      platform: 'imessage',
      direction: 'inbound',
      timestamp: msg.endedAt.toISOString(),
      sender: { id: msg.caller, platform: 'imessage' },
      space: { ...space },
      content: { type: 'text', text: msg.transcript },
    },
  };
}

export function checkGatewayUrl(raw: string): URL {
  const url = new URL(raw);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !local) {
    throw new Error('GATEWAY_WEBHOOK_URL must use HTTPS outside local development');
  }
  if (url.hostname === 'photon.codes' || url.hostname.endsWith('.photon.codes')) {
    throw new Error('GATEWAY_WEBHOOK_URL points at Photon; transcripts go only to the T-Guard gateway');
  }
  return url;
}

/**
 * POSTs the transcript to the gateway. Resolves on 2xx. The gateway acks with `200 ok`
 * before it classifies; the verdict shows up in GET /api/messages a moment later.
 */
export async function sendTranscriptToGateway(
  options: GatewayOptions,
  msg: TranscriptMessage,
  now: () => Date = () => new Date(),
): Promise<void> {
  const endpoint = checkGatewayUrl(options.url);
  const raw = JSON.stringify(buildTranscriptPayload(msg, options.line));
  const timestamp = String(Math.floor(now().getTime() / 1000));
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Spectrum-Event': 'messages',
      'X-Spectrum-Timestamp': timestamp,
      'X-Spectrum-Signature': spectrumSignature(options.secret, timestamp, raw),
    },
    body: raw,
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Gateway returned HTTP ${response.status}`);
  }
}
