// Types mirroring contracts/query-api.v1.schema.json. The contract is the source of truth;
// these are copied, not imported, per the decoupling rules.

export type Action = 'pending' | 'delivered' | 'blocked';
/** `not_classified`: delivered without a check because there was no text (attachment, reaction, contact). */
/**
 * `sender_blocked`: blocked without asking the model, because the sender is on the blocklist.
 * `override`: a person marked it "Not a scam" and moved it to the inbox.
 */
export type Reason = 'model_verdict' | 'classifier_unavailable' | 'not_classified' | 'sender_blocked' | 'override' | null;
export type MessageKind = 'text' | 'link' | 'attachment' | 'reaction' | 'contact' | 'album';

export interface Conversation {
  /** Opaque, stable per iMessage chat. */
  id: string;
  type: 'dm' | 'group';
}

export interface Attachment {
  name: string | null;
  mimeType: string | null;
  size: number | null;
}

export interface Highlight {
  start: number;
  end: number;
  text: string;
  weight: number;
}

/** Nemotron's second opinion, for scores in the review band. Absent when no review ran. */
export interface Review {
  decision: 'block' | 'deliver';
  reason: string;
  model: string;
  checks: Array<{ check: string; keyword: string | null; found: boolean }>;
  /** Where the bank checks ran. Null when Nemotron asked for none. */
  bankSource: 'nessie' | 'mock' | null;
}

export interface Verdict {
  label: 'scam' | 'legit';
  score: number;
  category: string | null;
  model: string;
  highlights: Highlight[];
  /** Set by the gateway on a delivered message that deserves a second look. */
  warning?: 'large_money_request';
  review?: Review;
}

export interface ApiMessage {
  id: string;
  from: { participantId: string; display: string };
  body: string;
  receivedAt: string;
  action: Action;
  reason: Reason;
  verdict: Verdict | null;
  kind: MessageKind;
  conversation: Conversation;
  attachments: Attachment[];
  reaction: { emoji: string; targetPreview: string | null } | null;
  /** Shared contact card; phones are masked. */
  contact: { name: string | null; phones: string[] } | null;
}

export interface MessagesResponse {
  schema: 't-gate.query-api';
  version: 1;
  messages: ApiMessage[];
}

/** Scam category names, exactly as in data/scam_categories.csv (labels 1-8). */
export const SCAM_CATEGORIES = [
  'Imposter & Phishing',
  'Prizes, Lotteries & Advance-Fee',
  'Jobs, Business & Investment',
  'Loans, Credit & Debt',
  'Health & Pharmacy',
  'Shopping & Product Offers',
  'Internet, Telecom & Media',
  'Threats & Extortion',
] as const;
export type ScamCategory = (typeof SCAM_CATEGORIES)[number];
