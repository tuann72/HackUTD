import { describe, expect, it } from "vitest";
import { handleWebhook, MemoryStore, spectrumSignature, type InboxConfig } from "../inbox";

const SECRET = "test-secret";
const NOW = new Date("2026-11-08T15:04:05Z");
const cfg: InboxConfig = { webhookSecret: SECRET, classifierUrl: null, classifierToken: null, classifierTimeoutMs: 100, blockThreshold: 0.5 };

function event(id: string, content: unknown, from = "+15555550142") {
  return {
    event: "messages",
    space: { id: `any;-;${from}`, platform: "imessage", type: "dm", phone: "+15555550100" },
    message: { id, platform: "imessage", direction: "inbound", sender: { id: from, platform: "imessage" }, content },
  };
}

function req(body: unknown, secret = SECRET, ts = String(Math.floor(NOW.getTime() / 1000))) {
  const raw = JSON.stringify(body);
  return new Request("https://x/webhooks/photon", {
    method: "POST",
    headers: { "content-type": "application/json", "x-spectrum-timestamp": ts, "x-spectrum-signature": spectrumSignature(secret, ts, raw) },
    body: raw,
  });
}

const run = (r: Request, store = new MemoryStore(), extra: Partial<InboxConfig> = {}, f?: typeof fetch) =>
  handleWebhook(r, { cfg: { ...cfg, ...extra }, store, now: () => NOW, fetch: f });

describe("Vercel Photon webhook", () => {
  it("blocks a scam and delivers a legit message, with no raw handles or Photon ids", async () => {
    const store = new MemoryStore();
    expect((await run(req(event("spc-1", { type: "text", text: "Your account is locked. Verify now at bit.ly/acct-verify" })), store)).status).toBe(200);
    expect((await run(req(event("spc-2", { type: "text", text: "See you at dinner" })), store)).status).toBe(200);
    const [a, b] = await store.list(10);
    const byBody = Object.fromEntries([a, b].map((m) => [m!.body, m!]));
    expect(byBody["See you at dinner"]).toMatchObject({ action: "delivered", reason: "model_verdict" });
    expect(byBody["Your account is locked. Verify now at bit.ly/acct-verify"]).toMatchObject({ action: "blocked", reason: "model_verdict", kind: "text" });
    expect(a!.from).toEqual({ participantId: expect.stringMatching(/^p_[0-9a-f]{16}$/), display: "***-***-0142" });
    const json = JSON.stringify(await store.list(10));
    expect(json).not.toContain("+15555550142");
    expect(json).not.toContain("spc-1");
  });

  it("rejects a bad signature (401) and a stale timestamp (400)", async () => {
    const body = event("spc-3", { type: "text", text: "hi" });
    expect((await run(req(body, "wrong-secret"))).status).toBe(401);
    expect((await run(req(body, SECRET, String(Math.floor(NOW.getTime() / 1000) - 600)))).status).toBe(400);
  });

  it("stores a redelivered message once", async () => {
    const store = new MemoryStore();
    const body = event("spc-4", { type: "text", text: "hello" });
    await run(req(body), store);
    await run(req(body), store);
    expect(store.rows.size).toBe(1);
  });

  it("fails open when the classifier is down, and skips the model for attachments", async () => {
    const store = new MemoryStore();
    const down = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    await run(req(event("spc-5", { type: "text", text: "Wire the money now" })), store, { classifierUrl: "https://clf" }, down);
    await run(req(event("spc-6", { type: "attachment", id: "g", name: "a.jpg" })), store);
    const reasons = (await store.list(10)).map((m) => [m.kind, m.action, m.reason]);
    expect(reasons).toContainEqual(["text", "delivered", "classifier_unavailable"]);
    expect(reasons).toContainEqual(["attachment", "delivered", "not_classified"]);
  });

  it("acks other events without storing them, and refuses to run without a secret", async () => {
    const store = new MemoryStore();
    expect((await run(req({ event: "typing" }), store)).status).toBe(200);
    expect(store.rows.size).toBe(0);
    expect((await run(req(event("spc-7", { type: "text", text: "x" })), store, { webhookSecret: "" })).status).toBe(503);
  });
});
