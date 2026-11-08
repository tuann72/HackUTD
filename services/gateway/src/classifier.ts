import type { Highlight, ScamCategory, Verdict } from './types.js';
import { SCAM_CATEGORIES } from './types.js';

export interface ClassifyInput {
  /** Opaque gateway message id. Never a sender handle or Photon message id. */
  messageId: string;
  text: string;
}

/** Port for the classifier. Throwing (or timing out) means "unavailable"; the gateway fails open. */
export interface Classifier {
  classify(input: ClassifyInput): Promise<Verdict>;
}

// ---------------------------------------------------------------------------
// Stub classifier: keyword/regex rules. A placeholder until the real model (task 2.3).
// ---------------------------------------------------------------------------

interface Rule {
  pattern: RegExp;
  weight: number;
  /** null = generic signal (urgency, short links) that does not pick a category. */
  category: ScamCategory | null;
}

const IMP: ScamCategory = 'Imposter & Phishing';
const PRZ: ScamCategory = 'Prizes, Lotteries & Advance-Fee';
const JOB: ScamCategory = 'Jobs, Business & Investment';
const LOAN: ScamCategory = 'Loans, Credit & Debt';
const HLT: ScamCategory = 'Health & Pharmacy';
const SHOP: ScamCategory = 'Shopping & Product Offers';
const NET: ScamCategory = 'Internet, Telecom & Media';

