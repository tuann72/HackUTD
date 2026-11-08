import { describe, expect, it } from "vitest";
import { diffMessages } from "../diff";
import { replaySource, staticSource } from "../source";
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
