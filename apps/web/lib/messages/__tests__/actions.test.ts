import { describe, expect, it } from "vitest";
import { ActionError, actionErrorText, blockActions, clearBlocksText } from "../actions";
import { liveSource, replaySource, staticSource } from "../source";

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown, calls: Call[] = []) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("blockActions", () => {
  it("sends the typed password as X-Action-Password to the contract paths", async () => {
    const calls: Call[] = [];
    const a = blockActions("https://gw.example/", fakeFetch(200, { ok: true, messageId: "m 1", allowlisted: null }, calls));
    expect(await a.unblock("m 1", "4321")).toEqual({ ok: true, messageId: "m 1", allowlisted: null });
    await a.clearBlocks("4321");
    expect(calls.map((c) => [c.url, c.init.method, new Headers(c.init.headers).get("x-action-password")])).toEqual([
      ["https://gw.example/api/messages/m%201/unblock", "POST", "4321"],
      ["https://gw.example/api/blocklist/clear", "POST", "4321"],
    ]);
  });

  it("reads the blocklist status without a password", async () => {
    const calls: Call[] = [];
    const a = blockActions("https://gw", fakeFetch(200, { enabled: true, blockedSenders: 3 }, calls));
    expect(await a.blocklist()).toEqual({ enabled: true, blockedSenders: 3 });
    expect(calls[0]!.url).toBe("https://gw/api/blocklist");
    expect(new Headers(calls[0]!.init.headers).has("x-action-password")).toBe(false);
  });

  it("throws ActionError with the status, and turns it into short text", async () => {
    for (const [status, text] of [
      [401, "Wrong password"],
      [404, "That message is gone. It may have been cleared."],
      [409, "That message isn't blocked anymore."],
      [500, "Something went wrong (500). Try again."],
    ] as const) {
      const err = await blockActions("https://gw", fakeFetch(status, { error: "x" })).unblock("m", "1").catch((e) => e);
      expect(err).toBeInstanceOf(ActionError);
      expect(err.status).toBe(status);
      expect(actionErrorText(err)).toBe(text);
    }
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const err = await blockActions("https://gw", down).clearBlocks("1").catch((e) => e);
    expect(err.status).toBe(0);
    expect(actionErrorText(err)).toBe("Couldn't reach the gateway. Try again.");
  });

  it("words the Clear blocks result", () => {
    expect(clearBlocksText({ ok: true, cleared: 3, enabled: true })).toBe("Unblocked 3 senders");
    expect(clearBlocksText({ ok: true, cleared: 1, enabled: true })).toBe("Unblocked 1 sender");
    expect(clearBlocksText({ ok: true, cleared: 0, enabled: true })).toBe("No senders were blocked.");
    expect(clearBlocksText({ ok: true, cleared: 0, enabled: false })).toBe("The sender blocklist is off, so no senders were blocked.");
  });

  it("is only on the live source", () => {
    expect(liveSource("https://gw").actions).toBeDefined();
    expect(replaySource().actions).toBeUndefined();
    expect(staticSource().actions).toBeUndefined();
  });
});
