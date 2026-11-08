// Filters for the message panel on /messages. Display only: they choose which of
// the gateway's messages to show and in what order, and never re-decide a verdict.

import { isGroupChat, isNotClassified, isRestored, isSenderBlocked, isUnverified, type Message } from "../../lib/messages/types";
import { categoryLabel } from "./category";

export type View = "all" | "inbox" | "blocked";
export type Sort = "newest" | "oldest" | "score";
/** Extra conditions; a message must match every one that is on. */
export type Flag = "unchecked" | "money" | "restored" | "group";

export interface Filters {
  view: View;
  query: string;
  /** A category label (as `categoryLabel` writes it), "known_sender", or "" for any. */
  category: string;
  flags: Flag[];
  sort: Sort;
}

export const DEFAULT_FILTERS: Filters = { view: "all", query: "", category: "", flags: [], sort: "newest" };

/** The "Known scam sender" option in the category filter: blocked by the blocklist, no category. */
export const KNOWN_SENDER = "known_sender";

export const FLAGS: { id: Flag; label: string; title: string }[] = [
  { id: "unchecked", label: "Not checked", title: "Delivered without a model check (classifier down, or nothing to check)" },
  { id: "money", label: "Money request", title: "Asks for a large sum of money" },
  { id: "restored", label: "Restored", title: "Marked \"Not a scam\" and moved to the inbox" },
  { id: "group", label: "Group chat", title: "Sent in a group chat" },
];

const FLAG_TEST: Record<Flag, (m: Message) => boolean> = {
  unchecked: (m) => isUnverified(m) || isNotClassified(m),
  money: (m) => m.verdict?.warning === "large_money_request",
  restored: isRestored,
  group: isGroupChat,
};

/** Which list a message belongs to. Pending messages sit in the inbox until decided. */
export function inView(m: Message, view: View): boolean {
  if (view === "all") return true;
  if (view === "blocked") return m.action === "blocked";
  return m.action !== "blocked";
}

/** The category filter's key for a blocked message: its category label, or KNOWN_SENDER. */
export function categoryKey(m: Message): string | null {
  if (m.action !== "blocked") return null;
  return isSenderBlocked(m) ? KNOWN_SENDER : categoryLabel(m.verdict?.category);
}

/** Categories present among the blocked messages, most common first, for the category menu. */
export function categoryOptions(messages: Message[]): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of messages) {
    const k = categoryKey(m);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function matchesQuery(m: Message, q: string): boolean {
  if (!q) return true;
  const hay = [m.from.display, m.body, m.verdict?.category ?? "", m.contact?.name ?? ""].join("\n").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

const time = (m: Message) => Date.parse(m.receivedAt) || 0;

/**
 * The messages to show for these filters. Pending messages always lead (they are
 * about to be decided); the rest follow the chosen sort. Scoreless messages sort last
 * under "score".
 */
export function applyFilters(messages: Message[], f: Filters): Message[] {
  const shown = messages.filter(
    (m) =>
      inView(m, f.view) &&
      (!f.category || categoryKey(m) === f.category) &&
      f.flags.every((flag) => FLAG_TEST[flag](m)) &&
      matchesQuery(m, f.query.trim()),
  );
  const order = (a: Message, b: Message) => {
    if (f.sort === "score") {
      const d = (b.verdict?.score ?? -1) - (a.verdict?.score ?? -1);
      if (d) return d;
    }
    return f.sort === "oldest" ? time(a) - time(b) : time(b) - time(a);
  };
  const pending = shown.filter((m) => m.action === "pending").sort(order);
  const decided = shown.filter((m) => m.action !== "pending").sort(order);
  return [...pending, ...decided];
}

/** How many filters (beyond the view tab) are narrowing the list. */
export function activeFilterCount(f: Filters): number {
  return (f.query.trim() ? 1 : 0) + (f.category ? 1 : 0) + f.flags.length + (f.sort !== "newest" ? 1 : 0);
}
