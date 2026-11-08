import { describe, expect, it } from 'vitest';
import type { Classifier } from '../src/classifier.js';
import { makeApp } from './helpers.js';

const TOKEN = 'voice-score-test-token';
const fixed = (score: number): Classifier => ({
  classify: async () => ({ label: score >= 0.5 ? 'scam' : 'legit', score, category: score >= 0.5 ? 'Imposter' : null, model: 'fixed@1', highlights: [] }),
});
const voiceApp = (classifier: Classifier, threshold?: number) =>
  makeApp({ classifier, config: { voiceScoreToken: TOKEN, ...(threshold === undefined ? {} : { voiceWarnThreshold: threshold }) } });
const score = (app: ReturnType<typeof makeApp>, body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
  app.request('/voice/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /voice/score', () => {
  it('is 404 when VOICE_SCORE_TOKEN is not set', async () => {
    expect((await score(makeApp(), { callId: 'c1', text: 'hi' })).status).toBe(404);
  });

  it('checks the bearer token', async () => {
    const app = voiceApp(fixed(0.1));
    expect((await score(app, { callId: 'c1', text: 'hi' }, null)).status).toBe(401);
    expect((await score(app, { callId: 'c1', text: 'hi' }, 'Bearer nope')).status).toBe(403);
  });

  it('rejects bad bodies', async () => {
    const app = voiceApp(fixed(0.1));
    for (const b of ['not json', {}, { callId: '', text: 'x' }, { callId: 'x'.repeat(129), text: 'x' }, { callId: 'c', text: '   ' }, { callId: 'c', text: 'x'.repeat(20001) }]) {
      expect((await score(app, b)).status).toBe(400);
    }
  });

  it('warns at or above the threshold (default blockThreshold) and stores nothing', async () => {
    const res = await score(voiceApp(fixed(0.5)), { callId: 'c1', text: 'pay the IRS in gift cards' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ callId: 'c1', action: 'warn', label: 'scam', score: 0.5, category: 'Imposter', model: 'fixed@1' });
    const below = voiceApp(fixed(0.49));
    expect((await (await score(below, { callId: 'c2', text: 'hello grandma' })).json()).action).toBe('none');
    expect(below.store.count()).toBe(0);
  });

  it('uses VOICE_WARN_THRESHOLD when set', async () => {
    expect((await (await score(voiceApp(fixed(0.4), 0.3), { callId: 'c', text: 'x' })).json()).action).toBe('warn');
  });

  it('is 503 when the classifier fails', async () => {
    const app = voiceApp({ classify: async () => { throw new Error('down'); } });
    const res = await score(app, { callId: 'c1', text: 'hi' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'classifier unavailable' });
    expect(app.store.count()).toBe(0);
  });
});
