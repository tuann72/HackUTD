import { createHmac, randomUUID } from "node:crypto";

/**
 * Photon (Spectrum) inbound iMessage webhook, shaped like
 * contracts/fixtures/photon-inbound-imessage.sample.json.
 * Docs: https://photon.codes/docs/webhooks/events
 */
export interface SpectrumSpace {
  id: string;
  platform: "imessage";
  type: "dm";
  phone: string;
}

export interface SpectrumPayload {
  event: "messages";
  space: SpectrumSpace;
  message: {
    id: string;
    platform: "imessage";
    direction: "inbound";
    timestamp: string;
    sender: { id: string; platform: "imessage" };
    space: SpectrumSpace;
    content: { type: "text"; text: string };
  };
}

/** `spc-msg-<uuid>`, fresh per message so reruns never collide with the gateway's dedupe. */
export function newMessageId(): string {
  return `spc-msg-${randomUUID()}`;
}

export interface InboundInput {
  from: string;
  /** The victim line (`space.phone`). */
  line: string;
  body: string;
  messageId?: string;
  timestamp?: string;
}

export function buildInboundMessage(input: InboundInput): SpectrumPayload {
  const space: SpectrumSpace = { id: `any;-;${input.from}`, platform: "imessage", type: "dm", phone: input.line };
  return {
    event: "messages",
    space,
    message: {
      id: input.messageId ?? newMessageId(),
      platform: "imessage",
      direction: "inbound",
      timestamp: input.timestamp ?? new Date().toISOString(),
      sender: { id: input.from, platform: "imessage" },
      space: { ...space },
      content: { type: "text", text: input.body },
    },
  };
}

/** `X-Spectrum-Signature`: `v0=` + hex HMAC-SHA256 over `v0:<timestamp>:<rawBody>`. */
export function signBody(secret: string, timestamp: string, rawBody: string): string {
  return "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
}

/** `+15555550142` -> `***-***-0142` */
export function maskNumber(number: string): string {
  const digits = number.replace(/\D/g, "");
  return `***-***-${digits.slice(-4).padStart(4, "*")}`;
}
