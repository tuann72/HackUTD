"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { Vector3 } from "three";
import { Blob, BLOB_RADIUS } from "./Blob";
import { MessageShot } from "./MessageShot";
import { FAKE_MESSAGES, type FakeMessage } from "./fakeMessages";

const SENDER_X = -3.2;
const VICTIM_X = 3.2;
/** Shots leave and land on the blob surfaces, not their centers. */
const SENDER_EDGE = new Vector3(SENDER_X + BLOB_RADIUS, 0.1, 0);
const VICTIM_EDGE = new Vector3(VICTIM_X - BLOB_RADIUS, 0.1, 0);
const SHOT_EVERY_MS = 1300;
const CAMERA = { position: [0, 1.6, 8.5] as [number, number, number], fov: 45 };
/** Capped below 2 so Retina screens don't render 4x the pixels. */
const DPR: [number, number] = [1, 1.5];

interface Shot {
  key: number;
  message: FakeMessage;
}

type Counts = { delivered: number; blocked: number };

/**
 * Delivered/blocked tally outside React state, so a tick re-renders only the
 * HUD line that shows it, not Scene and the whole <Canvas> tree.
 */
function createCounter() {
  let counts: Counts = { delivered: 0, blocked: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => counts,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    bump(kind: keyof Counts) {
      counts = { ...counts, [kind]: counts[kind] + 1 };
      listeners.forEach((l) => l());
    },
  };
}

type Counter = ReturnType<typeof createCounter>;

function CountsLine({ counter }: { counter: Counter }) {
  const counts = useSyncExternalStore(counter.subscribe, counter.get, counter.get);
  return (
    <span className="mt-1 text-slate-400">
      Delivered {counts.delivered} · Blocked {counts.blocked}
    </span>
  );
}

/**
 * performance.now() of the last hit on each blob (and of the victim's last
 * shield flash). Blobs read these in useFrame to animate; shots mark them.
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

interface ShotsProps {
  hits: HitClock;
  counter: Counter;
}

/**
 * Owns the in-flight shots. It lives inside <Canvas> so adding and removing
 * shots commits in the R3F renderer, not in React DOM. Each shot's drei <Html>
 * label is its own React DOM root, and unmounting one during a React DOM render
 * (which is what happened when this state lived in Scene) triggers React's
 * "synchronously unmount a root while React was already rendering" warning.
 */
function Shots({ hits, counter }: ShotsProps) {
  const [shots, setShots] = useState<Shot[]>([]);
  // Refs, not effect locals: Strict Mode runs the effect twice in dev, and a
  // counter that restarts per run hands out duplicate keys.
  const nextMessage = useRef(0);
  const nextKey = useRef(0);

  // Cycle through the fake messages forever.
  useEffect(() => {
    const fire = () => {
      const message = FAKE_MESSAGES[nextMessage.current % FAKE_MESSAGES.length];
      nextMessage.current += 1;
      nextKey.current += 1;
      const shot = { key: nextKey.current, message };
      setShots((s) => [...s, shot]);
    };
    fire();
    const id = setInterval(fire, SHOT_EVERY_MS);
    return () => clearInterval(id);
  }, []);

  // Stable callbacks so memoized shots already in flight skip re-rendering
  // when a shot is added or removed.
  const onArrive = useCallback(
    (message: FakeMessage) => {
      hits.mark(message.direction === "toVictim" ? "victim" : "sender");
      counter.bump("delivered");
    },
    [hits, counter],
  );
  const onBlocked = useCallback(() => {
    hits.mark("shield");
    counter.bump("blocked");
  }, [hits, counter]);
  const onDone = useCallback((key: number) => {
    setShots((s) => s.filter((x) => x.key !== key));
  }, []);

  return shots.map(({ key, message }) => {
    const toVictim = message.direction === "toVictim";
    return (
      <MessageShot
        key={key}
        shotKey={key}
        message={message}
        from={toVictim ? SENDER_EDGE : VICTIM_EDGE}
        to={toVictim ? VICTIM_EDGE : SENDER_EDGE}
        onArrive={onArrive}
        onBlocked={onBlocked}
        onDone={onDone}
      />
    );
  });
}

export default function Scene() {
  const [counter] = useState(createCounter);
  const [hits] = useState(createHitClock);

  return (
    <div className="relative h-dvh w-full bg-[#0b1020]">
      {/* No `shadows`: nothing receives a shadow map, so it was a wasted pass
          every frame. ContactShadows draws the ground shadow on its own. */}
      <Canvas camera={CAMERA} dpr={DPR}>
        <color attach="background" args={["#0b1020"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 6, 5]} intensity={1.6} />
        <pointLight position={[-4, 2, 3]} intensity={8} color="#93c5fd" />

        <Blob position={[SENDER_X, 0, 0]} color="#94a3b8" facing={1} hitAt={hits.at.sender} phase={1.3} />
        <Blob position={[VICTIM_X, 0, 0]} color="#f472b6" facing={-1} hitAt={hits.at.victim} shieldAt={hits.at.shield} />

        <Shots hits={hits} counter={counter} />

        <ContactShadows position={[0, -1.1, 0]} opacity={0.5} scale={14} blur={2.4} far={3} resolution={256} />
      </Canvas>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-4 text-sm text-slate-200">
        <div>
          <h1 className="text-lg font-semibold text-white">T-Gate</h1>
          <p className="text-slate-400">Demo with fake messages. Not connected to the gateway.</p>
        </div>
        <div className="flex flex-col gap-1 rounded-lg bg-slate-900/70 px-3 py-2">
          <span className="flex items-center gap-2">
            <i className="inline-block size-3 rounded-full bg-red-500" /> Potential scam
          </span>
          <span className="flex items-center gap-2">
            <i className="inline-block size-3 rounded-full bg-blue-200" /> Message
          </span>
          <CountsLine counter={counter} />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-[12%] pb-6 text-sm font-medium text-slate-300">
        <span>Sender</span>
        <span className="text-pink-300">Victim (protected)</span>
      </div>
    </div>
  );
}
