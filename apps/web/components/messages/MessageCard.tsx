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
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${categoryClass(category)}`}
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
        "rounded-xl border p-4 shadow-sm",
        blocked
          ? "border-rose-200 bg-white dark:border-rose-900/60 dark:bg-zinc-900"
          : pending
            ? "border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/50"
            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
      ].join(" ")}
    >
      <header className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">{m.from.display}</span>
        {isGroupChat(m) && (
          <span
            title={`Group chat ${m.conversation?.id ?? ""}`}
            className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-inset ring-sky-600/20 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/30"
          >
            Group chat
          </span>
        )}
        <time
          dateTime={m.receivedAt}
          title={m.receivedAt}
          suppressHydrationWarning
          className="text-zinc-500 tabular-nums dark:text-zinc-400"
        >
          {time}
        </time>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {pending && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              <span
                aria-hidden
                className="size-3 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 motion-reduce:animate-none dark:border-zinc-600 dark:border-t-zinc-300"
              />
              Checking…
            </span>
          )}
          {blocked && (
            <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white dark:bg-rose-500">
              Potential scam
            </span>
          )}
          {isRestored(m) && (
            <span
              title={RESTORED_TITLE}
              aria-label={`Restored. ${RESTORED_TITLE}`}
              className="inline-flex cursor-help items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30"
            >
              Restored
            </span>
          )}
          {isNotClassified(m) && (
            <span
              title={NOT_CLASSIFIED_TITLE}
              aria-label={`Not checked. ${NOT_CLASSIFIED_TITLE}`}
              className="inline-flex cursor-help items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-400"
            >
              Not checked
            </span>
          )}
          {unverified && (
            <span
              title={UNVERIFIED_TITLE}
              aria-label={`Unverified. ${UNVERIFIED_TITLE}`}
              className="inline-flex cursor-help items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/30 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30"
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
              className="inline-flex cursor-help items-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-600/30 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/30"
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

      {m.verdict && (
        <footer className="mt-3 flex items-baseline justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            Scam score <span className="font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{formatScore(m.verdict.score)}</span>
          </span>
          <span className="truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500" title="Model">
            {m.verdict.model}
          </span>
        </footer>
      )}
    </article>
  );
}
