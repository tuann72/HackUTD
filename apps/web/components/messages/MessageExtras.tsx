import type { Attachment, Message } from "@/lib/messages";
import { kindOf } from "@/lib/messages";
import { defangText } from "./defang";

function formatSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function icon(a: Attachment): string {
  const t = a.mimeType ?? "";
  if (t.startsWith("image/")) return "🖼️";
  if (t.startsWith("video/")) return "🎞️";
  if (t.startsWith("audio/")) return "🎙️";
  return "📎";
}

const chip =
  "inline-flex max-w-full items-center gap-1.5 rounded-lg bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

/**
 * The non-text parts of an iMessage: attachments (metadata only, never a
 * file or link), a reaction, or a shared contact card. Plain text only; on a
 * blocked message, names are defanged like the body.
 */
export function MessageExtras({ message: m, defang }: { message: Message; defang: boolean }) {
  const safe = (s: string) => (defang ? defangText(s) : s);
  const kind = kindOf(m);
  const attachments = m.attachments ?? [];

  return (
    <>
      {kind === "reaction" && m.reaction && (
        <p className="text-[15px] text-zinc-800 dark:text-zinc-200">
          <span className="mr-1.5 text-xl leading-none" aria-hidden>
            {m.reaction.emoji}
          </span>
          Reacted
          {m.reaction.targetPreview && (
            <>
              {" to "}
              <span className="italic text-zinc-600 dark:text-zinc-400">“{safe(m.reaction.targetPreview)}”</span>
            </>
          )}
        </p>
      )}

      {kind === "contact" && m.contact && (
        <div className={`${chip} flex-col items-start gap-0.5 px-3 py-2`}>
          <span className="font-medium">👤 {m.contact.name ? safe(m.contact.name) : "Contact card"}</span>
          {m.contact.phones.map((p) => (
            <span key={p} className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              {p}
            </span>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Attachments">
          {attachments.map((a, i) => {
            const size = formatSize(a.size);
            return (
              <li key={i} className={chip} title={a.mimeType ?? undefined}>
                <span aria-hidden>{icon(a)}</span>
                <span className="truncate">{a.name ? safe(a.name) : "Attachment"}</span>
                {size && <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{size}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
