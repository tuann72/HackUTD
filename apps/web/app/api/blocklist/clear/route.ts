// "Clear blocks" (contracts/README.md). Needs X-Action-Password; nothing to clear on the Vercel backup.
import { handleBlocklistClear } from "@/lib/server/actions";

export function POST(request: Request) {
  return handleBlocklistClear(request);
}
