// Server-only: POST /api/simulate (app/api/simulate/route.ts). Takes one
// simulated step from the simulation panel, builds the Photon (Spectrum)
// inbound-iMessage webhook that services/perpetrator-sim sends, signs it with
// X-Spectrum-Signature and POSTs it to the gateway. The secret never reaches
// the browser. Unauthenticated by choice (Tuan, 2026-11-08), like Clear chats,
// so the rails below limit it to fictional senders, short text and a rate.
import { createHmac, randomUUID } from "node:crypto";
import { isFictionalNumber, type SimContent, type Step } from "../sim/plan";

export interface SimConfig {
  /** Gateway webhook URL, or null when simulation is off. */
  url: string | null;
  secret: string | null;
  line: string;
  /** Why simulation is off, for the panel. */
  disabledReason: string | null;
}

export function simConfigFromEnv(env: Record<string, string | undefined> = process.env): SimConfig {
  const api = env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
  const url = env.SIM_WEBHOOK_URL || (api ? `${api}/webhooks/photon` : null);
  const secret = env.SIM_WEBHOOK_SECRET || env.PHOTON_WEBHOOK_SECRET || null;
  const line = env.SIM_VICTIM_NUMBER || "+15555550100";
  let disabledReason: string | null = null;
  if (!url) disabledReason = "No gateway to send to: set NEXT_PUBLIC_API_URL or SIM_WEBHOOK_URL.";
  else if (!secret) disabledReason = "No signing secret: set SIM_WEBHOOK_SECRET (the gateway's PHOTON_WEBHOOK_SECRET).";
  else {
    const urlError = checkUrl(url);
    if (urlError) disabledReason = urlError;
    else if (!isFictionalNumber(line)) disabledReason = "SIM_VICTIM_NUMBER must be a fictional +1555xxxxxxx number.";
  }
  return { url: disabledReason ? null : url, secret: disabledReason ? null : secret, line, disabledReason };
}

function checkUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "SIM_WEBHOOK_URL is not a valid URL.";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "SIM_WEBHOOK_URL must be http(s).";
  const host = u.hostname.toLowerCase();
  if (host === "photon.codes" || host.endsWith(".photon.codes")) return "SIM_WEBHOOK_URL points at Photon; simulation only sends to the gateway.";
  return null;
}

// --- Validation ------------------------------------------------------------------

export const MAX_TEXT = 1000;
const MAX_ITEMS = 10;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = MAX_TEXT): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

function parseContent(raw: unknown, nested = false): SimContent {
  if (!isObj(raw)) throw new Error("content must be an object");
  switch (raw.type) {
    case "text":
      if (!str(raw.text)) throw new Error(`text must be 1 to ${MAX_TEXT} characters`);
      return { type: "text", text: raw.text };
    case "richlink":
      if (!str(raw.url, 500)) throw new Error("richlink needs a url");
      return { type: "richlink", url: raw.url };
    case "attachment":
      if (!str(raw.name, 200)) throw new Error("attachment needs a name");
      return {
        type: "attachment",
        name: raw.name,
        mimeType: str(raw.mimeType, 100) ? raw.mimeType : "application/octet-stream",
        ...(typeof raw.size === "number" && Number.isInteger(raw.size) && raw.size >= 0 ? { size: raw.size } : {}),
      };
    case "reaction":
      if (nested) throw new Error("a reaction can't be inside an album");
      if (!str(raw.emoji, 16)) throw new Error("reaction needs an emoji");
      return { type: "reaction", emoji: raw.emoji, ...(str(raw.targetPreview) ? { targetPreview: raw.targetPreview } : {}) };
    case "contact": {
      if (nested) throw new Error("a contact card can't be inside an album");
      const phones = raw.phones ?? [];
      if (!Array.isArray(phones) || phones.length > 5 || !phones.every((p) => typeof p === "string" && isFictionalNumber(p))) {
        throw new Error("contact phones must be fictional +1555xxxxxxx numbers");
      }
      return { type: "contact", ...(str(raw.name, 100) ? { name: raw.name } : {}), phones: phones as string[] };
    }
    case "group":
      if (nested) throw new Error("albums can't nest");
      if (!Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > MAX_ITEMS) {
        throw new Error(`an album needs 1 to ${MAX_ITEMS} items`);
      }
      return { type: "group", items: raw.items.map((it) => parseContent(it, true)) };
    default:
      throw new Error(`unknown content type ${JSON.stringify(raw.type)}`);
  }
}

