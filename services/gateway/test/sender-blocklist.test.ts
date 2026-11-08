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

describe('sender blocklist in the webhook flow', () => {
  it('after 3 model blocks, the 4th message is sender_blocked without a classifier call', async () => {
    const { classifier, calls } = fixedClassifier(0.8);
    const app = makeApp({ classifier });
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
    const app = makeApp({ classifier });
    await send(app, 'spc-1');
    await app.idle();
    await send(app, 'spc-2');
    await app.idle();
    expect(calls).toHaveLength(1);
    expect((await list(app)).messages[0]).toMatchObject({ reason: 'sender_blocked' });
  });

  it('legit messages and other senders are unaffected', async () => {
    const { classifier } = fixedClassifier(0.97);
    const app = makeApp({ classifier });
    await send(app, 'spc-1');
    await app.idle();
    const legit = fixedClassifier(0.1);
    const other = makeApp({ classifier: legit.classifier });
    await send(other, 'spc-2', { from: '+15555550101' });
    await other.idle();
    expect((await list(other)).messages[0]).toMatchObject({ action: 'delivered', reason: 'model_verdict' });
  });

  it('blocks text-less content (attachment, reaction) from a blocklisted sender', async () => {
    const { classifier } = fixedClassifier(0.97);
    const app = makeApp({ classifier });
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
    const app = makeApp({ classifier });
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
    const app = makeApp({ classifier, now: () => clock });
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
    const app = makeApp({ classifier, blocklist: broken });
    await send(app, 'spc-1');
    const scam = fixedClassifier(0.99);
    const app2 = makeApp({ classifier: scam.classifier, blocklist: broken });
    await send(app2, 'spc-2');
    await app.idle();
    await app2.idle();
    expect(calls).toHaveLength(1);
    expect((await list(app)).messages[0]).toMatchObject({ action: 'delivered', reason: 'model_verdict' });
    expect((await list(app2)).messages[0]).toMatchObject({ action: 'blocked', reason: 'model_verdict' });
  });

  it('works with the blocklist off (no deps)', async () => {
    const { classifier, calls } = fixedClassifier(0.99);
    const app = makeApp({ classifier, blocklist: null });
    await send(app, 'spc-1');
    await app.idle();
    await send(app, 'spc-2');
    await app.idle();
    expect(calls).toHaveLength(2);
  });

  it('sender_blocked output matches the contract and exposes no raw handle', async () => {
    const { classifier } = fixedClassifier(0.97);
    const app = makeApp({ classifier });
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
    const app = makeApp({ classifier: fixedClassifier(0.97).classifier, blocklist });
    await send(app, 'spc-1');
    await app.idle();
    const dump = JSON.stringify([...blocklist.senders.values(), ...blocklist.texts.values()]);
    expect(dump).not.toContain('5555550166');
    expect(blocklist.senders.has(fingerprinter.sender(SCAMMER))).toBe(true);
  });
});

describe('POST /admin/senders/allow ("Not a scam")', () => {
  const ADMIN = 'admin-token-0123456789';
  const allow = (app: ReturnType<typeof makeApp>, body: unknown, token: string | null = ADMIN) =>
    app.request('/admin/senders/allow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Admin-Token': token } : {}) },
      body: JSON.stringify(body),
    });

  it('is 404 when ADMIN_TOKEN is unset', async () => {
    const app = makeApp();
    expect((await allow(app, { messageId: 'msg_x' })).status).toBe(404);
  });

  it('checks the token and the body', async () => {
    const app = makeApp({ config: { adminToken: ADMIN } });
    expect((await allow(app, { messageId: 'msg_x' }, null)).status).toBe(401);
    expect((await allow(app, { messageId: 'msg_x' }, 'wrong-token-0000000')).status).toBe(403);
    expect((await allow(app, {})).status).toBe(400);
    expect((await allow(app, { messageId: 'msg_missing' })).status).toBe(404);
  });

  it('restores the sender’s blocked messages and the model judges its next scam again', async () => {
    const { classifier, calls } = fixedClassifier(0.97);
    const app = makeApp({ classifier, config: { adminToken: ADMIN } });
    await send(app, 'spc-1');
    await app.idle();
    await send(app, 'spc-2');
    await app.idle();
    const [m2, m1] = (await list(app)).messages;
    expect(m2!.reason).toBe('sender_blocked');

    const res = await allow(app, { messageId: m1!.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, allowlisted: true, restored: 2 });
    const after = (await list(app)).messages;
    for (const m of after) expect(m).toMatchObject({ action: 'delivered', reason: 'override' });
    expect(after[1]!.verdict).toMatchObject({ label: 'scam' }); // the verdict is kept for the record
    expect(validate(await list(app))).toBe(true);

    await send(app, 'spc-3');
    await app.idle();
    expect(calls).toHaveLength(2);
    // Still judged one message at a time: the model blocks it, but the sender stays off the blocklist.
    expect((await list(app)).messages[0]).toMatchObject({ action: 'blocked', reason: 'model_verdict' });
    await send(app, 'spc-4');
    await app.idle();
    expect(calls).toHaveLength(3);
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
