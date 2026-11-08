"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { Vector3 } from "three";
import { Blob, BLOB_RADIUS } from "./Blob";
import { MessageShot } from "./MessageShot";
import type { SceneMessage, ShotFeed } from "./feed";

const SENDER_X = -3.2;
const VICTIM_X = 3.2;
/** Shots leave and land on the blob surfaces, not their centers. */
const SENDER_EDGE = new Vector3(SENDER_X + BLOB_RADIUS, 0.1, 0);
const VICTIM_EDGE = new Vector3(VICTIM_X - BLOB_RADIUS, 0.1, 0);
/** Minimum gap between shots, so a burst of messages doesn't fire all at once. */
const SHOT_GAP_MS = 600;
/**
 * At most this many shots wait to fire; older ones are dropped. A first poll
 * can return many messages at once, and only the newest are worth animating.
 */
const MAX_QUEUED = 5;
const CAMERA = { position: [0, 1.6, 8.5] as [number, number, number], fov: 45 };
/** Capped below 2 so Retina screens don't render 4x the pixels. */
const DPR: [number, number] = [1, 1.5];

interface Shot {
  key: number;
  message: SceneMessage;
}

/**
 * performance.now() of the last hit on the victim and of its last shield
 * flash. Blobs read these in useFrame to animate; shots mark them.
 */
function createHitClock() {
  const at = { victim: { current: 0 }, sender: { current: 0 }, shield: { current: 0 } };
  return {
    at,
    mark(kind: keyof typeof at) {
      at[kind].current = performance.now();
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
  const onBlocked = useCallback(() => hits.mark("shield"), [hits]);
  const onDone = useCallback((key: number) => {
    setShots((s) => s.filter((x) => x.key !== key));
  }, []);

  return shots.map(({ key, message }) => (
    <MessageShot
      key={key}
      shotKey={key}
      message={message}
      from={SENDER_EDGE}
      to={VICTIM_EDGE}
      onArrive={onArrive}
      onBlocked={onBlocked}
      onDone={onDone}
    />
  ));
}

/**
 * The scene band on the home page: every message the page receives flies from
 * the sender to the victim; blocked ones pop in front of the victim's shield.
 * It renders the gateway's decision and never makes one.
 */
export default function Scene({ feed }: { feed: ShotFeed }) {
  const [hits] = useState(createHitClock);

  return (
    <div className="relative h-full w-full bg-[#0b1020]">
      {/* No `shadows`: nothing receives a shadow map. ContactShadows draws the
          ground shadow on its own. */}
      <Canvas camera={CAMERA} dpr={DPR}>
        <color attach="background" args={["#0b1020"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 6, 5]} intensity={1.6} />
        <pointLight position={[-4, 2, 3]} intensity={8} color="#93c5fd" />

        <Blob
          position={[SENDER_X, 0, 0]}
          color="#94a3b8"
          facing={1}
          hitAt={hits.at.sender}
          phase={1.3}
          label="Sender"
          labelClass="text-slate-100"
        />
        <Blob
          position={[VICTIM_X, 0, 0]}
          color="#f472b6"
          facing={-1}
          hitAt={hits.at.victim}
          shieldAt={hits.at.shield}
          label="Receiver"
          labelClass="text-pink-300"
        />

        {/* The bubble images load once; nothing else waits on them. */}
        <Suspense fallback={null}>
          <Shots feed={feed} hits={hits} />
        </Suspense>

        <ContactShadows position={[0, -1.1, 0]} opacity={0.5} scale={14} blur={2.4} far={3} resolution={256} />
      </Canvas>
    </div>
  );
}
