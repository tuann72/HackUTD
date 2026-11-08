// The password-protected writes from contracts/README.md, "Unblock and Clear blocks".
// The password is whatever the user typed; the server checks it. Nothing here knows it.

export interface BlocklistStatus {
  enabled: boolean;
  blockedSenders: number;
}

export interface UnblockResult {
  ok: true;
  messageId: string;
  /** true/false with the blocklist on, null when it's off. */
  allowlisted: boolean | null;
}

export interface ClearBlocksResult {
  ok: true;
  cleared: number;
  enabled: boolean;
}

/** A failed write, with the HTTP status (401 wrong password, 404, 409, ...). status 0 = network error. */
export class ActionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

export interface BlockActions {
  blocklist(): Promise<BlocklistStatus>;
  unblock(messageId: string, password: string): Promise<UnblockResult>;
  clearBlocks(password: string): Promise<ClearBlocksResult>;
}

/** Short, user-facing text for a failed write. */
export function actionErrorText(err: unknown): string {
  if (err instanceof ActionError) {
    if (err.status === 401) return "Wrong password";
    if (err.status === 404) return "That message is gone. It may have been cleared.";
    if (err.status === 409) return "That message isn't blocked anymore.";
    if (err.status === 0) return "Couldn't reach the gateway. Try again.";
    return `Something went wrong (${err.status}). Try again.`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** "Unblocked 3 senders", "Unblocked 1 sender", or why nothing changed. */
export function clearBlocksText(r: ClearBlocksResult): string {
  if (!r.enabled) return "The sender blocklist is off, so no senders were blocked.";
  if (r.cleared === 0) return "No senders were blocked.";
  return `Unblocked ${r.cleared} sender${r.cleared === 1 ? "" : "s"}`;
}

export function blockActions(apiUrl: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): BlockActions {
  const base = apiUrl.replace(/\/+$/, "");
  const send = async <T>(path: string, init: RequestInit): Promise<T> => {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, { cache: "no-store", ...init });
    } catch (e) {
      throw new ActionError(0, e instanceof Error ? e.message : String(e));
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      throw new ActionError(res.status, typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  };
  const post = <T>(path: string, password: string) =>
    send<T>(path, { method: "POST", headers: { "X-Action-Password": password } });

  return {
    async blocklist() {
      const r = await send<BlocklistStatus>("/api/blocklist", { method: "GET" });
      return { enabled: r.enabled === true, blockedSenders: Number(r.blockedSenders) || 0 };
    },
    unblock: (id, password) => post<UnblockResult>(`/api/messages/${encodeURIComponent(id)}/unblock`, password),
    clearBlocks: (password) => post<ClearBlocksResult>("/api/blocklist/clear", password),
  };
}
