"use client";

import { MotionConfig, motion } from "motion/react";
import { AppHeader } from "@/components/brand/AppHeader";
import { useMemo, useState, type ReactNode } from "react";
import {
  messageStats,
  sortSenders,
  useMessages,
  type Count,
  type SenderCount,
  type SenderSortKey,
  type SortDir,
} from "@/lib/messages";

const LABEL = "font-label text-[10px] uppercase tracking-[0.06em]";
const pct = (x: number) => `${Math.round(x * 100)}%`;
const share = (n: number, total: number) => (total ? pct(n / total) : "0%");
/** Bars grow to their new size instead of jumping; MotionConfig turns this off for reduced motion. */
const GROW = { type: "spring", stiffness: 160, damping: 26 } as const;

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-4 border-t border-rule pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={`${LABEL} text-[11px] text-ink`}>{title}</h2>
        {note && <span className={`${LABEL} text-muted`}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className={`border border-dashed border-rule px-4 py-6 text-center ${LABEL} text-muted`}>{children}</p>;
}

/** "Most common" marker on the top row of a breakdown. */
function Leader() {
  return <span className={`ml-2 bg-hot px-1.5 py-0.5 ${LABEL} text-[9px] text-white`}>Most common</span>;
}

/**
 * Horizontal bars, most common first. Rows tied for the top count are pink and tagged; the
 * count and share are written beside each bar, so nothing relies on color.
 */
function Bars({ rows, total, empty }: { rows: Count[]; total: number; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${r.count} (${share(r.count, total)})`} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {r.label}
              {r.count === max && rows.length > 1 && <Leader />}
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-bold">{r.count}</span> <span className="text-muted">· {share(r.count, total)}</span>
            </span>
          </div>
          <div className="h-2.5 bg-paper">
            <motion.div
              className={`h-full rounded-r-[4px] transition-opacity group-hover:opacity-80 ${r.count === max ? "bg-hot" : "bg-ink"}`}
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(2, (r.count / max) * 100)}%` }}
              transition={GROW}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Scam-score histogram: ten columns in score order, the tallest one pink. */
