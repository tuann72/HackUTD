"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId, useMemo, useState, type ReactNode } from "react";
import type { Message } from "@/lib/messages";
import {
  activeFilterCount,
  applyFilters,
  categoryOptions,
  DEFAULT_FILTERS,
  FLAGS,
  KNOWN_SENDER,
  type Filters,
  type Flag,
  type Sort,
  type View,
} from "./filter";
import { CollapseButton } from "@/components/brand/CollapseButton";
import { MessageCard } from "./MessageCard";

const LABEL = "font-label text-[10px] uppercase tracking-[0.06em]";
const FIELD =
  "h-9 w-full min-w-0 border border-rule bg-card px-2.5 text-sm text-ink placeholder:text-muted focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-hot";

const SORTS: { id: Sort; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "score", label: "Highest scam score" },
];

function Tabs({ view, counts, onChange }: { view: View; counts: Record<View, number>; onChange: (v: View) => void }) {
  const tabs: { id: View; label: string }[] = [
    { id: "all", label: "All" },
    { id: "inbox", label: "Inbox" },
    { id: "blocked", label: "Blocked" },
  ];
  return (
    <div role="tablist" aria-label="Which messages" className="grid grid-cols-3 border border-ink">
      {tabs.map((t) => {
        const on = view === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`relative flex h-10 items-center justify-center gap-1.5 ${LABEL} transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot ${
              on ? "text-paper" : "text-ink hover:bg-paper"
            }`}
          >
            {on && (
              <motion.span
                layoutId="message-tab"
                aria-hidden
                className={`absolute inset-0 ${t.id === "blocked" ? "bg-hot" : "bg-ink"}`}
                transition={{ type: "spring", stiffness: 520, damping: 42 }}
              />
            )}
            <span className="relative">{t.label}</span>
            <span className={`relative tabular-nums ${on ? "opacity-80" : "text-muted"}`}>{counts[t.id]}</span>
          </button>
        );
      })}
    </div>
  );
}

