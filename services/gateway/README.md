# T-Gate interception gateway

The gateway is the victim number's "carrier". Twilio (or the perpetrator simulator) POSTs every inbound SMS for the victim number to `POST /twilio/sms`. The gateway verifies the signature, dedupes, stores the message, answers Twilio immediately with empty TwiML, then classifies the message in the background and either **delivers** it to the virtual inbox or **blocks** it. The web app reads the result from `GET /api/messages`.

Task 1.2 of [`docs/features/twilio-mvp.md`](../../docs/features/twilio-mvp.md). The only thing it shares with the web app is [`contracts/`](../../contracts/README.md).

Stack: TypeScript on Node 24, [Hono](https://hono.dev) with `@hono/node-server`, built-in `node:sqlite`, the official `twilio` package (signature check only, it never calls the Twilio API).

## Run

```bash
cd services/gateway
npm install
cp .env.example .env      # placeholders only; edit as needed
npm run dev               # http://localhost:8787, reloads on change
```

| Command | What it does |
|---|---|
| `npm run dev` | Start with reload (`tsx watch`). Loads `.env` if present |
| `npm start` | Start without reload |
| `npm test` | Vitest suite (in-memory SQLite, fake classifiers, no network beyond localhost) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run send:sample` | Send one signed, Twilio-format SMS to the local gateway, using the fixture in `contracts/fixtures/`. Options: `-- "custom body"`, `-- --from +15555550177`, `-- --sid SM...` (reuse a sid to test dedupe) |
| `npm run db:reset` | Delete the SQLite file at `DB_PATH` (stop the gateway first) |

Quick check:

```bash
npm run send:sample -- "I'm in trouble, I need \$800 in gift cards, please don't tell mom"
curl -s localhost:8787/api/messages | jq
```

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Listen port |
| `TWILIO_AUTH_TOKEN` | required | Token used to verify `X-Twilio-Signature`. Local dev uses the placeholder `dev-auth-token-change-me`, which the simulator also uses. For the real number, use the Twilio account's auth token (in `.env` only, never committed) |
| `PUBLIC_WEBHOOK_URL` | empty | The exact URL configured in the Twilio console. Twilio signs against that URL, so set it whenever the gateway sits behind a proxy, host or tunnel. Empty = validate against the URL the request arrived on (`http://localhost:8787/twilio/sms` in dev) |
| `DB_PATH` | `./data/gateway.sqlite` | SQLite file (gitignored). `:memory:` works too |
| `CLASSIFIER_URL` | empty | Empty = built-in keyword stub (`stub@0`). Set = call `POST ${CLASSIFIER_URL}/classify` |
| `CLASSIFIER_TOKEN` | empty | Sent as `Authorization: Bearer ...` when set |
| `CLASSIFIER_TIMEOUT_MS` | `2500` | Abort the classifier call after this long |
| `BLOCK_THRESHOLD` | `0.5` | Block when `verdict.score >= threshold` (TBD, to be tuned on `val`) |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated origins allowed to `GET /api/*` |
| `GATEWAY_DEBUG` | `0` | `1` registers `POST /debug/reset`. Startup fails if `DEBUG_TOKEN` is empty |
| `DEBUG_TOKEN` | empty | Required `X-Debug-Token` value for debug routes |

## Endpoints

### `POST /twilio/sms` (Twilio webhook)

Form-encoded, exactly as Twilio sends it ([fixture](../../contracts/fixtures/twilio-inbound-sms.sample.json)).

1. Verify `X-Twilio-Signature` with `twilio.validateRequest`. Missing or invalid → `403`. There is no bypass flag; tests and the simulator sign their requests.
2. Dedupe on `MessageSid` (UNIQUE in SQLite). A retry gets `200` and empty TwiML, and nothing else happens.
3. Map `From` to an opaque, stable `participantId` (`p_<hex>`) and a masked display (`***-***-0142`).
4. Store the message as `pending` and answer `200`, `Content-Type: text/xml`, body `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`. The gateway never replies to the sender.
5. After responding, classify through the `Classifier` interface. `score >= BLOCK_THRESHOLD` → `blocked`, else `delivered`, reason `model_verdict`.
6. If the classifier throws, times out or returns something malformed, **fail open** (Tuan, 2026-11-07): `delivered`, reason `classifier_unavailable`, `verdict: null`. The UI shows this as "unverified".

Raw phone numbers and Twilio SIDs live only in the SQLite file. They never appear in API responses, and logs show only masked numbers and opaque ids.

### `GET /api/messages?limit=N`

Read-only, `limit` 1–200 (default 100), newest first. The response shape is exactly [`contracts/query-api.v1.schema.json`](../../contracts/query-api.v1.schema.json); a test validates real output against it. CORS allows `CORS_ORIGINS`, GET only.

### `GET /healthz`

`{"ok":true}`.

### `POST /debug/reset` (developer tool, not part of the contract)

Clears all messages and participants. Only exists when `GATEWAY_DEBUG=1` (otherwise `404`). Needs `X-Debug-Token: <DEBUG_TOKEN>`: missing → `401`, wrong → `403`.

```bash
curl -X POST -H "X-Debug-Token: $DEBUG_TOKEN" localhost:8787/debug/reset
```

**The web app must never call `/debug/*`.** Keep `GATEWAY_DEBUG=0` on any public deployment unless you need it, and use a long random token if you turn it on.

## Classifiers

- **`StubClassifier`** (default): keyword/regex rules that return `{label, score, category, model: "stub@0", highlights}`. Highlights are exact character spans into the message. Categories are the seven names in [`data/scam_categories.csv`](../../data/scam_categories.csv); legit messages get `category: null`. It's a placeholder for demos and tests, not a model.
- **`HttpClassifier`** (when `CLASSIFIER_URL` is set): `POST {CLASSIFIER_URL}/classify` with JSON `{messageId, text}` only (the opaque gateway id, never a phone number or SID). Expects `{messageId, label, score, category, model, highlights: [{start, end, text, weight}]}`. Highlight spans that don't fit the message are dropped, and `text` is re-sliced from the message so it always matches the span.

## Pointing a real Twilio number at it

1. Run the gateway somewhere Twilio can reach over HTTPS.
2. In the Twilio console, under the victim number → Messaging → "A message comes in", set **Webhook**, `HTTP POST`, URL `https://<host>/twilio/sms`.
3. Set `TWILIO_AUTH_TOKEN` to the account's auth token and `PUBLIC_WEBHOOK_URL` to that exact URL, then restart.

A tunnel (cloudflared, ngrok) is needed **only** when a real phone texts a gateway running on a laptop: Twilio can't reach `localhost`. The simulator and `npm run send:sample` POST to `localhost` directly and need no tunnel. With a tunnel, put the tunnel's URL in both the Twilio console and `PUBLIC_WEBHOOK_URL`, since the signature covers the exact URL.

## Layout

```
src/app.ts         createApp({ db, classifier, config }) -> Hono app (+ idle() for tests)
src/server.ts      reads env, opens SQLite, picks the classifier, listens
src/classifier.ts  Classifier interface, StubClassifier, HttpClassifier
src/db.ts          SQLite schema and queries, number masking
src/config.ts      env parsing and validation
src/types.ts       types copied from the v1 contract
scripts/           db-reset, send-sample
test/              vitest suites and a local fake classifier server
```
