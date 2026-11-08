"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BlockActions, BlocklistStatus } from "@/lib/messages";

/**
 * Polls GET /api/blocklist for the "Clear blocks (n)" count. null until known, or when the
 * endpoint fails (the button then shows plain "Clear blocks").
 */
export function useBlocklist(actions: BlockActions | null, intervalMs = 5000) {
  const [status, setStatus] = useState<BlocklistStatus | null>(null);
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    if (!actions) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    // Only the newest poll writes and reschedules, so a refresh() never starts a second loop.
    let seq = 0;
    const tick = async () => {
      const mine = ++seq;
      clearTimeout(timer);
      const live = () => !stopped && mine === seq;
      try {
        const s = await actions.blocklist();
        if (live()) setStatus(s);
      } catch {
        if (live()) setStatus(null);
      } finally {
        if (live()) timer = setTimeout(tick, intervalMs);
      }
    };
    kick.current = () => void tick();
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      kick.current = () => {};
    };
  }, [actions, intervalMs]);

  const refresh = useCallback(() => kick.current(), []);
  return { status: actions ? status : null, refresh };
}

/** The button text: "Clear blocks (3)" when the blocklist is on and the count is known. */
export function clearBlocksLabel(status: BlocklistStatus | null): string {
  return status?.enabled ? `Clear blocks (${status.blockedSenders})` : "Clear blocks";
}
