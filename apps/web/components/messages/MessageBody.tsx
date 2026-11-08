import type { Highlight } from "@/lib/messages";
import { renderSegments } from "./highlight";

const DEFANGED_TITLE = {
  url: "Link disabled by T-Guard. Don't visit it.",
  phone: "Number disabled by T-Guard. Don't call it.",
} as const;

/**
 * Text size for a message body: short messages read big, long ones shrink so
 * cards stay compact. Steps by character count (trimmed).
 */
export function bodySizeClass(body: string): string {
  const n = body.trim().length;
  if (n <= 30) return "text-2xl leading-snug";
  if (n <= 80) return "text-xl leading-snug";
  if (n <= 160) return "text-[17px] leading-relaxed";
  if (n <= 320) return "text-[15px] leading-relaxed";
  return "text-[13px] leading-relaxed";
}

/**
 * Message text as plain React text nodes: never a link, never HTML.
 * With `defang`, links and phone numbers are defanged and styled; with
 * `highlights`, those offsets (into the original body) render as <mark>.
 */
export function MessageBody({
  body,
  highlights,
  defang = false,
}: {
  body: string;
  highlights?: readonly Highlight[] | null;
  defang?: boolean;
}) {
  const segments = renderSegments(body, highlights ?? null, { defang });
  return (
    <p className={`whitespace-pre-wrap break-words text-zinc-900 ${bodySizeClass(body)}`}>
      {segments.map((seg) => {
        const content = seg.pieces.map((p, i) =>
          p.kind === "plain" ? (
            p.text
          ) : (
            <span
              key={i}
              title={DEFANGED_TITLE[p.kind]}
              className="rounded bg-zinc-100 px-0.5 font-mono text-[0.9em] text-zinc-600 select-text dark:bg-zinc-800 dark:text-zinc-400"
            >
              {p.text}
            </span>
          ),
        );
        return seg.highlight ? (
          <mark
            key={seg.start}
            title={seg.highlight.text ? `Flagged word: ${seg.highlight.text}` : "Flagged word"}
            className="bg-[#ffcee6] px-0.5 text-inherit"
          >
            {content}
          </mark>
        ) : (
          <span key={seg.start}>{content}</span>
        );
      })}
    </p>
  );
}
