import { describe, expect, it, vi } from "vitest";
import { handleWebhook, MemoryStore, type InboxConfig } from "../inbox";
import { scenarioSteps } from "../../sim/plan";
import { buildPayload, createLimiter, handleSimulate, parseStep, signBody, simConfigFromEnv, type SimConfig } from "../simulate";

const SECRET = "sim-secret";
const NOW = new Date("2026-11-08T15:04:05Z");
const cfg: SimConfig = { url: "https://gw.example/webhooks/photon", secret: SECRET, line: "+15555550100", disabledReason: null };
const post = (body: unknown) => new Request("https://site/api/simulate", { method: "POST", body: JSON.stringify(body) });

describe("simConfigFromEnv", () => {
  it("defaults to the page's gateway and the Photon secret", () => {
    const c = simConfigFromEnv({ NEXT_PUBLIC_API_URL: "https://gw.example/", PHOTON_WEBHOOK_SECRET: "p" });
    expect(c).toMatchObject({ url: "https://gw.example/webhooks/photon", secret: "p", disabledReason: null });
  });
  it("prefers SIM_* overrides", () => {
    const c = simConfigFromEnv({ NEXT_PUBLIC_API_URL: "https://a", SIM_WEBHOOK_URL: "https://b/w", PHOTON_WEBHOOK_SECRET: "p", SIM_WEBHOOK_SECRET: "s" });
    expect(c).toMatchObject({ url: "https://b/w", secret: "s" });
  });
  it("is off without a target or secret, and refuses Photon URLs", () => {
    expect(simConfigFromEnv({}).disabledReason).toMatch(/No gateway/);
    expect(simConfigFromEnv({ NEXT_PUBLIC_API_URL: "https://a" }).disabledReason).toMatch(/secret/);
    const photon = simConfigFromEnv({ SIM_WEBHOOK_URL: "https://api.photon.codes/x", SIM_WEBHOOK_SECRET: "s" });
    expect(photon).toMatchObject({ url: null, secret: null });
    expect(photon.disabledReason).toMatch(/Photon/);
  });
});

describe("parseStep", () => {
  it("accepts text and scenario content", () => {
    expect(parseStep({ from: "+15555550142", body: "hi" })).toEqual({ from: "+15555550142", body: "hi" });
    for (const s of scenarioSteps("imessage-demo")) {
      const { delayMs, expected, ...step } = s;
      void delayMs;
      void expected;
      expect(() => parseStep(step)).not.toThrow();
    }
  });
  it("rejects real numbers, long text and bad content", () => {
    expect(() => parseStep({ from: "+12145550142", body: "hi" })).toThrow(/fictional/);
    expect(() => parseStep({ from: "+15555550142", body: "x".repeat(1001) })).toThrow(/1000/);
    expect(() => parseStep({ from: "+15555550142", body: "  " })).toThrow();
    expect(() => parseStep({ from: "+15555550142", content: { type: "contact", phones: ["+12145551234"] } })).toThrow(/fictional/);
    expect(() => parseStep({ from: "+15555550142", content: { type: "group", items: [{ type: "group", items: [] }] } })).toThrow(/nest/);
    expect(() => parseStep({ from: "+15555550142", body: "a", group: "../x" })).toThrow(/group/);
  });
});

describe("handleSimulate", () => {
  it("signs a Photon-format webhook that the Vercel receiver accepts and classifies", async () => {
    const store = new MemoryStore();
    const inboxCfg: InboxConfig = { webhookSecret: SECRET, classifierUrl: null, classifierToken: null, classifierTimeoutMs: 100, blockThreshold: 0.5 };
    const forward = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      handleWebhook(new Request(String(url), init), { cfg: inboxCfg, store, now: () => NOW }),
    ) as unknown as typeof fetch;
    const send = (body: unknown) => handleSimulate(post(body), { cfg, fetch: forward, now: () => NOW, allow: () => true });

    expect((await send({ from: "+15555550142", body: "Your account is locked. Verify now at bit.ly/acct-verify" })).status).toBe(200);
    expect((await send({ from: "+15555550110", body: "See you at dinner" })).status).toBe(200);
    const actions = Object.fromEntries((await store.list(10)).map((m) => [m.body, m.action]));
    expect(actions).toEqual({ "Your account is locked. Verify now at bit.ly/acct-verify": "blocked", "See you at dinner": "delivered" });
  });

  it("explains a secret mismatch and an unreachable gateway", async () => {
    const r401 = await handleSimulate(post({ from: "+15555550142", body: "hi" }), { cfg, fetch: (async () => new Response("no", { status: 401 })) as typeof fetch, allow: () => true });
    expect(r401.status).toBe(502);
    expect((await r401.json()).error).toMatch(/secret/);
    const down = await handleSimulate(post({ from: "+15555550142", body: "hi" }), { cfg, fetch: (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch, allow: () => true });
    expect((await down.json()).error).toMatch(/unreachable/);
  });

  it("returns 503 when off, 400 on bad input and 429 over the rate limit", async () => {
    const off = { ...cfg, url: null, secret: null, disabledReason: "off" };
    expect((await handleSimulate(post({}), { cfg: off })).status).toBe(503);
    const ok = (async () => new Response("ok")) as typeof fetch;
    expect((await handleSimulate(post({ from: "+1", body: "x" }), { cfg, fetch: ok, allow: () => true })).status).toBe(400);
    const allow = createLimiter(2, 60_000);
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await handleSimulate(post({ from: "+15555550142", body: "x" }), { cfg, fetch: ok, allow, now: () => NOW })).status);
    expect(codes).toEqual([200, 200, 429]);
  });

  it("builds the CLI's payload shape with fresh ids", () => {
    const a = buildPayload({ from: "+15555550142", body: "hi" }, "+15555550100", NOW);
    const b = buildPayload({ from: "+15555550142", body: "hi" }, "+15555550100", NOW);
    expect(a.message.id).toMatch(/^spc-msg-/);
    expect(a.message.id).not.toBe(b.message.id);
    expect(a).toMatchObject({ event: "messages", space: { type: "dm", phone: "+15555550100" }, message: { content: { type: "text", text: "hi" } } });
    expect(signBody("k", "1", "b")).toMatch(/^v0=[0-9a-f]{64}$/);
  });
});
