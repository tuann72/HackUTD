import { describe, expect, it } from "vitest";
import { messageStats } from "../stats";
import type { Message, Verdict } from "../types";

const verdict = (score: number, category: string | null = null): Verdict => ({
  label: score >= 0.5 ? "scam" : "legit",
  score,
  category,
  model: "test",
  highlights: [],
});

let n = 0;
function msg(over: Partial<Message> & { sender?: string }): Message {
  n += 1;
  const sender = over.sender ?? "a";
  return {
    id: `m${n}`,
    from: { participantId: `p-${sender}`, display: `***-***-${sender.padStart(4, "0")}` },
    body: "hi",
    receivedAt: `2026-11-08T00:00:${String(n % 60).padStart(2, "0")}.000Z`,
    action: "delivered",
    reason: "model_verdict",
    verdict: verdict(0.1),
    ...over,
  };
}

describe("messageStats", () => {
  it("is empty-safe", () => {
    const s = messageStats([]);
    expect(s).toMatchObject({ total: 0, blocked: 0, delivered: 0, pending: 0, blockRate: null, avgScore: null, span: null });
    expect(s.senders).toEqual([]);
    expect(s.scores.map((b) => b.count)).toEqual(Array(10).fill(0));
  });

  it("counts outcomes, block rate (pending excluded) and average score", () => {
    const s = messageStats([
      msg({ action: "blocked", verdict: verdict(0.9, "Imposter & Phishing") }),
      msg({ action: "blocked", verdict: verdict(0.7, "Imposter & Phishing") }),
      msg({ action: "delivered", verdict: verdict(0.2) }),
      msg({ action: "pending", reason: null, verdict: null }),
    ]);
    expect(s).toMatchObject({ total: 4, blocked: 2, delivered: 1, pending: 1 });
    expect(s.blockRate).toBeCloseTo(2 / 3);
    expect(s.avgScore).toBeCloseTo(0.6);
    expect(s.outcomes[0]).toEqual({ key: "blocked", label: "Blocked", count: 2 });
    expect(s.reasons.find((r) => r.key === "pending")?.count).toBe(1);
  });

  it("puts scores in tenths, with 1.0 in the top bucket", () => {
    const s = messageStats([msg({ verdict: verdict(0) }), msg({ verdict: verdict(0.55) }), msg({ verdict: verdict(1) })]);
    expect(s.scores.map((b) => b.count)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("counts categories of blocked messages only, most common first", () => {
    const s = messageStats([
      msg({ action: "blocked", verdict: verdict(0.9, "Loans, Credit & Debt") }),
      msg({ action: "blocked", verdict: verdict(0.9, "Imposter & Phishing") }),
      msg({ action: "blocked", verdict: verdict(0.9, "Imposter & Phishing") }),
      msg({ action: "delivered", verdict: verdict(0.3, "Loans, Credit & Debt") }),
      msg({ action: "blocked", reason: "sender_blocked", verdict: null }),
    ]);
    expect(s.categories).toEqual([
      { key: "Imposter & Phishing", label: "Imposter & Phishing", count: 2 },
      { key: "Loans, Credit & Debt", label: "Loans, Credit & Debt", count: 1 },
    ]);
  });

  it("defaults missing kinds to text", () => {
    const s = messageStats([msg({}), msg({ kind: "album" }), msg({ kind: "text" })]);
    expect(s.kinds[0]).toMatchObject({ key: "text", count: 2 });
    expect(s.kinds[1]).toMatchObject({ key: "album", label: "Photos / album", count: 1 });
  });

  it("ranks senders by messages, then by blocked", () => {
    const s = messageStats([
      msg({ sender: "1" }),
      msg({ sender: "2", action: "blocked" }),
      msg({ sender: "2" }),
      msg({ sender: "3", action: "blocked" }),
      msg({ sender: "1" }),
    ]);
    expect(s.senders.map((x) => [x.display, x.total, x.blocked])).toEqual([
      ["***-***-0002", 2, 1],
      ["***-***-0001", 2, 0],
      ["***-***-0003", 1, 1],
    ]);
  });
});
