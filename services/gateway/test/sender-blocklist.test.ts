import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { MemoryBlocklist, type Blocklist } from '../src/blocklist.js';
import type { Classifier } from '../src/classifier.js';
import type { MessagesResponse, Verdict } from '../src/types.js';
import { NOW, RULES, fingerprinter, makeApp, payload, readContract, signedRequest } from './helpers.js';

const Ajv2020 = (Ajv2020Module as unknown as { default: typeof Ajv2020Module.default }).default;
const addFormats = (addFormatsModule as unknown as { default: typeof addFormatsModule.default }).default;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(readContract('contracts/query-api.v1.schema.json'));

const SCAMMER = '+15555550166';

/** The parked option: SENDER_BLOCKLIST=on. */
const makeOn = (opts: Parameters<typeof makeApp>[0] = {}) => makeApp({ ...opts, config: { senderBlocklist: true, ...opts.config } });

/** Scores every message `score`, and counts calls. */
function fixedClassifier(score: number) {
  const calls: string[] = [];
  const classifier: Classifier = {
    classify: async (r) => {
      calls.push(r.text);
      const v: Verdict = { label: score >= 0.5 ? 'scam' : 'legit', score, category: 'Imposter & Phishing', model: 'fixed', highlights: [] };
      return v;
    },
  };
  return { classifier, calls };
}

async function list(app: ReturnType<typeof makeApp>): Promise<MessagesResponse> {
  return (await (await app.request('/api/messages')).json()) as MessagesResponse;
}

async function send(app: ReturnType<typeof makeApp>, id: string, opts: { from?: string; text?: string; content?: unknown; at?: Date } = {}) {
  const body = payload({ id, from: opts.from ?? SCAMMER, text: opts.content ? undefined : (opts.text ?? `Verify your account now ${id}`), content: opts.content });
  const res = await app.request(signedRequest(body, opts.at ? { timestamp: Math.floor(opts.at.getTime() / 1000) } : {}));
  expect(res.status).toBe(200);
}

