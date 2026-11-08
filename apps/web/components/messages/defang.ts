// Defanging for message bodies: links and phone numbers inside (possibly scam)
// text are shown as plain, non-clickable text that OS/browser link detectors
// won't pick up. `http` -> `hxxp`, `.` -> `[.]` in links; `+`, `-`, `.` in
// phone numbers -> `[+]`, `[-]`, `[.]`.
//
// Ranges are found on the ORIGINAL text, so callers can split the text first
// (e.g. for keyword highlights) and defang each slice with the same ranges.

export type DefangKind = "url" | "phone";

export interface DefangRange {
  start: number;
  end: number;
  kind: DefangKind;
}

export interface DefangPiece {
  /** Display text (already defanged for url/phone pieces). */
  text: string;
  kind: "plain" | DefangKind;
}

// Scheme or www. links, then bare domains such as bit.ly/x or example.com.
// The TLD must be letters, so "$8.50" or "v1.2" don't match.
const URL_RE =
  /\b(?:(?:https?|hxxps?):\/\/|www\.)[^\s<>"')\]]+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}\b(?:\/[^\s<>"')\]]*)?/gi;

// North American style numbers, with optional +country code:
// +1 (555) 555-0142, 555-555-0142, 555.555.0142, (555) 555 0142, 5555550142.
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

// Trailing punctuation that usually ends a sentence rather than a link.
const TRAILING = /[.,!?;:]+$/;

export function findDefangRanges(text: string): DefangRange[] {
  const ranges: DefangRange[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(TRAILING, "");
    if (!raw || !raw.includes(".")) continue;
    const start = m.index ?? 0;
    ranges.push({ start, end: start + raw.length, kind: "url" });
  }
  for (const m of text.matchAll(PHONE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (ranges.some((r) => r.kind === "url" && start < r.end && end > r.start)) continue;
    ranges.push({ start, end, kind: "phone" });
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** Display form of the single character at `i` inside a defang range. */
function defangChar(text: string, i: number, range: DefangRange): string {
  const ch = text[i];
  if (range.kind === "url") {
    // http(s) / HTTP(S) at the link start -> hxxp(s)
    const off = i - range.start;
    if ((off === 1 || off === 2) && /^http/i.test(text.slice(range.start, range.start + 4))) {
      return ch === "T" ? "X" : "x";
    }
    if (ch === ".") return "[.]";
    return ch;
  }
  if (ch === "+" || ch === "-" || ch === ".") return `[${ch}]`;
  return ch;
}

/**
 * Defangs `text.slice(start, end)` using ranges found on the whole `text`.
 * Returns pieces so the UI can style defanged parts.
 */
export function defangSlice(
  text: string,
  start = 0,
  end = text.length,
  ranges: readonly DefangRange[] = findDefangRanges(text),
): DefangPiece[] {
  const pieces: DefangPiece[] = [];
  const push = (t: string, kind: DefangPiece["kind"]) => {
    if (!t) return;
    const last = pieces[pieces.length - 1];
    if (last && last.kind === kind) last.text += t;
    else pieces.push({ text: t, kind });
  };
  let i = Math.max(0, start);
  const stop = Math.min(text.length, end);
  while (i < stop) {
    const r = ranges.find((x) => i >= x.start && i < x.end);
    if (!r) {
      const next = ranges.find((x) => x.start > i)?.start ?? stop;
      const to = Math.min(next, stop);
      push(text.slice(i, to), "plain");
      i = to;
      continue;
    }
    const to = Math.min(r.end, stop);
    let out = "";
    for (let j = i; j < to; j++) out += defangChar(text, j, r);
    push(out, r.kind);
    i = to;
  }
  return pieces;
}

/** Whole-string defang, as plain text. */
export function defangText(text: string): string {
  return defangSlice(text)
    .map((p) => p.text)
    .join("");
}
