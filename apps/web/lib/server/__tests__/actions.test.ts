import { describe, expect, it } from "vitest";
import type { Message } from "../../messages/types";
import { actionPassword, checkActionPassword, handleBlocklistClear, handleBlocklistStatus, handleUnblock, passwordMatches } from "../actions";
import { MemoryStore } from "../inbox";

const env = (UI_ACTION_PASSWORD?: string) => ({ UI_ACTION_PASSWORD }) as unknown as NodeJS.ProcessEnv;
const req = (password?: string) =>
  new Request("https://x/api/anything", { method: "POST", headers: password === undefined ? {} : { "X-Action-Password": password } });

const msg = (id: string, action: Message["action"]): Message => ({
  id,
  from: { participantId: "p_1", display: "***-***-0142" },
  body: "Your account is locked",
  receivedAt: "2026-11-08T15:00:00Z",
  action,
  reason: action === "blocked" ? "model_verdict" : null,
  verdict: action === "blocked" ? { label: "scam", score: 0.97, category: "Imposter & Phishing", model: "m@1", highlights: [] } : null,
});

async function storeWith(...ms: Message[]) {
  const store = new MemoryStore();
  for (const m of ms) await store.insert(m.id, m);
  return store;
}

describe("action password", () => {
  it("defaults to 4321, also when the env var is empty", () => {
    expect(actionPassword(env())).toBe("4321");
    expect(actionPassword(env(""))).toBe("4321");
    expect(actionPassword(env("9999"))).toBe("9999");
  });

  it("compares exactly", () => {
    expect(passwordMatches("4321", "4321")).toBe(true);
    expect(passwordMatches("432", "4321")).toBe(false);
    expect(passwordMatches("43210", "4321")).toBe(false);
    expect(passwordMatches(null, "4321")).toBe(false);
  });

  it("401s a missing or wrong password with the contract body", async () => {
    for (const r of [req(), req("1234"), req("")]) {
      const res = checkActionPassword(r, env());
      expect(res?.status).toBe(401);
      expect(await res?.json()).toEqual({ error: "wrong password" });
    }
    expect(checkActionPassword(req("4321"), env())).toBeNull();
    expect(checkActionPassword(req("4321"), env("9999"))?.status).toBe(401);
  });
});

describe("POST /api/messages/:id/unblock (Vercel backup)", () => {
  it("moves a blocked message to the inbox as an override and keeps its verdict", async () => {
    const store = await storeWith(msg("m_a", "blocked"));
    const res = await handleUnblock(req("4321"), "m_a", { store: async () => store, env: env() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, messageId: "m_a", allowlisted: null });
    const m = await store.get("m_a");
    expect(m).toMatchObject({ action: "delivered", reason: "override", verdict: { score: 0.97, label: "scam" } });
  });

  it("checks the password before looking the message up", async () => {
    const store = await storeWith(msg("m_a", "blocked"));
    expect((await handleUnblock(req("nope"), "m_missing", { store: async () => store, env: env() })).status).toBe(401);
    expect((await handleUnblock(req(), "m_a", { store: async () => store, env: env() })).status).toBe(401);
    expect((await store.get("m_a"))?.action).toBe("blocked");
  });

  it("404s an unknown id and 409s a message that isn't blocked", async () => {
    const store = await storeWith(msg("m_d", "delivered"));
    expect((await handleUnblock(req("4321"), "m_missing", { store: async () => store, env: env() })).status).toBe(404);
    expect((await handleUnblock(req("4321"), "m_d", { store: async () => store, env: env() })).status).toBe(409);
  });
});

describe("blocklist routes (Vercel backup has no blocklist)", () => {
  it("reports the blocklist off", async () => {
    expect(await handleBlocklistStatus().json()).toEqual({ enabled: false, blockedSenders: 0 });
  });

  it("clears nothing, but still needs the password", async () => {
    expect(handleBlocklistClear(req("1"), env()).status).toBe(401);
    const res = handleBlocklistClear(req("4321"), env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cleared: 0, enabled: false });
  });
});
