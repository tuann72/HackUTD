"use client";

/**
 * Square chevron button that collapses a side panel toward its edge of the screen
 * and expands it again. `side` is the edge the panel sits on: the chevron points
 * toward that edge while open (collapse) and away from it while closed (expand).
 */
export function CollapseButton({
  side,
  open,
  label,
  controls,
  onToggle,
  className = "",
}: {
  side: "left" | "right";
  open: boolean;
  /** The panel's name, used in "Collapse <label>" / "Expand <label>". */
  label: string;
  controls?: string;
  onToggle: () => void;
  className?: string;
}) {
  const pointsLeft = side === "left" ? open : !open;
  const action = `${open ? "Collapse" : "Expand"} ${label}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={action}
      title={action}
      className={`grid size-8 shrink-0 place-items-center border border-rule text-ink transition-colors hover:border-ink hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot ${className}`}
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className={`size-3.5 transition-transform duration-200 motion-reduce:transition-none ${pointsLeft ? "rotate-180" : ""}`}
      >
        <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
