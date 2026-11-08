import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verify } from "../src/fake-gateway.ts";
import { buildSignedRequest } from "../src/sender.ts";
import { buildInboundMessage, maskNumber, signBody } from "../src/spectrum-request.ts";
import { REPO_ROOT } from "../src/steps.ts";

const config = {
  webhookUrl: "http://localhost:8787/webhooks/photon",
  webhookSecret: "dev-photon-webhook-secret-change-me",
  victimNumber: "+15555550100",
};
const at = new Date("2026-11-08T15:04:05.000Z");
const nowS = at.getTime() / 1000;

describe("signature", () => {
  const req = buildSignedRequest(config, { from: "+15555550142", body: "Hi Grandma it's me" }, () => at);
  const sig = req.headers["X-Spectrum-Signature"]!;
  const ts = req.headers["X-Spectrum-Timestamp"]!;

  it("is v0= + HMAC-SHA256 over v0:<ts>:<raw body>, per Photon's docs", () => {
    expect(ts).toBe(String(nowS));
    const expected = "v0=" + createHmac("sha256", config.webhookSecret).update(`v0:${ts}:${req.body}`).digest("hex");
    expect(sig).toBe(expected);
    expect(sig).toMatch(/^v0=[0-9a-f]{64}$/);
    expect(signBody(config.webhookSecret, ts, req.body)).toBe(sig);
  });

  it("verifies, and fails for a wrong secret, tampered body or stale timestamp", () => {
    expect(verify(config.webhookSecret, sig, ts, req.body, nowS)).toBe(true);
    expect(verify("other", sig, ts, req.body, nowS)).toBe(false);
    expect(verify(config.webhookSecret, sig, ts, req.body.replace("Grandma", "Grandpa"), nowS)).toBe(false);
    expect(verify(config.webhookSecret, sig, ts, req.body, nowS + 301)).toBe(false);
  });

  it("sends JSON with the Spectrum headers", () => {
    expect(req.headers["Content-Type"]).toBe("application/json");
    expect(req.headers["X-Spectrum-Event"]).toBe("messages");
    expect(JSON.parse(req.body)).toEqual(req.payload);
  });
});

describe("payload", () => {
  const fixture = JSON.parse(
    readFileSync(join(REPO_ROOT, "contracts/fixtures/photon-inbound-imessage.sample.json"), "utf8"),
  ) as { body: Record<string, any> };

  it("reproduces the fixture for the fixture's inputs", () => {
    const f = fixture.body;
    const p = buildInboundMessage({
      from: f.message.sender.id,
      line: f.space.phone,
      body: f.message.content.text,
      messageId: f.message.id,
      timestamp: f.message.timestamp,
    });
    expect(p).toEqual(f);
  });

  it("uses a fresh spc-msg-<uuid> id per message", () => {
    const a = buildInboundMessage({ from: "+15555550142", line: "+15555550100", body: "hi" });
    const b = buildInboundMessage({ from: "+15555550142", line: "+15555550100", body: "hi" });
    expect(a.message.id).toMatch(/^spc-msg-[0-9a-f-]{36}$/);
    expect(b.message.id).not.toBe(a.message.id);
  });

  it("masks numbers", () => {
    expect(maskNumber("+15555550142")).toBe("***-***-0142");
  });
});
