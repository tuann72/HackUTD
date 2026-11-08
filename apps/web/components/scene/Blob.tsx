"use client";

import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { easing } from "maath";
import type { Group, Mesh, MeshBasicMaterial } from "three";

export const BLOB_RADIUS = 0.9;
const SHIELD_RADIUS = 1.45;

// Eye positions on the sphere surface (r ≈ 0.92), turned toward +x and the
// camera; x is mirrored by `facing` so each blob looks at the other.
const EYES: [number, number, number][] = [0.3, 0.62].map((x) => {
  const y = 0.25;
  return [x, y, Math.sqrt(0.92 ** 2 - x ** 2 - y ** 2)];
});

interface BlobProps {
  position: [number, number, number];
  color: string;
  /** +1 if the blob looks right (+x), -1 if it looks left. */
  facing: 1 | -1;
  /** performance.now() of the last message this blob received; triggers a bounce. */
  hitAt: RefObject<number>;
  /** performance.now() of the last message blocked in front of it; flashes a shield. */
  shieldAt?: RefObject<number>;
  /** Phase offset so two blobs don't bob in sync. */
  phase?: number;
  /** Name shown under the blob; it bobs with it, so it always lines up. */
  label?: string;
  /** Tailwind text color for the label. */
  labelClass?: string;
}

/** The label's center sits this far below the blob's center. */
const LABEL_Y = -(BLOB_RADIUS + 0.55);

export function Blob({ position, color, facing, hitAt, shieldAt, phase = 0, label, labelClass = "text-slate-100" }: BlobProps) {
  const group = useRef<Group>(null);
  const body = useRef<Group>(null);
  const shield = useRef<Mesh>(null);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime + phase;
    const now = performance.now();
    if (group.current) {
      // Idle bob.
      group.current.position.y = position[1] + Math.sin(t * 2) * 0.08;
    }
    if (body.current) {
      // Squash-and-stretch for ~0.45s after a hit, then damp back to round.
      const since = (now - hitAt.current) / 1000;
      const target: [number, number, number] =
        since < 0.12 ? [1.18, 0.78, 1.18] : since < 0.3 ? [0.92, 1.15, 0.92] : [1, 1, 1];
      easing.damp3(body.current.scale, target, 0.08, dt);
    }
    if (shield.current && shieldAt) {
      const since = (now - shieldAt.current) / 1000;
      const mat = shield.current.material as MeshBasicMaterial;
      mat.opacity = since < 0.6 ? 0.35 * (1 - since / 0.6) : 0;
      shield.current.visible = mat.opacity > 0.001;
      const s = 1 + Math.min(since, 0.6) * 0.15;
      shield.current.scale.setScalar(s);
    }
  });

  return (
    <group ref={group} position={position}>
      <group ref={body}>
        <mesh>
          <sphereGeometry args={[BLOB_RADIUS, 48, 48]} />
          <meshStandardMaterial color={color} roughness={0.45} />
        </mesh>
        {EYES.map(([x, y, z]) => (
          <mesh key={x} position={[x * facing, y, z]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
        ))}
      </group>
      {shieldAt && (
        <mesh ref={shield} visible={false}>
          <sphereGeometry args={[SHIELD_RADIUS, 32, 32]} />
          <meshBasicMaterial color="#f87171" transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {label && (
        <Html position={[0, LABEL_Y, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <span className={`whitespace-nowrap rounded-md bg-slate-900/70 px-2 py-0.5 text-sm font-medium ${labelClass}`}>
            {label}
          </span>
        </Html>
      )}
    </group>
  );
}
