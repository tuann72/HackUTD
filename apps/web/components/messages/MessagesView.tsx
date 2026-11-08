"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { AppHeader } from "@/components/brand/AppHeader";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearBlocksText,
  useMessages,
  type Message,
  type MessageChange,
} from "@/lib/messages";
import { createShotFeed, toSceneMessage } from "@/components/scene/feed";
import { SceneClient } from "@/components/scene/SceneClient";
import type { Guard } from "@/components/scene/Scene";
import { SimPanel } from "@/components/sim/SimPanel";
import { MessagePanel } from "./MessagePanel";
import { PasswordPrompt } from "./PasswordPrompt";
import { clearBlocksLabel, useBlocklist } from "./useBlocklist";
import { useNow } from "./useNow";

/** Tooltip on Unblock and Clear blocks when there's no gateway to check the password (mock data). */
const MOCK_ACTIONS_OFF = "Needs a live gateway (set NEXT_PUBLIC_API_URL). The demo data can't be unblocked.";

type Prompt = { kind: "chats" } | { kind: "clear" } | { kind: "unblock"; message: Message };

const PROMPT_TEXT = {
  chats: {
    title: "Clear chats",
    description: "Delete every message, in the inbox and the Blocked list, for everyone. This can't be undone.",
    confirm: "Clear chats",
  },
  clear: {
    title: "Clear blocks",
    description: "Unblock every sender T-Guard has blocked. Messages already in the Blocked list stay there.",
    confirm: "Clear blocks",
  },
} as const;

/** The scene's guard switch: the pink shield or the slapping hand. */
const GUARDS: { id: Guard; label: string }[] = [
  { id: "shield", label: "Shield" },
  { id: "hand", label: "Hand" },
];

/** Counters read like the prototype's "000". */
const pad3 = (n: number) => String(n).padStart(3, "0");

const TOOL =
  "flex h-8 items-center gap-2 border border-ink px-2.5 font-label text-[10px] uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink";