/** Validates one step from the browser. Throws with a message safe to show. */
export function parseStep(raw: unknown): Pick<Step, "from" | "body" | "content" | "group"> {
  if (!isObj(raw)) throw new Error("body must be a JSON object");
  if (typeof raw.from !== "string" || !isFictionalNumber(raw.from)) throw new Error("from must be a fictional +1555xxxxxxx number");
  if (raw.group !== undefined && !(typeof raw.group === "string" && /^[\w-]{1,40}$/.test(raw.group))) {
    throw new Error("group must be 1 to 40 letters, digits, - or _");
  }
  const group = raw.group as string | undefined;
  if (raw.content !== undefined) {
    if (raw.body !== undefined) throw new Error("give either body or content, not both");
    return { from: raw.from, content: parseContent(raw.content), ...(group ? { group } : {}) };
  }
  if (!str(raw.body)) throw new Error(`body must be 1 to ${MAX_TEXT} characters`);
  return { from: raw.from, body: raw.body, ...(group ? { group } : {}) };
}

// --- Payload (same shape as services/perpetrator-sim/src/spectrum-request.ts) ------

const newId = () => `spc-msg-${randomUUID()}`;

interface Space {
  id: string;
  platform: "imessage";
  type: "dm" | "group";
  phone: string;
}

function toSpectrum(c: SimContent, ctx: { from: string; space: Space; timestamp: string }): Record<string, unknown> {
  switch (c.type) {
    case "text":
    case "richlink":
      return { ...c };
    case "attachment":
      return { type: "attachment", id: randomUUID().toUpperCase(), name: c.name, mimeType: c.mimeType, ...(c.size !== undefined ? { size: c.size } : {}) };
    case "reaction":
      return {
        type: "reaction",
        emoji: c.emoji,
        target: { id: newId(), platform: "imessage", ...(c.targetPreview ? { contentPreview: c.targetPreview.slice(0, 80) } : {}) },
      };
    case "contact":
      return { type: "contact", ...(c.name ? { name: c.name } : {}), phones: c.phones ?? [] };
    case "group":
      return {
        type: "group",
        items: c.items.map((item) => ({
          id: newId(),
          platform: "imessage",
          direction: "inbound",
          timestamp: ctx.timestamp,
          sender: { id: ctx.from, platform: "imessage" },
          space: { ...ctx.space },
          content: toSpectrum(item, ctx),
        })),
      };
  }
}

export function buildPayload(step: Pick<Step, "from" | "body" | "content" | "group">, line: string, now = new Date()) {
  const space: Space = step.group
    ? { id: step.group, platform: "imessage", type: "group", phone: line }
    : { id: `any;-;${step.from}`, platform: "imessage", type: "dm", phone: line };
  const timestamp = now.toISOString();
  const content: SimContent = step.content ?? { type: "text", text: step.body ?? "" };
  return {
    event: "messages",
    space,
    message: {
      id: newId(),
      platform: "imessage",
      direction: "inbound",
      timestamp,
      sender: { id: step.from, platform: "imessage" },
      space: { ...space },
      content: toSpectrum(content, { from: step.from, space, timestamp }),
    },
  };
}

export function signBody(secret: string, timestamp: string, rawBody: string): string {
  return "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
}

// --- Rate limit (best effort: per server instance) --------------------------------

export function createLimiter(max = 60, windowMs = 60_000) {
  let hits: number[] = [];
  return (now: number) => {
    hits = hits.filter((t) => now - t < windowMs);
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  };
}

const defaultLimiter = createLimiter();

// --- Handler ------------------------------------------------------------------------

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function simStatus(cfg: SimConfig): Response {
  const target = cfg.url ? new URL(cfg.url).host : null;
  return json({ enabled: cfg.disabledReason === null, target, reason: cfg.disabledReason });
}

export async function handleSimulate(
  request: Request,
  deps: { cfg: SimConfig; fetch?: typeof fetch; now?: () => Date; allow?: (now: number) => boolean; timeoutMs?: number },
): Promise<Response> {
  const { cfg } = deps;
  if (!cfg.url || !cfg.secret) return json({ error: cfg.disabledReason ?? "simulation is off" }, 503);
  const now = (deps.now ?? (() => new Date()))();
  if (!(deps.allow ?? defaultLimiter)(now.getTime())) return json({ error: "Too many simulated messages; wait a minute." }, 429);

  let step;
  try {
    step = parseStep(await request.json());
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "invalid request" }, 400);
  }

  const raw = JSON.stringify(buildPayload(step, cfg.line, now));
  const ts = String(Math.floor(now.getTime() / 1000));
  try {
    const res = await (deps.fetch ?? fetch)(cfg.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-spectrum-event": "messages",
        "x-spectrum-timestamp": ts,
        "x-spectrum-signature": signBody(cfg.secret, ts, raw),
      },
      body: raw,
      signal: AbortSignal.timeout(deps.timeoutMs ?? 25_000),
      cache: "no-store",
    });
    if (!res.ok) {
      const hint = res.status === 401 ? " (signing secret doesn't match the gateway's PHOTON_WEBHOOK_SECRET)" : "";
      return json({ error: `gateway answered ${res.status}${hint}`, gatewayStatus: res.status }, 502);
    }
    return json({ ok: true, gatewayStatus: res.status });
  } catch (err) {
    return json({ error: `gateway unreachable: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }
}
