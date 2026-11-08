// Hands messages from the page's data (useMessages) to the 3D scene without
// re-rendering it: the page pushes, the scene subscribes. No three.js imports,
// so the page can use this without pulling the scene into its bundle.

import { defangText } from "@/components/messages/defang";
import { isPotentialScam, summarize, type Message } from "@/lib/messages";

/** What the scene needs to animate one resolved message. */
export interface SceneMessage {
  /** Short label under the bubble, defanged (no live links or numbers). */
  label: string;
  /** The gateway flagged it (red bubble). */
  potentialScam: boolean;
  /** The gateway blocked it (pops before reaching the victim). */
  blocked: boolean;
}

export interface ShotFeed {
  push(message: SceneMessage): void;
  subscribe(listener: (message: SceneMessage) => void): () => void;
}

export function createShotFeed(): ShotFeed {
  const listeners = new Set<(message: SceneMessage) => void>();
  return {
    push(message) {
      listeners.forEach((l) => l(message));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const LABEL_CHARS = 34;

/** Display mapping only: the action and verdict come from the gateway. */
export function toSceneMessage(m: Message): SceneMessage {
  const text = defangText(summarize(m));
  return {
    label: text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1)}…` : text,
    potentialScam: isPotentialScam(m),
    blocked: m.action === "blocked",
  };
}
