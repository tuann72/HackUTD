"use client";

import { useEffect, useRef, useState } from "react";
import { diffMessages, type MessageChange } from "./diff";
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
}

/**
 * Polls the gateway's GET /api/messages (or a mock source) and returns the
 * list, newest first. Shared by the message UI and the 3D scene.
 */
export function useMessages({ intervalMs = 1500, source, onChanges }: UseMessagesOptions = {}): UseMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [mode, setMode] = useState<SourceMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prev = useRef<Message[]>([]);
  const onChangesRef = useRef(onChanges);
  useEffect(() => {
    onChangesRef.current = onChanges;
  }, [onChanges]);

  useEffect(() => {
    let src: MessageSource | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        if (!src) {
          src = source ?? pickSource(new URLSearchParams(window.location.search).get("source"));
          setMode(src.mode);
        }
        const next = await src.fetch();
        if (stopped) return;
        const changes = diffMessages(prev.current, next);
        prev.current = next;
        setMessages(next);
        setError(null);
        if (changes.length) onChangesRef.current?.(changes);
      } catch (e) {
        if (!stopped) setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!stopped) timer = setTimeout(tick, intervalMs);
      }
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [intervalMs, source]);

  return { messages, mode, error };
}
