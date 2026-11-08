import { readFileSync } from "node:fs";
import { join } from "node:path";
import twilio from "twilio";
import { describe, expect, it } from "vitest";
import { buildSignedRequest } from "../src/sender.ts";
import { REPO_ROOT } from "../src/steps.ts";
import { buildInboundSms, INBOUND_SMS_FIELDS, maskNumber, numSegments, signRequest } from "../src/twilio-request.ts";

const config = {
  webhookUrl: "http://localhost:8787/twilio/sms",
  authToken: "dev-auth-token-change-me",
  accountSid: "AC00000000000000000000000000000000",
  victimNumber: "+15555550100",
};

describe("signature", () => {
  const req = buildSignedRequest(config, { from: "+15555550142", body: "Hi Grandma it's me" });
  const sig = req.headers["X-Twilio-Signature"]!;

  it("validates with twilio.validateRequest for the same URL and params", () => {
    expect(twilio.validateRequest(config.authToken, sig, config.webhookUrl, req.params)).toBe(true);
  });

  it("validates after a round trip through the form-encoded body", () => {
    const decoded = Object.fromEntries(new URLSearchParams(req.body));
    expect(twilio.validateRequest(config.authToken, sig, config.webhookUrl, decoded)).toBe(true);
  });

  it("fails for a different URL", () => {
    expect(twilio.validateRequest(config.authToken, sig, "http://localhost:8788/twilio/sms", req.params)).toBe(false);
    expect(twilio.validateRequest(config.authToken, sig, "https://gw.example.com/twilio/sms", req.params)).toBe(false);
  });

  it("fails for a different token or tampered body", () => {
    expect(twilio.validateRequest("other-token", sig, config.webhookUrl, req.params)).toBe(false);
    expect(twilio.validateRequest(config.authToken, sig, config.webhookUrl, { ...req.params, Body: "x" })).toBe(false);
  });

  it("matches signRequest", () => {
    expect(signRequest(config.authToken, config.webhookUrl, req.params)).toBe(sig);
  });
});

describe("form fields", () => {
  const fixture = JSON.parse(
    readFileSync(join(REPO_ROOT, "contracts/fixtures/twilio-inbound-sms.sample.json"), "utf8"),
  ) as { form: Record<string, string> };

  it("has exactly the fixture's keys, in order", () => {
    const params = buildInboundSms({ from: "+15555550142", to: "+15555550100", body: "hi", accountSid: "AC0" });
    expect(Object.keys(params)).toEqual(Object.keys(fixture.form));
    expect([...INBOUND_SMS_FIELDS]).toEqual(Object.keys(fixture.form));
  });

  it("reproduces the fixture's values for the fixture's inputs", () => {
    const f = fixture.form;
    const params = buildInboundSms({
      from: f.From!,
      to: f.To!,
      body: f.Body!,
      accountSid: f.AccountSid!,
      messageSid: f.MessageSid,
    });
    expect(params).toEqual(f);
  });

  it("uses one SM + 32 hex sid for all three sid fields, fresh per message", () => {
    const a = buildInboundSms({ from: "+15555550142", to: "+15555550100", body: "hi", accountSid: "AC0" });
    const b = buildInboundSms({ from: "+15555550142", to: "+15555550100", body: "hi", accountSid: "AC0" });
    expect(a.MessageSid).toMatch(/^SM[0-9a-f]{32}$/);
    expect(a.SmsSid).toBe(a.MessageSid);
    expect(a.SmsMessageSid).toBe(a.MessageSid);
    expect(b.MessageSid).not.toBe(a.MessageSid);
  });

  it("counts segments and masks numbers", () => {
    expect(numSegments("x")).toBe(1);
    expect(numSegments("x".repeat(160))).toBe(1);
    expect(numSegments("x".repeat(161))).toBe(2);
    expect(maskNumber("+15555550142")).toBe("***-***-0142");
  });
});
