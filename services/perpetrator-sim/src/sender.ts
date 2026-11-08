import type { SimConfig } from "./config.ts";
import { assertSafeNumber, assertSafeUrl } from "./safety.ts";
import type { Step } from "./steps.ts";
import { buildInboundSms, encodeForm, maskNumber, signRequest } from "./twilio-request.ts";

export interface RunOptions {
  dryRun?: boolean;
  allowRealNumbers?: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  timeoutMs?: number;
}

export interface SendResult {
  index: number;
  messageSid: string;
  from: string;
  ok: boolean;
  status?: number;
  error?: string;
  expected?: Step["expected"];
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  body: string;
}

export function buildSignedRequest(config: SimConfig, step: Pick<Step, "from" | "body">): SignedRequest {
  const params = buildInboundSms({
    from: step.from,
    to: config.victimNumber,
    body: step.body,
    accountSid: config.accountSid,
  });
  return {
    url: config.webhookUrl,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": signRequest(config.authToken, config.webhookUrl, params),
    },
    params,
    body: encodeForm(params),
  };
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function preview(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ");
  return JSON.stringify(flat.length > max ? flat.slice(0, max - 1) + "…" : flat);
}

/** Validate every step up front, then send them in order with their delays. Never throws on HTTP errors. */
export async function runSteps(config: SimConfig, steps: readonly Step[], opts: RunOptions = {}): Promise<SendResult[]> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const sleep = opts.sleep ?? realSleep;
  const doFetch = opts.fetch ?? fetch;
  const allowReal = opts.allowRealNumbers ?? false;

  assertSafeUrl(config.webhookUrl);
  assertSafeNumber(config.victimNumber, "VICTIM_NUMBER (To)", allowReal);
  steps.forEach((s, i) => assertSafeNumber(s.from, `step ${i + 1} From`, allowReal));

  log(`${opts.dryRun ? "[dry run] " : ""}${steps.length} message(s) -> ${config.webhookUrl}`);
  const results: SendResult[] = [];
  let elapsed = 0;
  for (const [i, step] of steps.entries()) {
    if (step.delayMs > 0 && !opts.dryRun) await sleep(step.delayMs);
    elapsed += step.delayMs;
    const req = buildSignedRequest(config, step);
    const tag = `[${i + 1}/${steps.length}] +${(elapsed / 1000).toFixed(1)}s ${maskNumber(step.from)}`;
    const expected = step.expected ? ` expected=${step.expected}` : "";
    const base = { index: i, messageSid: req.params.MessageSid, from: step.from, expected: step.expected };

    if (opts.dryRun) {
      log(`${tag}${expected} (not sent)`);
      log(`  POST ${req.url}`);
      for (const [k, v] of Object.entries(req.headers)) log(`  ${k}: ${v}`);
      log(`  body: ${req.body}`);
      results.push({ ...base, ok: true });
      continue;
    }

    try {
      const res = await doFetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: req.body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      await res.text().catch(() => "");
      const status = `${res.status}${res.statusText ? " " + res.statusText : ""}`;
      if (res.ok) {
        log(`${tag} -> ${status}${expected} ${preview(step.body)}`);
      } else {
        log(`${tag} -> FAILED ${status}${expected} ${preview(step.body)}`);
      }
      results.push({ ...base, ok: res.ok, status: res.status });
    } catch (err) {
      const msg = (err as Error).cause ? String((err as Error).cause) : (err as Error).message;
      log(`${tag} -> FAILED (${msg})${expected} ${preview(step.body)}`);
      results.push({ ...base, ok: false, error: msg });
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  if (opts.dryRun) log(`[dry run] printed ${results.length} request(s); nothing was sent`);
  else log(`done: ${results.length - failed}/${results.length} accepted${failed ? `, ${failed} FAILED` : ""}`);
  return results;
}