describe('SENDER_BLOCKLIST=on (parked option)', () => {
  it('after 3 model blocks, the 4th message is sender_blocked without a classifier call', async () => {
    const { classifier, calls } = fixedClassifier(0.8);
    const app = makeOn({ classifier });
    for (const id of ['spc-1', 'spc-2', 'spc-3']) await send(app, id);
    await app.idle();
    expect(calls).toHaveLength(3);
    await send(app, 'spc-4');
    await app.idle();
    expect(calls).toHaveLength(3);
    const [m4, m3] = (await list(app)).messages;
    expect(m3).toMatchObject({ action: 'blocked', reason: 'model_verdict' });
    expect(m4).toMatchObject({ action: 'blocked', reason: 'sender_blocked', verdict: null });
  });

  it('one very high score blocklists the sender at once', async () => {
    const { classifier, calls } = fixedClassifier(0.97);
    const app = makeOn({ classifier });
    await send(app, 'spc-1');
    await app.idle();
    await send(app, 'spc-2');
    await app.idle();
    expect(calls).toHaveLength(1);
    expect((await list(app)).messages[0]).toMatchObject({ reason: 'sender_blocked' });
  });

  it('legit messages and other senders are unaffected', async () => {
    const { classifier } = fixedClassifier(0.97);
    const app = makeOn({ classifier });
    await send(app, 'spc-1');
    await app.idle();
    const legit = fixedClassifier(0.1);
    const other = makeOn({ classifier: legit.classifier });
    await send(other, 'spc-2', { from: '+15555550101' });
    await other.idle();
    expect((await list(other)).messages[0]).toMatchObject({ action: 'delivered', reason: 'model_verdict' });
  });

  it('blocks text-less content (attachment, reaction) from a blocklisted sender', async () => {
    const { classifier } = fixedClassifier(0.97);
    const app = makeOn({ classifier });
    await send(app, 'spc-1');
    await app.idle();
    await send(app, 'spc-a', { content: { type: 'attachment', id: 'g', name: 'gift-card.jpg', mimeType: 'image/jpeg' } });
    await send(app, 'spc-r', { content: { type: 'reaction', emoji: '👍', target: { id: 'x', platform: 'imessage' } } });
    // A clean sender's attachment is still delivered unchecked.
    await send(app, 'spc-ok', { from: '+15555550101', content: { type: 'attachment', id: 'h', name: 'lake.jpg' } });
    await app.idle();
    const [ok, r, a] = (await list(app)).messages;
    expect(a).toMatchObject({ kind: 'attachment', action: 'blocked', reason: 'sender_blocked' });
    expect(r).toMatchObject({ kind: 'reaction', action: 'blocked', reason: 'sender_blocked' });
    expect(ok).toMatchObject({ action: 'delivered', reason: 'not_classified' });
  });

  it('fingerprints email handles case-insensitively', async () => {
    const { classifier, calls } = fixedClassifier(0.97);
    const app = makeOn({ classifier });
    await send(app, 'spc-1', { from: 'Scammer@iCloud.com' });
    await app.idle();
    await send(app, 'spc-2', { from: 'scammer@icloud.com ' });
    await app.idle();
    expect(calls).toHaveLength(1);
    expect((await list(app)).messages[0]).toMatchObject({ reason: 'sender_blocked' });
    expect(fingerprinter.sender('Scammer@iCloud.com')).toBe(fingerprinter.sender(' scammer@icloud.com'));
    expect(fingerprinter.sender('a@icloud.com')).not.toBe(fingerprinter.sender('b@icloud.com'));
  });

  it('an expired block sends the sender back to the model', async () => {
    const { classifier, calls } = fixedClassifier(0.97);
    let clock = NOW;
    const app = makeOn({ classifier, now: () => clock });
    await send(app, 'spc-1');
    await app.idle();
    clock = new Date(NOW.getTime() + RULES.ttlMs + 1000);
    await send(app, 'spc-2', { at: clock });
    await app.idle();
    expect(calls).toHaveLength(2);
    expect((await list(app)).messages[0]).toMatchObject({ reason: 'model_verdict' });
  });

  it('fails open when the blocklist throws: still classified, and the webhook still 200s', async () => {
    const broken: Blocklist = {
      isBlocked: async () => {
        throw new Error('atlas down');
      },
      recordScam: async () => {
        throw new Error('atlas down');
      },
      allow: async () => {
        throw new Error('atlas down');
      },
      close: async () => {},
    };
    const { classifier, calls } = fixedClassifier(0.1);
    const app = makeOn({ classifier, blocklist: broken });
    await send(app, 'spc-1');
    const scam = fixedClassifier(0.99);
    const app2 = makeOn({ classifier: scam.classifier, blocklist: broken });
    await send(app2, 'spc-2');
    await app.idle();
    await app2.idle();
    expect(calls).toHaveLength(1);
    expect((await list(app)).messages[0]).toMatchObject({ action: 'delivered', reason: 'model_verdict' });
    expect((await list(app2)).messages[0]).toMatchObject({ action: 'blocked', reason: 'model_verdict' });
  });

  it('works with the blocklist off (no deps)', async () => {
    const { classifier, calls } = fixedClassifier(0.99);
    const app = makeOn({ classifier, blocklist: null });
    await send(app, 'spc-1');
    await app.idle();
    await send(app, 'spc-2');
    await app.idle();
    expect(calls).toHaveLength(2);
  });

  it('sender_blocked output matches the contract and exposes no raw handle', async () => {
    const { classifier } = fixedClassifier(0.97);
    const app = makeOn({ classifier });
    await send(app, 'spc-1', { from: 'scammer@icloud.com' });
    await app.idle();
    await send(app, 'spc-2', { from: 'scammer@icloud.com' });
    await app.idle();
    const text = await (await app.request('/api/messages')).text();
    expect(validate(JSON.parse(text))).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
    expect(text).not.toContain('scammer@');
    expect(text).toContain('s***@icloud.com');
  });

  it('the in-memory store never holds a raw handle', async () => {
    const blocklist = new MemoryBlocklist(RULES);
    const app = makeOn({ classifier: fixedClassifier(0.97).classifier, blocklist });
    await send(app, 'spc-1');
    await app.idle();
    const dump = JSON.stringify([...blocklist.senders.values(), ...blocklist.texts.values()]);
    expect(dump).not.toContain('5555550166');
    expect(blocklist.senders.has(fingerprinter.sender(SCAMMER))).toBe(true);
  });
});

function spyBlocklist() {
  const calls: string[] = [];
  const inner = new MemoryBlocklist(RULES);
  const list: Blocklist = {
    isBlocked: (...a) => (calls.push('isBlocked'), inner.isBlocked(...a)),
    recordScam: (...a) => (calls.push('recordScam'), inner.recordScam(...a)),
    allow: (...a) => (calls.push('allow'), inner.allow(...a)),
    close: () => inner.close(),
  };
  return { list, calls };
}

