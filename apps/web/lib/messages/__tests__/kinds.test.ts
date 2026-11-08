import { describe, expect, it } from "vitest";
import fixture from "../fixture.v1.json";
import { isGroupChat, isNotClassified, kindOf, summarize, type Message, type MessagesResponse } from "../types";

const base: Message = {
  id: "m",
  from: { participantId: "p", display: "***-***-0142" },
  body: "hello",
  receivedAt: "2026-11-08T00:00:00.000Z",
  action: "delivered",
  reason: "model_verdict",
  verdict: null,
};

describe("message kinds", () => {
  it("defaults missing v1 fields to a text DM", () => {
    expect(kindOf(base)).toBe("text");
    expect(isGroupChat(base)).toBe(false);
    expect(summarize(base)).toBe("hello");
  });

  it("summarizes non-text kinds", () => {
    const empty = { ...base, body: "", reason: "not_classified" as const };
    expect(summarize({ ...empty, kind: "reaction", reaction: { emoji: "❤️", targetPreview: "See you" } })).toBe("❤️ reacted to “See you”");
    expect(summarize({ ...empty, kind: "contact", contact: { name: "Bank", phones: [] } })).toBe("👤 Contact card: Bank");
    expect(summarize({ ...empty, kind: "attachment", attachments: [{ name: "a.jpg", mimeType: "image/jpeg", size: 1 }] })).toBe("📎 Photo");
    const two = [
      { name: "a", mimeType: "image/heic", size: null },
      { name: "b", mimeType: null, size: null },
    ];
    expect(summarize({ ...base, kind: "album", body: "Lake!", attachments: two })).toBe("📎 2 attachments Lake!");
    expect(isNotClassified(empty)).toBe(true);
  });

  it("labels every fixture message for the scene, with no empty labels", () => {
    for (const m of (fixture as MessagesResponse).messages) {
      expect(summarize(m).trim().length).toBeGreaterThan(0);
    }
    const kinds = new Set((fixture as MessagesResponse).messages.map(kindOf));
    expect(kinds).toEqual(new Set(["text", "reaction", "album", "contact"]));
    expect((fixture as MessagesResponse).messages.some(isGroupChat)).toBe(true);
  });
});

describe("blocklist reasons", () => {
  it("treats sender_blocked as a potential scam and override as not", async () => {
    const { isPotentialScam, isRestored, isSenderBlocked } = await import("../types");
    const sb: Message = { ...base, action: "blocked", reason: "sender_blocked", verdict: null };
    expect(isSenderBlocked(sb)).toBe(true);
    expect(isPotentialScam(sb)).toBe(true);
    const restored: Message = {
      ...base,
      reason: "override",
      verdict: { label: "scam", score: 0.97, category: null, model: "m", highlights: [] },
    };
    expect(isRestored(restored)).toBe(true);
    expect(isPotentialScam(restored)).toBe(false);
    expect((fixture as MessagesResponse).messages.some(isSenderBlocked)).toBe(true);
  });
});
