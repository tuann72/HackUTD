import type { SimConfig } from "./config.ts";
import { assertSafeNumber, assertSafeUrl } from "./safety.ts";
import type { Step } from "./steps.ts";
import { buildInboundMessage, maskNumber, signBody, type SpectrumPayload } from "./spectrum-request.ts";

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
  messageId: string;
  from: string;
  ok: boolean;
  status?: number;
  error?: string;
  expected?: Step["expected"];
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  payload: SpectrumPayload;
  body: string;
}

/** Placeholder X-Spectrum-Webhook-Id; the gateway doesn't check it. */
export const SIM_WEBHOOK_ID = "00000000-0000-4000-8000-000000000000";

export function buildSignedRequest(
  config: SimConfig,
  step: Pick<Step, "from" | "body">,
  now: () => Date = () => new Date(),
): SignedRequest {
  const at = now();
  const payload = buildInboundMessage({ from: step.from, line: config.victimNumber, body: step.body, timestamp: at.toISOString() });
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(at.getTime() / 1000));
  return {
    url: config.webhookUrl,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "t-gate-perpetrator-sim",
      "X-Spectrum-Event": "messages",
      "X-Spectrum-Webhook-Id": SIM_WEBHOOK_ID,
      "X-Spectrum-Timestamp": timestamp,
      "X-Spectrum-Signature": signBody(config.webhookSecret, timestamp, body),
    },
    payload,
    body,
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
  assertSafeNumber(config.victimNumber, "VICTIM_NUMBER (line)", allowReal);
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
    const base = { index: i, messageId: req.payload.message.id, from: step.from, expected: step.expected };

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
