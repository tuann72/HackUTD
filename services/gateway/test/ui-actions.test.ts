import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { MemoryBlocklist, type Blocklist } from '../src/blocklist.js';
import type { Classifier } from '../src/classifier.js';
import type { MessagesResponse } from '../src/types.js';
import { RULES, makeApp, payload, readContract, signedRequest } from './helpers.js';

// Unblock, blocklist status and Clear blocks (contracts/README.md, "Unblock and Clear blocks").

const Ajv2020 = (Ajv2020Module as unknown as { default: typeof Ajv2020Module.default }).default;
const addFormats = (addFormatsModule as unknown as { default: typeof addFormatsModule.default }).default;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(readContract('contracts/query-api.v1.schema.json'));

const SCAMMER = '+15555550166';
const PASSWORD = '4321';
type App = ReturnType<typeof makeApp>;

const makeOn = (opts: Parameters<typeof makeApp>[0] = {}) => makeApp({ ...opts, config: { senderBlocklist: true, ...opts.config } });

function fixedClassifier(score: number) {
  const calls: string[] = [];
  const classifier: Classifier = {
    classify: async (r) => {
      calls.push(r.text);
      return { label: score >= 0.5 ? 'scam' : 'legit', score, category: 'Imposter & Phishing', model: 'fixed', highlights: [] };
    },
  };
  return { classifier, calls };
}

const list = async (app: App) => (await (await app.request('/api/messages')).json()) as MessagesResponse;

async function send(app: App, id: string, from = SCAMMER) {
  const res = await app.request(signedRequest(payload({ id, from, text: `Verify your account now ${id}` })));
  expect(res.status).toBe(200);
  await app.idle();
}

const headers = (password: string | null): Record<string, string> => (password === null ? {} : { 'X-Action-Password': password });
const unblock = (app: App, id: string, password: string | null = PASSWORD) =>
  app.request(`/api/messages/${encodeURIComponent(id)}/unblock`, { method: 'POST', headers: headers(password) });
const clearBlocks = (app: App, password: string | null = PASSWORD) =>
  app.request('/api/blocklist/clear', { method: 'POST', headers: headers(password) });
const status = async (app: App) => (await app.request('/api/blocklist')).json();

describe('password check', () => {
  it('401s both writes on a missing or wrong password, and changes nothing', async () => {
    const app = makeOn({ classifier: fixedClassifier(0.97).classifier });
    await send(app, 'u-1');
    const [m] = (await list(app)).messages;
    for (const pw of [null, '', '1234', '43210']) {
      const u = await unblock(app, m!.id, pw);
      expect(u.status).toBe(401);
      expect(await u.json()).toEqual({ error: 'wrong password' });
      const c = await clearBlocks(app, pw);
      expect(c.status).toBe(401);
      expect(await c.json()).toEqual({ error: 'wrong password' });
    }
    expect((await list(app)).messages[0]).toMatchObject({ action: 'blocked' });
    expect(await status(app)).toEqual({ enabled: true, blockedSenders: 1 });
  });

  it('uses UI_ACTION_PASSWORD when it is set', async () => {
    const app = makeOn({ config: { uiActionPassword: 'open-sesame' } });
    expect((await clearBlocks(app, PASSWORD)).status).toBe(401);
    expect((await clearBlocks(app, 'open-sesame')).status).toBe(200);
  });
});

describe('POST /api/messages/:id/unblock', () => {
  it('on: moves the message to the inbox and allowlists the sender', async () => {
    const { classifier, calls } = fixedClassifier(0.97);
    const app = makeOn({ classifier });
    await send(app, 'u-1');
    await send(app, 'u-2');
    const [m2, m1] = (await list(app)).messages;
    expect(m1).toMatchObject({ action: 'blocked', reason: 'model_verdict' });
    expect(m2).toMatchObject({ action: 'blocked', reason: 'sender_blocked' });

    const res = await unblock(app, m1!.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, messageId: m1!.id, allowlisted: true });
    const [a2, a1] = (await list(app)).messages;
    expect(a1).toMatchObject({ id: m1!.id, action: 'delivered', reason: 'override', verdict: { label: 'scam' } });
    expect(a2).toMatchObject({ action: 'blocked', reason: 'sender_blocked' });
    expect(validate(await list(app))).toBe(true);
    expect(await status(app)).toEqual({ enabled: true, blockedSenders: 0 });

    // Allowlisted: the next scam goes to the model and isn't sender_blocked.
    await send(app, 'u-3');
    expect(calls).toHaveLength(2);
    expect((await list(app)).messages[0]).toMatchObject({ action: 'blocked', reason: 'model_verdict' });
  });

  it('off: restores the message, allowlisted is null', async () => {
    const app = makeApp({ classifier: fixedClassifier(0.97).classifier, config: { senderBlocklist: false } });
    await send(app, 'u-1');
    const [m] = (await list(app)).messages;
    expect(await (await unblock(app, m!.id)).json()).toEqual({ ok: true, messageId: m!.id, allowlisted: null });
    expect((await list(app)).messages[0]).toMatchObject({ action: 'delivered', reason: 'override' });
  });

  it('404s an unknown message and 409s one that is not blocked', async () => {
    const app = makeOn({ classifier: fixedClassifier(0.97).classifier });
    expect((await unblock(app, 'msg_missing')).status).toBe(404);
    await send(app, 'u-1');
    const [m] = (await list(app)).messages;
    expect((await unblock(app, m!.id)).status).toBe(200);
    const again = await unblock(app, m!.id);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'message is delivered, not blocked' });
  });

  it('still restores when the allowlist write fails (fail open)', async () => {
    const inner = new MemoryBlocklist(RULES);
    const flaky: Blocklist = {
      isBlocked: (...a) => inner.isBlocked(...a),
      recordScam: (...a) => inner.recordScam(...a),
      allow: async () => {
        throw new Error('atlas down');
      },
      clear: () => inner.clear(),
      countBlocked: (...a) => inner.countBlocked(...a),
      close: () => inner.close(),
    };
    const app = makeOn({ classifier: fixedClassifier(0.97).classifier, blocklist: flaky });
    await send(app, 'u-1');
    const [m] = (await list(app)).messages;
    expect(await (await unblock(app, m!.id)).json()).toEqual({ ok: true, messageId: m!.id, allowlisted: false });
    expect((await list(app)).messages[0]).toMatchObject({ action: 'delivered', reason: 'override' });
  });
});