describe('SENDER_BLOCKLIST=off (default): block the message, not the sender', () => {
  it('is off by default in config', async () => {
    const { loadConfig } = await import('../src/config.js');
    expect(loadConfig({ PHOTON_WEBHOOK_SECRET: 't' }).senderBlocklist).toBe(false);
    expect(loadConfig({ PHOTON_WEBHOOK_SECRET: 't', SENDER_BLOCKLIST: 'on' }).senderBlocklist).toBe(true);
    expect(() => loadConfig({ PHOTON_WEBHOOK_SECRET: 't', SENDER_BLOCKLIST: 'yes' })).toThrow(/SENDER_BLOCKLIST/);
    // Atlas settings aren't validated while off.
    expect(() => loadConfig({ PHOTON_WEBHOOK_SECRET: 't', MONGODB_URI: 'mongodb+srv://x' })).not.toThrow();
    expect(() => loadConfig({ PHOTON_WEBHOOK_SECRET: 't', SENDER_BLOCKLIST: 'on', MONGODB_URI: 'mongodb+srv://x' })).toThrow(/FINGERPRINT_SECRET/);
  });

  it('never calls the blocklist, even after repeated scams; the scammer’s next legit message is delivered', async () => {
    const spy = spyBlocklist();
    let score = 0.99;
    const calls: string[] = [];
    const classifier: Classifier = {
      classify: async (r) => {
        calls.push(r.text);
        return { label: score >= 0.5 ? 'scam' : 'legit', score, category: score >= 0.5 ? 'Imposter & Phishing' : null, model: 'm', highlights: [] };
      },
    };
    const app = makeApp({ classifier, blocklist: spy.list }); // default config: off
    for (const id of ['spc-1', 'spc-2', 'spc-3', 'spc-4']) await send(app, id);
    await send(app, 'spc-att', { content: { type: 'attachment', id: 'g', name: 'card.jpg' } });
    await app.idle();
    score = 0.05;
    await send(app, 'spc-legit', { text: 'Running late, see you at 6' });
    await app.idle();
    expect(spy.calls).toEqual([]);
    expect(calls).toHaveLength(5);
    const [legit, att, ...scams] = (await list(app)).messages;
    expect(legit).toMatchObject({ action: 'delivered', reason: 'model_verdict' });
    expect(att).toMatchObject({ action: 'delivered', reason: 'not_classified' });
    for (const m of scams) expect(m).toMatchObject({ action: 'blocked', reason: 'model_verdict' });
    expect(JSON.stringify(await list(app))).not.toContain('sender_blocked');
  });
});

describe('POST /admin/messages/restore ("Not a scam" for one message)', () => {
  const ADMIN = 'admin-token-0123456789';
  const restore = (app: ReturnType<typeof makeApp>, body: unknown, token: string | null = ADMIN) =>
    app.request('/admin/messages/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Admin-Token': token } : {}) },
      body: JSON.stringify(body),
    });

  it('is 404 when ADMIN_TOKEN is unset', async () => {
    expect((await restore(makeApp(), { messageId: 'msg_x' })).status).toBe(404);
  });

  it('checks the token and the body', async () => {
    const app = makeApp({ config: { adminToken: ADMIN } });
    expect((await restore(app, { messageId: 'msg_x' }, null)).status).toBe(401);
    expect((await restore(app, { messageId: 'msg_x' }, 'wrong-token-0000000')).status).toBe(403);
    expect((await restore(app, {})).status).toBe(400);
    expect((await restore(app, { messageId: 'msg_missing' })).status).toBe(404);
  });

  it('off: restores only the named message, keeps its verdict, touches no blocklist', async () => {
    const spy = spyBlocklist();
    const app = makeApp({ classifier: fixedClassifier(0.97).classifier, blocklist: spy.list, config: { adminToken: ADMIN } });
    await send(app, 'spc-1');
    await send(app, 'spc-2');
    await app.idle();
    const [m2, m1] = (await list(app)).messages;
    const res = await restore(app, { messageId: m1!.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, messageId: m1!.id, allowlisted: null });
    const [a2, a1] = (await list(app)).messages;
    expect(a1).toMatchObject({ id: m1!.id, action: 'delivered', reason: 'override', verdict: { label: 'scam' } });
    expect(a2).toMatchObject({ id: m2!.id, action: 'blocked', reason: 'model_verdict' });
    expect(validate(await list(app))).toBe(true);
    expect(spy.calls).toEqual([]);
    // Restoring it again, or a delivered message, is a conflict.
    expect((await restore(app, { messageId: m1!.id })).status).toBe(409);
  });

  it('on: restores only the named message and allowlists the sender', async () => {
    const { classifier, calls } = fixedClassifier(0.97);
    const app = makeOn({ classifier, config: { adminToken: ADMIN } });
    await send(app, 'spc-1');
    await app.idle();
    await send(app, 'spc-2');
    await app.idle();
    const [m2, m1] = (await list(app)).messages;
    expect(m2!.reason).toBe('sender_blocked');
    const res = await restore(app, { messageId: m1!.id });
    expect(await res.json()).toEqual({ ok: true, messageId: m1!.id, allowlisted: true });
    const [a2, a1] = (await list(app)).messages;
    expect(a1).toMatchObject({ action: 'delivered', reason: 'override' });
    expect(a2).toMatchObject({ action: 'blocked', reason: 'sender_blocked' });
    // The sender is off the blocklist: its next scam goes to the model again.
    await send(app, 'spc-3');
    await app.idle();
    expect(calls).toHaveLength(2);
    expect((await list(app)).messages[0]).toMatchObject({ action: 'blocked', reason: 'model_verdict' });
  });
});

describe('openDb schema guard', () => {
  it('refuses a database created before the sender_blocked/override reasons', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DatabaseSync } = await import('node:sqlite');
    const { openDb } = await import('../src/db.js');
    const path = join(mkdtempSync(join(tmpdir(), 'tgate-')), 'old.sqlite');
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE messages (seq INTEGER PRIMARY KEY, id TEXT, extras_json TEXT, reason TEXT CHECK (reason IN ('model_verdict', 'not_classified')))",
    );
    old.close();
    expect(() => openDb(path)).toThrow(/older schema/);
  });
});
