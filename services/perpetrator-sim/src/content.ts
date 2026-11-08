/**
 * Non-text iMessage content a scenario step (or `send`) can carry. Shapes follow
 * Photon's inbound `message.content` (https://photon.codes/docs/webhooks/events).
 * Metadata only: Photon never sends file bytes, so neither does the simulator.
 */
export type SimContent =
  | { type: "text"; text: string }
  | { type: "richlink"; url: string }
  | { type: "attachment"; name: string; mimeType: string; size?: number }
  | { type: "reaction"; emoji: string; targetPreview?: string }
  | { type: "contact"; name?: string; phones?: string[] }
  | { type: "group"; items: SimContent[] };

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  gif: "image/gif",
  mov: "video/quicktime",
  mp4: "video/mp4",
  m4a: "audio/mp4",
  caf: "audio/x-caf",
  pdf: "application/pdf",
};

export function guessMimeType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" && v.length > 0;

/** Validates scenario `content`; throws with `where` in the message. */
export function parseContent(raw: unknown, where: string, nested = false): SimContent {
  if (!isObj(raw)) throw new Error(`${where}: content must be an object`);
  switch (raw.type) {
    case "text":
      if (!str(raw.text)) throw new Error(`${where}: text content needs a non-empty "text"`);
      return { type: "text", text: raw.text as string };
    case "richlink":
      if (!str(raw.url)) throw new Error(`${where}: richlink content needs a "url"`);
      return { type: "richlink", url: raw.url as string };
    case "attachment": {
      if (!str(raw.name)) throw new Error(`${where}: attachment content needs a "name"`);
      const name = raw.name as string;
      if (raw.size !== undefined && !(typeof raw.size === "number" && Number.isInteger(raw.size) && raw.size >= 0)) {
        throw new Error(`${where}: attachment size must be a non-negative integer`);
      }
      return {
        type: "attachment",
        name,
        mimeType: str(raw.mimeType) ? (raw.mimeType as string) : guessMimeType(name),
        ...(raw.size !== undefined ? { size: raw.size as number } : {}),
      };
    }
    case "reaction":
      if (nested) throw new Error(`${where}: a reaction can't be inside an album`);
      if (!str(raw.emoji)) throw new Error(`${where}: reaction content needs an "emoji"`);
      if (raw.targetPreview !== undefined && typeof raw.targetPreview !== "string") {
        throw new Error(`${where}: reaction targetPreview must be a string`);
      }
      return { type: "reaction", emoji: raw.emoji as string, ...(raw.targetPreview ? { targetPreview: raw.targetPreview as string } : {}) };
    case "contact": {
      if (nested) throw new Error(`${where}: a contact card can't be inside an album`);
      const phones = raw.phones ?? [];
      if (!Array.isArray(phones) || !phones.every(str)) throw new Error(`${where}: contact phones must be an array of strings`);
      if (raw.name !== undefined && !str(raw.name)) throw new Error(`${where}: contact name must be a non-empty string`);
      return { type: "contact", ...(raw.name ? { name: raw.name as string } : {}), phones: phones as string[] };
    }
    case "group": {
      if (nested) throw new Error(`${where}: albums can't nest`);
      if (!Array.isArray(raw.items) || raw.items.length === 0) throw new Error(`${where}: an album needs a non-empty "items" array`);
      return { type: "group", items: raw.items.map((it, i) => parseContent(it, `${where} item ${i + 1}`, true)) };
    }
    default:
      throw new Error(`${where}: unknown content type ${JSON.stringify(raw.type)}`);
  }
}

/** Every phone number a content block carries (contact cards), for the safety rail. */
export function contentPhones(c: SimContent | undefined): string[] {
  if (!c) return [];
  if (c.type === "contact") return c.phones ?? [];
  if (c.type === "group") return c.items.flatMap(contentPhones);
  return [];
}

/** One-line description for logs. */
export function describeContent(c: SimContent): string {
  switch (c.type) {
    case "text":
      return c.text;
    case "richlink":
      return `[link] ${c.url}`;
    case "attachment":
      return `[attachment] ${c.name} (${c.mimeType})`;
    case "reaction":
      return `[reaction ${c.emoji}]${c.targetPreview ? ` to "${c.targetPreview}"` : ""}`;
    case "contact":
      return `[contact] ${c.name ?? "(no name)"}`;
    case "group":
      return `[album] ${c.items.map(describeContent).join(" + ")}`;
  }
}
