"use client";

import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { easing } from "maath";
import {
  Plane,
  Vector3,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
} from "three";
import { HAND, SLAPS, slapAngle, type SlapName } from "./slap";

// Photographic hand from the T-GUARD offline prototype (assets/character).
// The palm and the back of the hand; the backhand image is drawn mirrored.
const HAND_IMAGES = {
  palm: "/scene/hand/palm.webp",
  backhand: "/scene/hand/backhand.webp",
};
useTexture.preload(Object.values(HAND_IMAGES));

/** The pink housing the hand rises out of (the prototype's cube). */
const BOX = { x: 3.0, w: 1.3, h: 0.8, d: 1.0, bottom: -1.1 };
const BOX_TOP = BOX.bottom + BOX.h;
/** The hand is cut off at the box's top, so the arm seems to come out of the box. */
const CLIP_AT_BOX_TOP = [new Plane(new Vector3(0, 1, 0), -BOX_TOP)];
const PINK = "#ef167d";
/** A delivered message makes the hand twitch for this long (the prototype's finger twitch). */
const TWITCH_SECONDS = 0.32;

export interface SlapState {
  /** performance.now() when the current slap started; 0 = none yet. */
  at: number;
  clip: SlapName;
}

interface HandProps {
  /** performance.now() of the last message delivered to the Receiver. */
  hitAt: RefObject<number>;
  /** The slap to play; a blocked message writes it. */
  slap: RefObject<SlapState>;
  /** Point under the box where the "T-Guard" label goes. */
  labelAnchor?: RefObject<Object3D | null>;
}

/**
 * T-Guard: a plain pink box with a photographic hand standing in it, in front
 * of the Receiver bean. When a
 * message is blocked it slaps the bubble away toward the sender. It only
 * animates the gateway's decision; it never makes one.
 */
export function Hand({ hitAt, slap, labelAnchor }: HandProps) {
  const pivot = useRef<Group>(null);
  const handMesh = useRef<Mesh>(null);
  const handMaterial = useRef<MeshBasicMaterial>(null);
  const boxMaterial = useRef<MeshStandardMaterial>(null);
  const textures = useTexture(HAND_IMAGES);

  useFrame((state, dt) => {
    const now = performance.now();
    const t = state.clock.elapsedTime;
    const { at, clip: name } = slap.current;
    const clip = SLAPS[name];
    const slapping = at > 0 && (now - at) / 1000 < 2;
    const angle = slapping ? slapAngle(clip, (now - at) / 1000) : 0;
    const sinceHit = (now - hitAt.current) / 1000;
    const idle = angle === 0 ? Math.sin(t * 1.8) * 0.012 : 0;
    const twitch = sinceHit < TWITCH_SECONDS ? Math.sin(sinceHit * 80) * 0.03 : 0;

    if (pivot.current) pivot.current.rotation.z = angle + idle + twitch;
    // Backhands show the back of the hand, mirrored like the prototype.
    const dorsal = angle !== 0 && "dorsal" in clip && clip.dorsal;
    if (handMesh.current) handMesh.current.scale.x = dorsal ? -1 : 1;
    if (handMaterial.current) {
      const map = dorsal ? textures.backhand : textures.palm;
      if (handMaterial.current.map !== map) {
        handMaterial.current.map = map;
        handMaterial.current.needsUpdate = true;
      }
    }
    // The box glows briefly when a message is delivered.
    if (boxMaterial.current) {
      const glow = sinceHit < 0.4 ? 0.5 * (1 - sinceHit / 0.4) : 0;
      easing.damp(boxMaterial.current, "emissiveIntensity", glow, 0.05, dt);
    }
  });

  return (
    <group>
      <group ref={pivot} position={[HAND.pivotX, HAND.pivotY, 0]}>
        <mesh ref={handMesh} position={[0, HAND.size / 2, 0]}>
          <planeGeometry args={[HAND.size, HAND.size]} />
          <meshBasicMaterial
            ref={handMaterial}
            map={textures.palm}
            transparent
            alphaTest={0.05}
            toneMapped={false}
            clippingPlanes={CLIP_AT_BOX_TOP}
          />
        </mesh>
      </group>

      <group position={[BOX.x, BOX.bottom + BOX.h / 2, 0]}>
        <mesh>
          <boxGeometry args={[BOX.w, BOX.h, BOX.d]} />
          <meshStandardMaterial ref={boxMaterial} color={PINK} emissive={PINK} emissiveIntensity={0} roughness={0.5} />
        </mesh>
        {/* Dark opening the hand comes out of. */}
        <mesh position={[0, BOX.h / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[BOX.w - 0.16, BOX.d - 0.16]} />
          <meshBasicMaterial color="#250f1d" />
        </mesh>
        {labelAnchor && <object3D ref={labelAnchor} position={[0, -BOX.h / 2 - 0.35, 0]} />}
      </group>
    </group>
  );
}