function ScoreColumns({ buckets }: { buckets: Count[] }) {
  const max = Math.max(...buckets.map((b) => b.count));
  if (max === 0) return <Empty>No scored messages yet.</Empty>;
  const top = buckets.findIndex((b) => b.count === max);
  return (
    <div>
      <div className="flex h-36 items-end gap-0.5 border-b border-ink" role="list">
        {buckets.map((b, i) => (
          <div
            key={b.key}
            role="listitem"
            title={`Score ${b.label}: ${b.count}`}
            aria-label={`Score ${b.label}: ${b.count} messages`}
            className="group relative flex h-full flex-1 items-end"
          >
            <motion.div
              className={`w-full rounded-t-[4px] transition-opacity group-hover:opacity-80 ${i === top ? "bg-hot" : "bg-ink"}`}
              initial={{ height: 0 }}
              animate={{ height: b.count ? `${(b.count / max) * 100}%` : "0%" }}
              transition={{ ...GROW, delay: i * 0.02 }}
            />
            {b.count > 0 && (
              <span className="absolute inset-x-0 -top-5 text-center text-[11px] font-bold tabular-nums opacity-0 group-hover:opacity-100">
                {b.count}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className={`mt-1.5 flex justify-between ${LABEL} text-[9px] text-muted`}>
        <span>0 · looks fine</span>
        <span>0.5</span>
        <span>1 · potential scam</span>
      </div>
      <p className="mt-2 text-sm">
        Most messages scored <span className="font-bold">{buckets[top]!.label}</span>{" "}
        <span className="text-muted">({max} messages)</span>
      </p>
    </div>
  );
}

const SORT_COLUMNS: { key: SenderSortKey; label: string }[] = [
  { key: "messages", label: "Messages" },
  { key: "blocked", label: "Blocked" },
  { key: "share", label: "Share" },
];

/** Most active numbers. Click Messages, Blocked or Share to sort; click again to flip the order. */
function Senders({ senders, total }: { senders: SenderCount[]; total: number }) {
  const [sort, setSort] = useState<{ key: SenderSortKey; dir: SortDir }>({ key: "messages", dir: "desc" });
  const sorted = useMemo(() => sortSenders(senders, sort.key, sort.dir), [senders, sort]);
  if (!senders.length) return <Empty>No senders yet.</Empty>;
  const rows = sorted.slice(0, 8);
  const max = Math.max(...senders.map((s) => s.total));
  const onSort = (key: SenderSortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={`${LABEL} text-muted`}>
          <th scope="col" className="pb-2 text-left font-bold">
            Number
          </th>
          {SORT_COLUMNS.map((c) => {
            const active = sort.key === c.key;
            return (
              <th
                key={c.key}
                scope="col"
                aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
                className="pb-2 text-right font-bold"
              >
                <button
                  type="button"
                  onClick={() => onSort(c.key)}
                  title={`Sort by ${c.label.toLowerCase()}`}
                  className={`inline-flex items-center gap-1 px-1 py-0.5 uppercase transition-colors hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot ${
                    active ? "text-ink" : ""
                  }`}
                >
                  {c.label}
                  <span aria-hidden className={active ? "text-hot" : "opacity-30"}>
                    {active && sort.dir === "asc" ? "▲" : "▼"}
                  </span>
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((s, i) => (
          // Masked numbers can repeat (same last four digits), so the index joins the key.
          <tr key={`${s.display}-${i}`} className="border-t border-rule hover:bg-card">
            <td className="py-2 font-label font-bold">
              {s.display}
              {s.total === max && senders.length > 1 && <Leader />}
            </td>
            <td className={`py-2 pr-1 text-right tabular-nums ${sort.key === "messages" ? "font-bold" : ""}`}>{s.total}</td>
            <td className={`py-2 pr-1 text-right tabular-nums ${s.blocked ? "text-hot-deep" : "text-muted"} ${sort.key === "blocked" ? "font-bold" : ""}`}>
              {s.blocked}
            </td>
            <td className={`py-2 pr-1 text-right tabular-nums ${sort.key === "share" ? "font-bold text-ink" : "text-muted"}`}>
              {share(s.total, total)}
            </td>
          </tr>
        ))}
      </tbody>
      {senders.length > rows.length && (
        <tfoot>
          <tr>
            <td colSpan={4} className={`pt-2 ${LABEL} text-muted`}>
              + {senders.length - rows.length} more numbers
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function Tile({ value, label, sub, hot }: { value: string; label: string; sub: string; hot?: boolean }) {
  return (
    <div className="flex flex-col gap-2 border-l border-rule pl-4 first:border-l-0 first:pl-0">
      <motion.span
        key={value}
        initial={{ y: -6, opacity: 0.4 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={`font-display text-5xl leading-none tabular-nums ${hot ? "text-hot" : "text-ink"}`}
      >
        {value}
      </motion.span>
      <span className={`${LABEL} leading-relaxed`}>
        {label}
        <br />
        <span className="text-muted">{sub}</span>
      </span>
    </div>
  );
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Analytics over the messages the gateway returns (its latest 100): outcomes,
 * why, what was sent, scam categories, score spread and the most active
 * numbers. It only counts the gateway's decisions.
 */
export function DashboardView() {
  const { messages, mode, error } = useMessages({ intervalMs: 3000 });
  const s = useMemo(() => messageStats(messages), [messages]);
  const loading = mode == null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh flex-col">
        <AppHeader>
          <p className={`hidden ${LABEL} text-muted md:block`} role="status">
            {loading
              ? "Loading…"
              : error
                ? `Couldn't refresh: ${error}`
                : s.span
                  ? `Latest ${s.total} messages, ${fmtTime(s.span.from)} to ${fmtTime(s.span.to)}`
                  : "No messages yet"}
          </p>
        </AppHeader>

        <main className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
          <div className="flex flex-col gap-6 border-b border-rule pb-6 xl:flex-row xl:items-end xl:justify-between">
            <h1 className="font-display text-5xl uppercase leading-[0.9] sm:text-6xl">Overall analytics</h1>
            <section aria-label="Totals" className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5 xl:gap-8">
              <Tile value={String(s.total)} label="Messages" sub="Received" />
              <Tile value={String(s.blocked)} label="Blocked" sub="Potential scams" hot />
              <Tile value={String(s.delivered)} label="Delivered" sub="Let through" />
              <Tile value={s.blockRate == null ? "N/A" : pct(s.blockRate)} label="Block rate" sub="Of decided messages" />
              <Tile value={s.avgScore == null ? "N/A" : s.avgScore.toFixed(2)} label="Avg scam score" sub="0 fine, 1 scam" />
            </section>
          </div>
          <p className={`${LABEL} text-muted md:hidden`} role="status">
            {loading ? "Loading…" : error ? `Couldn't refresh: ${error}` : s.span ? `Latest ${s.total} messages` : "No messages yet"}
          </p>

          <div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
            <Panel title="Most active numbers">
              <Senders senders={s.senders} total={s.total} />
            </Panel>
            <Panel title="Scam categories" note="Blocked messages">
              <Bars rows={s.categories} total={s.categories.reduce((a, r) => a + r.count, 0)} empty="Nothing blocked by the model yet." />
            </Panel>
            <Panel title="Scam score spread" note="Messages the model scored">
              <ScoreColumns buckets={s.scores} />
            </Panel>
            <Panel title="Outcome">
              <Bars rows={s.outcomes} total={s.total} empty="No messages yet." />
            </Panel>
            <Panel title="Why" note="How each decision was made">
              <Bars rows={s.reasons} total={s.total} empty="No messages yet." />
            </Panel>
            <Panel title="What was sent" note="Message type">
              <Bars rows={s.kinds} total={s.total} empty="No messages yet." />
            </Panel>
          </div>

          <p className={`mt-auto border-t border-rule pt-3 ${LABEL} text-[9px] leading-relaxed text-muted`}>
            Counts the gateway&apos;s decisions; &ldquo;potential scam&rdquo; is the classifier&apos;s verdict and can be
            wrong. Numbers are masked. Based on the latest messages the gateway returns.
          </p>
        </main>
      </div>
    </MotionConfig>
  );
}
