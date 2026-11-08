"use client";

import { memo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { motion } from "motion/react";
import {
  MeshBasicMaterial,
  SphereGeometry,
  type Group,
  type Mesh,
  type MeshStandardMaterial,
  type Vector3,
} from "three";
import type { FakeMessage } from "./fakeMessages";

const FLIGHT_SECONDS = 1.8;
const ARC_HEIGHT = 0.9;
/** Where along the path a blocked message stops (just outside the victim's shield). */
const BLOCK_AT = 0.8;
const STAMP_SECONDS = 0.9;
const POP_SECONDS = 0.3;
const SPARKS = 8;

const COLORS = {
  potentialScam: "#ef4444",
  normal: "#bfdbfe",
} as const;

// One copy of each geometry and spark material for every shot, instead of
// building and uploading 9 spheres per shot. R3F doesn't dispose objects
// passed as props, so these outlive each shot. The orb keeps its own material
// because its opacity animates per shot.
const ORB_GEOMETRY = new SphereGeometry(0.22, 20, 20);
const SPARK_GEOMETRY = new SphereGeometry(0.06, 8, 8);
const SPARK_MATERIALS = {
  potentialScam: new MeshBasicMaterial({ color: COLORS.potentialScam }),
  normal: new MeshBasicMaterial({ color: COLORS.normal }),
};
const SPARK_INDEXES = Array.from({ length: SPARKS }, (_, i) => i);

interface MessageShotProps {
  /** The shot's React key, passed back to `onDone`. */
  shotKey: number;
  message: FakeMessage;
  from: Vector3;
  to: Vector3;
  /** Called once when a delivered message reaches the target. */
  onArrive: (message: FakeMessage) => void;
  /** Called once when a blocked message stops. */
  onBlocked: (message: FakeMessage) => void;
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
  const orb = useRef<Mesh>(null);
  const sparks = useRef<(Mesh | null)[]>([]);
  const progress = useRef(0);
  const phase = useRef<Phase>("fly");
  const phaseTime = useRef(0);
  const [stamped, setStamped] = useState(false);

  const blocked = message.action === "blocked";
  const color = message.potentialScam ? COLORS.potentialScam : COLORS.normal;
  const label = message.text.length > 34 ? `${message.text.slice(0, 33)}…` : message.text;

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
          onBlocked(message);
        } else {
          phase.current = "done";
          onArrive(message);
          onDone(shotKey);
        }
      }
      return;
    }

    phaseTime.current += dt;

    if (phase.current === "stamp") {
      // Hover in place with a nervous wobble while the stamp shows.
      if (orb.current) {
        orb.current.position.x = Math.sin(phaseTime.current * 40) * 0.03;
      }
      if (phaseTime.current >= STAMP_SECONDS) {
        phase.current = "pop";
        phaseTime.current = 0;
      }
      return;
    }

    if (phase.current === "pop") {
      const k = Math.min(phaseTime.current / POP_SECONDS, 1);
      if (orb.current) {
        orb.current.scale.setScalar(1 + k * 0.8);
        const mat = orb.current.material as MeshStandardMaterial;
        mat.opacity = 1 - k;
      }
      sparks.current.forEach((s, i) => {
        if (!s) return;
        const a = (i / SPARKS) * Math.PI * 2;
        s.visible = true;
        s.position.set(Math.cos(a) * k * 0.9, Math.sin(a) * k * 0.9, 0);
        s.scale.setScalar(1 - k);
      });
      if (k >= 1) {
        phase.current = "done";
        onDone(shotKey);
      }
    }
  });

  return (
    <group ref={group} position={from}>
      <mesh ref={orb} geometry={ORB_GEOMETRY}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={message.potentialScam ? 0.6 : 0.25}
          transparent
        />
      </mesh>
      {SPARK_INDEXES.map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            sparks.current[i] = m;
          }}
          geometry={SPARK_GEOMETRY}
          material={message.potentialScam ? SPARK_MATERIALS.potentialScam : SPARK_MATERIALS.normal}
          visible={false}
        />
      ))}
      <Html position={[0, -0.45, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div
          className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium shadow ${
            message.potentialScam ? "bg-red-600/90 text-white" : "bg-white/90 text-slate-800"
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
