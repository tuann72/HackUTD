"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { diffMessages, type MessageChange } from "./diff";
import type { BlockActions } from "./actions";
import { pickSource, type MessageSource, type SourceMode } from "./source";
import type { Message } from "./types";

export interface UseMessagesOptions {
  /** Poll interval in ms. Default 1500. */
  intervalMs?: number;
  /** Force a source. Default: `?source=` query param, then env. */
  source?: MessageSource;
  /** Called with what changed since the last poll (for animations). */
  onChanges?: (changes: MessageChange[]) => void;
}

export interface UseMessagesResult {
  messages: Message[];
  mode: SourceMode | null;
  /** Last fetch error, if the most recent poll failed. Polling keeps going. */
  error: string | null;
  /** Deletes every message at the source, then empties the list. Live sources need the action password. Null when the source can't clear. */
  clear: ((password?: string) => Promise<void>) | null;
  /** Unblock and Clear blocks at the source. Null until loaded, and for the mock sources. */
  actions: BlockActions | null;
  /** Polls now instead of waiting for the next tick (e.g. right after an unblock). */
  refresh: () => void;
}

/**
 * Polls the gateway's GET /api/messages (or a mock source) and returns the
 * list, newest first. Shared by the message UI and the 3D scene.
 */
export function useMessages({ intervalMs = 1500, source, onChanges }: UseMessagesOptions = {}): UseMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [mode, setMode] = useState<SourceMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<BlockActions | null>(null);
  const prev = useRef<Message[]>([]);
  const srcRef = useRef<MessageSource | null>(null);
  // Bumped by clear() so a poll that started before the delete can't put the old list back.
  const generation = useRef(0);
  const kick = useRef<() => void>(() => {});
  const onChangesRef = useRef(onChanges);
  useEffect(() => {
    onChangesRef.current = onChanges;
  }, [onChanges]);

  useEffect(() => {
    let src: MessageSource | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let running = false;

    const tick = async () => {
      if (running) return;
      running = true;
      try {
        if (!src) {
          src = source ?? pickSource(new URLSearchParams(window.location.search).get("source"));
          srcRef.current = src;
          setMode(src.mode);
          setActions(src.actions ?? null);
        }
        const gen = generation.current;
        const next = await src.fetch();
        if (stopped || gen !== generation.current) return;
        const changes = diffMessages(prev.current, next);
        prev.current = next;
        setMessages(next);
        setError(null);
        if (changes.length) onChangesRef.current?.(changes);
      } catch (e) {
        if (!stopped) setError(String(e instanceof Error ? e.message : e));
      } finally {
        running = false;
        if (!stopped) {
          clearTimeout(timer);
          timer = setTimeout(tick, intervalMs);
        }
      }
    };
    // A poll already in flight may predate the change; the next tick picks it up.
    kick.current = () => {
      if (stopped || running) return;
      clearTimeout(timer);
      void tick();
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      kick.current = () => {};
    };
  }, [intervalMs, source]);

  const clear = useCallback(async (password?: string) => {
    await srcRef.current?.clear?.(password);
    generation.current++;
    prev.current = [];
    setMessages([]);
  }, []);

  const refresh = useCallback(() => kick.current(), []);

  return {
    messages,
    mode,
    error,
    clear: mode && mode !== "static" ? clear : null,
    actions,
    refresh,
  };
}
