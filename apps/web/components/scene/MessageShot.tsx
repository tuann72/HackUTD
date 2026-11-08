"use client";

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { motion } from "motion/react";
import { Vector3, type Group, type Mesh, type MeshStandardMaterial } from "three";
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

interface MessageShotProps {
  message: FakeMessage;
  from: Vector3;
  to: Vector3;
  /** Called once when a delivered message reaches the target. */
  onArrive: () => void;
  /** Called once when a blocked message stops. */
  onBlocked: () => void;
  /** Called once when the shot is finished and can be removed. */
  onDone: () => void;
}

type Phase = "fly" | "stamp" | "pop" | "done";

export function MessageShot({ message, from, to, onArrive, onBlocked, onDone }: MessageShotProps) {
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
          onBlocked();
        } else {
          phase.current = "done";
          onArrive();
          onDone();
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
        onDone();
      }
    }
  });

  return (
    <group ref={group} position={from}>
      <mesh ref={orb}>
        <sphereGeometry args={[0.22, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={message.potentialScam ? 0.6 : 0.25}
          transparent
        />
      </mesh>
      {Array.from({ length: SPARKS }, (_, i) => (
        <mesh key={i} ref={(m) => { sparks.current[i] = m; }} visible={false}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
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
}
