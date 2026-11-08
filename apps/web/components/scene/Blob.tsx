"use client";

import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { easing } from "maath";
import type { Group, Object3D } from "three";

/**
 * A jellybean character (an original party-game-style bean): a capsule body,
 * a pale face patch with two big glossy eyes, stubby arms and feet. Its origin
 * is the body's center; it stands on y = position.y - BEAN.footY.
 */
export const BEAN = {
  radius: 0.6,
  /** Straight part of the capsule between the two half-sphere ends. */
  length: 0.95,
  /** From the body's center down to the soles. */
  footY: 1.12,
};
/** Half the bean's width: shots leave the sender from its side. */
export const BLOB_RADIUS = BEAN.radius;

const TOP = BEAN.length / 2 + BEAN.radius;
const FACE = { y: 0.42, z: BEAN.radius * 0.86 };

interface BlobProps {
  position: [number, number, number];
  color: string;
  /** +1 if the bean looks right (+x), -1 if it looks left. */
  facing: 1 | -1;
  /** performance.now() of the last message this bean received; triggers a squash. */
  hitAt: RefObject<number>;
  /** Phase offset so two beans don't bob in sync. */
  phase?: number;
  /**
   * Point where its name label goes, under the feet or above the head. It moves
   * with the bean; the scene projects it to screen space and moves a DOM label there.
   */
  labelAnchor?: RefObject<Object3D | null>;
  labelAt?: "below" | "above";
}

export function Blob({ position, color, facing, hitAt, phase = 0, labelAnchor, labelAt = "below" }: BlobProps) {
  const group = useRef<Group>(null);
  const body = useRef<Group>(null);
  const arms = useRef<Group>(null);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime + phase;
    const now = performance.now();
    if (group.current) {
      // Idle bounce and a little side-to-side waddle.
      group.current.position.y = position[1] + Math.abs(Math.sin(t * 2.2)) * 0.07;
      group.current.rotation.z = Math.sin(t * 2.2) * 0.04;
    }
    if (body.current) {
      // Squash-and-stretch for ~0.45s after a hit, then damp back.
      const since = (now - hitAt.current) / 1000;
      const target: [number, number, number] =
        since < 0.12 ? [1.15, 0.82, 1.15] : since < 0.3 ? [0.94, 1.12, 0.94] : [1, 1, 1];
      easing.damp3(body.current.scale, target, 0.08, dt);
    }
    if (arms.current) {
      // Arms swing gently, and fly up when hit.
      const since = (now - hitAt.current) / 1000;
      const lift = since < 0.35 ? 0.9 : 0;
      arms.current.children.forEach((arm, i) => {
        const side = i === 0 ? 1 : -1;
        easing.damp(arm.rotation, "z", side * (0.35 + lift + Math.sin(t * 2.2 + i) * 0.12), 0.1, dt);
      });
    }
  });

  return (
    <group ref={group} position={position}>
      {/* Turned a little toward whoever it faces, but still showing its face. */}
      <group ref={body} rotation={[0, facing * 0.45, 0]}>
        <mesh>
          <capsuleGeometry args={[BEAN.radius, BEAN.length, 12, 32]} />
          <meshStandardMaterial color={color} roughness={0.35} />
        </mesh>

        {/* Face patch: a flattened pale oval on the front of the head. */}
        <mesh position={[0, FACE.y, FACE.z]} scale={[0.42, 0.34, 0.2]}>
          <sphereGeometry args={[1, 32, 24]} />
          <meshStandardMaterial color="#fff4ec" roughness={0.5} />
        </mesh>
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.15, FACE.y + 0.02, FACE.z + 0.17]}>
            <mesh scale={[1, 1.25, 0.6]}>
              <sphereGeometry args={[0.085, 20, 16]} />
              <meshStandardMaterial color="#14101a" roughness={0.2} />
            </mesh>
            {/* Eye shine. */}
            <mesh position={[0.025, 0.04, 0.05]}>
              <sphereGeometry args={[0.022, 10, 8]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
          </group>
        ))}

        {/* Stubby arms, pivoting at the shoulders. */}
        <group ref={arms}>
          {[1, -1].map((side) => (
            <group key={side} position={[side * (BEAN.radius - 0.04), -0.05, 0]} rotation={[0, 0, side * 0.35]}>
              <mesh position={[side * 0.08, -0.2, 0]}>
                <capsuleGeometry args={[0.1, 0.22, 6, 12]} />
                <meshStandardMaterial color={color} roughness={0.35} />
              </mesh>
            </group>
          ))}
        </group>

        {/* Feet. */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.22, -BEAN.footY + 0.1, 0.08]} scale={[1, 0.6, 1.35]}>
            <sphereGeometry args={[0.16, 16, 12]} />
            <meshStandardMaterial color={color} roughness={0.4} />
          </mesh>
        ))}
      </group>

      {labelAnchor && (
        <object3D ref={labelAnchor} position={[0, labelAt === "above" ? TOP + 0.35 : -BEAN.footY - 0.4, 0]} />
      )}
    </group>
  );
}
