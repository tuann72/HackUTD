import twilio from "twilio";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.ts";
import { startFakeGateway } from "../src/fake-gateway.ts";

const base = {
  webhookUrl: "http://localhost:8787/twilio/sms",
  authToken: "dev-auth-token-change-me",
  accountSid: "AC00000000000000000000000000000000",
  victimNumber: "+15555550100",
};

function capture() {
  const lines: string[] = [];
  return { lines, log: (l: string) => lines.push(l), text: () => lines.join("\n") };
}

describe("dry run", () => {
  it("sends nothing and prints signed requests", async () => {
    const fetchMock = vi.fn();
    const sleep = vi.fn(async () => {});
    // dry run never waits on delays
    const out = capture();
    const code = await main(["scenario", "smoke.jsonl", "--dry-run"], {
      config: base,
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
      log: out.log,
    });
    expect(code).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.text()).toContain("POST http://localhost:8787/twilio/sms");
    expect(out.lines.filter((l) => l.includes("X-Twilio-Signature: "))).toHaveLength(3);
    expect(out.text()).toContain("***-***-0177");
    expect(out.text()).toContain("nothing was sent");
  });

  it("works for random and send too", async () => {
    const fetchMock = vi.fn();
    for (const argv of [
      ["random", "--n", "5", "--seed", "1", "--dry-run"],
      ["send", "--from", "+15555550142", "hello there", "--dry-run"],
    ]) {
      const out = capture();
      const code = await main(argv, { config: base, fetch: fetchMock as never, sleep: async () => {}, log: out.log });
      expect(code).toBe(0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("safety rails", () => {
  const fetchMock = vi.fn();
  const run = (argv: string[], config = base) =>
    main(argv, { config, fetch: fetchMock as never, sleep: async () => {}, log: () => {} });

  it("refuses non-fictional From numbers unless allowed", async () => {
    expect(await run(["send", "--from", "+12145551234", "hi"])).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await run(["send", "--from", "+12145551234", "hi", "--dry-run", "--allow-real-numbers"])).toBe(0);
  });

  it("refuses a non-fictional victim number", async () => {
    expect(await run(["send", "--from", "+15555550142", "hi"], { ...base, victimNumber: "+12145550100" })).toBe(2);
  });

  it("refuses a Twilio URL", async () => {
    expect(await run(["send", "--from", "+15555550142", "hi"], { ...base, webhookUrl: "https://api.twilio.com/x" })).toBe(
      2,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports usage errors", async () => {
    expect(await run([])).toBe(2);
    expect(await run(["bogus"])).toBe(2);
    expect(await run(["send", "hi"])).toBe(2);
    expect(await run(["scenario", "missing.jsonl"])).toBe(2);
  });
});

describe("integration: smoke scenario against a local signature-checking server", () => {
  let gw: Awaited<ReturnType<typeof startFakeGateway>>;
  let webhookUrl: string;

  beforeAll(async () => {
    // Bind first to learn the port, then point the expected URL at it.
    gw = await startFakeGateway({ webhookUrl: "http://127.0.0.1/twilio/sms", authToken: base.authToken });
    await gw.close();
    webhookUrl = `http://127.0.0.1:${gw.port}/twilio/sms`;
    gw = await startFakeGateway({ webhookUrl, authToken: base.authToken, port: gw.port });
  });
  afterAll(() => gw.close());

  it("delivers all 3 messages with valid signatures (real delays)", async () => {
    const out = capture();
    const t0 = Date.now();
    const code = await main(["scenario", "smoke.jsonl"], { config: { ...base, webhookUrl }, log: out.log });
    expect(code).toBe(0);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
    expect(gw.received).toHaveLength(3);
    for (const m of gw.received) {
      expect(m.valid).toBe(true);
      expect(twilio.validateRequest(base.authToken, m.signature, webhookUrl, m.params)).toBe(true);
      expect(m.params.To).toBe("+15555550100");
    }
    expect(gw.received.map((m) => m.params.From)).toEqual(["+15555550110", "+15555550177", "+15555550101"]);
    expect(new Set(gw.received.map((m) => m.params.MessageSid)).size).toBe(3);
    expect(out.lines.filter((l) => l.includes("-> 200"))).toHaveLength(3);
  });

  it("reports 403 and exits 1 when the token is wrong", async () => {
    const out = capture();
    const code = await main(["send", "--from", "+15555550142", "hi"], {
      config: { ...base, webhookUrl, authToken: "wrong" },
      log: out.log,
    });
    expect(code).toBe(1);
    expect(out.text()).toContain("FAILED 403");
  });

  it("reports an unreachable gateway and exits 1", async () => {
    const out = capture();
    const code = await main(["send", "--from", "+15555550142", "hi"], {
      config: { ...base, webhookUrl: "http://127.0.0.1:1/twilio/sms" },
      log: out.log,
    });
    expect(code).toBe(1);
    expect(out.text()).toContain("FAILED");
  });
});
