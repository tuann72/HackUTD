// Sends one signed, Twilio-format inbound SMS to the local gateway.
// Usage: npm run send:sample [-- "custom body"] [-- --from +15555550177 --sid SMxxx]
// Uses fictional 555-01xx numbers. Never contacts Twilio.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import twilio from 'twilio';

const fixture = JSON.parse(
  readFileSync(new URL('../../../contracts/fixtures/twilio-inbound-sms.sample.json', import.meta.url), 'utf8'),
) as { form: Record<string, string> };

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const from = flag('--from');
const sid = flag('--sid') ?? `SM${randomBytes(16).toString('hex')}`;
const body = args.join(' ') || undefined;

const port = process.env.PORT?.trim() || '8787';
const url = process.env.PUBLIC_WEBHOOK_URL?.trim() || `http://localhost:${port}/twilio/sms`;
const token = process.env.TWILIO_AUTH_TOKEN?.trim() || 'dev-auth-token-change-me';

const form: Record<string, string> = { ...fixture.form, MessageSid: sid, SmsMessageSid: sid, SmsSid: sid };
if (from) form.From = from;
if (body) form.Body = body;

const signature = twilio.getExpectedTwilioSignature(token, url, form);
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature },
  body: new URLSearchParams(form).toString(),
});
console.log(`POST ${url} -> ${res.status} ${res.headers.get('content-type')}`);
console.log(await res.text());
