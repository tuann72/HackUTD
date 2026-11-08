import type { Message } from "./types";

/**
 * "Clear" in the web UI only hides messages in this browser. The web app is a
 * read-only display (AGENTS.md, decoupling rules), so it never deletes anything
 * on the gateway or in Atlas. Wiping stored data stays a gateway debug tool
 * (`POST /debug/reset`, `npm run db:reset`).
 *
 * The cutoff is the newest `receivedAt` on screen when Clear was pressed, so it
 * uses the gateway's clock, not the browser's.
 */
export const CLEAR_STORAGE_KEY = "t-gate.clearedBefore";

/** Newest `receivedAt` (ISO) among the messages, or null if there are none. */
export function newestReceivedAt(messages: Message[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const m of messages) {
    const ms = Date.parse(m.receivedAt);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = m.receivedAt;
    }
  }
  return best;
}

/** Messages received after the cutoff. A null or unparsable cutoff hides nothing. */
export function hideCleared(messages: Message[], clearedBefore: string | null): Message[] {
  const cutoff = clearedBefore == null ? NaN : Date.parse(clearedBefore);
  if (!Number.isFinite(cutoff)) return messages;
  return messages.filter((m) => {
    const ms = Date.parse(m.receivedAt);
    return !Number.isFinite(ms) || ms > cutoff;
  });
}

export function loadClearedBefore(): string | null {
  try {
    return window.localStorage.getItem(CLEAR_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveClearedBefore(value: string | null): void {
  try {
    if (value == null) window.localStorage.removeItem(CLEAR_STORAGE_KEY);
    else window.localStorage.setItem(CLEAR_STORAGE_KEY, value);
  } catch {
    // Private mode or blocked storage: the clear still applies until reload.
  }
}