const RULES: Rule[] = [
  // Imposter & Phishing
  { pattern: /\bgift\s?cards?\b/gi, weight: 0.8, category: IMP },
  { pattern: /\b(?:locked|suspended|frozen|compromised|deactivated)\b/gi, weight: 0.4, category: IMP },
  { pattern: /\bverify\b|\bconfirm your (?:identity|account|details)\b/gi, weight: 0.35, category: IMP },
  { pattern: /\b(?:pin|password|passcode|ssn|social security number|one[- ]time (?:code|passcode)|otp)\b/gi, weight: 0.55, category: IMP },
  { pattern: /\bdon[’']?t tell\b|\bkeep (?:this|it) (?:a )?secret\b/gi, weight: 0.6, category: IMP },
  { pattern: /\bwire (?:transfer|money|the money)\b|\bbitcoin\b|\bcrypto(?:currency)?\b|\bwestern union\b|\bmoneygram\b/gi, weight: 0.6, category: IMP },
  { pattern: /\bin trouble\b|\b(?:been )?arrested\b|\bbail\b/gi, weight: 0.3, category: IMP },
  { pattern: /\b(?:irs|tax refund|unpaid toll|package (?:is )?(?:on hold|held))\b/gi, weight: 0.4, category: IMP },
  // Borderline on its own (the "new number" grandparent opener): highlighted but not blocked.
  { pattern: /\blost my phone\b|\bmy new number\b/gi, weight: 0.2, category: IMP },
  // Prizes, Lotteries & Advance-Fee
  { pattern: /\byou(?:[’']ve| have)? won\b|\bwinner\b|\bprize\b|\blottery\b|\bsweepstakes\b|\binheritance\b/gi, weight: 0.5, category: PRZ },
  { pattern: /\bclaim\b/gi, weight: 0.35, category: PRZ },
  { pattern: /\bprocessing fee\b|\brelease fee\b/gi, weight: 0.45, category: PRZ },
  // Jobs, Business & Investment
  { pattern: /\bearn\s+\$?\d[\d,]*(?:\s*(?:\/|per|a)\s*(?:day|week|hour|hr))?/gi, weight: 0.55, category: JOB },
  { pattern: /\bwork from home\b|\bjob offer\b|\bremote (?:job|position)\b|\bguaranteed (?:returns?|profits?)\b|\binvestment opportunity\b/gi, weight: 0.45, category: JOB },
  // Loans, Credit & Debt
  { pattern: /\bpre-?approved\b|\bpayday\b|\bloan\b|\bcredit score\b|\bdebt relief\b|\bconsolidate (?:your )?debt\b|\blow interest\b/gi, weight: 0.4, category: LOAN },
  // Health & Pharmacy ("pharmacy" alone is weak so a real pickup notice still gets delivered)
  { pattern: /\bpills\b|\bviagra\b|\bcialis\b|\bno prescription\b|\bmiracle cure\b|\bweight loss\b/gi, weight: 0.5, category: HLT },
  { pattern: /\bpharmacy\b/gi, weight: 0.15, category: HLT },
  // Shopping & Product Offers
  { pattern: /\b\d{1,2}% off\b|\bfree (?:iphone|gift|trial)\b/gi, weight: 0.35, category: SHOP },
  { pattern: /\blimited time offer\b|\breplicas?\b|\bextended (?:car |auto )?warranty\b/gi, weight: 0.4, category: SHOP },
  // Internet, Telecom & Media
  { pattern: /\bcasino\b|\bfree spins\b|\bhot singles\b|\bringtones?\b/gi, weight: 0.45, category: NET },
  { pattern: /\btext \w+ to \d{4,6}\b/gi, weight: 0.35, category: NET },
  // Generic signals
  { pattern: /\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy)\/\S*/gi, weight: 0.5, category: null },
  { pattern: /\burgent(?:ly)?\b|\bimmediately\b|\bact now\b|\bright now\b|\bwithin 24 hours\b|\bfinal notice\b|\basap\b/gi, weight: 0.3, category: null },
];

const LEGIT_BASE_SCORE = 0.02;
const STUB_LABEL_THRESHOLD = 0.5;

const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

/** Pure function so it can be tested without the async wrapper. */
export function stubVerdict(text: string): Verdict {
  type Hit = Highlight & { rule: number; category: ScamCategory | null };
  const hits: Hit[] = [];
  RULES.forEach((rule, i) => {
    for (const m of text.matchAll(rule.pattern)) {
      const start = m.index;
      hits.push({ start, end: start + m[0].length, text: m[0], weight: rule.weight, rule: i, category: rule.category });
    }
  });

  // Keep the strongest hit where hits overlap (e.g. "verify" inside "bit.ly/acct-verify").
  hits.sort((a, b) => b.weight - a.weight || a.start - b.start);
  const kept: Hit[] = [];
  for (const h of hits) {
    if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h);
  }
  kept.sort((a, b) => a.start - b.start);

  // Each rule counts once toward the score (noisy-OR), so repeats don't compound.
  const ruleWeights = new Map<number, number>();
  for (const h of kept) ruleWeights.set(h.rule, h.weight);
  let notScam = 1;
  for (const w of ruleWeights.values()) notScam *= 1 - w;
  const score = ruleWeights.size === 0 ? LEGIT_BASE_SCORE : round(Math.max(LEGIT_BASE_SCORE, 1 - notScam));
  const label = score >= STUB_LABEL_THRESHOLD ? 'scam' : 'legit';

  let category: string | null = null;
  if (label === 'scam') {
    const byCat = new Map<ScamCategory, number>();
    for (const h of kept) if (h.category) byCat.set(h.category, (byCat.get(h.category) ?? 0) + h.weight);
    const best = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
    category = best ? best[0] : IMP; // only generic signals (links, urgency): treat as phishing
  }

  return {
    label,
    score,
    category,
    model: 'stub@0',
    highlights: kept.map(({ start, end, text: t, weight }) => ({ start, end, text: t, weight })),
  };
}

export class StubClassifier implements Classifier {
  async classify(input: ClassifyInput): Promise<Verdict> {
    return stubVerdict(input.text);
  }
}

// ---------------------------------------------------------------------------
// HTTP classifier: POST {baseUrl}/classify. Sends only the opaque id and the text.
// ---------------------------------------------------------------------------

export class ClassifierError extends Error {}

export interface HttpClassifierOptions {
  baseUrl: string;
  token?: string | null;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export class HttpClassifier implements Classifier {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HttpClassifierOptions) {
    this.endpoint = `${opts.baseUrl.replace(/\/+$/, '')}/classify`;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async classify(input: ClassifyInput): Promise<Verdict> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messageId: input.messageId, text: input.text }),
        signal: controller.signal,
      });
      if (!res.ok) throw new ClassifierError(`classifier returned HTTP ${res.status}`);
      const json = (await res.json()) as unknown;
      return parseVerdict(json, input);
    } catch (err) {
      if (controller.signal.aborted) throw new ClassifierError(`classifier timed out after ${this.opts.timeoutMs} ms`);
      throw err instanceof ClassifierError ? err : new ClassifierError(`classifier request failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Validates the classifier's response; anything malformed counts as "unavailable". */
export function parseVerdict(json: unknown, input: ClassifyInput): Verdict {
  const bad = (why: string): never => {
    throw new ClassifierError(`invalid classifier response: ${why}`);
  };
  if (typeof json !== 'object' || json === null) return bad('not an object');
  const o = json as Record<string, unknown>;
  if (o.messageId !== undefined && o.messageId !== input.messageId) bad('messageId mismatch');
  if (o.label !== 'scam' && o.label !== 'legit') bad('label');
  if (typeof o.score !== 'number' || !(o.score >= 0 && o.score <= 1)) bad('score');
  if (o.category !== null && typeof o.category !== 'string') bad('category');
  if (typeof o.category === 'string' && !(SCAM_CATEGORIES as readonly string[]).includes(o.category)) {
    console.warn(`[gateway] classifier returned unknown category "${o.category}"`);
  }
  if (typeof o.model !== 'string' || !o.model) bad('model');
  const rawHighlights = o.highlights ?? [];
  if (!Array.isArray(rawHighlights)) bad('highlights');
  const highlights: Highlight[] = [];
  for (const h of rawHighlights as unknown[]) {
    const x = h as Record<string, unknown>;
    const ok =
      typeof x === 'object' && x !== null &&
      Number.isInteger(x.start) && Number.isInteger(x.end) &&
      (x.start as number) >= 0 && (x.start as number) < (x.end as number) && (x.end as number) <= input.text.length &&
      typeof x.weight === 'number' && Number.isFinite(x.weight);
    if (!ok) continue; // drop spans that don't fit the message rather than show wrong highlights
    const start = x.start as number;
    const end = x.end as number;
    highlights.push({ start, end, text: input.text.slice(start, end), weight: x.weight as number });
  }
  return {
    label: o.label as Verdict['label'],
    score: o.score as number,
    category: (o.category as string | null) ?? null,
    model: o.model as string,
    highlights,
  };
}
