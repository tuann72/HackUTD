import { describe, expect, it } from 'vitest';
import { asksForLargeSum } from '../src/money-rule.js';
import type { Classifier } from '../src/classifier.js';
import { NOW_S, makeApp, payload, signedRequest } from './helpers.js';

describe('asksForLargeSum', () => {
  it.each([
    'Can you lend me $6000 for the bus fare?',
    'can u lend me 6000 dollars',
    'could you loan me 2.5k',
    'Hi mom, new number, can you send $1,500 for rent',
    'zelle me 900$ asap',
    'I need $6000 right now',
    'can I borrow 800 bucks',
  ])('flags %s', (text) => expect(asksForLargeSum(text, 500)).toBe(true));

  it.each([
    'can you lend me $20 for lunch',
    'the car ended up costing $6000',
    'I got a $5000 bonus at work',
    'send me the photos from 2019',
    'can you send me the address',
    'we need 600 chairs for the event',
  ])('does not flag %s', (text) => expect(asksForLargeSum(text, 500)).toBe(false));

  it('is off at 0', () => expect(asksForLargeSum('lend me $6000', 0)).toBe(false));
});

function fixed(score: number): Classifier {
  return { classify: async () => ({ label: score >= 0.5 ? 'scam' : 'legit', score, category: null, model: 'fake@1', highlights: [] }) } as Classifier;
}

async function verdictFor(text: string, score: number, amount?: number) {
  const app = makeApp({ classifier: fixed(score), config: amount === undefined ? {} : { moneyWarnAmount: amount } });
  await app.request(signedRequest(payload({ id: 'spc-money', text }), { timestamp: NOW_S }));
  await app.idle();
  const [m] = ((await (await app.request('http://localhost/api/messages')).json()) as { messages: any[] }).messages;
  return m;
}

describe('gateway warning', () => {
  it('delivers a low-scoring large ask with a warning', async () => {
    const m = await verdictFor('Can you lend me $6000?', 0.01);
    expect(m.action).toBe('delivered');
    expect(m.verdict.warning).toBe('large_money_request');
  });

  it('adds no warning to a small ask', async () => {
    expect((await verdictFor('Can you lend me $20?', 0.01)).verdict.warning).toBeUndefined();
  });

  it('leaves a blocked message without a warning', async () => {
    const m = await verdictFor('Can you lend me $6000?', 0.99);
    expect(m.action).toBe('blocked');
    expect(m.verdict.warning).toBeUndefined();
  });

  it('can be turned off', async () => {
    expect((await verdictFor('Can you lend me $6000?', 0.01, 0)).verdict.warning).toBeUndefined();
  });
});
