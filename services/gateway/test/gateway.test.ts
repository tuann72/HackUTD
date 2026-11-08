import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { HttpClassifier, type Classifier } from '../src/classifier.js';
import { maskHandle } from '../src/db.js';
import { spectrumSignature } from '../src/photon.js';
import type { MessagesResponse } from '../src/types.js';
import { NOW_S, SECRET, fixtureBody, fixtureText, makeApp, payload, readContract, signedRequest } from './helpers.js';
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

describe('POST /webhooks/photon', () => {
  it('accepts a validly signed fixture delivery with 200 ok and stores it', async () => {
    const app = makeApp();
    const res = await app.request(signedRequest(fixtureBody));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');

    // Stored as pending before classification runs.
    const before = await list(app);
    expect(before.messages).toHaveLength(1);
    expect(before.messages[0]).toMatchObject({ body: fixtureText, action: 'pending', reason: null, verdict: null });
    expect(before.messages[0]!.from.display).toBe('***-***-0142');

    await app.idle();
    const after = await list(app);
    expect(after.messages[0]!.action).not.toBe('pending');
  });

  it('rejects missing signature or timestamp headers with 400', async () => {
    const app = makeApp();
    expect((await app.request(signedRequest(fixtureBody, { signature: null }))).status).toBe(400);
    expect((await app.request(signedRequest(fixtureBody, { timestamp: null }))).status).toBe(400);
    expect(app.store.count()).toBe(0);
  });

  it('rejects a stale or future timestamp with 400 (replay window)', async () => {
    const app = makeApp();
    expect((await app.request(signedRequest(fixtureBody, { timestamp: NOW_S - 301 }))).status).toBe(400);
    expect((await app.request(signedRequest(fixtureBody, { timestamp: NOW_S + 301 }))).status).toBe(400);
    expect((await app.request(signedRequest(payload({ id: 'spc-msg-edge' }), { timestamp: NOW_S - 300 }))).status).toBe(200);
    expect(app.store.count()).toBe(1);
  });

  it('rejects a bad signature, a wrong secret, or a tampered body with 401', async () => {
    const app = makeApp();
    expect((await app.request(signedRequest(fixtureBody, { signature: 'v0=' + '0'.repeat(64) }))).status).toBe(401);
    expect((await app.request(signedRequest(fixtureBody, { signature: 'nope' }))).status).toBe(401);
    expect((await app.request(signedRequest(fixtureBody, { secret: 'other-secret' }))).status).toBe(401);
    const raw = JSON.stringify(fixtureBody);
    const sig = spectrumSignature(SECRET, String(NOW_S), raw);
    expect((await app.request(signedRequest(null, { raw: raw.replace('Grandma', 'Grandpa'), signature: sig }))).status).toBe(401);
    expect(app.store.count()).toBe(0);
  });

  it('verifies over the raw bytes, so whitespace a re-serializer would drop still counts', async () => {
    const app = makeApp();
    const raw = JSON.stringify(fixtureBody, null, 2);
    expect((await app.request(signedRequest(null, { raw }))).status).toBe(200);
    expect(app.store.count()).toBe(1);
  });

  it('ignores a duplicate message.id (Photon retry)', async () => {
    const app = makeApp();
    const r1 = await app.request(signedRequest(fixtureBody));
    const r2 = await app.request(signedRequest(fixtureBody));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    await app.idle();
    expect(app.store.count()).toBe(1);
  });

  it('acks but ignores unknown events, unknown content types and empty text', async () => {
    const app = makeApp();
    for (const body of [
      payload({ event: 'typing' }),
      payload({ id: 'spc-msg-poll', content: { type: 'poll', question: '?' } }),
      payload({ id: 'spc-msg-e', text: '   ' }),
      payload({ id: 'spc-msg-g', content: { type: 'group', items: [] } }),
    ]) {
      expect((await app.request(signedRequest(body))).status).toBe(200);
    }
    expect(app.store.count()).toBe(0);
  });

  it('delivers attachments, reactions and contact cards unclassified, with their metadata', async () => {
    const calls: string[] = [];
    const spy: Classifier = {
      classify: async (r) => {
        calls.push(r.text);
        return { label: 'legit', score: 0, category: null, model: 'spy', highlights: [] };
      },
    };
    const app = makeApp({ classifier: spy });
    await app.request(signedRequest(payload({ id: 'spc-msg-a', content: { type: 'attachment', id: 'GUID-1', name: 'invoice.pdf', mimeType: 'application/pdf', size: 1234 } })));
    await app.request(signedRequest(payload({ id: 'spc-msg-r', content: { type: 'reaction', emoji: '👍', target: { id: 'x', platform: 'imessage', contentPreview: 'See you at 5' } } })));
    await app.request(signedRequest(payload({ id: 'spc-msg-c', content: { type: 'contact', name: 'Bank Fraud Dept', phones: ['+15555550199'] } })));
    await app.idle();
    expect(calls).toEqual([]);
    const [c, r, a] = (await list(app)).messages;
    for (const m of [a, r, c]) expect(m).toMatchObject({ action: 'delivered', reason: 'not_classified', verdict: null, body: '' });
    expect(a).toMatchObject({ kind: 'attachment', attachments: [{ name: 'invoice.pdf', mimeType: 'application/pdf', size: 1234 }] });
    expect(r).toMatchObject({ kind: 'reaction', reaction: { emoji: '👍', targetPreview: 'See you at 5' } });
    expect(c).toMatchObject({ kind: 'contact', contact: { name: 'Bank Fraud Dept', phones: ['***-***-0199'] } });
    const text = await (await app.request('/api/messages')).text();
    expect(text).not.toContain('GUID-1');
    expect(text).not.toContain('+15555550199');
    expect(validate(JSON.parse(text))).toBe(true);
  });

  it('classifies rich links and album text, and lists album attachments', async () => {
    const app = makeApp();
    await app.request(signedRequest(payload({ id: 'spc-msg-l', content: { type: 'richlink', url: 'https://bit.ly/acct-verify' } })));
    const album = {
      type: 'group',
      items: [
        payload({ id: 'i1', text: 'Your account is locked' }).message,
        payload({ id: 'i2', content: { type: 'attachment', id: 'g', name: 'IMG_1.HEIC', mimeType: 'image/heic' } }).message,
      ],
    };
    await app.request(signedRequest(payload({ id: 'spc-msg-g', content: album })));
    const photosOnly = { type: 'group', items: [payload({ id: 'i3', content: { type: 'attachment', id: 'h', name: 'a.jpg' } }).message] };
    await app.request(signedRequest(payload({ id: 'spc-msg-p', content: photosOnly })));
    await app.idle();
    const [p, g, l] = (await list(app)).messages;
    expect(l).toMatchObject({ kind: 'link', body: 'https://bit.ly/acct-verify', reason: 'model_verdict' });
    expect(g).toMatchObject({
      kind: 'album',
      body: 'Your account is locked',
      reason: 'model_verdict',
      attachments: [{ name: 'IMG_1.HEIC', mimeType: 'image/heic', size: null }],
    });
    expect(p).toMatchObject({ kind: 'album', body: '', reason: 'not_classified', action: 'delivered' });
  });

  it('tracks group chats as one opaque conversation, separate from DMs', async () => {
    const app = makeApp();
    const group = (id: string, from: string, text: string) => {
      const b = payload({ id, from, text });
      b.space = { id: 'chat-guid-123', platform: 'imessage', type: 'group', phone: '+15555550100' };
      b.message.space = { ...b.space };
      return b;
    };
    await app.request(signedRequest(group('spc-msg-1', '+15555550142', 'Hi all')));
    await app.request(signedRequest(group('spc-msg-2', '+15555550177', 'Hey')));
    await app.request(signedRequest(payload({ id: 'spc-msg-3', from: '+15555550142', text: 'Just you' })));
    await app.idle();
    const [dm, g2, g1] = (await list(app)).messages;
    expect(g1!.conversation).toEqual(g2!.conversation);
    expect(g1!.conversation.type).toBe('group');
    expect(g1!.from.participantId).not.toBe(g2!.from.participantId);
    expect(dm!.conversation.type).toBe('dm');
    expect(dm!.conversation.id).not.toBe(g1!.conversation.id);
    expect(g1!.conversation.id).toMatch(/^c_[0-9a-f]{16}$/);
    expect(await (await app.request('/api/messages')).text()).not.toContain('chat-guid');
  });

  it('rejects a signed but malformed payload with 400', async () => {
    const app = makeApp();
    expect((await app.request(signedRequest(null, { raw: '{not json' }))).status).toBe(400);
    const noSender = payload();
    delete noSender.message.sender;
    expect((await app.request(signedRequest(noSender))).status).toBe(400);
    expect(app.store.count()).toBe(0);
  });

  it('keeps one participant id per handle, and masks email handles', async () => {
    const app = makeApp();
    await app.request(signedRequest(payload({ id: 'spc-msg-a' })));
    await app.request(signedRequest(payload({ id: 'spc-msg-b' })));
    await app.request(signedRequest(payload({ id: 'spc-msg-c', from: '+15555550177' })));
    await app.request(signedRequest(payload({ id: 'spc-msg-d', from: 'Scammer@iCloud.com' })));
    await app.request(signedRequest(payload({ id: 'spc-msg-e', from: 'scammer@icloud.com' })));
    await app.idle();
    const [e, d, c, b, a] = (await list(app)).messages;
    expect(a!.from.participantId).toBe(b!.from.participantId);
    expect(c!.from.participantId).not.toBe(a!.from.participantId);
    expect(d!.from.participantId).toBe(e!.from.participantId);
    expect(c!.from.display).toBe('***-***-0177');
    expect(d!.from.display).toBe('s***@icloud.com');
    expect(a!.from.participantId).toMatch(/^p_[0-9a-f]{16}$/);
    expect(maskHandle('+15555550142')).toBe('***-***-0142');
  });
});

