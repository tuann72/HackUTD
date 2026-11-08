"use client";

import { memo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useTexture } from "@react-three/drei";
import { motion } from "motion/react";
import type { Group, Sprite, SpriteMaterial, Vector3 } from "three";
import type { SceneMessage } from "./feed";

const FLIGHT_SECONDS = 1.8;
const ARC_HEIGHT = 0.9;
/** Where along the path a blocked message stops (just outside the victim's shield). */
const BLOCK_AT = 0.8;
const STAMP_SECONDS = 0.9;
const POP_SECONDS = 0.3;

// The projectile is a flat chat-bubble image (a sprite always faces the
// camera), not a 3D mesh. Swap the art by replacing these files.
const BUBBLES = {
  normal: "/scene/bubble.svg",
  potentialScam: "/scene/bubble-scam.svg",
};
useTexture.preload(Object.values(BUBBLES));
/** World size; keeps the SVGs' 128:104 aspect ratio. */
const BUBBLE_W = 0.62;
const BUBBLE_H = 0.5;

interface MessageShotProps {
  /** The shot's React key, passed back to `onDone`. */
  shotKey: number;
  message: SceneMessage;
  from: Vector3;
  to: Vector3;
  /** Called once when a delivered message reaches the target. */
  onArrive: () => void;
  /** Called once when a blocked message stops. */
  onBlocked: () => void;
  /** Called once when the shot is finished and can be removed. */
  onDone: (shotKey: number) => void;
}

type Phase = "fly" | "stamp" | "pop" | "done";

/**
 * Memoized: with stable callbacks from the parent, shots already in flight
 * skip re-rendering (and re-rendering their <Html> roots) when another shot is
 * added or removed.
 */
export const MessageShot = memo(function MessageShot({
  shotKey,
  message,
  from,
  to,
  onArrive,
  onBlocked,
  onDone,
}: MessageShotProps) {
  const group = useRef<Group>(null);
  const bubble = useRef<Sprite>(null);
  const material = useRef<SpriteMaterial>(null);
  const progress = useRef(0);
  const phase = useRef<Phase>("fly");
  const phaseTime = useRef(0);
  const [stamped, setStamped] = useState(false);
  // Cached by drei after the first load, so later shots don't suspend.
  const textures = useTexture(BUBBLES);

  const { blocked, potentialScam, label } = message;

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;

    if (phase.current === "fly") {
      progress.current = Math.min(progress.current + dt / FLIGHT_SECONDS, 1);
      const stop = blocked ? BLOCK_AT : 1;
      const p = Math.min(progress.current, stop);
      g.position.lerpVectors(from, to, p);
      g.position.y += Math.sin(Math.PI * p) * ARC_HEIGHT;
      if (progress.current >= stop) {
        phaseTime.current = 0;
        if (blocked) {
          phase.current = "stamp";
          setStamped(true);
          onBlocked();
        } else {
          phase.current = "done";
          onArrive();
          onDone(shotKey);
        }
      }
      return;
    }

    phaseTime.current += dt;

    if (phase.current === "stamp") {
      // Hover in place with a nervous wobble while the stamp shows.
      if (bubble.current) {
        bubble.current.position.x = Math.sin(phaseTime.current * 40) * 0.03;
      }
      if (phaseTime.current >= STAMP_SECONDS) {
        phase.current = "pop";
        phaseTime.current = 0;
      }
      return;
    }

    if (phase.current === "pop") {
      // Swell and fade out.
      const k = Math.min(phaseTime.current / POP_SECONDS, 1);
      bubble.current?.scale.set(BUBBLE_W * (1 + k * 0.8), BUBBLE_H * (1 + k * 0.8), 1);
      if (material.current) material.current.opacity = 1 - k;
      if (k >= 1) {
        phase.current = "done";
        onDone(shotKey);
      }
    }
  });

  return (
    <group ref={group} position={from}>
      <sprite ref={bubble} scale={[BUBBLE_W, BUBBLE_H, 1]}>
        <spriteMaterial
          ref={material}
          map={potentialScam ? textures.potentialScam : textures.normal}
          transparent
          depthWrite={false}
        />
      </sprite>
      <Html position={[0, -0.45, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div
          className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium shadow ${
            potentialScam ? "bg-red-600/90 text-white" : "bg-white/90 text-slate-800"
          }`}
        >
          {label}
        </div>
      </Html>
      {stamped && (
        <Html position={[0, 0.6, 0]} center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
          <motion.div
            initial={{ scale: 2.2, opacity: 0, rotate: -18 }}
            animate={{ scale: 1, opacity: 1, rotate: -8 }}
            transition={{ type: "spring", stiffness: 500, damping: 18 }}
            className="whitespace-nowrap rounded border-2 border-red-500 bg-red-950/80 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-red-300"
          >
            Potential scam · Blocked
          </motion.div>
        </Html>
      )}
    </group>
  );
});
