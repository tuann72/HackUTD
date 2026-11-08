"use client";

import { useId, useState } from "react";
import { PRESETS } from "@/lib/sim/presets";
import { presetSteps, runDurationMs, SENDER_POOL, type RunSettings } from "@/lib/sim/plan";
import { useSimRunner } from "./useSimRunner";

const field =
  "w-full border border-rule bg-card px-2 py-1 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-hot";
/** The prototype's outlined control buttons: ink on hover. */
const button =
  "group flex items-start gap-3 border border-rule px-3 py-3 text-left transition-colors hover:border-ink hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-rule disabled:hover:bg-transparent disabled:hover:text-ink";

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/**
 * Settings passed to every preset. Random presets take their count, scam ratio
 * and interval from presets.ts; these only supply a random sender each (from: "").
 * The panel's own inputs for them were removed (Tuan); each run gets a fresh seed.
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
    <aside aria-label="Simulations" className="flex flex-col gap-3 lg:sticky lg:top-6 lg:pt-6">
      <h2 className="font-label text-[11px] uppercase tracking-[0.08em] text-muted">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="-mx-1 flex items-center gap-2 px-1 uppercase underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hot"
        >
          <svg aria-hidden viewBox="0 0 16 16" className={`size-3 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>
            <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Simulate
        </button>
      </h2>

      {open && (
        <div id={bodyId} className="flex flex-col gap-4 border-t border-rule pt-3">
          {status === null && <p className="font-label text-[10px] uppercase tracking-[0.06em] text-muted">Checking…</p>}
          {status && !enabled && (
            <p role="status" className="border-l-4 border-hot bg-card px-2 py-1.5 text-xs text-ink">
              Simulation is off. {status.reason}
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
                  <span className="min-w-0">
                  <span className="block font-label text-[10px] uppercase tracking-[0.06em] font-bold">{p.label}</span>
                  <span className="mt-1 block text-xs text-muted group-hover:text-paper/70 group-disabled:group-hover:text-muted">
                    {p.kind === "random" && p.n > 1
                      ? `${preview.length} messages, ${Math.round(p.scamRatio * 100)}% scams, ${p.intervalMs} ms apart${secs ? `, about ${secs} s` : ""}`
                      : p.description}
                  </span>
                  </span>
                </button>
              );
            })}
          </div>

          {busy && (
            <div className="flex items-center justify-between gap-2 bg-ink px-2 py-1.5 font-label text-[10px] uppercase text-paper" role="status">
              <span>
                {run.label}: {run.sent}/{run.total} sent
              </span>
              <button type="button" onClick={stop} className="border border-hot px-2 py-0.5 font-bold text-hot transition-colors hover:bg-hot hover:text-white">
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
            <label htmlFor={ids.text} className="font-label text-[10px] uppercase tracking-[0.06em] text-muted">
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
              <button type="submit" disabled={!enabled || busy || !text.trim()} className="bg-ink px-3 py-1.5 font-label text-[10px] font-bold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-hot disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ink">
                Send
              </button>
            </div>
          </form>

          {log.length > 0 && (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-label text-[10px] uppercase tracking-[0.06em] text-muted">Sent</span>
                <button type="button" onClick={clearLog} className="font-label text-[10px] uppercase tracking-[0.06em] text-muted hover:text-ink hover:underline">
                  Clear
                </button>
              </div>
              <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                {log.map((e) => (
                  <li key={e.key} className="border border-rule bg-card px-2 py-1">
                    <span className={e.ok ? "text-emerald-700" : "text-hot-deep"}>{e.ok ? "✓" : "✕"}</span>{" "}
                    <span className="font-label text-muted">{e.from}</span>
                    {e.expected && <span className="text-muted"> · expect {e.expected}</span>}
                    <span className="block truncate text-ink">{e.preview}</span>
                    {e.error && <span className="block text-hot-deep">{e.error}</span>}
                  </li>
                ))}
              </ul>
              <p className="text-muted">&ldquo;expect&rdquo; is the bank&apos;s label, for checking; the gateway never sees it.</p>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
