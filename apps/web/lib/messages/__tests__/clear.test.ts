import { describe, expect, it } from "vitest";
import { hideCleared, newestReceivedAt } from "../clear";
import type { Message } from "../types";

const msg = (id: string, receivedAt: string): Message => ({
  id,
  from: { participantId: "p", display: "***-***-0000" },
  body: id,
  receivedAt,
  action: "delivered",
  reason: "model_verdict",
  verdict: null,
});

const a = msg("a", "2026-11-08T10:00:00.000Z");
const b = msg("b", "2026-11-08T10:05:00.000Z");
const c = msg("c", "2026-11-08T10:10:00.000Z");

describe("newestReceivedAt", () => {
  it("returns the latest timestamp regardless of order", () => {
    expect(newestReceivedAt([a, c, b])).toBe(c.receivedAt);
  });
  it("is null for an empty list", () => {
    expect(newestReceivedAt([])).toBeNull();
  });
});

describe("hideCleared", () => {
  it("hides nothing without a cutoff", () => {
    expect(hideCleared([c, b, a], null)).toEqual([c, b, a]);
    expect(hideCleared([c, b, a], "garbage")).toEqual([c, b, a]);
  });
  it("hides messages at or before the cutoff and keeps newer ones", () => {
    expect(hideCleared([c, b, a], b.receivedAt)).toEqual([c]);
  });
  it("hides everything when cleared at the newest message", () => {
    expect(hideCleared([c, b, a], newestReceivedAt([c, b, a]))).toEqual([]);
  });
});
