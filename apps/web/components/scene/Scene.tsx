"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { MathUtils, PerspectiveCamera, Vector3, type Object3D } from "three";
import { Blob, BLOB_RADIUS } from "./Blob";
import { Hand, type SlapState } from "./Hand";
import { MessageShot } from "./MessageShot";
import type { SlapName } from "./slap";
import type { SceneMessage, ShotFeed } from "./feed";

const SENDER_X = -3.2;
/** The Receiver bean stands behind and to the right of T-Guard's box, clear of the hand. */
const RECEIVER_POSITION: [number, number, number] = [3.95, 0, -0.9];
/** Shots leave the sender bean's side and land in T-Guard's hand, a little in front of it. */
const SENDER_EDGE = new Vector3(SENDER_X + BLOB_RADIUS, 0.1, 0);
const RECEIVER_CATCH = new Vector3(1.7, 0.1, 0.3);
/** Minimum gap between shots, so a burst of messages doesn't fire all at once. */
const SHOT_GAP_MS = 600;
/**
 * At most this many shots wait to fire; older ones are dropped. A first poll
 * can return many messages at once, and only the newest are worth animating.
 */
const MAX_QUEUED = 5;
const CAMERA = { position: [0, 1.6, 8.5] as [number, number, number], fov: 45 };
/**
 * Half the width and height of world space, around the origin the camera
 * looks at, that must stay in view: the sender bean, T-Guard's box and hand
 * (x about 1.1 to 3.3, fingertips at y about 1.8), the Receiver bean behind
 * and right of it (x up to about 4.55), the shot arc and "Blocked" stamp,
 * and the labels (y about -1.75 to 1.5), plus a margin.
 */
const FRAME_HALF_W = 5.1;
const FRAME_HALF_H = 2.1;
const CAMERA_DISTANCE = Math.hypot(...CAMERA.position);
/** Capped below 2 so Retina screens don't render 4x the pixels. */
const DPR: [number, number] = [1, 1.5];

interface Shot {
  key: number;
  message: SceneMessage;
}

/**
 * performance.now() of the last message delivered to each side, and the
 * Receiver's current slap. The blob and hand read these in useFrame to
 * animate; shots mark them.
 */
function createHitClock() {
  const at = { victim: { current: 0 }, sender: { current: 0 } };
  const slap = { current: { at: 0, clip: "slap" } as SlapState };
  return {
    at,
    slap,
    mark(kind: keyof typeof at) {
      at[kind].current = performance.now();
    },
    startSlap(clip: SlapName) {
      slap.current = { at: performance.now(), clip };
    },
  };
}

type HitClock = ReturnType<typeof createHitClock>;

/**
 * Owns the in-flight shots. It lives inside <Canvas> so adding and removing
 * shots commits in the R3F renderer, not in React DOM. Each shot's drei <Html>
 * label is its own React DOM root, and unmounting one during a React DOM render
 * triggers React's "synchronously unmount a root while React was already
 * rendering" warning.
 */
function Shots({ feed, hits }: { feed: ShotFeed; hits: HitClock }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const queue = useRef<SceneMessage[]>([]);
  // A ref, not an effect local: Strict Mode runs effects twice in dev, and a
  // counter that restarts per run hands out duplicate keys.
  const nextKey = useRef(0);

  useEffect(() => {
    const unsubscribe = feed.subscribe((message) => {
      queue.current.push(message);
      if (queue.current.length > MAX_QUEUED) queue.current.shift();
    });
    const id = setInterval(() => {
      const message = queue.current.shift();
      if (!message) return;
      nextKey.current += 1;
      const shot = { key: nextKey.current, message };
      setShots((s) => [...s, shot]);
    }, SHOT_GAP_MS);
    return () => {
      unsubscribe();
      clearInterval(id);
    };
  }, [feed]);

  // Stable callbacks so memoized shots already in flight skip re-rendering
  // when a shot is added or removed.
  const onArrive = useCallback(() => hits.mark("victim"), [hits]);
  const onBlocked = useCallback((clip: SlapName) => hits.startSlap(clip), [hits]);
  const onDone = useCallback((key: number) => {
    setShots((s) => s.filter((x) => x.key !== key));
  }, []);

  return shots.map(({ key, message }) => (
    <MessageShot
      key={key}
      shotKey={key}
      message={message}
      from={SENDER_EDGE}
      to={RECEIVER_CATCH}
      onArrive={onArrive}
      onBlocked={onBlocked}
      onDone={onDone}
    />
  ));
}

/**
 * Sets the camera's vertical fov so the frame above just fits the band at any
 * aspect ratio: a wide band zooms in until the blobs fill its height, and a
 * narrow (phone) band zooms out so neither blob is cut off at the sides.
 */
