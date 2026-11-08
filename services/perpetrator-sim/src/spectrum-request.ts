import { createHmac, randomUUID } from "node:crypto";
import type { SimContent } from "./content.ts";

/**
 * Photon (Spectrum) inbound iMessage webhook, shaped like
 * contracts/fixtures/photon-inbound-imessage.sample.json.
 * Docs: https://photon.codes/docs/webhooks/events
 */
export interface SpectrumSpace {
  id: string;
  platform: "imessage";
  type: "dm" | "group";
  phone: string;
}

/** Photon's `message.content`, as the gateway's parser expects it. */
export type SpectrumContent =
  | { type: "text"; text: string }
  | { type: "richlink"; url: string }
  | { type: "attachment"; id: string; name: string; mimeType: string; size?: number }
  | { type: "reaction"; emoji: string; target: { id: string; platform: "imessage"; contentPreview?: string } }
  | { type: "contact"; name?: string; phones: string[] }
  | { type: "group"; items: SpectrumMessage[] };

export interface SpectrumMessage {
  id: string;
  platform: "imessage";
  direction: "inbound";
  timestamp: string;
  sender: { id: string; platform: "imessage" };
  space: SpectrumSpace;
  content: SpectrumContent;
}

export interface SpectrumPayload {
  event: "messages";
  space: SpectrumSpace;
  message: SpectrumMessage;
}

/** `spc-msg-<uuid>`, fresh per message so reruns never collide with the gateway's dedupe. */
export function newMessageId(): string {
  return `spc-msg-${randomUUID()}`;
}

/** Placeholder iMessage attachment GUID. The gateway never exposes it. */
function newAttachmentId(): string {
  return randomUUID().toUpperCase();
}

export interface InboundInput {
  from: string;
  /** The victim line (`space.phone`). */
  line: string;
  /** Plain text. Ignored when `content` is given. */
  body?: string;
  content?: SimContent;
  /** Group chat id: makes `space.type` "group" with this `space.id`. */
  group?: string;
  messageId?: string;
  timestamp?: string;
}

function toSpectrumContent(c: SimContent, ctx: { from: string; space: SpectrumSpace; timestamp: string }): SpectrumContent {
  switch (c.type) {
    case "text":
    case "richlink":
      return { ...c };
    case "attachment":
      return { type: "attachment", id: newAttachmentId(), name: c.name, mimeType: c.mimeType, ...(c.size !== undefined ? { size: c.size } : {}) };
    case "reaction":
      // The target is some earlier message; its id is opaque to the gateway.
      return {
        type: "reaction",
        emoji: c.emoji,
        target: { id: newMessageId(), platform: "imessage", ...(c.targetPreview ? { contentPreview: c.targetPreview.slice(0, 80) } : {}) },
      };
    case "contact":
      return { type: "contact", ...(c.name ? { name: c.name } : {}), phones: c.phones ?? [] };
    case "group":
      // An album: each item is a full inbound message with its own id.
      return {
        type: "group",
        items: c.items.map((item) => ({
          id: newMessageId(),
          platform: "imessage",
          direction: "inbound",
          timestamp: ctx.timestamp,
          sender: { id: ctx.from, platform: "imessage" },
          space: { ...ctx.space },
          content: toSpectrumContent(item, ctx),
        })),
      };
  }
}

export function buildInboundMessage(input: InboundInput): SpectrumPayload {
  const space: SpectrumSpace = input.group
    ? { id: input.group, platform: "imessage", type: "group", phone: input.line }
    : { id: `any;-;${input.from}`, platform: "imessage", type: "dm", phone: input.line };
  const timestamp = input.timestamp ?? new Date().toISOString();
  const content = input.content ?? { type: "text" as const, text: input.body ?? "" };
  return {
    event: "messages",
    space,
    message: {
      id: input.messageId ?? newMessageId(),
      platform: "imessage",
      direction: "inbound",
      timestamp,
      sender: { id: input.from, platform: "imessage" },
      space: { ...space },
      content: toSpectrumContent(content, { from: input.from, space, timestamp }),
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
