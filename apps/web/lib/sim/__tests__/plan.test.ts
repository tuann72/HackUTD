import { describe, expect, it } from "vitest";
import { PRESETS } from "../presets";
import { isFictionalNumber, presetSteps, RAPID_ROWS, randomSteps, scenarioSteps, SCENARIO_IDS, SENDER_POOL } from "../plan";

const base = { n: 10, scamRatio: 0.6, intervalMs: 1500, from: "", seed: 42 };

describe("simulation plan", () => {
  it("draws round(n × ratio) scams, repeatably for a seed", () => {
    const a = randomSteps(base);
    expect(a).toHaveLength(10);
    expect(a.filter((s) => s.expected === "block")).toHaveLength(6);
    expect(randomSteps(base)).toEqual(a);
    expect(randomSteps({ ...base, seed: 7 })).not.toEqual(a);
    expect(a[0]!.delayMs).toBe(0);
    expect(a.slice(1).every((s) => s.delayMs === 1500)).toBe(true);
    expect(a.every((s) => isFictionalNumber(s.from) && s.body)).toBe(true);
  });

  it("clamps count and interval, and uses a fixed sender when given", () => {
    const s = randomSteps({ ...base, n: 999, intervalMs: 1, from: "+15555550150" });
    expect(s).toHaveLength(50);
    expect(s[1]!.delayMs).toBe(100);
    expect(new Set(s.map((x) => x.from))).toEqual(new Set(["+15555550150"]));
  });

  it("keeps the CLI's sender pool, without the scenario numbers", () => {
    expect(SENDER_POOL).toHaveLength(78);
    expect(SENDER_POOL.every(isFictionalNumber)).toBe(true);
    expect(SENDER_POOL).not.toContain("+15555550142");
  });

  it("presets use their own count, ratio and interval", () => {
    const scam = PRESETS.find((p) => p.id === "one-scam")!;
    const steps = presetSteps(scam, { ...base, n: 30, scamRatio: 0 });
    expect(steps).toHaveLength(1);
    expect(steps[0]!.expected).toBe("block");

    const rapid = presetSteps(PRESETS.find((p) => p.id === "rapid")!, base);
    expect(rapid).toHaveLength(50);
    expect(rapid.slice(1).every((s) => s.delayMs === 100)).toBe(true);
    expect(rapid.filter((s) => s.expected === "block")).toHaveLength(20);
  });

  it("Rapid fire draws only from its 200-sentence dataset, 40% scam, without repeats", () => {
    expect(RAPID_ROWS).toHaveLength(200);
    expect(RAPID_ROWS.filter((r) => r.label === "scam")).toHaveLength(80);
    expect(RAPID_ROWS.every((r) => /^[A-Z].*[.?!]$/.test(r.text))).toBe(true);
    const rapid = presetSteps(PRESETS.find((p) => p.id === "rapid")!, base);
    const texts = new Set(RAPID_ROWS.map((r) => r.text));
    expect(rapid.every((s) => texts.has(s.body!))).toBe(true);
    expect(new Set(rapid.map((s) => s.body)).size).toBe(50);
    // The other random presets keep the main bank.
    const burst = presetSteps(PRESETS.find((p) => p.id === "burst")!, base);
    expect(burst.some((s) => !texts.has(s.body!))).toBe(true);
  });

  it("every scenario preset exists in the copied bank", () => {
    for (const p of PRESETS) if (p.kind === "scenario") expect(SCENARIO_IDS).toContain(p.scenario);
    expect(scenarioSteps("smoke")).toHaveLength(3);
    expect(() => scenarioSteps("nope")).toThrow(/unknown scenario/);
  });
});
