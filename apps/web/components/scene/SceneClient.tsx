"use client";

import dynamic from "next/dynamic";
import type { ShotFeed } from "./feed";
import type { Guard } from "./Scene";

// WebGL only exists in the browser, so the scene skips prerendering.
const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-paper" />,
});

/** Fills its parent; the parent sets the height. */
export function SceneClient({ feed, guard }: { feed: ShotFeed; guard?: Guard }) {
  return <Scene feed={feed} guard={guard} />;
}
