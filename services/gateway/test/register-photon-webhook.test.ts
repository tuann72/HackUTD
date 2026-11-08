import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  checkWebhookUrl,
  deleteRequest,
  listRequest,
  main,
  registerRequest,
  upsertEnv,
} from '../scripts/register-photon-webhook.js';

const creds = { projectId: 'proj-123', projectSecret: 'super-secret-value' };
const env = { PHOTON_PROJECT_ID: creds.projectId, PHOTON_PROJECT_SECRET: creds.projectSecret };
const basic = 'Basic ' + Buffer.from('proj-123:super-secret-value').toString('base64');
const HOOK_URL = 'https://gateway.example.com/webhooks/photon';

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
}

function run(argv: string[], fetchMock: ReturnType<typeof fakeFetch>, extra: { envFile?: string } = {}) {
  const lines: string[] = [];
  const done = main(argv, { fetch: fetchMock as unknown as typeof fetch, env, log: (l) => lines.push(l), ...extra });
  return done.then((code) => ({ code, out: lines.join('\n') }));
}

describe('request building (per Photon managing-webhooks docs)', () => {
  it('registers with POST, Basic auth and { webhookUrl }', () => {
    const r = registerRequest(creds, HOOK_URL);
    expect(r).toEqual({
      method: 'POST',
      url: 'https://spectrum.photon.codes/projects/proj-123/webhooks/',
      headers: { Authorization: basic, 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl: HOOK_URL }),
    });
  });

  it('lists with GET and deletes with DELETE .../webhooks/{id}/', () => {
    expect(listRequest(creds)).toMatchObject({ method: 'GET', url: 'https://spectrum.photon.codes/projects/proj-123/webhooks/' });
    expect(deleteRequest(creds, '6a4d2e8c-7b1f-4d3a-9a8e-2c5d6f7e8a9b')).toMatchObject({
      method: 'DELETE',
      url: 'https://spectrum.photon.codes/projects/proj-123/webhooks/6a4d2e8c-7b1f-4d3a-9a8e-2c5d6f7e8a9b/',
    });
    expect(() => deleteRequest(creds, '../x')).toThrow(/looks wrong/);
  });
});

describe('checkWebhookUrl', () => {
  it('accepts the gateway URL', () => {
    expect(checkWebhookUrl(HOOK_URL)).toEqual({ url: HOOK_URL, warnings: [] });
  });

  it('rejects what Photon would silently never deliver to', () => {
    for (const bad of ['http://gateway.example.com/webhooks/photon', 'https://localhost:8787/webhooks/photon', 'https://192.168.1.5/webhooks/photon', 'https://10.0.0.2/x', 'https://[::1]/x', 'not a url']) {
      expect(() => checkWebhookUrl(bad), bad).toThrow();
    }
  });

  it('warns on a wrong path or a bare IP', () => {
    expect(checkWebhookUrl('https://gateway.example.com/twilio/sms').warnings[0]).toMatch(/\/webhooks\/photon/);
    expect(checkWebhookUrl('https://203.0.113.7/webhooks/photon').warnings[0]).toMatch(/bare IP/);
  });
});

describe('CLI', () => {
  const registered = { succeed: true, data: { id: 'abc-1', webhookUrl: HOOK_URL, signingSecret: 'sig-secret-64', createdAt: 'x', updatedAt: 'x' } };

  it('register prints the signing secret once and never the project secret', async () => {
    const f = fakeFetch(200, registered);
    const { code, out } = await run(['register', HOOK_URL], f);
    expect(code).toBe(0);
    expect(f).toHaveBeenCalledOnce();
    expect(f.mock.calls[0]![0]).toBe('https://spectrum.photon.codes/projects/proj-123/webhooks/');
    expect(out).toContain('PHOTON_WEBHOOK_SECRET=sig-secret-64');
    expect(out).not.toContain('super-secret-value');
    expect(out).not.toContain(basic);
  });

  it('register --write-env updates only the given .env file, mode 600', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tgate-'));
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'PORT=8787\nPHOTON_WEBHOOK_SECRET=dev-photon-webhook-secret-change-me\nDB_PATH=x\n');
    const { code, out } = await run(['register', HOOK_URL, '--write-env'], fakeFetch(200, registered), { envFile });
    expect(code).toBe(0);
    expect(readFileSync(envFile, 'utf8')).toBe('PORT=8787\nPHOTON_WEBHOOK_SECRET=sig-secret-64\nDB_PATH=x\n');
    expect(statSync(envFile).mode & 0o777).toBe(0o600);
    expect(out).not.toContain('sig-secret-64');
  });

  it('refuses a bad URL without calling Photon', async () => {
    const f = fakeFetch(200, registered);
    expect((await run(['register', 'http://localhost:8787/webhooks/photon'], f)).code).toBe(1);
    expect(f).not.toHaveBeenCalled();
  });

  it('explains API errors', async () => {
    expect((await run(['register', HOOK_URL], fakeFetch(409, { succeed: false, message: 'exists' }))).out).toMatch(/409: exists.*already registered/);
    expect((await run(['list'], fakeFetch(401, { succeed: false }))).out).toMatch(/401.*PHOTON_PROJECT_ID/);
  });

  it('lists and deletes', async () => {
    const list = await run(['list'], fakeFetch(200, { succeed: true, data: [{ id: 'abc-1', webhookUrl: HOOK_URL, createdAt: 't' }] }));
    expect(list.out).toContain(`abc-1  ${HOOK_URL}`);
    const del = await run(['delete', 'abc-1'], fakeFetch(200, { succeed: true, data: { id: 'abc-1' } }));
    expect(del).toMatchObject({ code: 0, out: 'deleted webhook abc-1' });
  });

  it('needs credentials and a command', async () => {
    const lines: string[] = [];
    expect(await main(['list'], { fetch: vi.fn() as never, env: {}, log: (l) => lines.push(l) })).toBe(1);
    expect(lines.join()).toMatch(/PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET/);
    expect(await main([], { env, log: () => {} })).toBe(2);
  });
});

