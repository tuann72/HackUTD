import type { Highlight } from "@/lib/messages";
import { defangSlice, findDefangRanges, type DefangPiece } from "./defang";

export interface Segment {
  /** Offsets into the ORIGINAL body. */
  start: number;
  end: number;
  /** Original text of this slice. */
  text: string;
  /** The highlight covering this slice, or null for unhighlighted text. */
  highlight: Highlight | null;
}

/**
 * Splits `body` into highlighted and plain segments from classifier
 * highlight offsets. Never throws: non-numeric, out-of-range, empty or
 * reversed spans are dropped or clamped, and overlapping spans are trimmed so
 * every character belongs to exactly one segment (earlier span wins).
 */
export function segmentHighlights(body: string, highlights: readonly Highlight[] | null | undefined): Segment[] {
  const text = typeof body === "string" ? body : "";
  const len = text.length;
  const spans = (Array.isArray(highlights) ? highlights : [])
    .filter((h): h is Highlight => !!h && Number.isFinite(h.start) && Number.isFinite(h.end))
    .map((h) => ({
      h,
      start: Math.max(0, Math.min(len, Math.floor(h.start))),
      end: Math.max(0, Math.min(len, Math.floor(h.end))),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const out: Segment[] = [];
  let cursor = 0;
  for (const s of spans) {
    const start = Math.max(s.start, cursor);
    if (start >= s.end) continue; // fully covered by an earlier span
    if (start > cursor) out.push({ start: cursor, end: start, text: text.slice(cursor, start), highlight: null });
    out.push({ start, end: s.end, text: text.slice(start, s.end), highlight: s.h });
    cursor = s.end;
  }
  if (cursor < len || out.length === 0) {
    out.push({ start: cursor, end: len, text: text.slice(cursor), highlight: null });
  }
  return out.filter((s) => s.end > s.start || len === 0);
}

export interface RenderSegment extends Segment {
  pieces: DefangPiece[];
}

/**
 * Highlight segments with display pieces. When `defang` is true, links and
 * phone numbers are found on the whole original body, then each segment is
 * defanged with those ranges, so a highlight that cuts through a link still
 * shows the link defanged.
 */
export function renderSegments(
  body: string,
  highlights: readonly Highlight[] | null | undefined,
  { defang }: { defang: boolean },
): RenderSegment[] {
  const text = typeof body === "string" ? body : "";
  const ranges = defang ? findDefangRanges(text) : [];
  return segmentHighlights(text, highlights).map((s) => ({
    ...s,
    pieces: defang ? defangSlice(text, s.start, s.end, ranges) : s.text ? [{ text: s.text, kind: "plain" }] : [],
  }));
}
