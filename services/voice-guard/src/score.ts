// Live scoring client for the gateway's POST /voice/score (services/gateway, docs/features/voice-scam-guard.md).
// Sends only an opaque call id and the caller's transcript so far; the gateway stores nothing.
import { checkGatewayUrl } from './gateway.js';

export interface LiveVerdict {
  callId: string;
  action: 'warn' | 'none';
  label: 'scam' | 'legit';
  score: number;
  category: string | null;
  model: string;
}

/** The gateway caps text at 20,000 characters; keep the most recent part of a long call. */
export const MAX_SCORE_CHARS = 20_000;

function isLiveVerdict(v: unknown, callId: string): v is LiveVerdict {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.callId === callId &&
    (r.action === 'warn' || r.action === 'none') &&
    typeof r.score === 'number' &&
    Number.isFinite(r.score)
  );
}

export async function scoreTranscript(
  options: { url: string; token: string; timeoutMs: number },
  callId: string,
  text: string,
): Promise<LiveVerdict> {
  const endpoint = checkGatewayUrl(options.url);
  const body = JSON.stringify({ callId, text: text.length > MAX_SCORE_CHARS ? text.slice(-MAX_SCORE_CHARS) : text });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new Error(`Gateway /voice/score returned HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (!isLiveVerdict(result, callId)) throw new Error('Gateway /voice/score returned an invalid response');
  return result;
}

/**
 * Decides when to score: after each finalized caller utterance, at most once per `intervalMs`.
 * An utterance that arrives during the cooldown is scored when the cooldown ends. One request
 * at a time; stops after the first `warn` (one warning per call).
 */
export class LiveScorer {
  private utterances: string[] = [];
  private lastScoredAt = 0;
  private lastScoredCount = 0;
  private inflight = false;
  private timer: NodeJS.Timeout | undefined;
  private done = false;

  constructor(
    private readonly intervalMs: number,
    private readonly score: (text: string) => Promise<LiveVerdict>,
    private readonly onWarn: (verdict: LiveVerdict) => void,
    private readonly log: (event: Record<string, unknown>) => void,
    private readonly now: () => number = Date.now,
  ) {}

  addUtterance(text: string): void {
    if (this.done) return;
    this.utterances.push(text);
    this.maybeScore();
  }

  stop(): void {
    this.done = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private maybeScore(): void {
    if (this.done || this.inflight || this.timer) return;
    if (this.utterances.length === this.lastScoredCount) return;
    const wait = this.lastScoredAt + this.intervalMs - this.now();
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.maybeScore();
      }, wait);
      return;
    }
    void this.run();
  }

  private async run(): Promise<void> {
    this.inflight = true;
    this.lastScoredAt = this.now();
    this.lastScoredCount = this.utterances.length;
    try {
      const verdict = await this.score(this.utterances.join(' '));
      this.log({ event: 'live_scored', score: verdict.score, action: verdict.action, utterances: this.lastScoredCount });
      if (verdict.action === 'warn' && !this.done) {
        this.done = true;
        this.onWarn(verdict);
      }
    } catch (error) {
      // Fail open: a scoring outage never affects the call.
      this.log({ event: 'live_score_failed', error: error instanceof Error ? error.message : 'unknown error' });
    } finally {
      this.inflight = false;
      this.maybeScore();
    }
  }
}
