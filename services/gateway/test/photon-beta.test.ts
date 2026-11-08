import { describe, expect, it } from 'vitest';
import { standardSignature } from '../src/photon.js';
import { NOW_S, WEBHOOK_URL, makeApp } from './helpers.js';

// A whsec_ secret: the key is the base64 part.
const KEY = Buffer.from('beta-signing-key-0123456789').toString('base64');
const BETA_SECRET = `whsec_${KEY}`;

function event(o: { id?: string; content?: unknown; type?: string; platform?: string; status?: string } = {}) {
  return {
    id: 'pho_evt_1',
    type: o.type ?? 'message.received',
    apiVersion: '2026-07-01',
    source: 'imessage.photon',
    timestamp: '2026-11-08T15:04:05.000Z',
    data: {
      projectId: 'pho_prj_x',
      object: {
        id: o.id ?? 'pho_msg_1',
        platform: o.platform ?? 'imessage',
        status: o.status ?? 'received',
        space: { id: 'pho_spc_1', kind: 'direct' },
        sentBy: { handle: '+15550100123', platform: 'imessage' },
        content: o.content ?? { type: 'text', format: 'plain', text: 'Your account is locked, verify now' },
        timestamp: '2026-11-08T15:04:04.000Z',
      },
    },
  };
}

function req(body: unknown, o: { secret?: string; ts?: number; sig?: string; raw?: string } = {}) {
  const raw = o.raw ?? JSON.stringify(body);
  const ts = String(o.ts ?? NOW_S);
  const sig = o.sig ?? `v1,${standardSignature(o.secret ?? BETA_SECRET, 'msg_1', ts, raw)}`;
  return new Request(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'webhook-id': 'msg_1', 'webhook-timestamp': ts, 'webhook-signature': sig },
    body: raw,
  });
}

const app = () => makeApp({ config: { photonWebhookSecret: BETA_SECRET } });
const list = async (a: ReturnType<typeof app>) => ((await (await a.request('http://localhost/api/messages')).json()) as { messages: any[] }).messages;

describe('Photon 2.0 / Beta webhooks', () => {
  it('accepts a signed message.received and stores it', async () => {
    const a = app();
    expect((await a.request(req(event()))).status).toBe(200);
    const [m] = await list(a);
    expect(m.body).toBe('Your account is locked, verify now');
    expect(m.kind).toBe('text');
    expect(JSON.stringify(m)).not.toContain('+15550100123');
  });

  it('accepts when any signature in a rotation list matches', async () => {
    const raw = JSON.stringify(event());
    const good = standardSignature(BETA_SECRET, 'msg_1', String(NOW_S), raw);
    expect((await app().request(req(null, { raw, sig: `v1,bm9wZQ== v1,${good}` }))).status).toBe(200);
  });

  it('rejects a wrong secret, a tampered body or a bare signature with 401', async () => {
    expect((await app().request(req(event(), { secret: 'whsec_b3RoZXI=' }))).status).toBe(401);
    const raw = JSON.stringify(event());
    const sig = `v1,${standardSignature(BETA_SECRET, 'msg_1', String(NOW_S), raw)}`;
    expect((await app().request(req(null, { raw: raw.replace('locked', 'lockeD'), sig }))).status).toBe(401);
    expect((await app().request(req(event(), { sig: 'not-a-signature' }))).status).toBe(401);
  });

  it('rejects a stale timestamp with 400', async () => {
    expect((await app().request(req(event(), { ts: NOW_S - 301 }))).status).toBe(400);
  });

  it('dedupes a retried delivery on the message id', async () => {
    const a = app();
    await a.request(req(event()));
    expect((await a.request(req(event()))).status).toBe(200);
    expect(await list(a)).toHaveLength(1);
  });

  it('acks but ignores events it will never handle', async () => {
    for (const body of [event({ type: 'message.delivered' }), event({ platform: 'sms' }), event({ content: { type: 'message.read' } })]) {
      const a = app();
      expect((await a.request(req(body))).status).toBe(200);
      expect(await list(a)).toHaveLength(0);
    }
  });

  it('joins the text parts of an album', async () => {
    const a = app();
    const content = { type: 'group', parts: [{ type: 'text', format: 'plain', text: 'look' }, { type: 'attachment', attachmentId: 'pho_att_1' }] };
    await a.request(req(event({ content })));
    const [m] = await list(a);
    expect(m.kind).toBe('album');
    expect(m.body).toBe('look');
  });

  it('400s a signed event with no sender', async () => {
    const body = event();
    delete (body.data.object as Record<string, unknown>).sentBy;
    expect((await app().request(req(body))).status).toBe(400);
  });
});
