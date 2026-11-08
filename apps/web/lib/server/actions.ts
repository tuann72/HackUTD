// Server-only: the password-protected Unblock and Clear blocks writes for the Vercel backup
// (contracts/README.md, "Unblock and Clear blocks"). The VM gateway serves the same routes.
// The Vercel backup has no sender blocklist, so its blocklist routes always report it off.
import { createHash, timingSafeEqual } from "node:crypto";
import type { Store } from "./inbox";

const noStore = { "Cache-Control": "no-store" };

/** UI_ACTION_PASSWORD, default 4321 (Tuan, 2026-11-08); empty also means 4321, so a copied .env.example never sets "". Server-only. */
export function actionPassword(env: NodeJS.ProcessEnv = process.env): string {
  return env.UI_ACTION_PASSWORD || "4321";
}

/** Constant-time compare. Hashing first makes both sides the same length. */
export function passwordMatches(given: string | null, want: string): boolean {
  if (given == null) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}

/** null when `X-Action-Password` is right, else the 401 to send. */
export function checkActionPassword(req: Request, env: NodeJS.ProcessEnv = process.env): Response | null {
  if (passwordMatches(req.headers.get("x-action-password"), actionPassword(env))) return null;
  return Response.json({ error: "wrong password" }, { status: 401, headers: noStore });
}

/** POST /api/messages/:id/unblock: moves one blocked message to the inbox (reason `override`, verdict kept). */
export async function handleUnblock(
  req: Request,
  id: string,
  deps: { store: () => Promise<Store>; env?: NodeJS.ProcessEnv },
): Promise<Response> {
  // Password first, so a wrong password can't probe which ids exist.
  const denied = checkActionPassword(req, deps.env);
  if (denied) return denied;
  const store = await deps.store();
  const m = await store.get(id);
  if (!m) return Response.json({ error: "no such message" }, { status: 404, headers: noStore });
  if (m.action !== "blocked") return Response.json({ error: "message is not blocked" }, { status: 409, headers: noStore });
  await store.update(id, { action: "delivered", reason: "override", verdict: m.verdict });
  return Response.json({ ok: true, messageId: id, allowlisted: null }, { headers: noStore });
}

/** GET /api/blocklist. No password. */
export function handleBlocklistStatus(): Response {
  return Response.json({ enabled: false, blockedSenders: 0 }, { headers: noStore });
}

/** POST /api/blocklist/clear. Nothing to clear here, but the password is still checked. */
export function handleBlocklistClear(req: Request, env: NodeJS.ProcessEnv = process.env): Response {
  const denied = checkActionPassword(req, env);
  if (denied) return denied;
  return Response.json({ ok: true, cleared: 0, enabled: false }, { headers: noStore });
}
