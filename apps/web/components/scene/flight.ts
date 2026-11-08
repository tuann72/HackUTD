/**
 * Speed profile for a message flying across the scene: fast for the first 30%
 * of the distance, slow through the middle 40%, fast again for the last 30%
 * (Tuan, 2026-11-08).
 *
 * Speed is defined over distance: `FAST_SPEED` on the outer segments and
 * `SLOW_SPEED` (a third of it) in the middle, with smoothstep blends
 * `BLEND` wide on each side of the 30% and 70% marks so the bubble eases
 * between speeds instead of jerking. Time to reach each distance is the
 * integral of 1/speed, sampled once into a table and normalized so the whole
 * flight takes time fraction 1.
 *
 * Resulting time split (see `segmentTimes`, checked in the tests): about 18% of
 * the flight time for the first 30% of the distance, 64% for the middle 40%,
 * and 18% for the last 30%. Over a 2.2 s flight that is roughly 0.39 s fast,
 * 1.41 s slow, 0.39 s fast. A blocked message (stops at 80% of the distance)
 * stops at about 88% of the flight time.
 */

/** Relative speed on the outer 30% segments. */
export const FAST_SPEED = 3;
/** Relative speed on the middle 40% segment. */
export const SLOW_SPEED = 1;
/** Distance marks where the slow middle starts and ends. */
export const SLOW_START = 0.3;
export const SLOW_END = 0.7;
/** Half-width (in distance) of each speed transition. */
const BLEND = 0.06;
const SAMPLES = 1000;

const smoothstep = (a: number, b: number, x: number) => {
  const k = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return k * k * (3 - 2 * k);
};

/** Speed at distance fraction `d`. */
export function flightSpeed(d: number): number {
  const slowness =
    smoothstep(SLOW_START - BLEND, SLOW_START + BLEND, d) - smoothstep(SLOW_END - BLEND, SLOW_END + BLEND, d);
  return FAST_SPEED + (SLOW_SPEED - FAST_SPEED) * slowness;
}

/** TIME[i] = normalized time to reach distance i / SAMPLES (TIME[0] = 0, TIME[SAMPLES] = 1). */
const TIME: number[] = (() => {
  const t = [0];
  for (let i = 0; i < SAMPLES; i++) {
    // Midpoint rule for the integral of 1/speed over one sample.
    t.push(t[i] + 1 / SAMPLES / flightSpeed((i + 0.5) / SAMPLES));
  }
  const total = t[SAMPLES];
  return t.map((x) => x / total);
})();

/** Time fraction at which the bubble reaches distance fraction `d`. */
export function flightTime(d: number): number {
  if (!(d > 0)) return 0;
  if (d >= 1) return 1;
  const x = d * SAMPLES;
  const i = Math.floor(x);
  return TIME[i] + (TIME[i + 1] - TIME[i]) * (x - i);
}

/**
 * Distance fraction covered at time fraction `t` (both 0..1). Continuous,
 * strictly increasing, `flightDistance(0) = 0` and `flightDistance(1) = 1`.
 */
export function flightDistance(t: number): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  // Binary search for the sample interval that contains t, then interpolate.
  let lo = 0;
  let hi = SAMPLES;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (TIME[mid] <= t) lo = mid;
    else hi = mid;
  }
  return (lo + (t - TIME[lo]) / (TIME[hi] - TIME[lo])) / SAMPLES;
}

/** Fraction of the flight time spent on the fast start, slow middle and fast end. */
export function segmentTimes(): [number, number, number] {
  const a = flightTime(SLOW_START);
  const b = flightTime(SLOW_END);
  return [a, b - a, 1 - b];
}
