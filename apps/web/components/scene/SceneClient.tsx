"use client";

import dynamic from "next/dynamic";
import type { ShotFeed } from "./feed";

// WebGL only exists in the browser, so the scene skips prerendering.
const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#0b1020]" />,
});

/** Fills its parent; the parent sets the height. */
export function SceneClient({ feed }: { feed: ShotFeed }) {
  return <Scene feed={feed} />;
}
