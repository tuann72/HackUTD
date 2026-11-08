import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { MockBank, NessieBank, matchRecords, type BankSource } from '../src/bank.js';
import type { Classifier } from '../src/classifier.js';
import { NemotronReviewer, extractJson, parseDecision, parsePlan, type Reviewer } from '../src/reviewer.js';
import type { MessagesResponse, Review, Verdict } from '../src/types.js';
import { makeApp, payload, readContract, signedRequest } from './helpers.js';

const Ajv2020 = (Ajv2020Module as unknown as { default: typeof Ajv2020Module.default }).default;
const addFormats = (addFormatsModule as unknown as { default: typeof addFormatsModule.default }).default;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(readContract('contracts/query-api.v1.schema.json'));

const verdict = (score: number): Verdict => ({ label: score >= 0.5 ? 'scam' : 'legit', score, category: 'Imposter & Phishing', model: 'fixed', highlights: [] });
const fixed = (score: number): Classifier => ({ classify: async () => verdict(score) });
const REVIEW: Review = { decision: 'block', reason: 'No such bill exists.', model: 'nemotron', checks: [{ check: 'bills', keyword: 'Comcast', found: false }], bankSource: 'mock' };

function fakeReviewer(result: Review | Error = REVIEW) {
  const calls: string[] = [];
  const reviewer: Reviewer = {
    review: async (text) => {
      calls.push(text);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { reviewer, calls };
}

async function run(score: number, reviewer?: Reviewer, text?: string) {
  const app = makeApp({ classifier: fixed(score), reviewer, config: { reviewBandLow: 0.22, reviewBandHigh: 0.77, blockThreshold: 0.5 } });
  const res = await app.request(signedRequest(payload({ id: 'r1', text: text ?? 'Your Comcast bill is overdue' })));
  expect(res.status).toBe(200);
  await app.idle();
  const body = (await (await app.request('/api/messages')).json()) as MessagesResponse;
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return body.messages[0]!;
}

describe('gateway review band', () => {
  it('blocks a below-threshold score when Nemotron says block, and keeps the model verdict', async () => {
    const m = await run(0.3, fakeReviewer().reviewer);
    expect(m.action).toBe('blocked');
    expect(m.reason).toBe('model_verdict');
    expect(m.verdict?.score).toBe(0.3);
    expect(m.verdict?.label).toBe('scam');
    expect(m.verdict?.review?.reason).toBe('No such bill exists.');
  });

  it('delivers an above-threshold score when Nemotron says deliver', async () => {
    const m = await run(0.6, fakeReviewer({ ...REVIEW, decision: 'deliver' }).reviewer);
    expect(m.action).toBe('delivered');
    expect(m.verdict?.label).toBe('legit');
  });

  it.each([0.1, 0.21, 0.77, 0.99])('does not review a score of %d, outside the band', async (score) => {
    const { reviewer, calls } = fakeReviewer();
    const m = await run(score, reviewer);
    expect(calls).toEqual([]);
    expect(m.action).toBe(score >= 0.5 ? 'blocked' : 'delivered');
    expect(m.verdict?.review).toBeUndefined();
  });

  it('reviews both band edges correctly: the low edge is included', async () => {
    const { reviewer, calls } = fakeReviewer();
    await run(0.22, reviewer);
    expect(calls).toHaveLength(1);
  });

  it.each([[0.3, 'delivered'], [0.6, 'blocked']])('keeps the model decision at %d when the review fails', async (score, action) => {
    const m = await run(score as number, fakeReviewer(new Error('down')).reviewer);
    expect(m.action).toBe(action);
    expect(m.verdict?.review).toBeUndefined();
  });

  it('reviews a large money ask below the band, and Nemotron can block it', async () => {
    const { reviewer, calls } = fakeReviewer();
    const m = await run(0.05, reviewer, 'Can you lend me $6000 for the bus fare?');
    expect(calls).toHaveLength(1);
    expect(m.action).toBe('blocked');
  });

  it('keeps the money warning when Nemotron delivers a large ask', async () => {
    const m = await run(0.05, fakeReviewer({ ...REVIEW, decision: 'deliver' }).reviewer, 'Can you lend me $6000 for the bus fare?');
    expect(m.action).toBe('delivered');
    expect(m.verdict?.warning).toBe('large_money_request');
  });

  it.each([[0.05, 'can you venmo me $20 for pizza'], [0.9, 'Can you lend me $6000 for the bus fare?']])('does not review score %d for %s', async (score, text) => {
    const { reviewer, calls } = fakeReviewer();
    await run(score as number, reviewer, text as string);
    expect(calls).toEqual([]);
  });

  it('behaves as before with no reviewer', async () => {
    expect((await run(0.3)).action).toBe('delivered');
    expect((await run(0.6)).action).toBe('blocked');
  });
});

describe('parsing Nemotron replies', () => {
  it('finds JSON after reasoning', () => {
    expect(extractJson('<think>maybe {x}</think>\nHere: {"checks":[]}')).toEqual({ checks: [] });
  });

  it('throws when there is no JSON', () => {
    expect(() => extractJson('sorry')).toThrow();
  });

  it('drops unknown checks and caps the list', () => {
    const plan = parsePlan({ checks: [{ check: 'transfer_money', keyword: 'x' }, ...Array(9).fill({ check: 'bills', keyword: 'a', amount: 'nope' })] });
    expect(plan).toHaveLength(4);
    expect(plan[0]).toEqual({ check: 'bills', keyword: 'a' });
  });

  it('rejects a decision outside block or deliver', () => {
    expect(() => parseDecision({ decision: 'allow', reason: 'x' })).toThrow();
  });

  it.each(['Visit http://evil.test now', 'Go to bit.ly/abc', 'see evil.com'])('removes a reason containing a link: %s', (reason) => {
    expect(parseDecision({ decision: 'deliver', reason }).reason).toBe('Second opinion from Nemotron.');
  });
});

describe('bank checks', () => {
  it('matches on keyword and amount', () => {
    const rows = [{ label: 'T-Mobile', amount: 85 }, { label: 'Amazon', amount: 10 }];
    expect(matchRecords({ check: 'bills', keyword: 't-mobile', amount: 85 }, rows)).toMatchObject({ found: true, matches: 1, labels: ['T-Mobile'] });
    expect(matchRecords({ check: 'bills', keyword: 'T-Mobile', amount: 99 }, rows).found).toBe(false);
  });

  it('never exposes the Nessie key in an error', async () => {
    const bank = new NessieBank({ baseUrl: 'https://n.test', apiKey: 'SECRETKEY', accountId: 'a1', fetch: (async () => { throw new Error('boom https://n.test?key=SECRETKEY'); }) as typeof fetch });
    await expect(bank.load('bills')).rejects.toThrow('Nessie request failed');
  });
});

describe('NemotronReviewer', () => {
  function chatFetch(replies: string[]) {
    const bodies: Array<{ messages: Array<{ content: string }> }> = [];
    const f = (async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ choices: [{ message: { content: replies.shift() } }] }), { status: 200 });
    }) as typeof fetch;
    return { f, bodies };
  }
  const opts = { apiKey: 'k', model: 'nemotron', baseUrl: 'https://nv.test/v1', timeoutMs: 2000, fallbackBank: new MockBank() };
  const PLAN = '{"checks":[{"check":"bills","keyword":"Comcast"}]}';
  const DECIDE = '{"decision":"block","reason":"No Comcast bill on file."}';

  it('plans, runs the check, and passes the result to the decision', async () => {
    const { f, bodies } = chatFetch([PLAN, DECIDE]);
    const r = await new NemotronReviewer({ ...opts, bank: new MockBank(), fetch: f }).review('Comcast overdue', verdict(0.4));
    expect(r).toEqual({ decision: 'block', reason: 'No Comcast bill on file.', model: 'nemotron', checks: [{ check: 'bills', keyword: 'Comcast', found: false }], bankSource: 'mock' });
    expect(JSON.parse(bodies[1]!.messages[1]!.content).bankChecks[0].found).toBe(false);
  });

  it('reports mock when Nessie fails, so the demo stays honest', async () => {
    const down: BankSource = { name: 'nessie', load: async () => { throw new Error('502'); } };
    const { f } = chatFetch([PLAN, DECIDE]);
    expect((await new NemotronReviewer({ ...opts, bank: down, fetch: f }).review('x', verdict(0.4))).bankSource).toBe('mock');
  });

  it('reports no bank source when no checks were asked for', async () => {
    const { f } = chatFetch(['{"checks":[]}', DECIDE]);
    expect((await new NemotronReviewer({ ...opts, bank: new MockBank(), fetch: f }).review('x', verdict(0.4))).bankSource).toBeNull();
  });

  it('rejects when the API errors, so the gateway keeps the model decision', async () => {
    const f = (async () => new Response('nope', { status: 429 })) as unknown as typeof fetch;
    await expect(new NemotronReviewer({ ...opts, bank: new MockBank(), fetch: f }).review('x', verdict(0.4))).rejects.toThrow('429');
  });
});
