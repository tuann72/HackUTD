import { describe, expect, it } from "vitest";
import { HAND, SLAPS, contactTime, palmAt, pickSlap, slapAngle, slapDuration, type SlapName } from "../slap";

const names = Object.keys(SLAPS) as SlapName[];

describe("slap clips", () => {
  it.each(names)("%s starts and ends upright and hits its angle at contact", (name) => {
    const clip = SLAPS[name];
    expect(slapAngle(clip, 0)).toBe(0);
    expect(slapAngle(clip, slapDuration(clip))).toBe(0);
    expect(slapAngle(clip, slapDuration(clip) - 1e-6)).toBeCloseTo(0, 4);
    expect(slapAngle(clip, contactTime(clip))).toBeCloseTo(clip.angle, 6);
  });

  it.each(names)("%s winds up away from the sender, then swings toward it", (name) => {
    const clip = SLAPS[name];
    expect(slapAngle(clip, clip.wind)).toBeLessThan(0);
    expect(slapAngle(clip, contactTime(clip))).toBeGreaterThan(0);
  });

  it.each(names)("%s overshoots past contact during recovery", (name) => {
    const clip = SLAPS[name];
    const t = contactTime(clip) + clip.hold + clip.recover * 0.24;
    expect(slapAngle(clip, t)).toBeCloseTo(clip.angle + clip.overshoot, 6);
  });

  it("does not move continuously at the phase boundaries", () => {
    for (const name of names) {
      const clip = SLAPS[name];
      const edges = [clip.wind, contactTime(clip), contactTime(clip) + clip.hold];
      for (const e of edges) expect(Math.abs(slapAngle(clip, e - 1e-6) - slapAngle(clip, e + 1e-6))).toBeLessThan(1e-3);
    }
  });
});

describe("palm and picking", () => {
  it("puts the palm straight above the pivot when upright and to the sender's side when slapping", () => {
    expect(palmAt(0)).toEqual({ x: HAND.pivotX, y: HAND.pivotY + HAND.palmRadius });
    expect(palmAt(SLAPS.slap.angle).x).toBeLessThan(HAND.pivotX);
  });

  it("is deterministic and uses every slap", () => {
    const picks = Array.from({ length: 70 }, (_, i) => pickSlap(i));
    expect(picks).toEqual(Array.from({ length: 70 }, (_, i) => pickSlap(i)));
    expect(new Set(picks)).toEqual(new Set(names));
    expect(picks.filter((p) => p === "slap").length).toBeGreaterThan(picks.length / 2);
  });
});
