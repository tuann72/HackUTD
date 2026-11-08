// Server-only: the Photon webhook receiver that runs on Vercel (app/webhooks/photon/route.ts)
// and the store behind GET /api/messages. A trimmed copy of the VM gateway's flow
// (services/gateway/src/app.ts, photon.ts): verify the signature, parse, classify, store.
// Differences: classification runs before the 200 (Vercel stops work after the response),
// storage is MongoDB Atlas (no disk on Vercel), and only text and links are classified.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { MongoClient, type Collection } from "mongodb";
import type { Message, MessageKind, Verdict } from "../messages/types";
import { stubVerdict } from "./stub";

export interface InboxConfig {
  webhookSecret: string;
  classifierUrl: string | null;
  classifierToken: string | null;
  classifierTimeoutMs: number;
  blockThreshold: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): InboxConfig {
  return {
    webhookSecret: env.PHOTON_WEBHOOK_SECRET ?? "",
    classifierUrl: env.CLASSIFIER_URL?.replace(/\/+$/, "") || null,
    classifierToken: env.CLASSIFIER_TOKEN || null,
    classifierTimeoutMs: Number(env.CLASSIFIER_TIMEOUT_MS) || 2500,
    blockThreshold: env.BLOCK_THRESHOLD ? Number(env.BLOCK_THRESHOLD) : 0.5,
  };
}

// --- Signature (https://photon.codes/docs/webhooks/verifying-signatures) -----

export function spectrumSignature(secret: string, timestamp: string, rawBody: string): string {
  return "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
}

function verify(secret: string, sig: string | null, ts: string | null, raw: string, nowSec: number): string | null {
  if (!sig || !ts || !/^\d+$/.test(ts)) return "missing or malformed signature headers";
  if (Math.abs(nowSec - Number(ts)) > 300) return "stale timestamp";
  const a = Buffer.from(spectrumSignature(secret, ts, raw));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b) ? null : "bad signature";
}

// --- Payload -------------------------------------------------------------------

const KINDS: Record<string, MessageKind> = {
  text: "text", richlink: "link", attachment: "attachment", reaction: "reaction", contact: "contact", group: "album",
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

type Parsed = { ok: true; id: string; sender: string; kind: MessageKind; body: string } | { ok: false; reason: string };

function parse(raw: unknown): Parsed {
  if (!isObj(raw) || raw.event !== "messages") return { ok: false, reason: "not a messages event" };
  const m = raw.message;
  if (!isObj(m) || typeof m.id !== "string" || !isObj(m.sender) || typeof m.sender.id !== "string") {
    return { ok: false, reason: "missing message.id or sender" };
  }
  if (m.platform !== "imessage" || (m.direction !== undefined && m.direction !== "inbound")) {
    return { ok: false, reason: "not an inbound iMessage" };
  }
  const c = isObj(m.content) ? m.content : {};
  const kind = KINDS[String(c.type)];
  if (!kind) return { ok: false, reason: `content type ${String(c.type)}` };
  const body = kind === "text" && typeof c.text === "string" ? c.text : kind === "link" && typeof c.url === "string" ? c.url : "";
  if ((kind === "text" || kind === "link") && !body.trim()) return { ok: false, reason: "empty text" };
  return { ok: true, id: m.id, sender: m.sender.id, kind, body };
}

/** `+15555550142` -> `***-***-0142`; `jane@icloud.com` -> `j***@icloud.com`. Raw handles are never stored. */
export function maskHandle(h: string): string {
  const at = h.lastIndexOf("@");
  if (at > 0) return `${h[0]}***@${h.slice(at + 1)}`;
  return `***-***-${h.replace(/\D/g, "").slice(-4).padStart(4, "*")}`;
}

const normalize = (h: string) => (h.includes("@") ? h.trim().toLowerCase() : h.replace(/[^\d+]/g, ""));
const opaque = (secret: string, prefix: string, v: string) =>
  prefix + createHmac("sha256", secret).update(prefix + v).digest("hex").slice(0, 16);

// --- Classifier (fail open, like the gateway) ------------------------------------

async function classify(cfg: InboxConfig, messageId: string, text: string, fetchImpl: typeof fetch): Promise<Verdict> {
  if (!cfg.classifierUrl) return stubVerdict(text);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.classifierToken) headers.Authorization = `Bearer ${cfg.classifierToken}`;
  const res = await fetchImpl(`${cfg.classifierUrl}/classify`, {
    method: "POST",
    headers,
    body: JSON.stringify({ messageId, text }),
    signal: AbortSignal.timeout(cfg.classifierTimeoutMs),
  });
  if (!res.ok) throw new Error(`classifier HTTP ${res.status}`);
  const v = (await res.json()) as Verdict;
  if ((v.label !== "scam" && v.label !== "legit") || typeof v.score !== "number" || typeof v.model !== "string") {
    throw new Error("invalid classifier response");
  }
  return { label: v.label, score: v.score, category: v.category ?? null, model: v.model, highlights: Array.isArray(v.highlights) ? v.highlights : [] };
}

