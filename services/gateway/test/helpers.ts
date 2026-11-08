import { readFileSync } from 'node:fs';
import twilio from 'twilio';
import { createApp, type AppDeps } from '../src/app.js';
import type { Classifier } from '../src/classifier.js';
import { StubClassifier } from '../src/classifier.js';
import { openDb } from '../src/db.js';

export const AUTH_TOKEN = 'test-auth-token';
export const WEBHOOK_URL = 'http://localhost/twilio/sms';

const repoRoot = new URL('../../../', import.meta.url);
export const readContract = (rel: string) => JSON.parse(readFileSync(new URL(rel, repoRoot), 'utf8'));

export const fixtureForm: Record<string, string> = readContract('contracts/fixtures/twilio-inbound-sms.sample.json').form;

export const silentLogger = { info: () => {}, warn: () => {} };

export function makeApp(opts: { classifier?: Classifier; config?: Partial<AppDeps['config']> } = {}) {
  return createApp({
    db: openDb(':memory:'),
    classifier: opts.classifier ?? new StubClassifier(),
    config: {
      twilioAuthToken: AUTH_TOKEN,
      publicWebhookUrl: null,
      blockThreshold: 0.5,
      corsOrigins: ['http://localhost:3000'],
      debug: false,
      debugToken: null,
      ...opts.config,
    },
    logger: silentLogger,
  });
}

export function form(overrides: Record<string, string> = {}): Record<string, string> {
  const f = { ...fixtureForm, ...overrides };
  if (overrides.MessageSid) {
    f.SmsMessageSid = overrides.MessageSid;
    f.SmsSid = overrides.MessageSid;
  }
  return f;
}

export function signedRequest(params: Record<string, string>, opts: { signature?: string | null; url?: string; token?: string } = {}) {
  const url = opts.url ?? WEBHOOK_URL;
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const sig = opts.signature === undefined ? twilio.getExpectedTwilioSignature(opts.token ?? AUTH_TOKEN, url, params) : opts.signature;
  if (sig !== null) headers['X-Twilio-Signature'] = sig;
  return new Request(url, { method: 'POST', headers, body: new URLSearchParams(params).toString() });
}
