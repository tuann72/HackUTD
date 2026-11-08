import type { Message } from "./types";

/**
 * A change between two polls of GET /api/messages. Useful for animation
 * (e.g. the 3D scene): "received" when a message first appears, "resolved"
 * when its action changes from pending to delivered/blocked.
 * A message that first appears already resolved emits both, in order.
 */
export type MessageChange =
  | { type: "received"; message: Message }
  | { type: "resolved"; message: Message };

export function diffMessages(prev: Message[], next: Message[]): MessageChange[] {
  const before = new Map(prev.map((m) => [m.id, m]));
  const changes: MessageChange[] = [];
  // next is newest first; emit oldest first so animations play in order.
  for (const m of [...next].reverse()) {
    const old = before.get(m.id);
    if (!old) {
      changes.push({ type: "received", message: m });
      if (m.action !== "pending") changes.push({ type: "resolved", message: m });
    } else if (old.action === "pending" && m.action !== "pending") {
      changes.push({ type: "resolved", message: m });
    }
  }
  return changes;
}
