// Types mirroring contracts/query-api.v1.schema.json. The contract is the source of truth;
// these are copied, not imported, per the decoupling rules.

export type Action = 'pending' | 'delivered' | 'blocked';
export type Reason = 'model_verdict' | 'classifier_unavailable' | null;

export interface Highlight {
  start: number;
  end: number;
  text: string;
  weight: number;
}

export interface Verdict {
  label: 'scam' | 'legit';
  score: number;
  category: string | null;
  model: string;
  highlights: Highlight[];
}

export interface ApiMessage {
  id: string;
  from: { participantId: string; display: string };
  body: string;
  receivedAt: string;
  action: Action;
  reason: Reason;
  verdict: Verdict | null;
}

export interface MessagesResponse {
  schema: 't-gate.query-api';
  version: 1;
  messages: ApiMessage[];
}

/** Scam category names, exactly as in data/scam_categories.csv (labels 1-7). */
export const SCAM_CATEGORIES = [
  'Imposter & Phishing',
  'Prizes, Lotteries & Advance-Fee',
  'Jobs, Business & Investment',
  'Loans, Credit & Debt',
  'Health & Pharmacy',
  'Shopping & Product Offers',
  'Internet, Telecom & Media',
] as const;
export type ScamCategory = (typeof SCAM_CATEGORIES)[number];