function Counter({ value, label, hot }: { value: number; label: string; hot?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="order-last font-label text-[10px] uppercase tracking-[0.06em] text-ink">{label}</dt>
      <dd>
        <motion.span
          key={value}
          initial={{ y: -6, opacity: 0.4 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className={`block font-display text-5xl leading-none tabular-nums sm:text-6xl ${hot ? "text-hot" : "text-ink"}`}
        >
          {pad3(value)}
        </motion.span>
      </dd>
    </div>
  );
}

/**
 * The /messages page. On wide screens it fills the window: the message panel
 * (All, Inbox, Blocked, with filters) on the left, the 3D scene in the middle and
 * Simulate on the right, each scrolling on its own. On phones they stack, scene first.
 * One poll feeds the panel and the scene, so the scene animates the same messages.
 */
export function MessagesView() {
  const [feed] = useState(createShotFeed);
  const [guard, setGuard] = useState<Guard>("shield");
  // Each message fires a shot once the gateway has decided it.
  const onChanges = useCallback(
    (changes: MessageChange[]) => {
      for (const c of changes) if (c.type === "resolved") feed.push(toSceneMessage(c.message));
    },
    [feed],
  );
  const { messages, mode, error, clear: clearSource, actions, refresh } = useMessages({ intervalMs: 1500, onChanges });
  const now = useNow();

  // "Clear chats" deletes every stored message on the gateway (or the Vercel backup), not just this screen.
  // A live source asks for the password (the server checks it); the demo replay just confirms.
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const clear = async () => {
    if (!clearSource) return;
    if (actions) {
      setPrompt({ kind: "chats" });
      return;
    }
    if (!window.confirm("Delete all messages? This can't be undone.")) return;
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

  // Unblock and Clear blocks: both ask for the password, which the server checks.
  const blocklist = useBlocklist(actions);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  // Null while loading too, so the buttons stay off until the source is known.
  const actionsOff = actions ? null : mode == null ? "Loading…" : MOCK_ACTIONS_OFF;
  const openUnblock = useCallback((message: Message) => setPrompt({ kind: "unblock", message }), []);
  const runPrompt = async (password: string) => {
    if (!actions || !prompt) return;
    if (prompt.kind === "chats") {
      if (!clearSource) return;
      await clearSource(password);
      setClearError(null);
      setNotice("Deleted every message.");
    } else if (prompt.kind === "clear") {
      const r = await actions.clearBlocks(password);
      setNotice(clearBlocksText(r));
      blocklist.refresh();
    } else {
      const r = await actions.unblock(prompt.message.id, password);
      setNotice(r.allowlisted ? "Moved to the inbox. That sender won't be blocked again." : "Moved to the inbox.");
      refresh();
      blocklist.refresh();
    }
  };

  const { blockedCount, deliveredCount } = useMemo(
    () => ({
      blockedCount: messages.filter((m) => m.action === "blocked").length,
      deliveredCount: messages.filter((m) => m.action === "delivered").length,
    }),
    [messages],
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
        <AppHeader>
          <span className="hidden font-label text-[10px] uppercase tracking-[0.06em] text-muted xl:block">
            Personal space. Protected.
          </span>
        </AppHeader>

        <main className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:grid-rows-[minmax(0,1fr)]">
          <section
            aria-label="Live demonstration"
            className="relative order-first h-[48dvh] min-h-72 overflow-hidden border-b border-rule lg:order-none lg:col-start-2 lg:row-start-1 lg:h-auto lg:min-h-0 lg:border-b-0"
          >
            <div
              className="absolute inset-0"
              aria-label={
                guard === "shield"
                  ? "Animation: each message flies toward the Receiver; blocked ones bounce off the T-Guard shield"
                  : "Animation: each message flies to T-Guard's hand; blocked ones are slapped away"
              }
              role="img"
            >
              <SceneClient feed={feed} guard={guard} />
            </div>

            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3 sm:p-4">
              <span className="font-label text-[9px] uppercase tracking-[0.06em] text-muted">Live demonstration</span>
              <div role="group" aria-label="What guards the Receiver" className="pointer-events-auto flex border border-ink bg-paper/80 backdrop-blur-sm">
                {GUARDS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={guard === g.id}
                    onClick={() => setGuard(g.id)}
                    className={`relative px-2.5 py-1 font-label text-[9px] uppercase tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot ${
                      guard === g.id ? "text-paper" : "text-ink hover:text-hot"
                    }`}
                  >
                    {guard === g.id && (
                      <motion.span
                        layoutId="guard-switch"
                        aria-hidden
                        className="absolute inset-0 bg-ink"
                        transition={{ type: "spring", stiffness: 520, damping: 42 }}
                      />
                    )}
                    <span className="relative">{g.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <dl
              aria-label="Totals"
              className="pointer-events-none absolute bottom-0 left-0 flex items-end gap-6 p-3 sm:gap-10 sm:p-5"
            >
              <Counter value={blockedCount} label="Threats blocked" hot />
              <Counter value={deliveredCount} label="Delivered" />
            </dl>
          </section>

          <MessagePanel
            messages={messages}
            loading={mode == null}
            now={now}
            onUnblock={openUnblock}
            unblockOff={actionsOff}
            status={
              (error || clearError) && (
                <div className="flex flex-col gap-2">
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
              )
            }
            tools={
              <>
                <button
                  type="button"
                  onClick={clear}
                  disabled={!clearSource || clearing || messages.length === 0}
                  title={actions ? "Delete all messages from the gateway. Needs the password." : "Delete all messages. This can't be undone."}
                  className={TOOL}
                >
                  {clearing ? "Clearing…" : "Clear chats"}
                </button>
                <button
                  type="button"
                  onClick={() => setPrompt({ kind: "clear" })}
                  disabled={!!actionsOff}
                  title={actionsOff ?? "Unblock every sender T-Guard has blocked. Needs the password."}
                  className={TOOL}
                >
                  <span className="tabular-nums">{clearBlocksLabel(blocklist.status)}</span>
                </button>
              </>
            }
          />

          <SimPanel />
        </main>
      </div>

      <AnimatePresence>
        {notice && (
          <motion.p
            key={notice}
            role="status"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="fixed bottom-4 left-1/2 z-40 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 border-l-4 border-hot bg-ink px-4 py-3 text-sm font-bold text-paper shadow-[5px_10px_20px_-12px_#2d233180]"
          >
            {notice}
          </motion.p>
        )}
      </AnimatePresence>

      {prompt && (
        <PasswordPrompt
          key={prompt.kind === "unblock" ? prompt.message.id : prompt.kind}
          title={prompt.kind === "unblock" ? "Unblock message" : PROMPT_TEXT[prompt.kind].title}
          description={
            prompt.kind === "unblock"
              ? `Move this potential scam from ${prompt.message.from.display} to the inbox. It will show as restored.`
              : PROMPT_TEXT[prompt.kind].description
          }
          confirmLabel={prompt.kind === "unblock" ? "Unblock" : PROMPT_TEXT[prompt.kind].confirm}
          onSubmit={runPrompt}
          onClose={() => setPrompt(null)}
        />
      )}
    </MotionConfig>
  );
}
