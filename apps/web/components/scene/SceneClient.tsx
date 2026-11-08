"use client";

import dynamic from "next/dynamic";

// WebGL only exists in the browser, so the scene skips prerendering.
const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => <div className="h-dvh w-full bg-[#0b1020]" />,
});

export function SceneClient() {
  return <Scene />;
}
