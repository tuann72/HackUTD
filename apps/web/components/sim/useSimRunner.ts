"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Step } from "@/lib/sim/plan";

export interface SimStatus {
  enabled: boolean;
  target: string | null;
  reason: string | null;
}

export interface LogEntry {
  key: number;
  at: number;
  from: string;
  preview: string;
  expected?: "deliver" | "block";
  ok: boolean;
  error?: string;
}

export interface Run {
  label: string;
  sent: number;
  total: number;
}

const mask = (n: string) => `***-***-${n.replace(/\D/g, "").slice(-4)}`;

function preview(s: Step): string {
  if (s.body) return s.body;
  const c = s.content;
  switch (c?.type) {
    case "text":
      return c.text;
    case "richlink":
      return `🔗 ${c.url}`;
    case "attachment":
      return `📎 ${c.name}`;
    case "reaction":
      return `${c.emoji} reaction`;
    case "contact":
      return `👤 ${c.name ?? "contact card"}`;
    case "group":
      return `🖼 album (${c.items.length} items)`;
    default:
      return "";
  }
}

/** Resolves after `ms`, or rejects at once when the signal aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const id = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(id), reject(signal.reason)), { once: true });
  });
}

/**
 * Sends a run's steps one at a time through POST /api/simulate, waiting each
 * step's delay in the browser, so a long run never hits a server time limit
 * and Stop takes effect immediately. One run at a time.
 */
export function useSimRunner() {
  const [status, setStatus] = useState<SimStatus | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const abort = useRef<AbortController | null>(null);
  const nextKey = useRef(0);

  useEffect(() => {
    let live = true;
    fetch("/api/simulate", { cache: "no-store" })
      .then((r) => r.json() as Promise<SimStatus>)
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus({ enabled: false, target: null, reason: "Couldn't reach /api/simulate." }));
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, []);

  const start = useCallback(async (label: string, steps: Step[]) => {
    if (abort.current || steps.length === 0) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRun({ label, sent: 0, total: steps.length });
    try {
      for (const [i, step] of steps.entries()) {
        if (step.delayMs > 0) await wait(step.delayMs, ctrl.signal);
        const { expected, delayMs, ...body } = step;
        void delayMs;
        let ok = false;
        let error: string | undefined;
        try {
          const res = await fetch("/api/simulate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
          ok = res.ok;
          if (!ok) error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
        } catch (e) {
          if (ctrl.signal.aborted) throw e;
          error = e instanceof Error ? e.message : String(e);
        }
        nextKey.current += 1;
        const entry: LogEntry = { key: nextKey.current, at: Date.now(), from: mask(step.from), preview: preview(step), expected, ok, error };
        setLog((l) => [entry, ...l].slice(0, 30));
        setRun({ label, sent: i + 1, total: steps.length });
        // A rejected rate limit or a missing secret fails every later step too.
        if (!ok && error && /Too many|secret|simulation is off/i.test(error)) break;
      }
    } catch {
      // Stopped.
    } finally {
      abort.current = null;
      setRun(null);
    }
  }, []);

  const stop = useCallback(() => abort.current?.abort(), []);
  const clearLog = useCallback(() => setLog([]), []);

  return { status, run, log, start, stop, clearLog };
}
