"use client";

import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import {
  useMessages,
  type Message,
  type MessageChange,
} from "@/lib/messages";
import { createShotFeed, toSceneMessage } from "@/components/scene/feed";
import { SceneClient } from "@/components/scene/SceneClient";
import { SimPanel } from "@/components/sim/SimPanel";
import { MessageCard } from "./MessageCard";
import { useNow } from "./useNow";

/** Counters read like the prototype's "000". */
const pad3 = (n: number) => String(n).padStart(3, "0");

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
    <section aria-label={title} className="flex min-w-0 flex-col gap-3 border-t border-rule pt-4">
      <h2 className="font-label text-[11px] uppercase tracking-[0.08em] text-muted">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="-mx-1 flex items-baseline gap-2 px-1 uppercase hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hot"
        >
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className={`size-3 self-center transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          >
            <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {title}
          <span className="tabular-nums text-ink">/ {count}</span>
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
              <p className="border border-dashed border-rule px-4 py-8 text-center font-label text-[11px] uppercase tracking-[0.06em] text-muted">
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
 * The /messages page: the 3D scene on top, then the inbox (delivered, plus pending
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
  const { messages, mode, error, clear: clearSource } = useMessages({ intervalMs: 1500, onChanges });
  const now = useNow();

  // "Clear chats" deletes every stored message on the gateway (or the Vercel backup), not just this screen.
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const clear = async () => {
    if (!clearSource) return;
    if (!window.confirm("Delete all messages? This removes them for everyone and can't be undone.")) return;
    setClearing(true);
    setClearError(null);
    try {
      await clearSource();
    } catch (e) {
      setClearError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearing(false);
    }
  };

  const { inbox, blocked, deliveredCount } = useMemo(() => {
    const pending = messages.filter((m) => m.action === "pending");
    const delivered = messages.filter((m) => m.action === "delivered");
    const blocked = messages.filter((m) => m.action === "blocked");
    return { inbox: [...pending, ...delivered], blocked, deliveredCount: delivered.length };
  }, [messages]);

  return (
    <MotionConfig reducedMotion="user">
      <main className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-x-8 gap-y-8 px-4 pb-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <header className="col-span-full flex h-20 items-center justify-between gap-4 border-b border-rule">
          <Link
            href="/"
            className="whitespace-nowrap text-[28px] font-black tracking-[-0.06em] text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hot"
          >
            T—GUARD<span className="ml-1 align-top text-xs tracking-normal">®</span>
          </Link>
          <span className="hidden font-label text-[10px] uppercase tracking-[0.06em] text-muted sm:block">
            Personal space. Protected.
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={!clearSource || clearing || messages.length === 0}
            title="Delete all messages from the gateway. This can't be undone."
            className="flex items-center gap-4 border border-ink px-4 py-3 font-label text-[10px] uppercase tracking-[0.06em] text-ink hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hot disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink"
          >
            {clearing ? "Clearing…" : "Clear chats"}
            <span aria-hidden>↺</span>
          </button>
        </header>

        <div className="min-w-0">
          {(error || clearError) && (
            <div className="mb-4 flex flex-col gap-2">
              {error && (
                <p role="status" className="border-l-4 border-hot bg-card px-3 py-2 text-sm text-ink">
                  Couldn&apos;t refresh messages: {error}. Retrying…
                </p>
              )}
              {clearError && (
                <p role="alert" className="border-l-4 border-hot-deep bg-card px-3 py-2 text-sm text-ink">
                  Couldn&apos;t clear messages: {clearError}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-between gap-2 pb-2 font-label text-[9px] uppercase tracking-[0.06em] text-muted">
            <span>Live demonstration</span>
            <span role="status" className="flex items-center gap-1.5 text-ink">
              <i aria-hidden className={`inline-block size-1.5 rounded-full ${error ? "bg-muted" : "bg-hot"}`} />
              {mode == null ? "Waking up" : error ? "Reconnecting" : "On guard"}
            </span>
          </div>
          <section
            aria-label="Animation: each message flies to the Receiver; blocked ones are slapped away"
            className="h-[45dvh] min-h-64 overflow-hidden sm:h-[60dvh] sm:min-h-80"
          >
            <SceneClient feed={feed} />
          </section>
          <div className="flex justify-between gap-2 pt-2 font-label text-[9px] uppercase tracking-[0.06em] text-muted">
            <span>01 / The protector</span>
            <span className="hidden sm:inline">Fictional senders. Real classifier.</span>
          </div>

          <section
            aria-label="Totals"
            className="my-8 flex flex-wrap items-center justify-between gap-6 border-y border-rule py-6"
          >
            <div className="flex items-center gap-4">
              <span className="font-display text-6xl leading-none text-hot tabular-nums">{pad3(blocked.length)}</span>
              <span className="font-label text-[10px] uppercase leading-relaxed tracking-[0.06em]">
                Threats blocked
                <br />
                <span className="text-muted">You&apos;re in good hands.</span>
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="font-display text-6xl leading-none text-ink tabular-nums">{pad3(deliveredCount)}</span>
              <span className="font-label text-[10px] uppercase leading-relaxed tracking-[0.06em]">
                Delivered
                <br />
                <span className="text-muted">Let through, untouched.</span>
              </span>
            </div>
          </section>

          <LayoutGroup>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-8">
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

          <p className="mt-10 border-t border-rule pt-3 font-label text-[9px] uppercase leading-relaxed tracking-[0.06em] text-muted">
            &ldquo;Potential scam&rdquo; is the classifier&apos;s verdict and can be wrong. Links and phone numbers in
            blocked messages are disabled.
          </p>
        </div>
        <SimPanel />
      </main>
    </MotionConfig>
  );
}