// --- Store -------------------------------------------------------------------------

export interface Store {
  /** false if this key was already stored (Photon retries and re-delivers). */
  insert(key: string, msg: Message): Promise<boolean>;
  update(id: string, patch: Pick<Message, "action" | "reason" | "verdict">): Promise<void>;
  list(limit: number): Promise<Message[]>;
}

/** Tests and local dev only: Vercel cold starts lose it. */
export class MemoryStore implements Store {
  rows = new Map<string, Message>();
  async insert(key: string, msg: Message) {
    if (this.rows.has(key)) return false;
    this.rows.set(key, { ...msg });
    return true;
  }
  async update(id: string, patch: Pick<Message, "action" | "reason" | "verdict">) {
    for (const m of this.rows.values()) if (m.id === id) Object.assign(m, patch);
  }
  async list(limit: number) {
    return [...this.rows.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, limit);
  }
}

type Doc = Message & { _id: string };

export class MongoStore implements Store {
  constructor(private readonly col: Collection<Doc>) {}
  async insert(key: string, msg: Message) {
    try {
      await this.col.insertOne({ _id: key, ...msg });
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return false;
      throw err;
    }
  }
  async update(id: string, patch: Pick<Message, "action" | "reason" | "verdict">) {
    await this.col.updateOne({ id }, { $set: patch });
  }
  async list(limit: number) {
    return (await this.col.find({}, { projection: { _id: 0 } }).sort({ receivedAt: -1 }).limit(limit).toArray()) as Message[];
  }
}

const g = globalThis as { __tgateClient?: Promise<MongoClient>; __tgateMemory?: MemoryStore };

/** Atlas when MONGODB_URI is set (required on Vercel); otherwise an in-memory store. The client is reused across warm invocations. */
export async function getStore(env: NodeJS.ProcessEnv = process.env): Promise<Store> {
  if (!env.MONGODB_URI) return (g.__tgateMemory ??= new MemoryStore());
  g.__tgateClient ??= new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 }).connect();
  const col = (await g.__tgateClient).db(env.MONGODB_DB || "tgate").collection<Doc>("inbox");
  return new MongoStore(col);
}

// --- Webhook handler ------------------------------------------------------------------

export async function handleWebhook(
  req: Request,
  deps: { cfg: InboxConfig; store: Store; now?: () => Date; fetch?: typeof fetch },
): Promise<Response> {
  const { cfg, store } = deps;
  const now = deps.now ?? (() => new Date());
  if (!cfg.webhookSecret) return new Response("PHOTON_WEBHOOK_SECRET is not set", { status: 503 });

  const raw = await req.text();
  const bad = verify(cfg.webhookSecret, req.headers.get("x-spectrum-signature"), req.headers.get("x-spectrum-timestamp"), raw, Math.floor(now().getTime() / 1000));
  if (bad) return new Response(bad, { status: bad === "bad signature" ? 401 : 400 });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return new Response("body is not JSON", { status: 400 });
  }
  const p = parse(json);
  if (!p.ok) return new Response("ok", { status: 200 }); // 2xx so Photon doesn't retry what we'll never handle

  // Keys and ids are keyed hashes: no Photon ids or raw handles are stored or served.
  const key = createHash("sha256").update(p.id).digest("hex");
  const id = opaque(cfg.webhookSecret, "m_", p.id);
  const msg: Message = {
    id,
    from: { participantId: opaque(cfg.webhookSecret, "p_", normalize(p.sender)), display: maskHandle(normalize(p.sender)) },
    body: p.body,
    receivedAt: now().toISOString(),
    action: "pending",
    reason: null,
    verdict: null,
    kind: p.kind,
  };
  if (!(await store.insert(key, msg))) return new Response("ok", { status: 200 }); // duplicate delivery

  if (!p.body) {
    await store.update(id, { action: "delivered", reason: "not_classified", verdict: null });
    return new Response("ok", { status: 200 });
  }
  try {
    const verdict = await classify(cfg, id, p.body, deps.fetch ?? fetch);
    await store.update(id, { action: verdict.score >= cfg.blockThreshold ? "blocked" : "delivered", reason: "model_verdict", verdict });
  } catch (err) {
    console.warn(`[webhook] ${id}: classifier unavailable (${(err as Error).message}); delivered unverified`);
    await store.update(id, { action: "delivered", reason: "classifier_unavailable", verdict: null });
  }
  return new Response("ok", { status: 200 });
}
