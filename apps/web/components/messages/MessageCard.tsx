"use client";

import { isGroupChat, isNotClassified, isRestored, isSenderBlocked, isUnverified, type Message } from "@/lib/messages";
import { categoryClass, categoryLabel } from "./category";
import { MessageBody } from "./MessageBody";
import { MessageExtras } from "./MessageExtras";
import { formatRelative, formatScore } from "./time";

const UNVERIFIED_TITLE = "The classifier was unavailable, so this was delivered without a check.";
const SENDER_BLOCKED_TITLE = "This sender sent earlier scams, so T-Guard blocked this without checking it again.";
const RESTORED_TITLE = "Someone marked this message \"Not a scam\", so it was moved to the inbox.";
const NOT_CLASSIFIED_TITLE = "No text to check (attachment, reaction or contact card), so this was delivered without a check.";

export function CategoryBadge({ category }: { category: string | null | undefined }) {
  return (
    <span
      className={`inline-flex items-center rounded-sm px-2 py-0.5 font-label text-[10px] uppercase tracking-[0.04em] ring-1 ring-inset ${categoryClass(category)}`}
    >
      {categoryLabel(category)}
    </span>
  );
}

/** One message. Renders the gateway's action/reason/verdict as given. */
export function MessageCard({ message: m, now }: { message: Message; now: number | null }) {
  const blocked = m.action === "blocked";
  const pending = m.action === "pending";
  const unverified = isUnverified(m);
  const time = now == null ? "" : formatRelative(m.receivedAt, now);

  return (
    <article
      aria-busy={pending || undefined}
      className={[
        "border p-4 shadow-[5px_10px_20px_-12px_#2d233140]",
        blocked
          ? "border-rule border-l-4 border-l-hot bg-card"
          : pending
            ? "border-dashed border-rule bg-paper"
            : "border-rule bg-card",
      ].join(" ")}
    >
      <header className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-label font-bold text-ink">{m.from.display}</span>
        {isGroupChat(m) && (
          <span
            title={`Group chat ${m.conversation?.id ?? ""}`}
            className="inline-flex items-center rounded-sm bg-ink px-2 py-0.5 font-label text-[10px] uppercase tracking-[0.04em] text-paper"
          >
            Group chat
          </span>
        )}
        <time
          dateTime={m.receivedAt}
          title={m.receivedAt}
          suppressHydrationWarning
          className="font-label text-[11px] text-muted tabular-nums"
        >
          {time}
        </time>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {pending && (
            <span className="inline-flex items-center gap-1.5 font-label text-[10px] uppercase tracking-[0.04em] text-muted">
              <span
                aria-hidden
                className="size-3 animate-spin rounded-full border-2 border-rule border-t-hot motion-reduce:animate-none"
              />
              Checking…
            </span>
          )}
          {blocked && (
            <span className="inline-flex items-center rounded-sm bg-hot px-2 py-0.5 font-label text-[10px] uppercase tracking-[0.04em] font-bold text-white">
              Potential scam
            </span>
          )}
          {isRestored(m) && (
            <span
              title={RESTORED_TITLE}
              aria-label={`Restored. ${RESTORED_TITLE}`}
              className="inline-flex cursor-help items-center rounded-sm bg-emerald-100 px-2 py-0.5 font-label text-[10px] uppercase tracking-[0.04em] text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30"
            >
              Restored
            </span>
          )}
          {isNotClassified(m) && (
            <span
              title={NOT_CLASSIFIED_TITLE}
              aria-label={`Not checked. ${NOT_CLASSIFIED_TITLE}`}
              className="inline-flex cursor-help items-center rounded-sm bg-paper px-2 py-0.5 font-label text-[10px] uppercase tracking-[0.04em] text-muted ring-1 ring-inset ring-rule"
            >
              Not checked
            </span>
          )}
          {unverified && (
            <span
              title={UNVERIFIED_TITLE}
              aria-label={`Unverified. ${UNVERIFIED_TITLE}`}
              className="inline-flex cursor-help items-center rounded-sm bg-amber-100 px-2 py-0.5 font-label text-[10px] uppercase tracking-[0.04em] text-amber-800 ring-1 ring-inset ring-amber-600/30 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30"
            >
              Unverified
            </span>
          )}
        </span>
      </header>

      {blocked && (
        <div className="mb-2">
          {isSenderBlocked(m) ? (
            <span
              title={SENDER_BLOCKED_TITLE}
              className="inline-flex cursor-help items-center rounded-sm bg-rose-50 px-2 py-0.5 font-label text-[10px] uppercase tracking-[0.04em] text-rose-800 ring-1 ring-inset ring-rose-600/30 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/30"
            >
              Blocked: known scam sender
            </span>
          ) : (
            <CategoryBadge category={m.verdict?.category} />
          )}
        </div>
      )}

      {m.body && <MessageBody body={m.body} highlights={blocked ? m.verdict?.highlights : null} defang={blocked} />}
      <MessageExtras message={m} defang={blocked} />

      {m.verdict?.warning === "large_money_request" && (
        <p className="mt-3 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
          Asks for a large sum of money. Check it&apos;s really them before sending anything.
        </p>
      )}

      {m.verdict?.review && (
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="font-semibold">Second opinion:</span> {m.verdict.review.reason}
          {m.verdict.review.bankSource && (
            <span className="text-zinc-400 dark:text-zinc-500">
              {" "}
              (checked {m.verdict.review.checks.length} against {m.verdict.review.bankSource === "mock" ? "mock bank data" : "Nessie"})
            </span>
          )}
        </p>
      )}

      {m.verdict && (
        <footer className="mt-3 flex items-baseline justify-between gap-2 border-t border-rule pt-2 font-label text-[10px] uppercase tracking-[0.04em] text-muted">
          <span>
            Scam score <span className="font-bold tabular-nums text-ink">{formatScore(m.verdict.score)}</span>
          </span>
          <span className="truncate normal-case" title="Model">
            {m.verdict.model}
          </span>
        </footer>
      )}
    </article>
  );
}
