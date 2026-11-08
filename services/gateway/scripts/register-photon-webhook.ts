// Manage the Photon (Spectrum) webhook that points at this gateway.
//
//   npm run photon:webhook -- register https://<gateway-host>/webhooks/photon [--write-env]
//   npm run photon:webhook -- list
//   npm run photon:webhook -- delete <webhook-id>
//
// Reads PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET from the environment (or services/gateway/.env).
// The project secret is never printed. On register, the signing secret is printed once; with
// --write-env it is also written to services/gateway/.env as PHOTON_WEBHOOK_SECRET (gitignored).
//
// API verified against Photon's Stable docs on 2026-11-08:
//   https://photon.codes/docs/webhooks/managing-webhooks
//   POST   https://spectrum.photon.codes/projects/{projectId}/webhooks/        { webhookUrl } -> data.{id, webhookUrl, signingSecret, ...}
//   GET    https://spectrum.photon.codes/projects/{projectId}/webhooks/        -> data: [{ id, webhookUrl, createdAt, updatedAt }]
//   DELETE https://spectrum.photon.codes/projects/{projectId}/webhooks/{id}/   -> data.{id}
// Auth: HTTP Basic, projectId:projectSecret. Responses are { succeed, data } or { succeed: false, message }.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SPECTRUM_API = 'https://spectrum.photon.codes';
export const GATEWAY_PATH = '/webhooks/photon';
const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));

export interface Credentials {
  projectId: string;
  projectSecret: string;
}

export interface Webhook {
  id: string;
  webhookUrl: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RegisteredWebhook extends Webhook {
  signingSecret: string;
}

export interface ApiRequest {
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

function base(c: Credentials): string {
  return `${SPECTRUM_API}/projects/${encodeURIComponent(c.projectId)}/webhooks/`;
}

function authHeader(c: Credentials): string {
  return 'Basic ' + Buffer.from(`${c.projectId}:${c.projectSecret}`).toString('base64');
}

export function registerRequest(c: Credentials, webhookUrl: string): ApiRequest {
  return {
    method: 'POST',
    url: base(c),
    headers: { Authorization: authHeader(c), 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhookUrl }),
  };
}

export function listRequest(c: Credentials): ApiRequest {
  return { method: 'GET', url: base(c), headers: { Authorization: authHeader(c) } };
}

export function deleteRequest(c: Credentials, id: string): ApiRequest {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`webhook id ${JSON.stringify(id)} looks wrong (expected a UUID)`);
  return { method: 'DELETE', url: `${base(c)}${id}/`, headers: { Authorization: authHeader(c) } };
}

/**
 * Photon accepts any syntactically valid URL at registration but silently drops deliveries to
 * http://, private/loopback addresses or redirects. Catch the obvious cases before registering.
 */
export function checkWebhookUrl(raw: string): { url: string; warnings: string[] } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${JSON.stringify(raw)} is not a valid URL`);
  }
  if (u.protocol !== 'https:') throw new Error('Photon only delivers to https:// URLs');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const privateV4 = /^(127\.|10\.|192\.168\.|169\.254\.|0\.)|^172\.(1[6-9]|2\d|3[01])\./;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || (isIP(host) === 4 && privateV4.test(host)) || host === '::1' || /^f[cd]|^fe80/.test(host)) {
    throw new Error(`${host} is not publicly reachable; Photon refuses private and loopback addresses. Use the deployed host or a tunnel.`);
  }
  const warnings: string[] = [];
  if (u.pathname !== GATEWAY_PATH) warnings.push(`path is ${u.pathname}, but the gateway listens on ${GATEWAY_PATH}`);
  if (isIP(host)) warnings.push('a bare IP has no valid TLS certificate behind Caddy; use a hostname');
  return { url: u.toString(), warnings };
}

type Fetch = typeof fetch;

async function call<T>(doFetch: Fetch, req: ApiRequest): Promise<T> {
  const res = await doFetch(req.url, { method: req.method, headers: req.headers, body: req.body, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let json: { succeed?: boolean; data?: T; message?: string } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok || json.succeed === false) {
    const hint =
      res.status === 401 ? ' (check PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET)'
      : res.status === 409 ? ' (this URL is already registered: run `list`, then `delete` the old one and register again)'
      : res.status === 404 ? ' (no such webhook id)'
      : res.status === 422 ? ' (Photon rejected the URL)'
      : '';
    throw new Error(`Photon API ${req.method} -> ${res.status}${json.message ? `: ${json.message}` : ''}${hint}`);
  }
  return json.data as T;
}

export const registerWebhook = (f: Fetch, c: Credentials, url: string) => call<RegisteredWebhook>(f, registerRequest(c, url));
export const listWebhooks = (f: Fetch, c: Credentials) => call<Webhook[]>(f, listRequest(c));
export const deleteWebhook = (f: Fetch, c: Credentials, id: string) => call<{ id: string }>(f, deleteRequest(c, id));

/** Sets KEY=value in a dotenv file's text, replacing an existing (possibly commented-out) line or appending. */
export function upsertEnv(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^#?\\s*${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`;
}

