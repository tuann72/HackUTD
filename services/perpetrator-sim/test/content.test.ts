import { describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.ts";
import { contentPhones, guessMimeType, parseContent } from "../src/content.ts";
import { buildSignedRequest } from "../src/sender.ts";
import { buildInboundMessage } from "../src/spectrum-request.ts";
import { loadScenario, parseScenario } from "../src/steps.ts";

const config = {
  webhookUrl: "http://localhost:8787/webhooks/photon",
  webhookSecret: "dev-photon-webhook-secret-change-me",
  victimNumber: "+15555550100",
};
const base = { from: "+15555550142", line: "+15555550100" };

function capture() {
  const lines: string[] = [];
  return { lines, log: (l: string) => lines.push(l), text: () => lines.join("\n") };
}

describe("payload shapes (what the gateway's photon.ts parser accepts)", () => {
  it("attachment: id, name, mimeType, size", () => {
    const p = buildInboundMessage({ ...base, content: { type: "attachment", name: "a.jpg", mimeType: "image/jpeg", size: 10 } });
    expect(p.message.content).toMatchObject({ type: "attachment", name: "a.jpg", mimeType: "image/jpeg", size: 10 });
    expect((p.message.content as { id: string }).id).toMatch(/^[0-9A-F-]{36}$/);
  });

  it("reaction: emoji and a target with contentPreview capped at 80 chars", () => {
    const p = buildInboundMessage({ ...base, content: { type: "reaction", emoji: "❤️", targetPreview: "x".repeat(100) } });
    const c = p.message.content as { emoji: string; target: { id: string; platform: string; contentPreview: string } };
    expect(c.emoji).toBe("❤️");
    expect(c.target).toMatchObject({ platform: "imessage" });
    expect(c.target.id).toMatch(/^spc-msg-/);
    expect(c.target.contentPreview).toHaveLength(80);
  });

  it("contact and richlink pass through", () => {
    expect(buildInboundMessage({ ...base, content: { type: "contact", name: "Bank", phones: ["+15555550199"] } }).message.content).toEqual({
      type: "contact",
      name: "Bank",
      phones: ["+15555550199"],
    });
    expect(buildInboundMessage({ ...base, content: { type: "richlink", url: "https://x.example" } }).message.content).toEqual({
      type: "richlink",
      url: "https://x.example",
    });
  });

  it("album: items are full inbound messages with their own ids", () => {
    const p = buildInboundMessage({
      ...base,
      content: { type: "group", items: [{ type: "text", text: "Lake!" }, { type: "attachment", name: "a.heic", mimeType: "image/heic" }] },
    });
    const items = (p.message.content as { items: Array<Record<string, any>> }).items;
    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(it).toMatchObject({ platform: "imessage", direction: "inbound", sender: { id: base.from, platform: "imessage" } });
      expect(it.id).toMatch(/^spc-msg-/);
      expect(it.id).not.toBe(p.message.id);
    }
    expect(items[0]!.content).toEqual({ type: "text", text: "Lake!" });
  });

  it("group chats set space.type and space.id; DMs keep the any;-; id", () => {
    const g = buildInboundMessage({ ...base, body: "hi", group: "family-chat" });
    expect(g.space).toEqual({ id: "family-chat", platform: "imessage", type: "group", phone: base.line });
    expect(g.message.space).toEqual(g.space);
    expect(buildInboundMessage({ ...base, body: "hi" }).space).toMatchObject({ id: "any;-;+15555550142", type: "dm" });
  });

  it("the signature still covers the whole JSON body", () => {
    const req = buildSignedRequest(config, { from: base.from, body: "", content: { type: "reaction", emoji: "👍" } });
    expect(JSON.parse(req.body)).toEqual(req.payload);
    expect(req.headers["X-Spectrum-Signature"]).toMatch(/^v0=[0-9a-f]{64}$/);
  });
});

