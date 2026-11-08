"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The color-block composition on the right of the landing page: a "T" built
 * from flat pink blocks (crossbar, a serif under its left end, the stem with a
 * deep-pink foot) beside a black slab, with thin grid rules. Every block and
 * rule is placed in percent of the panel, so it scales with it.
 */
const HOT = "#e1346f";
const LIGHT = "#ec4f8e";
const DEEP = "#b5225a";
const INK = "#100f0d";

const BLOCKS = [
  // Crossbar: one long block, then a lighter block and a deep-pink end cap.
  { id: "bar", left: 8, top: 6, width: 53, height: 28, color: HOT },
  { id: "bar-light", left: 61, top: 6, width: 19, height: 28, color: LIGHT },
  { id: "bar-cap", left: 80, top: 6, width: 12, height: 28, color: DEEP },
  // Serif hanging under the crossbar's left end.
  { id: "serif", left: 8, top: 34, width: 12, height: 12, color: LIGHT },
  // Stem, centered under the crossbar, with a deep-pink foot.
  { id: "stem", left: 39, top: 34, width: 22, height: 42, color: HOT },
  { id: "foot", left: 39, top: 76, width: 22, height: 24, color: DEEP },
  // Black slab to the right of the stem.
  { id: "slab", left: 61, top: 46, width: 39, height: 54, color: INK },
];

/** Thin grid rules: horizontal ones have a width, vertical ones a height. */
const RULES = [
  { left: 0, top: 34, width: 39, height: 0 },
  { left: 0, top: 76, width: 39, height: 0 },
  { left: 39, top: 0, width: 0, height: 6 },
  { left: 92, top: 0, width: 0, height: 6 },
  { left: 92, top: 34, width: 0, height: 12 },
];

const pct = (n: number) => `${n}%`;

export function Blocks() {
  const still = useReducedMotion();

  return (
    <div aria-hidden className="relative h-full w-full">
      {BLOCKS.map((b, i) => (
        <motion.div
          key={b.id}
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
