// Read-only bank checks for the Nemotron review (docs/features/nemotron-review.md).
// Results carry a found flag, a count and short labels. Never balances or account numbers.

export const CHECK_NAMES = ['bills', 'purchases', 'accounts', 'loans'] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export interface BankCheck {
  check: CheckName;
  keyword?: string;
  amount?: number;
}

export interface BankCheckResult extends BankCheck {
  found: boolean;
  matches: number;
  labels: string[];
}

export interface BankRecord {
  label: string;
  amount?: number;
}

export type BankData = Record<CheckName, BankRecord[]>;

export interface BankSource {
  readonly name: 'nessie' | 'mock';
  load(check: CheckName, signal?: AbortSignal): Promise<BankRecord[]>;
}

/** Local stand-in for Nessie: the demo victim's bills and purchases. */
export const MOCK_BANK: BankData = {
  bills: [
    { label: 'T-Mobile', amount: 85 },
    { label: 'Oncor Electric', amount: 132.4 },
  ],
  purchases: [
    { label: 'Amazon', amount: 42.17 },
    { label: 'H-E-B', amount: 96.3 },
    { label: 'Shell', amount: 38 },
  ],
  accounts: [{ label: 'Checking' }, { label: 'Savings' }],
  loans: [],
};

export class MockBank implements BankSource {
  readonly name = 'mock' as const;
  constructor(private readonly data: BankData = MOCK_BANK) {}
  async load(check: CheckName) {
    return this.data[check];
  }
}

export interface NessieOptions {
  baseUrl: string;
  apiKey: string;
  accountId: string;
  fetch?: typeof fetch;
}

type Row = Record<string, unknown>;

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const money = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Capital One's Nessie mock bank. Errors never include the URL, because the API key is in its query. */
export class NessieBank implements BankSource {
  readonly name = 'nessie' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: NessieOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async get(path: string, signal?: AbortSignal): Promise<Row[]> {
    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}${path}?key=${encodeURIComponent(this.opts.apiKey)}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
    } catch {
      throw new Error('Nessie request failed');
    }
    if (!res.ok) throw new Error(`Nessie returned HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? (json as Row[]) : [json as Row];
  }

  async load(check: CheckName, signal?: AbortSignal): Promise<BankRecord[]> {
    const account = `/accounts/${encodeURIComponent(this.opts.accountId)}`;
    if (check === 'accounts') {
      const a = (await this.get(account, signal))[0];
      return a ? [{ label: text(a.type) || 'Account' }] : [];
    }
    if (check === 'bills') {
      return (await this.get(`${account}/bills`, signal)).map((b) => ({ label: text(b.payee) || text(b.nickname), amount: money(b.payment_amount) }));
    }
    if (check === 'purchases') {
      return (await this.get(`${account}/purchases`, signal)).map((p) => ({ label: text(p.description), amount: money(p.amount) }));
    }
    return (await this.get(`${account}/loans`, signal)).map((l) => ({ label: text(l.type) || 'Loan', amount: money(l.amount) }));
  }
}

/** Runs one check. Labels are clipped because they go to an LLM. */
export function matchRecords(c: BankCheck, records: BankRecord[]): BankCheckResult {
  const kw = c.keyword?.trim().toLowerCase();
  const hits = records.filter(
    (r) =>
      (!kw || r.label.toLowerCase().includes(kw)) &&
      (c.amount === undefined || (r.amount !== undefined && Math.abs(r.amount - c.amount) < 0.01)),
  );
  return { ...c, found: hits.length > 0, matches: hits.length, labels: hits.slice(0, 5).map((r) => r.label.slice(0, 40)) };
}
