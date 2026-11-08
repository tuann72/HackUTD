// The Vercel backup has no sender blocklist, so it always reports it off.
import { handleBlocklistStatus } from "@/lib/server/actions";

export function GET() {
  return handleBlocklistStatus();
}
