import { describe, expect, it } from "vitest";
import { FAST_SPEED, SLOW_END, SLOW_SPEED, SLOW_START, flightDistance, flightSpeed, flightTime, segmentTimes } from "../flight";

const N = 2000;
const ts = Array.from({ length: N + 1 }, (_, i) => i / N);

describe("flightDistance", () => {
  it("starts at 0 and ends at 1, clamping outside 0..1", () => {
    expect(flightDistance(0)).toBe(0);
    expect(flightDistance(1)).toBe(1);
    expect(flightDistance(-0.5)).toBe(0);
    expect(flightDistance(1.5)).toBe(1);
    expect(flightDistance(Number.NaN)).toBe(0);
  });

  it("is strictly increasing", () => {
    for (let i = 1; i <= N; i++) {
      expect(flightDistance(ts[i])).toBeGreaterThan(flightDistance(ts[i - 1]));
    }
  });

  it("is continuous (no jumps between close times)", () => {
    // Max speed is FAST_SPEED / average pace, so a step of 1/N moves at most a few / N.
    for (let i = 1; i <= N; i++) {
      expect(flightDistance(ts[i]) - flightDistance(ts[i - 1])).toBeLessThan(3 / N);
    }
  });

  it("inverts flightTime", () => {
    for (const d of [0.05, 0.3, 0.5, 0.7, 0.8, 0.95]) {
      expect(flightDistance(flightTime(d))).toBeCloseTo(d, 6);
    }
  });
});

describe("speed profile", () => {
  it("is fast on the outer segments and slow in the middle", () => {
    expect(flightSpeed(0.1)).toBe(FAST_SPEED);
    expect(flightSpeed(0.5)).toBe(SLOW_SPEED);
    expect(flightSpeed(0.9)).toBe(FAST_SPEED);
    expect(SLOW_SPEED / FAST_SPEED).toBeLessThanOrEqual(0.4);
  });

  it("spends clearly more time on the middle 40% than on either outer 30%", () => {
    const [start, middle, end] = segmentTimes();
    expect(start + middle + end).toBeCloseTo(1, 10);
    expect(middle).toBeGreaterThan(2 * start);
    expect(middle).toBeGreaterThan(2 * end);
    expect(middle).toBeGreaterThan(0.5);
  });

  it("has a higher average speed on the outer segments than in the middle", () => {
    const [start, middle, end] = segmentTimes();
    const startSpeed = SLOW_START / start;
    const middleSpeed = (SLOW_END - SLOW_START) / middle;
    const endSpeed = (1 - SLOW_END) / end;
    expect(startSpeed).toBeGreaterThan(2 * middleSpeed);
    expect(endSpeed).toBeGreaterThan(2 * middleSpeed);
  });
});
