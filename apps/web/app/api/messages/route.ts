// Query API v1 (contracts/query-api.v1.schema.json) for messages received by /webhooks/photon.
// Point the page at it with NEXT_PUBLIC_API_URL=https://<this site>.
import { getStore, storeUnavailable } from "@/lib/server/inbox";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("limit");
  const limit = raw === null ? 100 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return Response.json({ error: "limit must be an integer from 1 to 200" }, { status: 400 });
  }
  try {
    const messages = await (await getStore()).list(limit);
    return Response.json({ schema: "t-gate.query-api", version: 1, messages }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storeUnavailable("api/messages", err);
  }
}

// The page's "Clear chats" button (Tuan, 2026-11-08): deletes every stored message. Unauthenticated by choice.
export async function DELETE() {
  try {
    const cleared = await (await getStore()).clear();
    return Response.json({ ok: true, cleared }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storeUnavailable("api/messages", err);
  }
}
