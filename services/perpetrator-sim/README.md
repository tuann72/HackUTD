# Perpetrator simulator

A CLI that pretends to be **Twilio delivering an inbound SMS to the victim number**. It POSTs form-encoded, Twilio-format webhooks, signed with a valid `X-Twilio-Signature`, straight to the T-Gate gateway's webhook. There is no second Twilio number and no outbound SMS: nothing goes through Twilio, so it costs nothing.

The gateway handles these requests exactly like real ones (verify signature, dedupe on `MessageSid`, classify, deliver or block). See `docs/features/twilio-mvp.md`, "Simulator".

## Setup

Node 24 and npm.

```bash
cd services/perpetrator-sim
npm install
cp .env.example .env   # optional; the defaults match the gateway's dev defaults
```

## Environment

`.env` is loaded automatically if present (`process.loadEnvFile`).

| Variable | Default | Meaning |
|---|---|---|
| `GATEWAY_WEBHOOK_URL` | `http://localhost:8787/twilio/sms` | Where to POST. The signature is computed over this **exact** string, so it must match the URL the gateway validates against (scheme, host, port, path, query) |
| `TWILIO_AUTH_TOKEN` | `dev-auth-token-change-me` | Signing key; must equal the gateway's token |
| `TWILIO_ACCOUNT_SID` | `AC` + 32 zeros | Sent as `AccountSid` |
| `VICTIM_NUMBER` | `+15555550100` | Sent as `To` |

## Commands

```bash
npm run sim -- scenario grandparent.jsonl           # main demo story (about 25 s)
npm run sim -- scenario smoke.jsonl                 # 3 messages, 500 ms apart
npm run sim -- random --n 20 --scam-ratio 0.6 --seed 42 --interval-ms 1500
npm run sim -- send --from +15555550142 "Hi Grandma it's me"
npm run sim -- scenario smoke.jsonl --dry-run       # print signed requests, send nothing
```

- **`scenario <file>`** plays `{delayMs, from, body, expected}` steps from a JSONL file. If the path doesn't exist as given, it's looked up in `data/message_bank/scenarios/` (the `.jsonl` suffix is optional).
- **`random`** draws `round(n × scam-ratio)` scam rows and the rest legit from `data/message_bank/bank.jsonl` + `generated.jsonl`, shuffled with the seed, each with a fictional sender from `+15555550120`–`+15555550199` (skipping 0142 and 0177, which the scenario uses). The seed is printed so a run can be repeated. Defaults: `--n 20 --scam-ratio 0.6 --interval-ms 1500`, random seed.
- **`send --from <number> "<text>"`** sends one typed message.
- **`--dry-run`** (any command) prints the URL, headers (including the signature) and form body for each request, and doesn't wait on delays.

Each send prints the masked sender (`***-***-0142`), the HTTP status and the expected outcome:

```
[3/5] +12.0s ***-***-0142 -> 200 OK expected=block "I'm in trouble, I need $800 in gift cards, please don't tel…"
```

`expected` comes from the scenario or bank row and is printed **for checking only**. It is never sent, and the gateway never sees it. A 200 means the gateway accepted the webhook, not that it delivered or blocked the message; check the query API (`GET /api/messages`) or the UI for the verdict.

Exit codes: `0` all sends accepted (2xx), `1` any send failed (non-2xx or unreachable), `2` usage or safety error (nothing sent).

## Safety rails

- Only sends to `GATEWAY_WEBHOOK_URL`; refuses a URL whose host is `twilio.com` or a subdomain, and anything not `http(s)`.
- Refuses any `From` or `To` outside the fictional `+1555xxxxxxx` range, unless `--allow-real-numbers` is passed. All checks run before the first send.
- `MessageSid` is always fresh crypto-random (`SM` + 32 hex), even with `--seed`, so reruns aren't swallowed by the gateway's dedupe.

## Fake gateway (for testing the simulator alone)

```bash
npm run fake-gateway   # listens on GATEWAY_WEBHOOK_URL's port, 127.0.0.1
```

Validates each request with `twilio.validateRequest`, logs it and returns empty TwiML (`403` on a bad signature). It doesn't classify or store anything; it's not the real gateway.

## Tests

```bash
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

Covers: signatures validate with `twilio.validateRequest` and fail for another URL, token or body; form fields match `contracts/fixtures/twilio-inbound-sms.sample.json`; scenario and bank parsing; random mode seed and ratio; dry run never calls `fetch`; safety rails; and an integration run of `smoke.jsonl` against the fake gateway with real delays.

## Relation to the gateway

The simulator and gateway share nothing but the Twilio webhook format and the auth token. The simulator doesn't import gateway code, doesn't read the query API, and works the same against the real gateway, the fake gateway, or a tunnel URL.
