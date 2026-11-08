import type { Reviewer } from '../src/reviewer.js';
import { readFileSync } from 'node:fs';
import { createApp, type AppDeps } from '../src/app.js';
import { MemoryBlocklist, makeFingerprinter, type Blocklist, type BlocklistRules } from '../src/blocklist.js';
import type { Classifier } from '../src/classifier.js';
import { StubClassifier } from '../src/classifier.js';
import { openDb } from '../src/db.js';
import { spectrumSignature } from '../src/photon.js';

export const SECRET = 'test-photon-webhook-secret';
export const WEBHOOK_URL = 'http://localhost/webhooks/photon';
/** Fixed clock so signature timestamps are deterministic. */
export const NOW = new Date('2026-11-08T15:04:05.000Z');
export const NOW_S = Math.floor(NOW.getTime() / 1000);

const repoRoot = new URL('../../../', import.meta.url);
export const readContract = (rel: string) => JSON.parse(readFileSync(new URL(rel, repoRoot), 'utf8'));

export type Payload = { event: string; space: Record<string, unknown>; message: Record<string, any> };
export const fixtureBody: Payload = readContract('contracts/fixtures/photon-inbound-imessage.sample.json').body;
export const fixtureText: string = fixtureBody.message.content.text;

export const silentLogger = { info: () => {}, warn: () => {} };

export const RULES: BlocklistRules = { strikes: 3, highScore: 0.95, ttlMs: 7 * 24 * 3600 * 1000 };
export const fingerprinter = makeFingerprinter('test-fingerprint-secret-0123456789abcdef');

/**
 * Every test app gets an in-memory blocklist unless `blocklist: null` is passed. It is only
 * used when `config.senderBlocklist` is true. Production defaults to on (2026-11-08), but test apps
 * default to off so each test opts in to sender-level blocking explicitly.
 * Pass `now` to move the clock (blocklist expiry).
 */
export function makeApp(
  opts: { classifier?: Classifier; config?: Partial<AppDeps['config']>; blocklist?: Blocklist | null; now?: () => Date; reviewer?: Reviewer } = {},
) {
  const blocklist = opts.blocklist === undefined ? new MemoryBlocklist(RULES) : opts.blocklist;
  return createApp({
    ...(blocklist ? { blocklist, fingerprinter } : {}),
    ...(opts.reviewer ? { reviewer: opts.reviewer } : {}),
    db: openDb(':memory:'),
    classifier: opts.classifier ?? new StubClassifier(),
    config: {
      photonWebhookSecret: SECRET,
      signatureToleranceSeconds: 300,
      blockThreshold: 0.5,
      moneyWarnAmount: 500,
      corsOrigins: ['http://localhost:3000'],
      debug: false,
      debugToken: null,
      adminToken: null,
      senderBlocklist: false,
      uiActionPassword: '4321',
      reviewBandLow: 0.22,
      reviewBandHigh: 0.77,
      ...opts.config,
    },
    logger: silentLogger,
    now: opts.now ?? (() => NOW),
  });
}

/** The fixture payload with a new message id, sender and/or text (or a whole content block). */
export function payload(o: { id?: string; from?: string; text?: string; content?: unknown; event?: string } = {}): Payload {
  const p: Payload = structuredClone(fixtureBody);
  if (o.event) p.event = o.event;
  if (o.id) p.message.id = o.id;
  if (o.from) {
    p.message.sender = { id: o.from, platform: 'imessage' };
    p.space.id = `any;-;${o.from}`;
    p.message.space = { ...p.space };
  }
  if (o.text !== undefined) p.message.content = { type: 'text', text: o.text };
  if (o.content !== undefined) p.message.content = o.content;
  return p;
}

export function signedRequest(
  body: unknown,
  opts: { signature?: string | null; timestamp?: number | null; secret?: string; raw?: string } = {},
) {
  const raw = opts.raw ?? JSON.stringify(body);
  const ts = opts.timestamp === undefined ? NOW_S : opts.timestamp;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Spectrum-Event': 'messages' };
  if (ts !== null) headers['X-Spectrum-Timestamp'] = String(ts);
  const sig = opts.signature === undefined ? spectrumSignature(opts.secret ?? SECRET, String(ts), raw) : opts.signature;
  if (sig !== null) headers['X-Spectrum-Signature'] = sig;
  return new Request(WEBHOOK_URL, { method: 'POST', headers, body: raw });
}
