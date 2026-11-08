import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { EMPTY_TWIML } from '../src/app.js';
import { HttpClassifier, type Classifier } from '../src/classifier.js';
import type { MessagesResponse } from '../src/types.js';
import { fixtureForm, form, makeApp, readContract, signedRequest } from './helpers.js';
import { startFakeClassifier } from './fake-classifier.js';

// CJS interop: these packages export the class/function as module.exports.default.
const Ajv2020 = (Ajv2020Module as unknown as { default: typeof Ajv2020Module.default }).default;
const addFormats = (addFormatsModule as unknown as { default: typeof addFormatsModule.default }).default;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(readContract('contracts/query-api.v1.schema.json'));

async function list(app: ReturnType<typeof makeApp>, query = ''): Promise<MessagesResponse> {
  const res = await app.request(`/api/messages${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as MessagesResponse;
}

describe('POST /twilio/sms', () => {
  it('accepts a validly signed fixture request with empty TwiML and stores it', async () => {
    const app = makeApp();
    const res = await app.request(signedRequest(fixtureForm));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/xml/);
    expect(await res.text()).toBe(EMPTY_TWIML);

    // Stored as pending before classification runs.
    const before = await list(app);
    expect(before.messages).toHaveLength(1);
    expect(before.messages[0]).toMatchObject({ body: fixtureForm.Body, action: 'pending', reason: null, verdict: null });
    expect(before.messages[0]!.from.display).toBe('***-***-0142');

    await app.idle();
    const after = await list(app);
    expect(after.messages[0]!.action).not.toBe('pending');
  });

  it('rejects a missing signature with 403', async () => {
    const app = makeApp();
    const res = await app.request(signedRequest(fixtureForm, { signature: null }));
    expect(res.status).toBe(403);
    expect(app.store.count()).toBe(0);
  });

  it('rejects a bad signature, a wrong token, or tampered params with 403', async () => {
    const app = makeApp();
    expect((await app.request(signedRequest(fixtureForm, { signature: 'bm9wZQ==' }))).status).toBe(403);
    expect((await app.request(signedRequest(fixtureForm, { token: 'other-token' }))).status).toBe(403);
    const req = signedRequest(fixtureForm);
    const tampered = new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: new URLSearchParams({ ...fixtureForm, Body: 'tampered' }).toString(),
    });
    expect((await app.request(tampered)).status).toBe(403);
    expect(app.store.count()).toBe(0);
  });

  it('validates against PUBLIC_WEBHOOK_URL when set', async () => {
    const publicUrl = 'https://gateway.example.com/twilio/sms';
    const app = makeApp({ config: { publicWebhookUrl: publicUrl } });
    // Signed for the public URL, delivered to the local one (as behind a proxy or tunnel).
    const params = fixtureForm;
    const sig = (await import('twilio')).default.getExpectedTwilioSignature('test-auth-token', publicUrl, params);
    expect((await app.request(signedRequest(params, { signature: sig }))).status).toBe(200);
    // Signed for the local URL is now rejected.
    expect((await app.request(signedRequest(form({ MessageSid: 'SM2' })))).status).toBe(403);
  });

  it('ignores a duplicate MessageSid (Twilio retry)', async () => {
    const app = makeApp();
    const r1 = await app.request(signedRequest(fixtureForm));
    const r2 = await app.request(signedRequest(fixtureForm));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(await r2.text()).toBe(EMPTY_TWIML);
    await app.idle();
    expect(app.store.count()).toBe(1);
  });

  it('keeps one participant id per sender number', async () => {
    const app = makeApp();
    await app.request(signedRequest(form({ MessageSid: 'SMa' })));
    await app.request(signedRequest(form({ MessageSid: 'SMb' })));
    await app.request(signedRequest(form({ MessageSid: 'SMc', From: '+15555550177' })));
    await app.idle();
    const { messages } = await list(app);
    const [c, b, a] = messages;
    expect(a!.from.participantId).toBe(b!.from.participantId);
    expect(c!.from.participantId).not.toBe(a!.from.participantId);
    expect(c!.from.display).toBe('***-***-0177');
    expect(a!.from.participantId).toMatch(/^p_[0-9a-f]{16}$/);
  });
});

describe('classification and policy', () => {
  it('blocks a scam with a category and highlights whose spans match the body', async () => {
    const app = makeApp();
    const body = "I'm in trouble, I need $800 in gift cards, please don't tell mom";
    await app.request(signedRequest(form({ MessageSid: 'SMscam', Body: body })));
    await app.idle();
    const [m] = (await list(app)).messages;
    expect(m!.action).toBe('blocked');
    expect(m!.reason).toBe('model_verdict');
    expect(m!.verdict).toMatchObject({ label: 'scam', category: 'Imposter & Phishing', model: 'stub@0' });
    expect(m!.verdict!.score).toBeGreaterThanOrEqual(0.5);
    expect(m!.verdict!.highlights.length).toBeGreaterThan(0);
    for (const h of m!.verdict!.highlights) expect(m!.body.slice(h.start, h.end)).toBe(h.text);
    expect(m!.verdict!.highlights.map((h) => h.text)).toContain('gift cards');
  });

  it('delivers a legitimate message', async () => {
    const app = makeApp();
    await app.request(signedRequest(form({ MessageSid: 'SMlegit', Body: 'Dinner Sunday still on?' })));
    await app.idle();
    const [m] = (await list(app)).messages;
    expect(m).toMatchObject({ action: 'delivered', reason: 'model_verdict' });
    expect(m!.verdict).toMatchObject({ label: 'legit', category: null });
  });

  it('respects BLOCK_THRESHOLD', async () => {
    const fixed: Classifier = { classify: async () => ({ label: 'scam', score: 0.6, category: 'Imposter & Phishing', model: 'fixed', highlights: [] }) };
    const strict = makeApp({ classifier: fixed, config: { blockThreshold: 0.7 } });
    await strict.request(signedRequest(fixtureForm));
    await strict.idle();
    expect((await list(strict)).messages[0]!.action).toBe('delivered');
    const loose = makeApp({ classifier: fixed, config: { blockThreshold: 0.6 } });
    await loose.request(signedRequest(fixtureForm));
    await loose.idle();
    expect((await list(loose)).messages[0]!.action).toBe('blocked');
  });

  it('fails open when the classifier throws', async () => {
    const broken: Classifier = { classify: async () => { throw new Error('boom'); } };
    const app = makeApp({ classifier: broken });
    const res = await app.request(signedRequest(fixtureForm));
    expect(res.status).toBe(200);
    await app.idle();
    const [m] = (await list(app)).messages;
    expect(m).toMatchObject({ action: 'delivered', reason: 'classifier_unavailable', verdict: null });
  });

  it('fails open when the HTTP classifier times out, and the webhook does not wait for it', async () => {
    const fake = await startFakeClassifier({ delayMs: 1000 });
    try {
      const app = makeApp({ classifier: new HttpClassifier({ baseUrl: fake.url, timeoutMs: 100 }) });
      const t0 = Date.now();
      const res = await app.request(signedRequest(fixtureForm));
      expect(res.status).toBe(200);
      expect(Date.now() - t0).toBeLessThan(100);
      await app.idle();
      const [m] = (await list(app)).messages;
      expect(m).toMatchObject({ action: 'delivered', reason: 'classifier_unavailable', verdict: null });
    } finally {
      await fake.close();
    }
  });
});

describe('GET /api/messages', () => {
  async function seeded() {
    const app = makeApp({ classifier: undefined });
    const bodies = [
      'Your prescription is ready for pickup at Main St Pharmacy.',
      "Hi Grandma it's me, I lost my phone, this is my new number",
      "I'm in trouble, I need $800 in gift cards, please don't tell mom",
      'Your account is locked. Verify at bit.ly/acct-verify now',
      'Dinner Sunday still on?',
    ];
    for (const [i, Body] of bodies.entries()) {
      await app.request(signedRequest(form({ MessageSid: `SM${String(i).padStart(32, '0')}`, Body, From: `+1555555010${i}` })));
    }
    // One left pending: add after idle without awaiting it.
    await app.idle();
    await app.request(signedRequest(form({ MessageSid: 'SMpending', Body: 'See you soon' })));
    return { app, bodies };
  }

  it('matches the v1 contract schema, newest first', async () => {
    const { app, bodies } = await seeded();
    const json = await list(app);
    const ok = validate(json);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
    expect(json.messages).toHaveLength(6);
    expect(json.messages[0]!.action).toBe('pending');
    expect(json.messages.slice(1).map((m) => m.body)).toEqual([...bodies].reverse());
    const byBody = Object.fromEntries(json.messages.map((m) => [m.body, m.action]));
    expect(byBody).toMatchObject({
      [bodies[0]!]: 'delivered',
      [bodies[1]!]: 'delivered',
      [bodies[2]!]: 'blocked',
      [bodies[3]!]: 'blocked',
      [bodies[4]!]: 'delivered',
    });
    await app.idle();
    expect(validate(await list(app))).toBe(true);
  });

  it('never exposes raw phone numbers or Twilio SIDs', async () => {
    const { app } = await seeded();
    await app.idle();
    const text = await (await app.request('/api/messages')).text();
    expect(text).not.toContain('+1555');
    expect(text).not.toContain('5555550');
    expect(text).not.toMatch(/\b(SM|AC)[0-9a-zA-Z]{8,}/);
    expect(text).not.toContain('SMpending');
  });

  it('applies limit and rejects bad values', async () => {
    const { app } = await seeded();
    await app.idle();
    expect((await list(app, '?limit=2')).messages).toHaveLength(2);
    for (const bad of ['0', '201', 'abc', '1.5']) {
      expect((await app.request(`/api/messages?limit=${bad}`)).status).toBe(400);
    }
  });

  it('sends CORS headers for allowed origins only', async () => {
    const app = makeApp();
    const ok = await app.request('/api/messages', { headers: { Origin: 'http://localhost:3000' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    const other = await app.request('/api/messages', { headers: { Origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await app.request('/api/messages', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'GET' },
    });
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET');
  });

  it('serves /healthz', async () => {
    const res = await makeApp().request('/healthz');
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('POST /debug/reset', () => {
  it('is 404 when debug is off', async () => {
    const app = makeApp();
    const res = await app.request('/debug/reset', { method: 'POST', headers: { 'X-Debug-Token': 'x' } });
    expect(res.status).toBe(404);
  });

  it('requires the debug token and clears all data when on', async () => {
    const app = makeApp({ config: { debug: true, debugToken: 'secret-debug' } });
    await app.request(signedRequest(fixtureForm));
    await app.idle();
    expect(app.store.count()).toBe(1);

    expect((await app.request('/debug/reset', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/debug/reset', { method: 'POST', headers: { 'X-Debug-Token': 'wrong' } })).status).toBe(403);
    expect(app.store.count()).toBe(1);

    const res = await app.request('/debug/reset', { method: 'POST', headers: { 'X-Debug-Token': 'secret-debug' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cleared: 1 });
    expect((await list(app)).messages).toEqual([]);

    // The same MessageSid is accepted again after a reset.
    await app.request(signedRequest(fixtureForm));
    expect(app.store.count()).toBe(1);
  });
});
