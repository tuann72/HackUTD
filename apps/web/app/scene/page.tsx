import type { Metadata } from "next";
import { SceneClient } from "@/components/scene/SceneClient";

export const metadata: Metadata = {
  title: "Scene · T-Gate",
  description: "3D demo: a sender shoots messages at the victim; potential scams are blocked",
};

export default function ScenePage() {
  return <SceneClient />;
}
