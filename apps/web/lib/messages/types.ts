// Types for the gateway's read-only query API, v1.
// Source of truth: contracts/query-api.v1.schema.json (copied by hand; keep in sync).

export type Action = "pending" | "delivered" | "blocked";
/** `not_classified`: delivered without a check because there was no text (attachment, reaction, contact card). */
/**
 * `sender_blocked`: blocked without the model, because the sender is on the blocklist (`verdict` is null).
 * `override`: a person marked it "Not a scam" and moved it to the inbox (the original verdict is kept).
 */
export type Reason = "model_verdict" | "classifier_unavailable" | "not_classified" | "sender_blocked" | "override" | null;

/** What was sent over iMessage. */
export type MessageKind = "text" | "link" | "attachment" | "reaction" | "contact" | "album";

export interface Conversation {
  /** Opaque, stable per iMessage chat. */
  id: string;
  type: "dm" | "group";
}

/** Metadata only: the gateway never has the file itself. */
export interface Attachment {
  name: string | null;
  mimeType: string | null;
  size: number | null;
}

export interface Reaction {
  emoji: string;
  /** Up to ~80 characters of the message reacted to. */
  targetPreview: string | null;
}

export interface ContactCard {
  name: string | null;
  /** Masked, like `from.display`. */
  phones: string[];
}

export interface Highlight {
  start: number;
  end: number;
  text: string;
  weight: number;
}

export interface Verdict {
  label: "scam" | "legit";
  /** P(scam), 0..1 */
  score: number;
  category: string | null;
  model: string;
  highlights: Highlight[];
}

export interface Message {
  id: string;
  from: { participantId: string; display: string };
  body: string;
  receivedAt: string;
  action: Action;
  reason: Reason;
  verdict: Verdict | null;
  // Optional in v1 (older producers omit them): use the helpers below, which apply the defaults.
  kind?: MessageKind;
  conversation?: Conversation;
  attachments?: Attachment[];
  reaction?: Reaction | null;
  contact?: ContactCard | null;
}

export interface MessagesResponse {
  schema: "t-gate.query-api";
  version: 1;
  /** Newest first. */
  messages: Message[];
}

/** Delivered without a verdict because the classifier was down (fail open). */
export function isUnverified(m: Message): boolean {
  return m.action === "delivered" && m.reason === "classifier_unavailable";
}

/** Defaults for fields older v1 producers omit. */
export function kindOf(m: Message): MessageKind {
  return m.kind ?? "text";
}

export function isGroupChat(m: Message): boolean {
  return m.conversation?.type === "group";
}

/** Delivered without a check because there was nothing to classify. */
export function isNotClassified(m: Message): boolean {
  return m.reason === "not_classified";
}

function attachmentNoun(a: Attachment): string {
  const t = a.mimeType ?? "";
  if (t.startsWith("image/")) return "Photo";
  if (t.startsWith("video/")) return "Video";
  if (t.startsWith("audio/")) return "Voice memo";
  return "File";
}

/**
 * One-line plain-text summary, for places that show a short label (the scene)
 * and for messages with no body. Display only.
 */
export function summarize(m: Message): string {
  const atts = m.attachments ?? [];
  const attLabel =
    atts.length === 1 ? `📎 ${attachmentNoun(atts[0]!)}` : atts.length > 1 ? `📎 ${atts.length} attachments` : "";
  switch (kindOf(m)) {
    case "reaction":
      return m.reaction
        ? `${m.reaction.emoji} reacted${m.reaction.targetPreview ? ` to “${m.reaction.targetPreview}”` : ""}`
        : "Reaction";
    case "contact":
      return `👤 Contact card${m.contact?.name ? `: ${m.contact.name}` : ""}`;
    case "attachment":
      return attLabel || "📎 Attachment";
    case "album":
      return m.body ? `${attLabel} ${m.body}`.trim() : attLabel || "📎 Album";
    default:
      return m.body;
  }
}

/** The gateway flagged it as a potential scam. Display only: never re-decide. */
export function isPotentialScam(m: Message): boolean {
  if (m.reason === "override") return false;
  return m.reason === "sender_blocked" || m.verdict?.label === "scam";
}

/** Blocked because the sender is a known scam sender, not by the model on this message. */
export function isSenderBlocked(m: Message): boolean {
  return m.action === "blocked" && m.reason === "sender_blocked";
}

/** A person marked it "Not a scam" and it was moved to the inbox. */
export function isRestored(m: Message): boolean {
  return m.reason === "override";
}