function Chip({ on, title, onClick, children }: { on: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`border px-2 py-1 ${LABEL} text-[9px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot ${
        on ? "border-ink bg-ink text-paper" : "border-rule text-ink hover:border-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The left panel on /messages: tabs for All, Inbox and Blocked, then search, a
 * category menu, flag chips and sort, then the list itself (which scrolls on its own
 * on wide screens). `tools` sits in a footer under the list (Clear chats).
 * On wide screens a chevron button collapses it to a thin strip at the left edge.
 */
export function MessagePanel({
  messages,
  loading,
  now,
  tools,
  status,
}: {
  messages: Message[];
  loading: boolean;
  now: number | null;
  tools?: ReactNode;
  status?: ReactNode;
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [moreOpen, setMoreOpen] = useState(false);
  // Wide screens only: the panel can collapse to a thin strip at the left edge.
  const [open, setOpen] = useState(true);
  const ids = { body: useId(), search: useId(), category: useId(), sort: useId(), more: useId(), list: useId() };
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggleFlag = (flag: Flag) =>
    setFilters((f) => ({ ...f, flags: f.flags.includes(flag) ? f.flags.filter((x) => x !== flag) : [...f.flags, flag] }));

  const counts = useMemo(() => {
    const blocked = messages.filter((m) => m.action === "blocked").length;
    return { all: messages.length, inbox: messages.length - blocked, blocked };
  }, [messages]);
  const categories = useMemo(() => categoryOptions(messages), [messages]);
  const shown = useMemo(() => applyFilters(messages, filters), [messages, filters]);
  const active = activeFilterCount(filters);
  const narrowed = shown.length !== counts[filters.view];
  // Filters inside the drawer (search is always visible, so it isn't counted here).
  const drawerCount = active - (filters.query.trim() ? 1 : 0);

  const empty = loading
    ? "Loading messages…"
    : counts[filters.view] === 0
      ? filters.view === "blocked"
        ? "Nothing blocked yet. Send a scam from Simulate to see one land here."
        : "No messages yet. Text the victim line or use Simulate."
      : "No messages match these filters.";

  return (
    <section
      aria-label="Messages"
      className={`flex min-h-0 flex-col border-rule bg-card/40 lg:overflow-hidden lg:border-r lg:transition-[width] lg:duration-300 lg:ease-out motion-reduce:transition-none ${
        open ? "lg:w-[25rem]" : "lg:w-12"
      }`}
    >
      {!open && (
        <div className="hidden w-12 flex-col items-center gap-4 py-4 lg:flex">
          <CollapseButton side="left" open={false} label="messages" controls={ids.body} onToggle={() => setOpen(true)} />
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 font-label text-[11px] uppercase tracking-[0.08em] text-muted [writing-mode:vertical-rl] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot"
          >
            Messages
            <span className="tabular-nums text-ink">{counts.all}</span>
            {counts.blocked > 0 && <span className="tabular-nums text-hot">{counts.blocked} blocked</span>}
          </button>
        </div>
      )}
      {/* Fixed width on wide screens, so the content is revealed, not squeezed, while the panel opens. */}
      <div id={ids.body} className={`flex min-h-0 flex-1 flex-col lg:w-[25rem] ${open ? "" : "lg:hidden"}`}>
        <div className="flex flex-col gap-3 border-b border-rule p-4">
          <div className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1">
              <Tabs view={filters.view} counts={counts} onChange={(view) => set({ view })} />
            </div>
            <CollapseButton
              side="left"
              open
              label="messages"
              controls={ids.body}
              onToggle={() => setOpen(false)}
              className="hidden lg:grid lg:size-auto lg:w-10"
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor={ids.search} className="sr-only">
              Search messages
            </label>
            <input
              id={ids.search}
              type="search"
              value={filters.query}
              onChange={(e) => set({ query: e.target.value })}
              placeholder="Search sender, text or category"
              className={FIELD}
            />
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls={ids.more}
              onClick={() => setMoreOpen((o) => !o)}
              className={`flex h-9 shrink-0 items-center gap-1.5 border px-2.5 ${LABEL} transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot ${
                moreOpen ? "border-ink bg-ink text-paper" : "border-ink text-ink hover:bg-paper"
              }`}
            >
              Filters
              {drawerCount > 0 && (
                <span className="grid size-4 place-items-center rounded-full bg-hot text-[9px] leading-none text-white tabular-nums">
                  {drawerCount}
                </span>
              )}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {moreOpen && (
              <motion.div
                id={ids.more}
                key="more"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-3 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <label htmlFor={ids.category} className={`${LABEL} text-muted`}>
                        Scam category
                      </label>
                      <select
                        id={ids.category}
                        value={filters.category}
                        onChange={(e) => set({ category: e.target.value })}
                        className={FIELD}
                      >
                        <option value="">Any category</option>
                        {categories.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.key === KNOWN_SENDER ? "Known scam sender" : c.key} ({c.count})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <label htmlFor={ids.sort} className={`${LABEL} text-muted`}>
                        Sort
                      </label>
                      <select
                        id={ids.sort}
                        value={filters.sort}
                        onChange={(e) => set({ sort: e.target.value as Sort })}
                        className={FIELD}
                      >
                        {SORTS.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div role="group" aria-label="Only show messages that are" className="flex flex-wrap gap-1.5">
                    {FLAGS.map((fl) => (
                      <Chip key={fl.id} on={filters.flags.includes(fl.id)} title={fl.title} onClick={() => toggleFlag(fl.id)}>
                        {fl.label}
                      </Chip>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className={`flex min-h-5 items-center justify-between gap-2 ${LABEL} text-muted`}>
            <span role="status" aria-live="polite" className="tabular-nums">
              {narrowed ? `Showing ${shown.length} of ${counts[filters.view]}` : `${shown.length} messages`}
            </span>
            {active > 0 && (
              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...DEFAULT_FILTERS, view: f.view }))}
                className="text-ink underline-offset-4 hover:text-hot hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot"
              >
                Reset filters
              </button>
            )}
          </div>
          {status}
        </div>

        <motion.div layoutScroll id={ids.list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {shown.length === 0 ? (
            <p className={`border border-dashed border-rule px-4 py-10 text-center ${LABEL} leading-relaxed text-muted`}>{empty}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              <AnimatePresence initial={false} mode="popLayout">
                {shown.map((m) => (
                  <motion.li
                    key={m.id}
                    layout="position"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  >
                    <MessageCard message={m} now={now} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </motion.div>

        {tools && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-rule bg-paper px-4 py-3">{tools}</div>}
      </div>
    </section>
  );
}