describe("scenario content parsing", () => {
  it("accepts content or body, not both, and validates shapes", () => {
    const ok = parseScenario('{"delayMs":0,"from":"+15555550142","content":{"type":"attachment","name":"a.PNG"},"group":"g1"}');
    expect(ok[0]).toMatchObject({ body: "", group: "g1", content: { type: "attachment", name: "a.PNG", mimeType: "image/png" } });
    const bad = [
      '{"delayMs":0,"from":"+15555550142","body":"hi","content":{"type":"text","text":"x"}}',
      '{"delayMs":0,"from":"+15555550142","content":{"type":"poll"}}',
      '{"delayMs":0,"from":"+15555550142","content":{"type":"group","items":[]}}',
      '{"delayMs":0,"from":"+15555550142","content":{"type":"group","items":[{"type":"reaction","emoji":"x"}]}}',
      '{"delayMs":0,"from":"+15555550142","content":{"type":"contact","phones":[1]}}',
      '{"delayMs":0,"from":"+15555550142","body":"hi","group":""}',
    ];
    for (const line of bad) expect(() => parseScenario(line)).toThrow();
  });

  it("loads the imessage-demo scenario with every kind", () => {
    const steps = loadScenario("imessage-demo");
    const types = new Set(steps.map((s) => s.content?.type ?? "text"));
    expect(types).toEqual(new Set(["text", "group", "reaction", "attachment", "richlink", "contact"]));
    expect(steps.some((s) => s.group)).toBe(true);
    const total = steps.reduce((t, s) => t + s.delayMs, 0);
    expect(total).toBeGreaterThanOrEqual(60_000);
    expect(total).toBeLessThanOrEqual(90_000);
  });

  it("finds contact phones for the safety rail, and guesses mime types", () => {
    expect(contentPhones(parseContent({ type: "contact", phones: ["+15555550199"] }, "x"))).toEqual(["+15555550199"]);
    expect(guessMimeType("IMG_1.HEIC")).toBe("image/heic");
    expect(guessMimeType("weird.bin")).toBe("application/octet-stream");
  });
});

describe("safety rail and dry run", () => {
  const run = (argv: string[], log = () => {}) =>
    main(argv, { config, fetch: vi.fn() as never, sleep: async () => {}, log });

  it("refuses a real number on a contact card unless allowed", async () => {
    const dir = await import("node:fs/promises");
    const tmp = new URL("./tmp-real-contact.jsonl", import.meta.url);
    await dir.writeFile(tmp, '{"delayMs":0,"from":"+15555550142","content":{"type":"contact","name":"x","phones":["+12145551234"]}}\n');
    try {
      expect(await run(["scenario", tmp.pathname, "--dry-run"])).toBe(2);
      expect(await run(["scenario", tmp.pathname, "--dry-run", "--allow-real-numbers"])).toBe(0);
    } finally {
      await dir.rm(tmp);
    }
  });

  it("dry-runs the demo scenario and describes each kind", async () => {
    const out = capture();
    expect(await run(["scenario", "imessage-demo", "--dry-run"], out.log as never)).toBe(0);
    expect(out.lines.filter((l) => l.includes("X-Spectrum-Signature: v0="))).toHaveLength(10);
    expect(out.text()).toContain("in group family-chat");
    expect(out.text()).toContain('"type":"reaction"');
    expect(out.text()).toContain('"type":"contact"');
  });

  it("send flags build attachments, captioned albums, reactions and group messages", async () => {
    const out = capture();
    expect(await run(["send", "--from", "+15555550142", "--attachment", "a.jpg", "--dry-run"], out.log as never)).toBe(0);
    expect(out.text()).toContain('"type":"attachment"');
    expect(out.text()).toContain('"mimeType":"image/jpeg"');
    const album = capture();
    expect(await run(["send", "--from", "+15555550142", "--attachment", "a.jpg", "look", "--group", "g1", "--dry-run"], album.log as never)).toBe(0);
    expect(album.text()).toContain('"type":"group"');
    expect(album.text()).toContain('"id":"g1"');
    const react = capture();
    expect(await run(["send", "--from", "+15555550142", "--react", "👍", "See you", "--dry-run"], react.log as never)).toBe(0);
    expect(react.text()).toContain('"contentPreview":"See you"');
    expect(await run(["send", "--from", "+15555550142", "--react", "👍", "--attachment", "a.jpg"])).toBe(2);
  });
});
