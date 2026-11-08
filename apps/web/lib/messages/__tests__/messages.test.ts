import { describe, expect, it, vi } from "vitest";
import { ActionError } from "../actions";
import { diffMessages } from "../diff";
import { liveSource, replaySource, staticSource } from "../source";
import type { Message } from "../types";

const msg = (id: string, action: Message["action"]): Message => ({
  id,
  from: { participantId: "p", display: "***-***-0000" },
  body: "hi",
  receivedAt: "2026-11-07T00:00:00.000Z",
  action,
  reason: action === "pending" ? null : "model_verdict",
  verdict: null,
});

describe("diffMessages", () => {
  it("emits received for new and resolved for pending -> final, oldest first", () => {
    const prev = [msg("a", "pending")];
    const next = [msg("b", "pending"), msg("a", "blocked")];
    expect(diffMessages(prev, next).map((c) => `${c.type}:${c.message.id}`)).toEqual(["resolved:a", "received:b"]);
  });
  it("emits received then resolved for a message that arrives already final", () => {
    expect(diffMessages([], [msg("a", "delivered")]).map((c) => c.type)).toEqual(["received", "resolved"]);
  });
  it("emits nothing when unchanged", () => {
    const l = [msg("a", "delivered")];
    expect(diffMessages(l, l)).toEqual([]);
  });
});

describe("replaySource", () => {
  it("releases messages over time, pending first, then the fixture action", async () => {
    let t = 0;
    const src = replaySource({ everyMs: 1000, pendingMs: 500, now: () => t });
    let list = await src.fetch();
    expect(list).toHaveLength(1);
    expect(list[0].action).toBe("pending");
    t = 600;
    list = await src.fetch();
    expect(list[0].action).not.toBe("pending");
    t = 2100;
    list = await src.fetch();
    expect(list).toHaveLength(3);
    expect(list[0].action).toBe("pending"); // newest first
  });
  it("loops with unique ids", async () => {
    let t = 0;
    const src = replaySource({ everyMs: 10, pendingMs: 1, now: () => t });
    const n = (await staticSource().fetch()).length;
    t = 10 * (n * 2);
    const ids = (await src.fetch()).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(n);
  });
  it("never emits a final message without a reason", async () => {
    let t = 0;
    const src = replaySource({ everyMs: 10, pendingMs: 1, now: () => t });
    t = 1000;
    for (const m of await src.fetch()) {
      if (m.action !== "pending") expect(m.reason).not.toBeNull();
    }
  });
});

describe("replaySource.clear", () => {
  it("empties the list, then keeps replaying with fresh ids", async () => {
    let t = 0;
    const src = replaySource({ everyMs: 10, pendingMs: 1, now: () => t });
    t = 25;
    expect((await src.fetch()).length).toBe(3);
    const before = new Set((await src.fetch()).map((m) => m.id));
    await src.clear!();
    expect(await src.fetch()).toEqual([]);
    t = 31;
    const after = await src.fetch();
    expect(after.length).toBe(1);
    expect(before.has(after[0].id)).toBe(false);
  });
});

describe("liveSource.clear", () => {
  it("sends the password and throws ActionError on a 401", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    let status = 401;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify(status === 200 ? { ok: true, cleared: 1 } : { error: "wrong password" }), { status });
    });
    try {
      const src = liveSource("https://gw.example/");
      const err = await src.clear!("1234").catch((e) => e);
      expect(err).toBeInstanceOf(ActionError);
      expect(err.status).toBe(401);
      status = 200;
      await src.clear!("4321");
      expect(calls.map(([u, i]) => [u, i?.method, (i?.headers as Record<string, string>)["X-Action-Password"]])).toEqual([
        ["https://gw.example/api/messages", "DELETE", "1234"],
        ["https://gw.example/api/messages", "DELETE", "4321"],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
