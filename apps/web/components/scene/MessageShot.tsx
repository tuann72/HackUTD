"use client";

import { memo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useTexture } from "@react-three/drei";
import { motion } from "motion/react";
import type { Group, Sprite, SpriteMaterial, Vector3 } from "three";
import type { SceneMessage } from "./feed";
import { flightDistance } from "./flight";
import { SLAPS, contactTime, palmAt, pickSlap, type SlapName } from "./slap";

/** Whole flight; fast-slow-fast (see `flight.ts`), so the middle takes most of it. */
const FLIGHT_SECONDS = 2.2;
const ARC_HEIGHT = 0.9;
/** Distance fraction where a blocked message stops, within reach of the Receiver's hand. */
const BLOCK_AT = 0.85;
/** At contact the bubble's center is this far left of the palm center (it meets the palm's edge). */
const CONTACT_OFFSET_X = 0.3;
/** How long a slapped bubble flies before it is removed, and how it flies. */
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
  to: Vector3;
  /** Called once when a delivered message reaches the target. */
  onArrive: () => void;
  /** Called once when a blocked message stops, with the slap the hand should play. */
  onBlocked: (slap: SlapName) => void;
  /** Called once when the shot is finished and can be removed. */
  onDone: (shotKey: number) => void;
}

/** fly → (blocked) wait for the slap → knocked away, or fly → done when delivered. */
type Phase = "fly" | "wait" | "knocked" | "done";

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
  const waitFrom = useRef({ x: 0, y: 0 });
  const velocity = useRef({ x: 0, y: 0 });
  const label = useRef<HTMLDivElement>(null);
  const stamp = useRef<HTMLDivElement>(null);
  const [stamped, setStamped] = useState(false);
  // Cached by drei after the first load, so later shots don't suspend.
  const textures = useTexture(BUBBLES);

  const { blocked, potentialScam } = message;
  const slapName = pickSlap(shotKey);
  const slap = SLAPS[slapName];

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;

    if (phase.current === "fly") {
      // `progress` is the time fraction; the path and arc use the distance it maps to.
      progress.current = Math.min(progress.current + dt / FLIGHT_SECONDS, 1);
      const stop = blocked ? BLOCK_AT : 1;
      const distance = flightDistance(progress.current);
      const p = Math.min(distance, stop);
      g.position.lerpVectors(from, to, p);
      g.position.y += Math.sin(Math.PI * p) * ARC_HEIGHT;
      if (distance >= stop) {
        phaseTime.current = 0;
        if (blocked) {
          phase.current = "wait";
          waitFrom.current = { x: g.position.x, y: g.position.y };
          setStamped(true);
          onBlocked(slapName);
        } else {
          phase.current = "done";
          onArrive();
          onDone(shotKey);
        }
      }
      return;
    }

    phaseTime.current += dt;

    if (phase.current === "wait") {
      // While the hand winds up, drift to where its palm will be at contact,
      // with a nervous wobble, so the slap lands on the bubble.
      const hit = contactTime(slap);
      const k = Math.min(phaseTime.current / hit, 1);
      const ease = k * k * (3 - 2 * k);
      const palm = palmAt(slap.angle);
      g.position.x = waitFrom.current.x + (palm.x - CONTACT_OFFSET_X - waitFrom.current.x) * ease;
      g.position.y = waitFrom.current.y + (palm.y - waitFrom.current.y) * ease;
      if (bubble.current) bubble.current.position.x = Math.sin(phaseTime.current * 40) * 0.03;
      if (phaseTime.current >= hit) {
        phase.current = "knocked";
        phaseTime.current = 0;
        velocity.current = { x: KNOCK_VX, y: KNOCK_VY };
        if (bubble.current) bubble.current.position.x = 0;
      }
      return;
    }

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
          className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium shadow ${
            potentialScam ? "bg-red-600/90 text-white" : "bg-white/90 text-slate-800"
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
            className="whitespace-nowrap rounded border-2 border-red-500 bg-red-950/80 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-red-300"
          >
            Potential scam · Blocked
          </motion.div>
          </div>
        </Html>
      )}
    </group>
  );
});
