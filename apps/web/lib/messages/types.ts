// Types for the gateway's read-only query API, v1.
// Source of truth: contracts/query-api.v1.schema.json (copied by hand; keep in sync).

export type Action = "pending" | "delivered" | "blocked";
export type Reason = "model_verdict" | "classifier_unavailable" | null;

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

/** The gateway flagged it as a potential scam. Display only: never re-decide. */
export function isPotentialScam(m: Message): boolean {
  return m.verdict?.label === "scam";
}
