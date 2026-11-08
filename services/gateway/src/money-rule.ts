// A delivered message that asks the reader for a large sum gets a warning. The model can't weigh
// amounts ($20 and $6000 are both just tokens), so this is a plain rule. It warns and never blocks,
// because real family and friends ask for money too.

const AMOUNT = /\$\s?(\d[\d,]*(?:\.\d+)?)(k\b)?|\b(\d[\d,]*(?:\.\d+)?)(k\b|\s?(?:\$|dollars?\b|bucks?\b|usd\b))/gi;

/** Phrases that ask the reader for money, not ones that just mention it ("the car cost $6000"). */
const ASK =
  /\b(?:lend|loan|spot|send|wire|zelle|venmo|cash\s?app|paypal|transfer|give)\s+(?:me|us)\b|\bborrow\b|\b(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+)?(?:lend|loan|spot|send|wire|zelle|venmo|cash\s?app|paypal|transfer|give|help)\b|\bi\s+(?:really\s+|urgently\s+)?need\s+(?:you\s+to\s+send\s+)?(?:\$|\d)/i;

function largestAmount(text: string): number {
  let max = 0;
  for (const m of text.matchAll(AMOUNT)) {
    const digits = m[1] ?? m[3];
    if (!digits) continue;
    const value = Number(digits.replaceAll(',', '')) * (m[2] || /^k$/i.test(m[4] ?? '') ? 1000 : 1);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

/** True when `text` asks the reader for at least `minAmount`. A `minAmount` of 0 turns the rule off. */
export function asksForLargeSum(text: string, minAmount: number): boolean {
  if (minAmount <= 0 || !ASK.test(text)) return false;
  return largestAmount(text) >= minAmount;
}