function FitCamera() {
  const get = useThree((s) => s.get);
  const aspect = useThree((s) => s.size.width / Math.max(s.size.height, 1));

  useEffect(() => {
    // Read from the store, not a hook value: the camera is a three.js object
    // R3F owns, and the React compiler lint forbids mutating hook results.
    const { camera } = get();
    if (!(camera instanceof PerspectiveCamera)) return;
    const halfH = Math.max(FRAME_HALF_H, FRAME_HALF_W / aspect);
    camera.fov = MathUtils.radToDeg(2 * Math.atan(halfH / CAMERA_DISTANCE));
    camera.updateProjectionMatrix();
  }, [get, aspect]);

  return null;
}

const projected = new Vector3();

/**
 * Moves a DOM label to its blob's anchor every frame. Labels are plain
 * elements over the canvas, not drei <Html>: the Sender's <Html> label never
 * appeared (twice), while the same code showed the Receiver's.
 */
function TrackLabel({
  anchorRef,
  labelRef,
}: {
  anchorRef: RefObject<Object3D | null>;
  labelRef: RefObject<HTMLSpanElement | null>;
}) {
  useFrame(({ camera, size }) => {
    const anchor = anchorRef.current;
    const el = labelRef.current;
    if (!anchor || !el) return;
    anchor.getWorldPosition(projected).project(camera);
    const x = ((projected.x + 1) / 2) * size.width;
    const y = ((1 - projected.y) / 2) * size.height;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    el.style.visibility = "visible";
  });
  return null;
}

/** A blob's name, positioned by TrackLabels; hidden until the first frame places it. */
function BlobLabel({ text, className, ref }: { text: string; className: string; ref: RefObject<HTMLSpanElement | null> }) {
  return (
    <span
      ref={ref}
      style={{ visibility: "hidden" }}
      className={`pointer-events-none absolute left-0 top-0 z-10 whitespace-nowrap bg-ink px-2 py-1 font-label text-[11px] font-bold uppercase tracking-[0.06em] ${className}`}
    >
      {text}
    </span>
  );
}

/**
 * The scene band on /messages: every message the page receives flies from the
 * sender bean to T-Guard's hand; the hand slaps blocked ones away, and
 * delivered ones make the Receiver bean behind it bounce.
 * It renders the gateway's decision and never makes one.
 */
export default function Scene({ feed }: { feed: ShotFeed }) {
  const [hits] = useState(createHitClock);
  const senderAnchor = useRef<Object3D>(null);
  const victimAnchor = useRef<Object3D>(null);
  const senderLabel = useRef<HTMLSpanElement>(null);
  const victimLabel = useRef<HTMLSpanElement>(null);
  const receiverAnchor = useRef<Object3D>(null);
  const receiverLabel = useRef<HTMLSpanElement>(null);

  return (
    <div className="relative h-full w-full bg-paper">
      {/* No `shadows`: nothing receives a shadow map. ContactShadows draws the
          ground shadow on its own. */}
      {/* Local clipping cuts the hand off at the top of its box. */}
      <Canvas
        camera={CAMERA}
        dpr={DPR}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
        }}
      >
        <FitCamera />
        <TrackLabel anchorRef={senderAnchor} labelRef={senderLabel} />
        <TrackLabel anchorRef={victimAnchor} labelRef={victimLabel} />
        <TrackLabel anchorRef={receiverAnchor} labelRef={receiverLabel} />
        <color attach="background" args={["#f2f0e9"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 6, 5]} intensity={1.6} />
        <pointLight position={[-4, 2, 3]} intensity={6} color="#ffcee6" />

        <Blob
          position={[SENDER_X, 0, 0]}
          color="#94a3b8"
          facing={1}
          hitAt={hits.at.sender}
          phase={1.3}
          labelAnchor={senderAnchor}
        />
        {/* The person T-Guard protects, behind the hand. Delivered messages make it bounce. */}
        <Blob
          position={RECEIVER_POSITION}
          color="#f472b6"
          facing={-1}
          hitAt={hits.at.victim}
          phase={0.6}
          labelAnchor={receiverAnchor}
        />
        {/* The hand and bubble images load once; the sender blob doesn't wait on them. */}
        <Suspense fallback={null}>
          <Hand hitAt={hits.at.victim} slap={hits.slap} labelAnchor={victimAnchor} />
          <Shots feed={feed} hits={hits} />
        </Suspense>

        <ContactShadows position={[0, -1.1, 0]} opacity={0.5} scale={14} blur={2.4} far={3} resolution={256} />
      </Canvas>
      <BlobLabel ref={senderLabel} text="Sender" className="text-paper" />
      <BlobLabel ref={victimLabel} text="T-Guard" className="text-hot" />
      <BlobLabel ref={receiverLabel} text="Receiver" className="text-paper" />
    </div>
  );
}