describe('upsertEnv', () => {
  it('replaces, uncomments or appends', () => {
    expect(upsertEnv('A=1\nK=old\n', 'K', 'new')).toBe('A=1\nK=new\n');
    expect(upsertEnv('# K=\n', 'K', 'v')).toBe('K=v\n');
    expect(upsertEnv('A=1', 'K', 'v')).toBe('A=1\nK=v\n');
    expect(upsertEnv('', 'K', 'v')).toBe('K=v\n');
  });
});

describe('Photon 2.0 / Beta (pho_prj_ project ids)', () => {
  const betaEnv = { PHOTON_PROJECT_ID: 'pho_prj_01abc', PHOTON_PROJECT_SECRET: 'pho_ask_secretvalue' };
  const base = 'https://api.photon.codes/v1/projects/pho_prj_01abc/webhooks';
  const dest = { destinationId: 'pho_whd_01xyz', url: HOOK_URL, createdAt: 't', enabledEvents: ['message.received'], status: 'enabled' };

  /** Routes by method + URL; each response is JSON. */
  function routes(table: Record<string, [number, unknown]>) {
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${String(url)}`;
      const hit = table[key];
      if (!hit) throw new Error(`unexpected ${key}`);
      return new Response(JSON.stringify(hit[1]), { status: hit[0] });
    });
  }
  function runBeta(argv: string[], f: ReturnType<typeof routes>, extra: { envFile?: string } = {}) {
    const lines: string[] = [];
    return main(argv, { fetch: f as unknown as typeof fetch, env: betaEnv, log: (l) => lines.push(l), ...extra }).then((code) => ({ code, out: lines.join('\n') }));
  }

  it('registers a destination for message.received with Bearer auth, an idempotency key and the newest API version', async () => {
    const f = routes({
      [`GET ${base}/api-versions`]: [200, { apiVersions: [
        { version: '2026-01-01', status: 'deprecated', selectable: false },
        { version: '2026-07-01', status: 'preview', selectable: true },
      ] }],
      [`POST ${base}/destinations`]: [201, { destination: dest, signingSecret: 'whsec_c2VjcmV0' }],
    });
    const { code, out } = await runBeta(['register', HOOK_URL], f);
    expect(code).toBe(0);
    const init = f.mock.calls[1]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer pho_ask_secretvalue');
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body as string)).toEqual({ apiVersion: '2026-07-01', name: 'T-Gate gateway', url: HOOK_URL, enabledEvents: ['message.received'] });
    expect(out).toContain('registered webhook pho_whd_01xyz');
    expect(out).toContain('PHOTON_WEBHOOK_SECRET=whsec_c2VjcmV0');
    expect(out).not.toContain('pho_ask_secretvalue');
  });

  it('lists (all pages), deletes and rotates', async () => {
    const f = routes({
      [`GET ${base}/destinations`]: [200, { destinations: [dest], nextPageToken: 'p2' }],
      [`GET ${base}/destinations?pageToken=p2`]: [200, { destinations: [{ ...dest, destinationId: 'pho_whd_02' }] }],
      [`DELETE ${base}/destinations/pho_whd_01xyz`]: [200, dest],
      [`POST ${base}/destinations/pho_whd_01xyz/secret-rotations`]: [200, { signingSecret: 'whsec_bmV3', previousSecretExpiresAt: '2026-11-08T12:00:00Z' }],
    });
    const list = await runBeta(['list'], f);
    expect(list.out).toContain(`pho_whd_01xyz  ${HOOK_URL}  created t  enabled  events: message.received`);
    expect(list.out).toContain('pho_whd_02');
    expect((await runBeta(['delete', 'pho_whd_01xyz'], f)).out).toBe('deleted webhook pho_whd_01xyz');
    const dir = mkdtempSync(join(tmpdir(), 'tgate-'));
    const envFile = join(dir, '.env');
    const rot = await runBeta(['rotate', 'pho_whd_01xyz', '--write-env'], f, { envFile });
    expect(rot.code).toBe(0);
    expect(readFileSync(envFile, 'utf8')).toBe('PHOTON_WEBHOOK_SECRET=whsec_bmV3\n');
    expect(JSON.parse(f.mock.calls.at(-1)![1]!.body as string)).toEqual({ overlapSeconds: 3600 });
  });

  it('explains problem-details errors and refuses keys with stray characters', async () => {
    const f = routes({ [`GET ${base}/destinations`]: [401, { title: 'Not Authenticated', requestId: 'pho_req_1' }] });
    expect((await runBeta(['list'], f)).out).toMatch(/401: Not Authenticated.*PHOTON_PROJECT_SECRET.*\[pho_req_1\]/);
    const lines: string[] = [];
    const code = await main(['list'], { fetch: vi.fn() as never, env: { ...betaEnv, PHOTON_PROJECT_SECRET: 'pho_ask_x`' }, log: (l) => lines.push(l) });
    expect(code).toBe(1);
    expect(lines.join()).toMatch(/PHOTON_PROJECT_SECRET contains a quote, backtick or space/);
  });

  it('rotate is Beta only', async () => {
    expect((await run(['rotate', 'abc-1'], fakeFetch(200, {}))).out).toMatch(/Beta only/);
  });
});
