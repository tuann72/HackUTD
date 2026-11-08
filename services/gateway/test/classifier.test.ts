import { afterEach, describe, expect, it } from 'vitest';
import { HttpClassifier, stubVerdict } from '../src/classifier.js';
import { loadConfig } from '../src/config.js';
import { maskNumber } from '../src/db.js';
import { SCAM_CATEGORIES } from '../src/types.js';
import { startFakeClassifier } from './fake-classifier.js';

describe('stub classifier', () => {
  const cases: Array<[string, 'scam' | 'legit', string | null]> = [
    ["I'm in trouble, I need $800 in gift cards, please don't tell mom", 'scam', 'Imposter & Phishing'],
    ['Your account is locked. Verify at bit.ly/acct-verify now', 'scam', 'Imposter & Phishing'],
    ['Reply with your PIN and password to keep your account active', 'scam', 'Imposter & Phishing'],
    ['URGENT: wire the money via bitcoin today', 'scam', 'Imposter & Phishing'],
    ['Congratulations! You have won a $1000 prize. Claim now', 'scam', 'Prizes, Lotteries & Advance-Fee'],
    ['Work from home and earn $500/day, no experience needed', 'scam', 'Jobs, Business & Investment'],
    ['You are pre-approved for a $5000 loan, low interest, act now', 'scam', 'Loans, Credit & Debt'],
    ['Cheap pills online, no prescription needed', 'scam', 'Health & Pharmacy'],
    ['Limited time offer: 70% off replica watches', 'scam', 'Shopping & Product Offers'],
    ['Free spins at our casino! Text WIN to 80080', 'scam', 'Internet, Telecom & Media'],
    ['Dinner Sunday still on?', 'legit', null],
    ['Your prescription is ready for pickup at Main St Pharmacy.', 'legit', null],
    ["Hi Grandma it's me, I lost my phone, this is my new number", 'legit', null],
  ];

  it.each(cases)('%s -> %s', (text, label, category) => {
    const v = stubVerdict(text);
    expect(v.label).toBe(label);
    expect(v.category).toBe(category);
    expect(v.model).toBe('stub@0');
    expect(v.score).toBeGreaterThanOrEqual(0);
    expect(v.score).toBeLessThanOrEqual(1);
    if (category) expect(SCAM_CATEGORIES).toContain(category);
    for (const h of v.highlights) expect(text.slice(h.start, h.end)).toBe(h.text);
    // Non-overlapping, sorted spans.
    for (let i = 1; i < v.highlights.length; i++) expect(v.highlights[i]!.start).toBeGreaterThanOrEqual(v.highlights[i - 1]!.end);
    if (label === 'scam') expect(v.highlights.length).toBeGreaterThan(0);
  });

  it('has no highlights for plain text', () => {
    expect(stubVerdict('Dinner Sunday still on?').highlights).toEqual([]);
  });
});

describe('HttpClassifier', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('posts only messageId and text with a bearer token, and parses the verdict', async () => {
    const fake = await startFakeClassifier({
      respond: (b) => ({
        messageId: b.messageId, label: 'scam', score: 0.91, category: 'Imposter & Phishing', model: 'minilm@0.1',
        highlights: [{ start: 0, end: 4, text: 'Your', weight: 0.2 }],
      }),
    });
    close = fake.close;
    const c = new HttpClassifier({ baseUrl: `${fake.url}/`, token: 'tok', timeoutMs: 1000 });
    const v = await c.classify({ messageId: 'msg_1', text: 'Your PIN' });
    expect(v).toEqual({ label: 'scam', score: 0.91, category: 'Imposter & Phishing', model: 'minilm@0.1', highlights: [{ start: 0, end: 4, text: 'Your', weight: 0.2 }] });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.path).toBe('/classify');
    expect(fake.requests[0]!.headers.authorization).toBe('Bearer tok');
    expect(fake.requests[0]!.body).toEqual({ messageId: 'msg_1', text: 'Your PIN' });
  });

  it('omits Authorization when no token is set', async () => {
    const fake = await startFakeClassifier();
    close = fake.close;
    await new HttpClassifier({ baseUrl: fake.url, timeoutMs: 1000 }).classify({ messageId: 'm', text: 't' });
    expect(fake.requests[0]!.headers.authorization).toBeUndefined();
  });

  it('times out', async () => {
    const fake = await startFakeClassifier({ delayMs: 1000 });
    close = fake.close;
    const t0 = Date.now();
    await expect(new HttpClassifier({ baseUrl: fake.url, timeoutMs: 100 }).classify({ messageId: 'm', text: 't' })).rejects.toThrow(/timed out/);
    expect(Date.now() - t0).toBeLessThan(800);
  });

  it('rejects HTTP errors and malformed responses', async () => {
    const err = await startFakeClassifier({ status: 500 });
    await expect(new HttpClassifier({ baseUrl: err.url, timeoutMs: 1000 }).classify({ messageId: 'm', text: 't' })).rejects.toThrow(/HTTP 500/);
    await err.close();
    const bad = await startFakeClassifier({ respond: () => ({ label: 'maybe', score: 2 }) });
    close = bad.close;
    await expect(new HttpClassifier({ baseUrl: bad.url, timeoutMs: 1000 }).classify({ messageId: 'm', text: 't' })).rejects.toThrow(/invalid/);
  });

  it('rejects an unreachable service', async () => {
    await expect(new HttpClassifier({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000 }).classify({ messageId: 'm', text: 't' })).rejects.toThrow(/failed/);
  });

  it('drops highlight spans that do not fit the message', async () => {
    const fake = await startFakeClassifier({
      respond: (b) => ({ messageId: b.messageId, label: 'legit', score: 0.1, category: null, model: 'x', highlights: [{ start: 0, end: 99, text: 'x', weight: 1 }, { start: 1, end: 1, text: '', weight: 1 }, { start: 0, end: 2, text: 'hi', weight: 1 }] }),
    });
    close = fake.close;
    const v = await new HttpClassifier({ baseUrl: fake.url, timeoutMs: 1000 }).classify({ messageId: 'm', text: 'hi there' });
    expect(v.highlights).toEqual([{ start: 0, end: 2, text: 'hi', weight: 1 }]);
  });
});

describe('config and masking', () => {
  it('masks numbers to the last four digits', () => {
    expect(maskNumber('+15555550142')).toBe('***-***-0142');
    expect(maskNumber('12')).toBe('***-***-**12');
  });

  it('applies defaults and refuses debug without a token', () => {
    const c = loadConfig({ PHOTON_WEBHOOK_SECRET: 't' });
    expect(c).toMatchObject({ port: 8787, blockThreshold: 0.5, classifierTimeoutMs: 2500, corsOrigins: ['http://localhost:3000'], debug: false, classifierUrl: null });
    expect(() => loadConfig({})).toThrow(/PHOTON_WEBHOOK_SECRET/);
    expect(() => loadConfig({ PHOTON_WEBHOOK_SECRET: 't', GATEWAY_DEBUG: '1' })).toThrow(/DEBUG_TOKEN/);
    expect(loadConfig({ PHOTON_WEBHOOK_SECRET: 't', GATEWAY_DEBUG: '1', DEBUG_TOKEN: 'd' }).debug).toBe(true);
    expect(() => loadConfig({ PHOTON_WEBHOOK_SECRET: 't', BLOCK_THRESHOLD: '2' })).toThrow(/BLOCK_THRESHOLD/);
    expect(loadConfig({ PHOTON_WEBHOOK_SECRET: 't', CORS_ORIGINS: 'http://a, http://b' }).corsOrigins).toEqual(['http://a', 'http://b']);
  });
});
