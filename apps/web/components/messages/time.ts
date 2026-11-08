/**
 * Short relative time: "just now", "12s ago", "3m ago", "2h ago", "4d ago".
 * Future times (clock skew) read as "just now". Invalid input returns "".
 */
export function formatRelative(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return "";
  const s = Math.floor((nowMs - t) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Score (P(scam), 0..1) as a whole percentage, clamped. */
export function formatScore(score: number): string {
  if (!Number.isFinite(score)) return "–";
  return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
}
