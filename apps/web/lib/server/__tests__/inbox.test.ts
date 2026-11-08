import { describe, expect, it } from "vitest";
import { handleWebhook, MemoryStore, spectrumSignature, standardSignature, type InboxConfig } from "../inbox";

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

describe("Vercel Photon webhook, Photon 2.0 / Beta deliveries", () => {
  const WHSEC = "whsec_" + Buffer.from("beta-signing-key").toString("base64");
  const betaCfg = { ...cfg, webhookSecret: WHSEC };

  function betaEvent(msgId: string, content: unknown, handle = "+15555550142", type = "message.received") {
    return {
      id: `pho_evt_${msgId}`,
      type,
      apiVersion: "2026-07-01",
      source: "imessage.photon",
      timestamp: NOW.toISOString(),
      data: {
        projectId: "pho_prj_1",
        object: { id: `pho_msg_${msgId}`, platform: "imessage", status: "received", sentBy: { handle, platform: "imessage" }, space: { id: "pho_spc_1" }, content },
      },
    };
  }
  function betaReq(body: unknown, secret = WHSEC, extraSig = "") {
    const raw = JSON.stringify(body);
    const id = (body as { id: string }).id;
    const ts = String(Math.floor(NOW.getTime() / 1000));
    const sig = `v1,${standardSignature(secret, id, ts, raw)}`;
    return new Request("https://x/webhooks/photon", {
      method: "POST",
      headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": extraSig ? `${extraSig} ${sig}` : sig },
      body: raw,
    });
  }
  const runBeta = (r: Request, store = new MemoryStore()) => handleWebhook(r, { cfg: betaCfg, store, now: () => NOW });

  it("verifies Standard Webhooks signatures, including the second one during a rotation", async () => {
    const store = new MemoryStore();
    expect((await runBeta(betaReq(betaEvent("1", { type: "text", format: "plain", text: "Your account is locked, verify at bit.ly/x" })), store)).status).toBe(200);
    expect((await runBeta(betaReq(betaEvent("2", { type: "text", format: "plain", text: "see you at dinner" }), WHSEC, "v1,b2xkLXNpZw=="), store)).status).toBe(200);
    expect((await runBeta(betaReq(betaEvent("3", { type: "text", format: "plain", text: "x" }), "whsec_" + Buffer.from("wrong").toString("base64")))).status).toBe(401);
    const byBody = Object.fromEntries((await store.list(10)).map((m) => [m.body, m]));
    expect(byBody["Your account is locked, verify at bit.ly/x"]).toMatchObject({ action: "blocked", reason: "model_verdict", from: { display: "***-***-0142" } });
    expect(byBody["see you at dinner"]).toMatchObject({ action: "delivered", reason: "model_verdict" });
    expect(JSON.stringify(await store.list(10))).not.toMatch(/pho_msg_|\+15555550142/);
  });

  it("classifies album text, skips the model for attachments, ignores other events, dedupes retries", async () => {
    const store = new MemoryStore();
    const album = { type: "group", parts: [{ type: "text", format: "plain", text: "Claim your prize now" }, { type: "attachment", attachmentId: "pho_att_1" }] };
    await runBeta(betaReq(betaEvent("4", album)), store);
    await runBeta(betaReq(betaEvent("5", { type: "attachment", attachmentId: "pho_att_2" }, "jane@icloud.com")), store);
    await runBeta(betaReq(betaEvent("5", { type: "attachment", attachmentId: "pho_att_2" }, "jane@icloud.com")), store);
    expect((await runBeta(betaReq(betaEvent("6", { type: "text", format: "plain", text: "hi" }, "+1", "message.delivered")), store)).status).toBe(200);
    expect((await runBeta(betaReq(betaEvent("7", { type: "message.read" })), store)).status).toBe(200);
    const rows = await store.list(10);
    expect(rows).toHaveLength(2);
    expect(rows.map((m) => [m.kind, m.reason, m.from.display])).toEqual(
      expect.arrayContaining([["album", "model_verdict", "***-***-0142"], ["attachment", "not_classified", "j***@icloud.com"]]),
    );
  });
});