describe('GET /api/blocklist and POST /api/blocklist/clear', () => {
  it('counts blocked senders, and clear sends them back to the model', async () => {
    const { classifier, calls } = fixedClassifier(0.97);
    const app = makeOn({ classifier });
    const res = await app.request('/api/blocklist');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ enabled: true, blockedSenders: 0 });

    await send(app, 'c-1', SCAMMER);
    await send(app, 'c-2', '+15555550177');
    expect(await status(app)).toEqual({ enabled: true, blockedSenders: 2 });
    await send(app, 'c-3', SCAMMER);
    expect((await list(app)).messages[0]).toMatchObject({ reason: 'sender_blocked' });
    expect(calls).toHaveLength(2);

    const cleared = await clearBlocks(app);
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ ok: true, cleared: 2, enabled: true });
    expect(await status(app)).toEqual({ enabled: true, blockedSenders: 0 });
    // Already-blocked messages stay in the log.
    const before = (await list(app)).messages;
    expect(before.every((m) => m.action === 'blocked')).toBe(true);

    // The sender's next scam is judged by the model again, not sender_blocked.
    await send(app, 'c-4', SCAMMER);
    expect(calls).toHaveLength(3);
    expect((await list(app)).messages[0]).toMatchObject({ action: 'blocked', reason: 'model_verdict' });
  });

  it('off: status says disabled and clear is a no-op', async () => {
    const spyCalls: string[] = [];
    const inner = new MemoryBlocklist(RULES);
    const spy: Blocklist = {
      isBlocked: (...a) => (spyCalls.push('isBlocked'), inner.isBlocked(...a)),
      recordScam: (...a) => (spyCalls.push('recordScam'), inner.recordScam(...a)),
      allow: (...a) => (spyCalls.push('allow'), inner.allow(...a)),
      clear: () => (spyCalls.push('clear'), inner.clear()),
      countBlocked: (...a) => (spyCalls.push('countBlocked'), inner.countBlocked(...a)),
      close: () => inner.close(),
    };
    const app = makeApp({ blocklist: spy, config: { senderBlocklist: false } });
    expect(await status(app)).toEqual({ enabled: false, blockedSenders: 0 });
    expect(await (await clearBlocks(app)).json()).toEqual({ ok: true, cleared: 0, enabled: false });
    expect(spyCalls).toEqual([]);
  });

  it('503s when the blocklist store fails', async () => {
    const broken: Blocklist = {
      isBlocked: async () => false,
      recordScam: async () => ({ strikes: 0, blocked: false, blockedUntil: null }),
      allow: async () => {},
      clear: async () => {
        throw new Error('atlas down');
      },
      countBlocked: async () => {
        throw new Error('atlas down');
      },
      close: async () => {},
    };
    const app = makeOn({ blocklist: broken });
    const s = await app.request('/api/blocklist');
    expect(s.status).toBe(503);
    expect(await s.json()).toEqual({ error: 'blocklist unavailable' });
    const c = await clearBlocks(app);
    expect(c.status).toBe(503);
  });
});

describe('CORS for the UI actions', () => {
  it('allows POST with X-Action-Password from an allowed origin', async () => {
    const app = makeApp({ config: { corsOrigins: ['https://web.example'] } });
    const res = await app.request('/api/blocklist/clear', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://web.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-action-password,content-type',
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://web.example');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    expect(allowed).toContain('x-action-password');
    expect(allowed).toContain('content-type');
  });
});
