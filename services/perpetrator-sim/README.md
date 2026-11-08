# Perpetrator simulator

A CLI that pretends to be **Photon (Spectrum) delivering an inbound iMessage to the victim line**. It POSTs JSON webhooks in Photon's `messages` event format, signed with a valid `X-Spectrum-Signature`, straight to the T-Guard gateway's webhook. Nothing goes through Photon or Apple, so it costs nothing.

The gateway handles these requests exactly like real ones (verify the signature and timestamp, dedupe on `message.id`, classify, deliver or block). See [`docs/features/photon-imessage.md`](../../docs/features/photon-imessage.md).

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
| `GATEWAY_WEBHOOK_URL` | `http://localhost:8787/webhooks/photon` | Where to POST. The signature covers the timestamp and body, not the URL, so any URL that reaches the gateway works |
| `PHOTON_WEBHOOK_SECRET` | `dev-photon-webhook-secret-change-me` | Signing key; must equal the gateway's `PHOTON_WEBHOOK_SECRET` |
| `VICTIM_NUMBER` | `+15555550100` | The victim line, sent as `space.phone` |

## Commands

```bash
npm run sim -- scenario imessage-demo               # iMessage demo: albums, reactions, contact cards, links (about 80 s)
npm run sim -- scenario grandparent.jsonl           # text-only demo story (about 25 s)
npm run sim -- scenario smoke.jsonl                 # 3 messages, 500 ms apart
npm run sim -- random --n 20 --scam-ratio 0.6 --seed 42 --interval-ms 1500
npm run sim -- send --from +15555550142 "Hi Grandma it's me"
npm run sim -- send --from +15555550142 --attachment receipt.jpg            # a photo (metadata only)
npm run sim -- send --from +15555550110 --attachment IMG_1.HEIC "Lake!" --group family-chat   # captioned album in a group
npm run sim -- send --from +15555550101 --react ❤️ "Photos from the lake"    # a reaction to that message
npm run sim -- scenario smoke.jsonl --dry-run       # print signed requests, send nothing
```

- **`scenario <file>`** plays `{delayMs, from, body, expected}` steps from a JSONL file. A step can carry `content` (an attachment, reaction, contact card, rich link or album) instead of `body`, and a `group` id to arrive in a group chat. Fields and examples are in [`data/message_bank/README.md`](../../data/message_bank/README.md). If the path doesn't exist as given, it's looked up in `data/message_bank/scenarios/` (the `.jsonl` suffix is optional).
- **`random`** draws `round(n × scam-ratio)` scam rows and the rest legit from `data/message_bank/bank.jsonl` + `generated.jsonl`, shuffled with the seed, each with a fictional sender from `+15555550120`–`+15555550199` (skipping 0142 and 0177, which the scenario uses). The seed is printed so a run can be repeated. Defaults: `--n 20 --scam-ratio 0.6 --interval-ms 1500`, random seed.
- **`send --from <number> "<text>"`** sends one typed message. `--group <id>` sends it into a group chat. `--attachment <file>` sends an attachment instead; with text, it's a captioned album. `--react <emoji>` sends a reaction, with the text as the message reacted to. The MIME type is guessed from the file extension.
- **`--dry-run`** (any command) prints the URL, headers (including the signature) and JSON body for each request, and doesn't wait on delays.

Each send prints the masked sender (`***-***-0142`), the HTTP status and the expected outcome:

```
[3/5] +12.0s ***-***-0142 -> 200 OK expected=block "I'm in trouble, I need $800 in gift cards, please don't tel…"
```

`expected` comes from the scenario or bank row and is printed **for checking only**. It is never sent, and the gateway never sees it. A 200 means the gateway accepted the webhook, not that it delivered or blocked the message; check the query API (`GET /api/messages`) or the UI for the verdict.

Exit codes: `0` all sends accepted (2xx), `1` any send failed (non-2xx or unreachable), `2` usage or safety error (nothing sent).

## Safety rails

- Only sends to `GATEWAY_WEBHOOK_URL`; refuses a URL whose host is `photon.codes` or a subdomain, and anything not `http(s)`.
- Refuses any sender, victim-line or contact-card number outside the fictional `+1555xxxxxxx` range, unless `--allow-real-numbers` is passed. All checks run before the first send.
- `message.id` is always a fresh `spc-msg-<uuid>`, even with `--seed`, so reruns aren't swallowed by the gateway's dedupe. The timestamp is the send time, so signed requests go stale after 5 minutes (a dry run's output can't be replayed later).

## Fake gateway (for testing the simulator alone)

```bash
npm run fake-gateway   # listens on GATEWAY_WEBHOOK_URL's port, 127.0.0.1
```

Verifies `X-Spectrum-Signature` and the timestamp window, logs each request and returns `200 ok` (`401` on a bad signature). It doesn't classify or store anything; it's not the real gateway.

## Tests

```bash
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

Covers: signatures match Photon's `v0` HMAC-SHA256 scheme and fail for another secret, body or a stale timestamp; payloads match `contracts/fixtures/photon-inbound-imessage.sample.json`; scenario and bank parsing; random mode seed and ratio; dry run never calls `fetch`; safety rails; and an integration run of `smoke.jsonl` against the fake gateway with real delays.

## Relation to the gateway

The simulator and gateway share nothing but Photon's webhook format and the signing secret. The simulator doesn't import gateway code, doesn't read the query API, and works the same against the real gateway, the fake gateway, or a tunnel URL.
