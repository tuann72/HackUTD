// Aggregates for the /dashboard page. Display only: these count the gateway's
// decisions (action, reason, verdict) as given and never re-decide anything.

import { kindOf, type Message, type MessageKind, type Reason } from "./types";

export interface Count {
  key: string;
  label: string;
  count: number;
}

export interface SenderCount {
  /** Masked display string from the gateway, e.g. "***-***-4821". */
  display: string;
  total: number;
  blocked: number;
}

export interface MessageStats {
  total: number;
  blocked: number;
  delivered: number;
  pending: number;
  /** blocked / decided (blocked + delivered); null with nothing decided. */
  blockRate: number | null;
  /** Mean P(scam) over messages the model scored; null if none. */
  avgScore: number | null;
  /** Each list is sorted most common first; ties keep a stable order. */
  outcomes: Count[];
  reasons: Count[];
  kinds: Count[];
  /** Scam categories of blocked messages that have one. */
  categories: Count[];
  /** Ten buckets of P(scam): [0, 0.1), [0.1, 0.2), ... [0.9, 1]. Kept in score order, not sorted. */
  scores: Count[];
  /** Senders by message count, most active first. */
  senders: SenderCount[];
  /** receivedAt of the oldest and newest message, ISO strings; null when empty. */
  span: { from: string; to: string } | null;
}

const REASON_LABELS: Record<string, string> = {
  model_verdict: "Model verdict",
  classifier_unavailable: "Unverified (classifier down)",
  not_classified: "Not checked (no text)",
  sender_blocked: "Known scam sender",
  override: "Restored by a person",
  pending: "Still checking",
};

const KIND_LABELS: Record<MessageKind, string> = {
  text: "Text",
  link: "Link",
  album: "Photos / album",
  attachment: "Attachment",
  reaction: "Reaction",
  contact: "Contact card",
};

const OUTCOME_LABELS = { blocked: "Blocked", delivered: "Delivered", pending: "Pending" } as const;

function tally(keys: string[], label: (key: string) => string): Count[] {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  // Map keeps first-seen order, and sort is stable, so ties stay in that order.
  return [...counts]
    .map(([key, count]) => ({ key, label: label(key), count }))
    .sort((a, b) => b.count - a.count);
}

const reasonKey = (r: Reason) => r ?? "pending";

export function messageStats(messages: Message[]): MessageStats {
  const blocked = messages.filter((m) => m.action === "blocked").length;
  const delivered = messages.filter((m) => m.action === "delivered").length;
  const pending = messages.length - blocked - delivered;
  const decided = blocked + delivered;

  const scored = messages.map((m) => m.verdict?.score).filter((s): s is number => typeof s === "number");
  const avgScore = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;

  const scores: Count[] = Array.from({ length: 10 }, (_, i) => ({
    key: String(i),
    label: `${(i / 10).toFixed(1)} to ${((i + 1) / 10).toFixed(1)}`,
    count: 0,
  }));
  for (const s of scored) scores[Math.min(9, Math.max(0, Math.floor(s * 10)))]!.count += 1;

  const bySender = new Map<string, SenderCount>();
  for (const m of messages) {
    const key = m.from.participantId || m.from.display;
    const row = bySender.get(key) ?? { display: m.from.display, total: 0, blocked: 0 };
    row.total += 1;
    if (m.action === "blocked") row.blocked += 1;
    bySender.set(key, row);
  }

  const times = messages.map((m) => m.receivedAt).filter(Boolean).sort();

  return {
    total: messages.length,
    blocked,
    delivered,
    pending,
    blockRate: decided ? blocked / decided : null,
    avgScore,
    outcomes: tally(
      messages.map((m) => m.action),
      (k) => OUTCOME_LABELS[k as keyof typeof OUTCOME_LABELS] ?? k,
    ),
    reasons: tally(
      messages.map((m) => reasonKey(m.reason)),
      (k) => REASON_LABELS[k] ?? k,
    ),
    kinds: tally(
      messages.map((m) => kindOf(m)),
      (k) => KIND_LABELS[k as MessageKind] ?? k,
    ),
    categories: tally(
      messages.filter((m) => m.action === "blocked" && m.verdict?.category).map((m) => m.verdict!.category!),
      (k) => k,
    ),
    scores,
    senders: [...bySender.values()].sort((a, b) => b.total - a.total || b.blocked - a.blocked),
    span: times.length ? { from: times[0]!, to: times[times.length - 1]! } : null,
  };
}

export type SenderSortKey = "messages" | "blocked" | "share";
export type SortDir = "desc" | "asc";

/**
 * Senders ordered by a column. Share is each sender's part of all messages, so
 * it orders like messages. Ties fall back to the other count, then the number.
 */
export function sortSenders(senders: SenderCount[], key: SenderSortKey, dir: SortDir = "desc"): SenderCount[] {
  const primary = (s: SenderCount) => (key === "blocked" ? s.blocked : s.total);
  const secondary = (s: SenderCount) => (key === "blocked" ? s.total : s.blocked);
  const sign = dir === "desc" ? -1 : 1;
  return [...senders].sort(
    (a, b) =>
      sign * (primary(a) - primary(b)) || sign * (secondary(a) - secondary(b)) || a.display.localeCompare(b.display),
  );
}
