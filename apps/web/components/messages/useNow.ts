"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 1000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let current = 0;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// Stable between ticks, so React doesn't re-render in a loop.
const getSnapshot = () => current || (current = Date.now());
// No clock on the server or during prerender: relative times render empty
// and fill in after hydration. Keeps the route prerenderable with Cache Components.
const getServerSnapshot = () => null;

/** Current time in ms, refreshed every second; null on the server. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
