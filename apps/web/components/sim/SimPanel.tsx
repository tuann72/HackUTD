"use client";

import { useId, useState } from "react";
import { PRESETS } from "@/lib/sim/presets";
import { presetSteps, runDurationMs, SENDER_POOL, type RunSettings } from "@/lib/sim/plan";
import { useSimRunner } from "./useSimRunner";

const field =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const button =
  "rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:hover:bg-zinc-800";

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/**
 * Fixed run settings for the random-burst presets. The panel used to expose
 * these as inputs (count, scam share, interval, sender, seed); Tuan removed
 * them, so every burst uses these and a fresh seed.
 */
const SETTINGS: Omit<RunSettings, "seed"> = { n: 10, scamRatio: 0.6, intervalMs: 1500, from: "" };

/**
 * Sidebar that runs perpetrator simulations from the page: preset buttons
 * (lib/sim/presets.ts) and a custom message. Each step goes
 * through POST /api/simulate, which signs it and sends it to the gateway, so
 * results show up in the scene and lists like real iMessages.
 */
export function SimPanel() {
  const { status, run, log, start, stop, clearLog } = useSimRunner();
  const [open, setOpen] = useState(true);
  const [text, setText] = useState("");
  const [customFrom, setCustomFrom] = useState(SENDER_POOL[0]!);
  const bodyId = useId();
  const ids = { text: useId(), customFrom: useId() };

  const enabled = status?.enabled === true;
  const busy = run !== null;

  return (
    <aside aria-label="Simulations" className="flex flex-col gap-3 lg:sticky lg:top-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="-mx-1 flex items-center gap-2 rounded px-1 uppercase hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 dark:hover:text-zinc-200"
        >
          <svg aria-hidden viewBox="0 0 16 16" className={`size-3 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>
            <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Simulate
        </button>
      </h2>

      {open && (
        <div id={bodyId} className="flex flex-col gap-4 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
          {status === null && <p className="text-xs text-zinc-500">Checking…</p>}
          {status && !enabled && (
            <p role="status" className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              Simulation is off. {status.reason}
            </p>
          )}
          {enabled && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Sends signed, simulated iMessages from fictional numbers to <span className="font-mono">{status.target}</span>.
            </p>
          )}

          <div className="flex flex-col gap-2">
            {PRESETS.map((p) => {
              const preview = presetSteps(p, { ...SETTINGS, seed: 1 });
              const secs = Math.round(runDurationMs(preview) / 1000);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!enabled || busy}
                  onClick={() => start(p.label, presetSteps(p, { ...SETTINGS, seed: newSeed() }))}
                  className={button}
                >
                  <span className="block font-medium">{p.label}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {p.kind === "random" && p.n > 1
                      ? `${preview.length} messages, ${Math.round(SETTINGS.scamRatio * 100)}% scams${secs ? `, about ${secs} s` : ""}`
                      : p.description}
                  </span>
                </button>
              );
            })}
          </div>

          {busy && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-zinc-100 px-2 py-1.5 text-xs dark:bg-zinc-800" role="status">
              <span>
                {run.label}: {run.sent}/{run.total} sent
              </span>
              <button type="button" onClick={stop} className="rounded border border-red-300 px-2 py-0.5 font-medium text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10">
                Stop
              </button>
            </div>
          )}

          <form
            className="flex flex-col gap-2 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              const body = text.trim();
              if (!body) return;
              void start("Custom message", [{ delayMs: 0, from: customFrom, body }]);
              setText("");
            }}
          >
            <label htmlFor={ids.text} className="font-semibold text-zinc-600 dark:text-zinc-300">
              Custom message
            </label>
            <textarea id={ids.text} rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Hi Grandma, it's me…" className={field} />
            <div className="flex items-center gap-2">
              <label htmlFor={ids.customFrom} className="sr-only">
                Custom message sender
              </label>
              <select id={ids.customFrom} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={`${field} min-w-0 flex-1`}>
                {SENDER_POOL.slice(0, 12).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={!enabled || busy || !text.trim()} className="rounded-md bg-zinc-900 px-3 py-1 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
                Send
              </button>
            </div>
          </form>

          {log.length > 0 && (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-600 dark:text-zinc-300">Sent</span>
                <button type="button" onClick={clearLog} className="text-zinc-500 hover:underline">
                  Clear
                </button>
              </div>
              <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                {log.map((e) => (
                  <li key={e.key} className="rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-900">
                    <span className={e.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{e.ok ? "✓" : "✕"}</span>{" "}
                    <span className="font-mono text-zinc-500">{e.from}</span>
                    {e.expected && <span className="text-zinc-400"> · expect {e.expected}</span>}
                    <span className="block truncate text-zinc-700 dark:text-zinc-300">{e.preview}</span>
                    {e.error && <span className="block text-red-600 dark:text-red-400">{e.error}</span>}
                  </li>
                ))}
              </ul>
              <p className="text-zinc-400">&ldquo;expect&rdquo; is the bank&apos;s label, for checking; the gateway never sees it.</p>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
