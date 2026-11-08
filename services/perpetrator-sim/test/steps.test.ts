import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isFictionalNumber } from "../src/safety.ts";
import {
  BANK_FILES,
  loadBank,
  loadScenario,
  parseScenario,
  RANDOM_SENDERS,
  randomSteps,
  resolveScenarioPath,
  SCENARIO_DIR,
} from "../src/steps.ts";

describe("scenario parser", () => {
  it("parses every scenario file in data/message_bank/scenarios", () => {
    const files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".jsonl"));
    expect(files).toEqual(expect.arrayContaining(["grandparent.jsonl", "smoke.jsonl"]));
    for (const f of files) {
      const steps = loadScenario(f);
      expect(steps.length).toBeGreaterThan(0);
      for (const s of steps) expect(isFictionalNumber(s.from)).toBe(true);
    }
  });

  it("loads the grandparent story as specified", () => {
    const steps = loadScenario("grandparent.jsonl");
    expect(steps.map((s) => s.expected)).toEqual(["deliver", "deliver", "block", "block", "deliver"]);
    expect(steps.map((s) => s.delayMs).reduce((a, b) => a + b)).toBe(25_000);
    expect(steps[2]!.from).toBe("+15555550142");
  });

  it("smoke has 3 steps 500ms apart", () => {
    expect(loadScenario("smoke").map((s) => s.delayMs)).toEqual([0, 500, 500]);
  });

  it("resolves by name or by given path", () => {
    const p = join(SCENARIO_DIR, "smoke.jsonl");
    expect(resolveScenarioPath("smoke.jsonl")).toBe(p);
    expect(resolveScenarioPath(p)).toBe(p);
    expect(() => resolveScenarioPath("nope.jsonl")).toThrow(/not found/);
  });

  it("skips blank lines and rejects bad rows", () => {
    expect(parseScenario('{"delayMs":0,"from":"+15555550101","body":"hi"}\n\n')).toHaveLength(1);
    expect(() => parseScenario('{"delayMs":-1,"from":"+15555550101","body":"hi"}')).toThrow(/delayMs/);
    expect(() => parseScenario('{"delayMs":0,"from":"+15555550101","body":""}')).toThrow(/body/);
    expect(() => parseScenario('{"delayMs":0,"from":"+15555550101","body":"x","expected":"maybe"}')).toThrow(
      /expected/,
    );
    expect(() => parseScenario("{not json")).toThrow(/invalid JSON/);
  });
});

describe("message bank", () => {
  const bank = loadBank();

  it("has well-formed rows", () => {
    expect(bank.length).toBeGreaterThan(100);
    const ids = new Set<string>();
    for (const r of bank) {
      expect(["scam", "legit"]).toContain(r.expected_label);
      expect(["dataset_test", "generated"]).toContain(r.source);
      expect(typeof r.text).toBe("string");
      expect(r.category === null).toBe(r.expected_label === "legit");
      expect(r.source_id === null).toBe(r.source === "generated");
      ids.add(r.id);
    }
    expect(ids.size).toBe(bank.length);
  });

  it("uses only category names from data/scam_categories.csv", () => {
    const csv = readFileSync(join(SCENARIO_DIR, "../../scam_categories.csv"), "utf8");
    const names = csv
      .split("\n")
      .slice(1)
      .filter(Boolean)
      .map((l) => (l.split(",")[1]!.startsWith('"') ? l.split('"')[1]! : l.split(",")[1]!));
    for (const r of bank) if (r.category) expect(names).toContain(r.category);
  });

  it("reads both bank files", () => {
    expect(BANK_FILES).toHaveLength(2);
  });
});

describe("random mode", () => {
  const bank = loadBank();
  const opts = { n: 20, scamRatio: 0.6, seed: 42, intervalMs: 1500 };

  it("is repeatable for the same seed", () => {
    expect(randomSteps(bank, opts)).toEqual(randomSteps(bank, opts));
  });

  it("differs for a different seed", () => {
    expect(randomSteps(bank, { ...opts, seed: 43 })).not.toEqual(randomSteps(bank, opts));
  });

  it("respects the scam ratio", () => {
    for (const [n, ratio] of [
      [20, 0.6],
      [10, 0],
      [10, 1],
      [7, 0.5],
    ] as const) {
      const steps = randomSteps(bank, { ...opts, n, scamRatio: ratio });
      expect(steps).toHaveLength(n);
      expect(steps.filter((s) => s.expected === "block")).toHaveLength(Math.round(n * ratio));
    }
  });

  it("uses fictional senders and the interval", () => {
    const steps = randomSteps(bank, opts);
    for (const s of steps) {
      expect(s.from).toMatch(/^\+155555501[2-9]\d$/);
      expect(["+15555550142", "+15555550177"]).not.toContain(s.from);
    }
    expect(RANDOM_SENDERS).toHaveLength(78);
    expect(steps.map((s) => s.delayMs)).toEqual([0, ...Array(19).fill(1500)]);
  });

  it("wraps around when n exceeds the pool", () => {
    expect(randomSteps(bank, { ...opts, n: 500 })).toHaveLength(500);
  });

  it("rejects bad options", () => {
    expect(() => randomSteps(bank, { ...opts, scamRatio: 1.5 })).toThrow();
    expect(() => randomSteps(bank, { ...opts, n: 0 })).toThrow();
  });
});
