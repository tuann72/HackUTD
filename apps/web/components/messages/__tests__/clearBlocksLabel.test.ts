import { describe, expect, it } from "vitest";
import { clearBlocksLabel } from "../useBlocklist";

describe("clearBlocksLabel", () => {
  it("shows the count only when the blocklist is on", () => {
    expect(clearBlocksLabel({ enabled: true, blockedSenders: 3 })).toBe("Clear blocks (3)");
    expect(clearBlocksLabel({ enabled: true, blockedSenders: 0 })).toBe("Clear blocks (0)");
    expect(clearBlocksLabel({ enabled: false, blockedSenders: 0 })).toBe("Clear blocks");
    expect(clearBlocksLabel(null)).toBe("Clear blocks");
  });
});
