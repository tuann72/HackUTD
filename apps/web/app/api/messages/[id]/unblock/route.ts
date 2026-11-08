// Unblock one message (contracts/README.md, "Unblock and Clear blocks"). Needs X-Action-Password.
import { handleUnblock } from "@/lib/server/actions";
import { getStore, storeUnavailable } from "@/lib/server/inbox";

export async function POST(request: Request, ctx: RouteContext<"/api/messages/[id]/unblock">) {
  const { id } = await ctx.params;
  try {
    return await handleUnblock(request, id, { store: () => getStore() });
  } catch (err) {
    return storeUnavailable("api/messages/unblock", err);
  }
}
