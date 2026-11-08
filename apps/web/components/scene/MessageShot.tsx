"use client";

import { memo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useTexture } from "@react-three/drei";
import { motion } from "motion/react";
import type { Group, Sprite, SpriteMaterial, Vector3 } from "three";
import type { SceneMessage } from "./feed";
import { flightDistance } from "./flight";

/** Whole flight; fast-slow-fast (see `flight.ts`), so the middle takes most of it. */
const FLIGHT_SECONDS = 2.2;
/** Default arc height; delivered shots pass a higher one so they clear the shield. */
const ARC_HEIGHT = 0.9;
/** How long a blocked bubble flies back after hitting the shield, and how it flies. */
const KNOCK_SECONDS = 0.8;
const KNOCK_VX = -6;
const KNOCK_VY = 2.6;
const GRAVITY = -9;
const KNOCK_SPIN = 9;

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
  /** Where it lands: the Receiver for delivered messages, the shield's face for blocked ones. */
  to: Vector3;
  /** Peak height of the flight arc above the straight line. */
  arc?: number;
  /** Called once when a delivered message reaches the target. */
  onArrive: () => void;
  /** Called once when a blocked message hits the shield. */
  onBlocked: () => void;
  /** Called once when the shot is finished and can be removed. */
  onDone: (shotKey: number) => void;
}

/** fly → (blocked) knocked back off the shield, or fly → done when delivered. */
type Phase = "fly" | "knocked" | "done";

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
  arc = ARC_HEIGHT,
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
  const velocity = useRef({ x: 0, y: 0 });
  const label = useRef<HTMLDivElement>(null);
  const stamp = useRef<HTMLDivElement>(null);
  const [stamped, setStamped] = useState(false);
  // Cached by drei after the first load, so later shots don't suspend.
  const textures = useTexture(BUBBLES);

  const { blocked, potentialScam } = message;

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;

    if (phase.current === "fly") {
      // `progress` is the time fraction; the path and arc use the distance it maps to.
      progress.current = Math.min(progress.current + dt / FLIGHT_SECONDS, 1);
      const p = flightDistance(progress.current);
      g.position.lerpVectors(from, to, p);
      g.position.y += Math.sin(Math.PI * p) * arc;
      if (p >= 1) {
        phaseTime.current = 0;
        if (blocked) {
          // Hit the shield: stamp it and bounce straight back.
          phase.current = "knocked";
          velocity.current = { x: KNOCK_VX, y: KNOCK_VY };
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

    if (phase.current === "knocked") {
      // Fly back toward the sender, spinning and fading.
      velocity.current.y += GRAVITY * dt;
      g.position.x += velocity.current.x * dt;
      g.position.y += velocity.current.y * dt;
      const fade = Math.max(1 - phaseTime.current / KNOCK_SECONDS, 0);
      if (material.current) {
        material.current.rotation += KNOCK_SPIN * dt;
        material.current.opacity = fade;
      }
      for (const el of [label.current, stamp.current]) if (el) el.style.opacity = String(fade);
      if (phaseTime.current >= KNOCK_SECONDS) {
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
          ref={label}
          className={`whitespace-nowrap px-2 py-0.5 font-label text-[10px] font-bold uppercase shadow ${
            potentialScam ? "bg-hot text-white" : "bg-card text-ink ring-1 ring-rule"
          }`}
        >
          {message.label}
        </div>
      </Html>
      {stamped && (
        <Html position={[0, 0.6, 0]} center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
          <div ref={stamp}>
          <motion.div
            initial={{ scale: 2.2, opacity: 0, rotate: -18 }}
            animate={{ scale: 1, opacity: 1, rotate: -8 }}
            transition={{ type: "spring", stiffness: 500, damping: 18 }}
            className="whitespace-nowrap border-2 border-hot bg-ink px-2 py-0.5 font-label text-[11px] font-bold uppercase tracking-wide text-hot"
          >
            Potential scam · Blocked
          </motion.div>
          </div>
        </Html>
      )}
    </group>
  );
});
