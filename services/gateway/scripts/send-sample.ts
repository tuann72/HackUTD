// Sends one signed, Photon (Spectrum) format inbound iMessage webhook to the local gateway.
// Usage: npm run send:sample [-- "custom body"] [-- --from +15555550177 --id spc-msg-xxx]
// Uses fictional 555-01xx numbers. Never contacts Photon.
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(
  readFileSync(new URL('../../../contracts/fixtures/photon-inbound-imessage.sample.json', import.meta.url), 'utf8'),
) as { body: { space: Record<string, unknown>; message: Record<string, unknown> & { sender: { id: string } } } };

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const from = flag('--from') ?? fixture.body.message.sender.id;
const id = flag('--id') ?? `spc-msg-${randomUUID()}`;
const text = args.join(' ') || (fixture.body.message.content as { text: string }).text;

const port = process.env.PORT?.trim() || '8787';
const url = process.env.GATEWAY_WEBHOOK_URL?.trim() || `http://localhost:${port}/webhooks/photon`;
const secret = process.env.PHOTON_WEBHOOK_SECRET?.trim() || 'dev-photon-webhook-secret-change-me';

const space = { ...fixture.body.space, id: `any;-;${from}` };
const payload = {
  event: 'messages',
  space,
  message: { ...fixture.body.message, id, timestamp: new Date().toISOString(), sender: { id: from, platform: 'imessage' }, space, content: { type: 'text', text } },
};
const body = JSON.stringify(payload);
const ts = String(Math.floor(Date.now() / 1000));
const signature = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Spectrum-Event': 'messages',
    'X-Spectrum-Webhook-Id': '00000000-0000-4000-8000-000000000000',
    'X-Spectrum-Timestamp': ts,
    'X-Spectrum-Signature': signature,
  },
  body,
});
console.log(`POST ${url} -> ${res.status}`);
console.log(await res.text());
