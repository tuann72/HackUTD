"use client";

import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import {
  hideCleared,
  loadClearedBefore,
  newestReceivedAt,
  saveClearedBefore,
  useMessages,
  type Message,
  type MessageChange,
  type SourceMode,
} from "@/lib/messages";
import { createShotFeed, toSceneMessage } from "@/components/scene/feed";
import { SceneClient } from "@/components/scene/SceneClient";
import { MessageCard } from "./MessageCard";
import { useNow } from "./useNow";

const MODE_LABEL: Record<SourceMode, string> = {
  live: "Live",
  replay: "Replay (mock)",
  static: "Static (mock)",
};

function SourceIndicator({ mode }: { mode: SourceMode | null }) {
  const live = mode === "live";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
      <span
        aria-hidden
        className={`size-2 rounded-full ${
          mode == null ? "bg-zinc-300 dark:bg-zinc-600" : live ? "bg-emerald-500" : "bg-sky-500"
        } ${live ? "animate-pulse motion-reduce:animate-none" : ""}`}
      />
      {mode == null ? "Connecting…" : MODE_LABEL[mode]}
    </span>
  );
}

function Column({
  title,
  count,
  empty,
  messages,
  now,
}: {
  title: string;
  count: ReactNode;
  empty: string;
  messages: Message[];
  now: number | null;
}) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="-mx-1 flex items-baseline gap-2 rounded px-1 uppercase hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 dark:hover:text-zinc-200"
        >
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className={`size-3 self-center transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          >
            <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {title}
          <span className="tabular-nums text-zinc-400 dark:text-zinc-500">{count}</span>
        </button>
      </h2>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={bodyId}
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex flex-col gap-3 overflow-hidden"
          >
            {messages.length === 0 && (
              <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                {empty}
              </p>
            )}
            <ul className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {messages.map((m) => (
                  <motion.li
                    key={m.id}
                    layout="position"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                  >
                    <MessageCard message={m} now={now} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * The home page: the 3D scene on top, then the inbox (delivered, plus pending
 * at top) and blocked lists. One poll feeds both, so the scene animates the
 * same messages the lists show.
 */
export function MessagesView() {
  const [feed] = useState(createShotFeed);
  // Each message fires a shot once the gateway has decided it.
  const onChanges = useCallback(
    (changes: MessageChange[]) => {
      for (const c of changes) if (c.type === "resolved") feed.push(toSceneMessage(c.message));
    },
    [feed],
  );
  const { messages: allMessages, mode, error } = useMessages({ intervalMs: 1500, onChanges });
  const now = useNow();

  // "Clear" hides what's on screen in this browser only; nothing is deleted on the gateway.
  // Reading storage at init is hydration-safe: messages arrive by polling, so the first render is empty either way.
  const [clearedBefore, setClearedBefore] = useState<string | null>(() =>
    typeof window === "undefined" ? null : loadClearedBefore(),
  );
  const messages = useMemo(() => hideCleared(allMessages, clearedBefore), [allMessages, clearedBefore]);
  const hiddenCount = allMessages.length - messages.length;
  const clear = () => {
    const cutoff = newestReceivedAt(allMessages);
    if (cutoff == null) return;
    setClearedBefore(cutoff);
    saveClearedBefore(cutoff);
  };
  const showAll = () => {
    setClearedBefore(null);
    saveClearedBefore(null);
  };

  const { inbox, blocked, deliveredCount } = useMemo(() => {
    const pending = messages.filter((m) => m.action === "pending");
    const delivered = messages.filter((m) => m.action === "delivered");
    const blocked = messages.filter((m) => m.action === "blocked");
    return { inbox: [...pending, ...delivered], blocked, deliveredCount: delivered.length };
  }, [messages]);

  return (
    <MotionConfig reducedMotion="user">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-10">
        <header className="mb-6 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">T-Gate</h1>
            <div className="flex items-center gap-2">
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={showAll}
                  className="rounded-full px-2.5 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Show <span className="tabular-nums">{hiddenCount}</span> cleared
                </button>
              )}
              <button
                type="button"
                onClick={clear}
                disabled={messages.length === 0}
                title="Hide the current messages on this screen. Nothing is deleted on the gateway."
                className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Clear chats
              </button>
              <SourceIndicator mode={mode} />
            </div>
          </div>
          {error && (
            <p
              role="status"
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
            >
              Couldn&apos;t refresh messages: {error}. Retrying…
            </p>
          )}
        </header>

        <section
          aria-label="Animation: each message flies to the victim; blocked ones pop before they arrive"
          className="mb-8 h-[45dvh] min-h-64 overflow-hidden rounded-2xl sm:h-[65dvh] sm:min-h-80"
        >
          <SceneClient feed={feed} />
        </section>

        <LayoutGroup>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-6">
            <Column
              title="Inbox"
              count={deliveredCount}
              empty={mode == null ? "Loading…" : "No messages delivered yet."}
              messages={inbox}
              now={now}
            />
            <Column
              title="Blocked"
              count={blocked.length}
              empty={mode == null ? "Loading…" : "Nothing blocked yet."}
              messages={blocked}
              now={now}
            />
          </div>
        </LayoutGroup>

        <p className="mt-10 text-xs text-zinc-500 dark:text-zinc-400">
          &ldquo;Potential scam&rdquo; is the classifier&apos;s verdict and can be wrong. Links and phone numbers in
          blocked messages are disabled.
        </p>
      </main>
    </MotionConfig>
  );
}
