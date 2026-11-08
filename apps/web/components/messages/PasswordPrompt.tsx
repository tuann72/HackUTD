"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { actionErrorText } from "@/lib/messages";

/**
 * Asks for the action password, then runs `onSubmit` with it. The password is never
 * checked here: the server answers 401 for a wrong one, shown as "Wrong password".
 * Mount it only while open; Escape, Cancel or the backdrop closes it.
 */
export function PasswordPrompt({
  title,
  description,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  /** Throws (ActionError) on failure; resolving closes the prompt. */
  onSubmit: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const descId = useId();
  const errorId = useId();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(password);
      onClose();
    } catch (err) {
      setError(actionErrorText(err));
      setPassword("");
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descId}
      // Escape fires "cancel"; let the parent unmount us instead of the browser closing it.
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      className="m-auto w-[min(22rem,calc(100vw-2rem))] border border-ink bg-card p-0 text-ink shadow-[5px_10px_30px_-12px_#2d233180] backdrop:bg-ink/40"
    >
      <form onSubmit={submit} className="flex flex-col gap-4 p-5">
        <h2 id={titleId} className="font-label text-[13px] font-bold uppercase tracking-[0.06em]">
          {title}
        </h2>
        <p id={descId} className="text-sm text-muted">
          {description}
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="font-label text-[10px] font-bold uppercase tracking-[0.06em] text-muted">Password</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="border border-ink bg-paper px-3 py-2 text-base tracking-[0.2em] text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot aria-invalid:border-hot"
          />
        </label>
        {error && (
          <p id={errorId} role="alert" className="-mt-2 text-sm font-bold text-hot-deep">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="border border-rule px-4 py-2.5 font-label text-[10px] uppercase tracking-[0.06em] text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hot disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !password}
            className="border border-hot bg-hot px-4 py-2.5 font-label text-[10px] font-bold uppercase tracking-[0.06em] text-white transition-colors hover:border-hot-deep hover:bg-hot-deep focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Checking…" : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