export function credentialsFromEnv(env: NodeJS.ProcessEnv): Credentials {
  const projectId = env.PHOTON_PROJECT_ID?.trim();
  const projectSecret = env.PHOTON_PROJECT_SECRET?.trim();
  if (!projectId || !projectSecret) {
    throw new Error(
      'Set PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET (Photon dashboard > Settings, or `photon projects show`) in services/gateway/.env or the environment.',
    );
  }
  return { projectId, projectSecret };
}

const USAGE = `Usage: npm run photon:webhook -- <command>
  register <https-url> [--write-env]   Register the gateway's webhook URL (prints the signing secret once)
  list                                 List this project's webhooks
  delete <webhook-id>                  Delete one (deliveries to it stop)`;

export async function main(argv: string[], deps: { fetch?: Fetch; env?: NodeJS.ProcessEnv; log?: (l: string) => void; envFile?: string } = {}): Promise<number> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const doFetch = deps.fetch ?? fetch;
  const envFile = deps.envFile ?? ENV_FILE;
  const writeEnv = argv.includes('--write-env');
  const [cmd, arg] = argv.filter((a) => a !== '--write-env');
  if (!cmd || cmd === '-h' || cmd === '--help') {
    log(USAGE);
    return cmd ? 0 : 2;
  }
  try {
    const creds = credentialsFromEnv(deps.env ?? process.env);
    if (cmd === 'register') {
      if (!arg) throw new Error('register needs the webhook URL, e.g. https://gateway.example.com/webhooks/photon');
      const { url, warnings } = checkWebhookUrl(arg);
      for (const w of warnings) log(`warning: ${w}`);
      const hook = await registerWebhook(doFetch, creds, url);
      log(`registered webhook ${hook.id} -> ${hook.webhookUrl}`);
      if (writeEnv) {
        const before = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
        writeFileSync(envFile, upsertEnv(before, 'PHOTON_WEBHOOK_SECRET', hook.signingSecret), { mode: 0o600 });
        chmodSync(envFile, 0o600); // mode above only applies when the file is created
        log(`wrote PHOTON_WEBHOOK_SECRET to ${envFile}. Restart the gateway.`);
      } else {
        log('');
        log('Signing secret (Photon shows it ONLY now; store it before closing this terminal):');
        log(`  PHOTON_WEBHOOK_SECRET=${hook.signingSecret}`);
        log('Put that line in the gateway .env (on the VM: /opt/t-gate/HackUTD/services/gateway/.env), then restart the gateway.');
      }
      return 0;
    }
    if (cmd === 'list') {
      const hooks = await listWebhooks(doFetch, creds);
      if (hooks.length === 0) log('no webhooks registered');
      for (const h of hooks) log(`${h.id}  ${h.webhookUrl}  created ${h.createdAt ?? '?'}`);
      return 0;
    }
    if (cmd === 'delete') {
      if (!arg) throw new Error('delete needs a webhook id (see `list`)');
      const res = await deleteWebhook(doFetch, creds, arg);
      log(`deleted webhook ${res.id}`);
      return 0;
    }
    log(`unknown command ${JSON.stringify(cmd)}\n\n${USAGE}`);
    return 2;
  } catch (err) {
    log(`error: ${(err as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
