"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { VoiceCallResult, VoiceCallResultsResponse } from "@/lib/voice/types";

function displayTime(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : value;
}

export function VoiceCallsView() {
  const [tokenInput, setTokenInput] = useState("");
  const [viewToken, setViewToken] = useState<string | null>(null);
  const [calls, setCalls] = useState<VoiceCallResult[]>([]);
  const [status, setStatus] = useState<"locked" | "loading" | "ready">("locked");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!viewToken) return;
    let active = true;
    let loading = false;
    const controller = new AbortController();

    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch("/api/voice/calls?limit=20", {
          headers: { Authorization: `Bearer ${viewToken}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
              ? body.error
              : `Could not load call results (HTTP ${response.status})`;
          throw new Error(message);
        }
        if (
          typeof body !== "object" || body === null ||
          (body as VoiceCallResultsResponse).schema !== "t-gate.voice-call-results" ||
          (body as VoiceCallResultsResponse).version !== 1 ||
          !Array.isArray((body as VoiceCallResultsResponse).calls)
        ) {
          throw new Error("The call result API returned an invalid response");
        }
        if (active) {
          setCalls((body as VoiceCallResultsResponse).calls);
          setStatus("ready");
          setError(null);
        }
      } catch (reason) {
        if (active && !(reason instanceof DOMException && reason.name === "AbortError")) {
          setStatus("ready");
          setError(reason instanceof Error ? reason.message : "Could not load call results");
        }
      } finally {
        loading = false;
      }
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [viewToken]);

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = tokenInput.trim();
    if (!token) return;
    setCalls([]);
    setError(null);
    setStatus("loading");
    setViewToken(token);
  }

  function disconnect() {
    setViewToken(null);
    setTokenInput("");
    setCalls([]);
    setError(null);
    setStatus("locked");
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:py-12">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-sm font-medium text-zinc-500 underline-offset-4 hover:underline dark:text-zinc-400">
            ← Back to messages
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Voice call results</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            After-call transcripts and classifier results. The text classifier is trained on messages, so its call
            verdicts are experimental and may be wrong.
          </p>
        </div>
        {viewToken && (
          <button
            type="button"
            onClick={disconnect}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Lock results
          </button>
        )}
      </header>

      {!viewToken ? (
        <form onSubmit={connect} className="max-w-xl rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
          <label htmlFor="voice-view-token" className="block text-sm font-medium">Authorized viewer token</label>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            The token is sent only to the read-only API and stays in this page&apos;s memory until you lock results or
            close the page.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              id="voice-view-token"
              type="password"
              autoComplete="off"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              type="submit"
              disabled={!tokenInput.trim()}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              View results
            </button>
          </div>
        </form>
      ) : (
        <section aria-label="Call results" aria-live="polite" className="flex flex-col gap-4">
          {status === "loading" && <p className="text-sm text-zinc-500">Loading call results…</p>}
          {error && (
            <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              {error}
            </p>
          )}
          {status === "ready" && !error && calls.length === 0 && (
            <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              No call results yet. This page refreshes every five seconds while it is unlocked.
            </p>
          )}
          {calls.map((call) => (
            <article key={call.callId} className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                      call.label === "scam"
                        ? "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                    }`}
                  >
                    {call.label === "scam" ? "Potential scam" : "Classifier labeled legitimate"}
                  </span>
                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Ended {displayTime(call.completedAt)}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium tabular-nums">Scam score: {Math.round(call.score * 100)}%</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Model: {call.model}</p>
                </div>
              </div>
              {call.category && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">Category: {call.category}</p>}
              <div className="mt-4 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Caller transcript</h2>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{call.transcript}</p>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
