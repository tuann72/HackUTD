"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { easing } from "maath";
import {
  DoubleSide,
  ExtrudeGeometry,
  Matrix4,
  type BufferGeometry,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
} from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

// Outline and check mark of the Lucide `shield-check` icon (lucide.dev, ISC
// license), in its 24 x 24 viewBox. The outline is filled and extruded into a
// badge; the check is stroked on its face.
const OUTLINE =
  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";
const CHECK = "m9 12 2 2 4-4";

/** T-Mobile magenta. */
export const SHIELD_PINK = "#e20074";

/** Where T-Guard's shield stands (where the box and hand were) and how big it is. */
export const SHIELD = { x: 1.9, y: 0.05, height: 2.1 };
/** World units per icon unit: the outline is 20 units tall (y 2 to 22). */
const SCALE = SHIELD.height / 20;
/** Half the shield's depth after extrusion and bevel, in world units. */
export const SHIELD_FRONT_Z = ((1.6 + 2 * 0.6) / 2) * SCALE;

interface ShieldGeometry {
  body: BufferGeometry;
  check: BufferGeometry;
}

/** Builds the badge and check-mark geometry from the icon paths, centered on the origin. */
function buildShield(): ShieldGeometry | null {
  if (typeof DOMParser === "undefined") return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${OUTLINE}"/><path d="${CHECK}" fill="none"/></svg>`;
  const { paths } = new SVGLoader().parse(svg);
  const [outline, check] = paths;
  if (!outline || !check) return null;

  const body = new ExtrudeGeometry(SVGLoader.createShapes(outline), {
    depth: 1.6,
    bevelEnabled: true,
    bevelThickness: 0.6,
    bevelSize: 0.5,
    bevelSegments: 4,
    curveSegments: 24,
  });
  const strokes = check.subPaths.map((sub) =>
    SVGLoader.pointsToStroke(sub.getPoints(), SVGLoader.getStrokeStyle(2.4, "#fff", "round", "round")),
  );
  const checkGeometry = strokes[0];
  if (!checkGeometry) return null;

  // SVG y points down: turn both upside down (a rotation, so faces keep their winding).
  const flip = new Matrix4().makeRotationX(Math.PI);
  body.applyMatrix4(flip);
  checkGeometry.applyMatrix4(flip);
  body.computeBoundingBox();
  const box = body.boundingBox!;
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  body.translate(-cx, -cy, -cz);
  // The check sits just in front of the badge's front face.
  checkGeometry.translate(-cx, -cy, box.max.z - cz + 0.05);
  return { body, check: checkGeometry };
}

interface ShieldProps {
  /** performance.now() of the last message blocked against it: it flashes and kicks back. */
  blockedAt: RefObject<number>;
  /** Point under the shield where the "T-Guard" label goes. */
  labelAnchor?: RefObject<Object3D | null>;
}

/**
 * T-Guard: a pink shield (Lucide's shield-check) between the sender and the
 * Receiver. Blocked messages bounce off its face; delivered ones arc over it.
 * It only animates the gateway's decision; it never makes one.
 */
export function Shield({ blockedAt, labelAnchor }: ShieldProps) {
  // Built once per mount (lazy state); disposed on unmount.
  const [geometry] = useState(buildShield);
  const group = useRef<Group>(null);
  const badge = useRef<Group>(null);
  const bodyMaterial = useRef<MeshStandardMaterial>(null);
  const ring = useRef<Mesh>(null);

  useEffect(
    () => () => {
      geometry?.body.dispose();
      geometry?.check.dispose();
    },
    [geometry],
  );

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const since = (performance.now() - blockedAt.current) / 1000;
    const hit = since < 0.5;
    if (group.current) {
      // Idle: a slow float and sway.
      group.current.position.y = SHIELD.y + Math.sin(t * 1.6) * 0.05;
      group.current.rotation.y = Math.sin(t * 0.8) * 0.12;
    }
    if (badge.current) {
      // On a block: punch up in size and rock back from the impact, then settle.
      const punch = since < 0.1 ? 1.14 : 1;
      const rock = since < 0.12 ? -0.28 : 0;
      easing.damp3(badge.current.scale, [punch, punch, punch], since < 0.1 ? 0.03 : 0.12, dt);
      easing.damp(badge.current.rotation, "x", rock, since < 0.12 ? 0.03 : 0.15, dt);
    }
    if (bodyMaterial.current) {
      easing.damp(bodyMaterial.current, "emissiveIntensity", hit ? 0.9 * (1 - since / 0.5) : 0.08, 0.05, dt);
    }
    if (ring.current) {
      // A pink ring bursts out from behind the shield.
      const mat = ring.current.material as MeshBasicMaterial;
      mat.opacity = hit ? 0.45 * (1 - since / 0.5) : 0;
      ring.current.visible = mat.opacity > 0.001;
      ring.current.scale.setScalar(1 + Math.min(since, 0.5) * 1.2);
    }
  });

  return (
    <group ref={group} position={[SHIELD.x, SHIELD.y, 0]}>
      <group ref={badge}>
        {geometry && (
          <group scale={SCALE}>
            <mesh geometry={geometry.body}>
              <meshStandardMaterial
                ref={bodyMaterial}
                color={SHIELD_PINK}
                emissive={SHIELD_PINK}
                emissiveIntensity={0.08}
                roughness={0.32}
                metalness={0.1}
              />
            </mesh>
            <mesh geometry={geometry.check}>
              <meshBasicMaterial color="#ffffff" side={DoubleSide} toneMapped={false} />
            </mesh>
          </group>
        )}
      </group>
      <mesh ref={ring} position={[0, 0, -0.05]} visible={false}>
        <ringGeometry args={[SHIELD.height * 0.5, SHIELD.height * 0.56, 48]} />
        <meshBasicMaterial color={SHIELD_PINK} transparent opacity={0} depthWrite={false} side={DoubleSide} />
      </mesh>
      {labelAnchor && <object3D ref={labelAnchor} position={[0, -SHIELD.height / 2 - 0.4, 0]} />}
    </group>
  );
}
