/**
 * The Receiver's hand: where it stands, how each slap moves, and where its palm
 * is, so a blocked message can meet the palm at the moment of contact.
 *
 * Timings and angles come from the T-GUARD offline prototype
 * (`src/animations/clips.js`, Tuan, 2026-11-08). Its canvas angles turn
 * clockwise; three.js `rotation.z` turns counterclockwise, so the sign is
 * flipped here: a positive angle swings the fingers left, toward the sender.
 */

export interface SlapClip {
  /** Seconds of anticipation: the hand leans back, away from the sender. */
  wind: number;
  /** Seconds from the wind-up to contact. */
  strike: number;
  /** Seconds held at contact. */
  hold: number;
  /** Seconds back to upright, through the overshoot. */
  recover: number;
  /** Radians at contact (positive = fingers toward the sender). */
  angle: number;
  /** Extra radians swung past contact during recovery. */
  overshoot: number;
  /** Shows the back of the hand (backhand.webp, mirrored). */
  dorsal?: boolean;
}

/** Strikes that hit toward the sender, from the prototype's slap-left, backhand and delayed clips. */
export const SLAPS = {
  slap: { wind: 0.16, strike: 0.065, hold: 0.025, recover: 0.3, angle: 0.72, overshoot: 0.2 },
  backhand: { wind: 0.12, strike: 0.055, hold: 0.035, recover: 0.38, angle: 0.92, overshoot: 0.28, dorsal: true },
  delayed: { wind: 0.85, strike: 0.045, hold: 0.055, recover: 0.45, angle: 0.55, overshoot: 0.35 },
} satisfies Record<string, SlapClip>;

export type SlapName = keyof typeof SLAPS;

/** Lean-back angle during the wind-up (the prototype's anticipation). */
const ANTICIPATION = -0.22;

/**
 * Hand placement in world units. The hand image is a square; its pivot is the
 * bottom center (the forearm, hidden inside the box), and the palm center sits
 * `PALM_RADIUS` above the pivot along the arm, as in the prototype (205 of 410 px).
 */
export const HAND = {
  pivotX: 2.18,
  pivotY: -0.39,
  size: 2.2,
  palmRadius: 1.1,
} as const;

/**
 * Which slap a blocked message gets. Deterministic per shot so a re-render
 * can't change it: mostly the plain slap, 3 in 10 backhands (the prototype's
 * backhand odds), and every 7th one a slow "delayed" slap for comedy.
 */
export function pickSlap(shotKey: number): SlapName {
  if (shotKey % 7 === 6) return "delayed";
  return shotKey % 10 < 3 ? "backhand" : "slap";
}

/** Seconds from the start of a slap to contact. */
export function contactTime(clip: SlapClip): number {
  return clip.wind + clip.strike;
}

/** Seconds a whole slap takes. */
export function slapDuration(clip: SlapClip): number {
  return clip.wind + clip.strike + clip.hold + clip.recover;
}

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** Hand angle `t` seconds into a slap (0 before it starts and after it ends). */
export function slapAngle(clip: SlapClip, t: number): number {
  if (!(t > 0) || t >= slapDuration(clip)) return 0;
  const contact = contactTime(clip);
  if (t < clip.wind) return mix(0, ANTICIPATION, smooth(t / clip.wind));
  if (t < contact) return mix(ANTICIPATION, clip.angle, smooth((t - clip.wind) / clip.strike));
  if (t < contact + clip.hold) return clip.angle;
  // Swing past contact for the first quarter of recovery, then settle upright.
  const u = (t - contact - clip.hold) / clip.recover;
  const past = clip.angle + clip.overshoot;
  return u < 0.24 ? mix(clip.angle, past, smooth(u / 0.24)) : mix(past, 0, smooth((u - 0.24) / 0.76));
}

/** World position of the palm center when the hand is at `angle`. */
export function palmAt(angle: number): { x: number; y: number } {
  return {
    x: HAND.pivotX - Math.sin(angle) * HAND.palmRadius,
    y: HAND.pivotY + Math.cos(angle) * HAND.palmRadius,
  };
}
