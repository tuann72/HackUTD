// Scam category display colors. Category names come from the gateway's
// verdict (the scam groups in data/scam_categories.csv); the UI only
// colors them and never derives a category itself.
// Full class strings are listed so Tailwind can see them.

export const KNOWN_CATEGORIES = [
  "Imposter & Phishing",
  "Prizes, Lotteries & Advance-Fee",
  "Jobs, Business & Investment",
  "Loans, Credit & Debt",
  "Health & Pharmacy",
  "Shopping & Product Offers",
  "Internet, Telecom & Media",
  "Threats & Extortion",
] as const;

const COLORS: Record<string, string> = {
  "Imposter & Phishing":
    "bg-rose-100 text-rose-800 ring-rose-600/20 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/30",
  "Prizes, Lotteries & Advance-Fee":
    "bg-violet-100 text-violet-800 ring-violet-600/20 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/30",
  "Jobs, Business & Investment":
    "bg-sky-100 text-sky-800 ring-sky-600/20 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/30",
  "Loans, Credit & Debt":
    "bg-orange-100 text-orange-800 ring-orange-600/20 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-400/30",
  "Health & Pharmacy":
    "bg-emerald-100 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30",
  "Shopping & Product Offers":
    "bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-600/20 dark:bg-fuchsia-500/15 dark:text-fuchsia-300 dark:ring-fuchsia-400/30",
  "Internet, Telecom & Media":
    "bg-teal-100 text-teal-800 ring-teal-600/20 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-400/30",
  "Threats & Extortion":
    "bg-red-100 text-red-800 ring-red-600/20 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/30",
};

export const FALLBACK_CATEGORY_CLASS =
  "bg-zinc-100 text-zinc-700 ring-zinc-500/20 dark:bg-zinc-500/15 dark:text-zinc-300 dark:ring-zinc-400/30";

/** Badge classes for a category name; unknown or null gets the neutral fallback. */
export function categoryClass(category: string | null | undefined): string {
  return (category && COLORS[category]) || FALLBACK_CATEGORY_CLASS;
}

/** Label for a category; null or empty becomes "Uncategorized". */
export function categoryLabel(category: string | null | undefined): string {
  return category && category.trim() ? category : "Uncategorized";
}