describe('classification and policy', () => {
  it('blocks a scam with a category and highlights whose spans match the body', async () => {
    const app = makeApp();
    const body = "I'm in trouble, I need $800 in gift cards, please don't tell mom";
    await app.request(signedRequest(payload({ id: 'SMscam', text: body })));
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
    await app.request(signedRequest(payload({ id: 'SMlegit', text: 'Dinner Sunday still on?' })));
    await app.idle();
    const [m] = (await list(app)).messages;
    expect(m).toMatchObject({ action: 'delivered', reason: 'model_verdict' });
    expect(m!.verdict).toMatchObject({ label: 'legit', category: null });
  });

  it('respects BLOCK_THRESHOLD', async () => {
    const fixed: Classifier = { classify: async () => ({ label: 'scam', score: 0.6, category: 'Imposter & Phishing', model: 'fixed', highlights: [] }) };
    const strict = makeApp({ classifier: fixed, config: { blockThreshold: 0.7 } });
    await strict.request(signedRequest(fixtureBody));
    await strict.idle();
    expect((await list(strict)).messages[0]!.action).toBe('delivered');
    const loose = makeApp({ classifier: fixed, config: { blockThreshold: 0.6 } });
    await loose.request(signedRequest(fixtureBody));
    await loose.idle();
    expect((await list(loose)).messages[0]!.action).toBe('blocked');
  });

  it('fails open when the classifier throws', async () => {
    const broken: Classifier = { classify: async () => { throw new Error('boom'); } };
    const app = makeApp({ classifier: broken });
    const res = await app.request(signedRequest(fixtureBody));
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
      const res = await app.request(signedRequest(fixtureBody));
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
      await app.request(signedRequest(payload({ id: `spc-msg-${i}`, text: Body, from: `+1555555010${i}` })));
    }
    // One left pending: add after idle without awaiting it.
    await app.idle();
    await app.request(signedRequest(payload({ id: 'spc-pending', text: 'See you soon' })));
    return { app, bodies };
  }

  it('the contract fixture itself matches the schema', () => {
    expect(validate(readContract('contracts/fixtures/messages.v1.sample.json'))).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
  });

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

  it('never exposes raw handles or Photon message/space ids', async () => {
    const { app } = await seeded();
    await app.idle();
    const text = await (await app.request('/api/messages')).text();
    expect(text).not.toContain('+1555');
    expect(text).not.toContain('5555550');
    expect(text).not.toContain('spc-msg');
    expect(text).not.toContain('any;-;');
    expect(text).not.toContain('spc-pending');
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
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET,POST,DELETE');
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
    await app.request(signedRequest(fixtureBody));
    await app.idle();
    expect(app.store.count()).toBe(1);

    expect((await app.request('/debug/reset', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/debug/reset', { method: 'POST', headers: { 'X-Debug-Token': 'wrong' } })).status).toBe(403);
    expect(app.store.count()).toBe(1);

    const res = await app.request('/debug/reset', { method: 'POST', headers: { 'X-Debug-Token': 'secret-debug' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cleared: 1 });
    expect((await list(app)).messages).toEqual([]);

    // The same message id is accepted again after a reset.
    await app.request(signedRequest(fixtureBody));
    expect(app.store.count()).toBe(1);
  });
});

describe('DELETE /api/messages', () => {
  it('deletes every message without a token, and the id is accepted again', async () => {
    const app = makeApp();
    await app.request(signedRequest(fixtureBody));
    await app.idle();
    expect(app.store.count()).toBe(1);

    const res = await app.request('/api/messages', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cleared: 1 });
    expect((await list(app)).messages).toEqual([]);

    await app.request(signedRequest(fixtureBody));
    expect(app.store.count()).toBe(1);
  });

  it('allows DELETE in the CORS preflight', async () => {
    const app = makeApp({ config: { corsOrigins: ['https://web.example'] } });
    const res = await app.request('/api/messages', {
      method: 'OPTIONS',
      headers: { Origin: 'https://web.example', 'Access-Control-Request-Method': 'DELETE' },
    });
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  });
});
