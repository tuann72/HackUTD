"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The color-block composition on the right of the landing page. Every block
 * and rule is placed in percent of a 932 x 548 frame, so it scales with the
 * panel. Measured from the design mock.
 */
const BLOCKS = [
  { left: 6.87, top: 0, width: 41.2, height: 78.47, color: "#e1346f" },
  { left: 48.07, top: 8.39, width: 13.73, height: 23.36, color: "#ec4f8e" },
  { left: 34.33, top: 78.47, width: 13.73, height: 21.53, color: "#b5225a" },
  { left: 48.07, top: 31.75, width: 51.93, height: 68.25, color: "#100f0d" },
];

/** Thin grid rules: horizontal ones run from the left edge, vertical ones from the top. */
const RULES = [
  { left: 0, top: 31.75, width: 48.07, height: 0 },
  { left: 0, top: 78.47, width: 48.07, height: 0 },
  { left: 48.07, top: 0, width: 0, height: 31.75 },
  { left: 89.27, top: 0, width: 0, height: 31.75 },
];

const pct = (n: number) => `${n}%`;

export function Blocks() {
  const still = useReducedMotion();

  return (
    <div aria-hidden className="relative h-full w-full">
      {BLOCKS.map((b, i) => (
        <motion.div
          key={b.color}
          className="absolute"
          style={{
            left: pct(b.left),
            top: pct(b.top),
            width: pct(b.width),
            height: pct(b.height),
            background: b.color,
            transformOrigin: "left top",
          }}
          initial={still ? false : { opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.1 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
      {RULES.map((r) => (
        <div
          key={`${r.left}-${r.top}`}
          className="absolute border-[#9a9390]"
          style={{
            left: pct(r.left),
            top: pct(r.top),
            width: r.width ? pct(r.width) : 0,
            height: r.height ? pct(r.height) : 0,
            borderTopWidth: r.height ? 0 : 1,
            borderLeftWidth: r.width ? 0 : 1,
          }}
        />
      ))}
    </div>
  );
}
