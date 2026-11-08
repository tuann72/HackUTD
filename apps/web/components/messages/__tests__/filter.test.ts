import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/messages";
import { activeFilterCount, applyFilters, categoryOptions, DEFAULT_FILTERS, KNOWN_SENDER, type Filters } from "../filter";

let n = 0;
const msg = (over: Partial<Message> & { score?: number; category?: string | null; warning?: "large_money_request" }): Message => {
  const { score, category, warning, ...rest } = over;
  n += 1;
  return {
    id: `m${n}`,
    from: { participantId: `p${n}`, display: "***-***-0000" },
    body: "hello",
    receivedAt: new Date(Date.UTC(2026, 10, 8, 12, n)).toISOString(),
    action: "delivered",
    reason: "model_verdict",
    verdict:
      score == null
        ? null
        : { label: score >= 0.5 ? "scam" : "legit", score, category: category ?? null, model: "m", highlights: [], ...(warning ? { warning } : {}) },
    ...rest,
  };
};

const f = (over: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...over });

const ok = msg({ score: 0.1, body: "Lunch at noon?", from: { participantId: "a", display: "***-***-1111" } });
const money = msg({ score: 0.3, body: "Send me $900 today", warning: "large_money_request" });
const phish = msg({ action: "blocked", score: 0.97, category: "Imposter & Phishing", body: "Your bank account is locked" });
const prize = msg({ action: "blocked", score: 0.8, category: "Prizes, Lotteries & Advance-Fee", body: "You won" });
const known = msg({ action: "blocked", reason: "sender_blocked", body: "again" });
const down = msg({ reason: "classifier_unavailable", body: "unverified" });
const pending = msg({ action: "pending", reason: null, body: "checking" });
const all = [ok, money, phish, prize, known, down, pending];
const ids = (ms: Message[]) => ms.map((m) => m.id);

describe("applyFilters", () => {
  it("splits inbox (with pending) from blocked", () => {
    expect(ids(applyFilters(all, f({ view: "blocked" })))).toEqual(ids([known, prize, phish]));
    expect(ids(applyFilters(all, f({ view: "inbox" })))).toEqual(ids([pending, down, money, ok]));
  });

  it("puts pending first, then newest first by default", () => {
    expect(applyFilters(all, f({}))[0]).toBe(pending);
    expect(ids(applyFilters(all, f({ sort: "oldest" })))).toEqual(ids([pending, ok, money, phish, prize, known, down]));
  });

  it("sorts by score with scoreless messages last", () => {
    expect(ids(applyFilters(all, f({ view: "blocked", sort: "score" })))).toEqual(ids([phish, prize, known]));
  });

  it("matches every search word against sender, text and category", () => {
    expect(applyFilters(all, f({ query: "bank LOCKED" }))).toEqual([phish]);
    expect(applyFilters(all, f({ query: "1111" }))).toEqual([ok]);
    expect(applyFilters(all, f({ query: "imposter" }))).toEqual([phish]);
    expect(applyFilters(all, f({ query: "bank noon" }))).toEqual([]);
  });

  it("filters by category, including known scam senders", () => {
    expect(applyFilters(all, f({ category: "Imposter & Phishing" }))).toEqual([phish]);
    expect(applyFilters(all, f({ category: KNOWN_SENDER }))).toEqual([known]);
  });

  it("requires every flag that is on", () => {
    expect(applyFilters(all, f({ flags: ["money"] }))).toEqual([money]);
    expect(applyFilters(all, f({ flags: ["unchecked"] }))).toEqual([down]);
    expect(applyFilters(all, f({ flags: ["money", "unchecked"] }))).toEqual([]);
  });
});

describe("categoryOptions", () => {
  it("lists blocked categories, most common first", () => {
    const extra = msg({ action: "blocked", score: 0.9, category: "Imposter & Phishing" });
    expect(categoryOptions([...all, extra])).toEqual([
      { key: "Imposter & Phishing", count: 2 },
      { key: KNOWN_SENDER, count: 1 },
      { key: "Prizes, Lotteries & Advance-Fee", count: 1 },
    ]);
  });
});

describe("activeFilterCount", () => {
  it("ignores the view tab and counts the rest", () => {
    expect(activeFilterCount(f({ view: "blocked" }))).toBe(0);
    expect(activeFilterCount(f({ query: " x ", category: "c", flags: ["group", "money"], sort: "score" }))).toBe(5);
  });
});
