import fixture from "./fixture.v1.json";
import type { Message, MessagesResponse } from "./types";

/**
 * Where messages come from.
 * - "live":   poll the gateway at NEXT_PUBLIC_API_URL
 * - "replay": replay the contract fixture over time (pending -> resolved), looping
 * - "static": the fixture as-is
 */
export type SourceMode = "live" | "replay" | "static";

export interface MessageSource {
  mode: SourceMode;
  /** Current list, newest first. */
  fetch(): Promise<Message[]>;
}

const FIXTURE = (fixture as MessagesResponse).messages;

export function liveSource(apiUrl: string, limit = 100): MessageSource {
  const base = apiUrl.replace(/\/+$/, "");
  return {
    mode: "live",
    async fetch() {
      const res = await fetch(`${base}/api/messages?limit=${limit}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`GET /api/messages failed: ${res.status}`);
      const data = (await res.json()) as MessagesResponse;
      if (data.schema !== "t-gate.query-api" || data.version !== 1) {
        throw new Error(`unexpected contract: ${data.schema} v${data.version}`);
      }
      return data.messages;
    },
  };
}

export function staticSource(): MessageSource {
  return { mode: "static", fetch: async () => FIXTURE };
}

export interface ReplayOptions {
  /** ms between messages arriving. */
  everyMs?: number;
  /** ms a message stays pending before it resolves. */
  pendingMs?: number;
  /** clock, for tests. */
  now?: () => number;
}

/**
 * Replays the fixture as if messages were arriving: one every `everyMs`,
 * each pending for `pendingMs`, then its fixture action. Loops forever with
 * fresh ids, so a demo or scene keeps moving with no backend.
 * Fixture messages that are pending in the fixture stay pending briefly,
 * then resolve to "delivered".
 */
export function replaySource({ everyMs = 3000, pendingMs = 1200, now = Date.now }: ReplayOptions = {}): MessageSource {
  const start = now();
  const script = [...FIXTURE].reverse(); // oldest first
  return {
    mode: "replay",
    async fetch() {
      const t = now() - start;
      const arrived = Math.floor(t / everyMs) + 1;
      const out: Message[] = [];
      for (let i = 0; i < arrived; i++) {
        const base = script[i % script.length];
        const loop = Math.floor(i / script.length);
        const arrivedAt = start + i * everyMs;
        const resolved = now() - arrivedAt >= pendingMs;
        const finalAction = base.action === "pending" ? "delivered" : base.action;
        const finalReason = base.action === "pending" ? "model_verdict" : base.reason;
        const finalVerdict =
          base.verdict ??
          (base.action === "pending"
            ? { label: "legit" as const, score: 0.05, category: null, model: "replay@0", highlights: [] }
            : null);
        out.push({
          ...base,
          id: loop === 0 ? base.id : `${base.id}_r${loop}`,
          receivedAt: new Date(arrivedAt).toISOString(),
          action: resolved ? finalAction : "pending",
          reason: resolved ? finalReason : null,
          verdict: resolved ? finalVerdict : null,
        });
      }
      return out.reverse().slice(0, 100); // newest first
    },
  };
}

/**
 * Picks the source: `?source=live|replay|static` overrides; otherwise live
 * when NEXT_PUBLIC_API_URL is set, else replay.
 */
export function pickSource(override?: string | null): MessageSource {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (override === "static") return staticSource();
  if (override === "replay") return replaySource();
  if (override === "live" || (!override && apiUrl)) {
    if (!apiUrl) throw new Error("source=live needs NEXT_PUBLIC_API_URL");
    return liveSource(apiUrl);
  }
  return replaySource();
}
