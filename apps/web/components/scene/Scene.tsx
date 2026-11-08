"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
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

interface Shot {
  key: number;
  message: FakeMessage;
}

type HitRef = RefObject<number>;

interface ShotsProps {
  victimHit: HitRef;
  victimShield: HitRef;
  senderHit: HitRef;
  onDelivered: () => void;
  onBlocked: () => void;
}

/**
 * Owns the in-flight shots. It lives inside <Canvas> so adding and removing
 * shots commits in the R3F renderer, not in React DOM. Each shot's drei <Html>
 * label is its own React DOM root, and unmounting one during a React DOM render
 * (which is what happened when this state lived in Scene) triggers React's
 * "synchronously unmount a root while React was already rendering" warning.
 */
function Shots({ victimHit, victimShield, senderHit, onDelivered, onBlocked }: ShotsProps) {
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

  const remove = useCallback((key: number) => {
    setShots((s) => s.filter((x) => x.key !== key));
  }, []);

  return shots.map(({ key, message }) => {
    const toVictim = message.direction === "toVictim";
    return (
      <MessageShot
        key={key}
        message={message}
        from={toVictim ? SENDER_EDGE : VICTIM_EDGE}
        to={toVictim ? VICTIM_EDGE : SENDER_EDGE}
        onArrive={() => {
          (toVictim ? victimHit : senderHit).current = performance.now();
          onDelivered();
        }}
        onBlocked={() => {
          victimShield.current = performance.now();
          onBlocked();
        }}
        onDone={() => remove(key)}
      />
    );
  });
}

export default function Scene() {
  const [counts, setCounts] = useState({ delivered: 0, blocked: 0 });
  const victimHit = useRef(0);
  const victimShield = useRef(0);
  const senderHit = useRef(0);

  const onDelivered = useCallback(() => setCounts((c) => ({ ...c, delivered: c.delivered + 1 })), []);
  const onBlocked = useCallback(() => setCounts((c) => ({ ...c, blocked: c.blocked + 1 })), []);

  return (
    <div className="relative h-dvh w-full bg-[#0b1020]">
      <Canvas shadows="percentage" camera={{ position: [0, 1.6, 8.5], fov: 45 }} dpr={[1, 2]}>
        <color attach="background" args={["#0b1020"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 6, 5]} intensity={1.6} castShadow />
        <pointLight position={[-4, 2, 3]} intensity={8} color="#93c5fd" />

        <Blob position={[SENDER_X, 0, 0]} color="#94a3b8" facing={1} hitAt={senderHit} phase={1.3} />
        <Blob position={[VICTIM_X, 0, 0]} color="#f472b6" facing={-1} hitAt={victimHit} shieldAt={victimShield} />

        <Shots
          victimHit={victimHit}
          victimShield={victimShield}
          senderHit={senderHit}
          onDelivered={onDelivered}
          onBlocked={onBlocked}
        />

        <ContactShadows position={[0, -1.1, 0]} opacity={0.5} scale={14} blur={2.4} far={3} />
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
          <span className="mt-1 text-slate-400">
            Delivered {counts.delivered} · Blocked {counts.blocked}
          </span>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-[12%] pb-6 text-sm font-medium text-slate-300">
        <span>Sender</span>
        <span className="text-pink-300">Victim (protected)</span>
      </div>
    </div>
  );
}
