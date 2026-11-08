# T-Gate interception gateway

The gateway is the victim line's "carrier". Photon (Spectrum), or the perpetrator simulator, POSTs every inbound **iMessage** for the victim line to `POST /webhooks/photon`. The gateway verifies the signature, dedupes, stores the message, answers `200 ok` right away, then classifies the message in the background and either **delivers** it to the virtual inbox or **blocks** it. The web app reads the result from `GET /api/messages`.

Plan: [`docs/features/photon-imessage.md`](../../docs/features/photon-imessage.md), which replaces the Twilio webhook of [`twilio-mvp.md`](../../docs/features/twilio-mvp.md). The only thing it shares with the web app is [`contracts/`](../../contracts/README.md).

Stack: TypeScript on Node 24, [Hono](https://hono.dev) with `@hono/node-server`, built-in `node:sqlite`. It has no Photon SDK dependency: the signature check is ~20 lines of `node:crypto` (`src/photon.ts`), and the gateway never calls Photon's API.

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
| `npm run send:sample` | Send one signed, Photon-format iMessage webhook to the local gateway, using the fixture in `contracts/fixtures/`. Options: `-- "custom body"`, `-- --from +15555550177` (or an email handle), `-- --id spc-msg-...` (reuse an id to test dedupe) |
| `npm run db:reset` | Delete the SQLite file at `DB_PATH` (stop the gateway first) |
| `npm run message:restore -- <msg id>` | "Not a scam": move that one blocked message to the inbox (reason `override`). Needs `ADMIN_TOKEN` (and `GATEWAY_URL` if not local) |

Quick check:

```bash
npm run send:sample -- "I'm in trouble, I need \$800 in gift cards, please don't tell mom"
curl -s localhost:8787/api/messages | jq
```

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Listen port |
| `PHOTON_WEBHOOK_SECRET` | required | The webhook's signing secret, shown once when it's registered. Verifies `X-Spectrum-Signature`. Local dev uses the placeholder `dev-photon-webhook-secret-change-me`, which the simulator also uses. Keep the real one in `.env` only |
| `SIGNATURE_TOLERANCE_SECONDS` | `300` | Reject deliveries whose `X-Spectrum-Timestamp` is further than this from now (replay protection, Photon's recommended value) |
| `DB_PATH` | `./data/gateway.sqlite` | SQLite file (gitignored). `:memory:` works too. A file left over from the Twilio schema is refused at startup: delete it (`npm run db:reset`) |
| `CLASSIFIER_URL` | empty | Empty = built-in keyword stub (`stub@0`). Set = call `POST ${CLASSIFIER_URL}/classify` |
| `CLASSIFIER_TOKEN` | empty | Sent as `Authorization: Bearer ...` when set |
| `CLASSIFIER_TIMEOUT_MS` | `2500` | Abort the classifier call after this long |
| `BLOCK_THRESHOLD` | `0.5` | Block when `verdict.score >= threshold` (TBD, to be tuned on `val`) |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated origins allowed to `GET /api/*` |
| `GATEWAY_DEBUG` | `0` | `1` registers `POST /debug/reset`. Startup fails if `DEBUG_TOKEN` is empty |
| `DEBUG_TOKEN` | empty | Required `X-Debug-Token` value for debug routes |
| `ADMIN_TOKEN` | empty | Turns on `POST /admin/messages/restore` ("Not a scam" for one message), checked against `X-Admin-Token`. At least 16 characters. Empty means the route is off |
| `SENDER_BLOCKLIST` | `off` | **`off` (default, Tuan 2026-11-08): block the message, not the sender.** No blocklist calls, no fingerprints and no Atlas connection, and the settings below are ignored. `on` is the parked option: block known scam senders without the model |
| `MONGODB_URI` | empty | With `SENDER_BLOCKLIST=on` only: the Atlas connection string. Empty means an in-process blocklist that resets on restart. Ignored (with a log line) when off |
| `MONGODB_DB` | `tgate` | Atlas database name |
| `DNS_SERVERS` | empty | With `SENDER_BLOCKLIST=on` only: comma-separated DNS server IPs for Node's own lookups, for example `1.1.1.1,8.8.8.8`. Set it if Atlas fails with `querySrv ECONNREFUSED`: on some machines Node gets a DNS server that doesn't answer the SRV lookup `mongodb+srv://` needs. Empty means the OS default |
| `FINGERPRINT_SECRET` | empty | With `SENDER_BLOCKLIST=on` only: HMAC key for sender and text fingerprints (`openssl rand -hex 32`). Required with `MONGODB_URI`. Empty means a random key per process |
| `SENDER_BLOCK_STRIKES` | `3` | Model blocks from one sender before it's blocklisted (TBD) |
| `SENDER_BLOCK_SCORE` | `0.95` | One block at or above this score blocklists the sender at once (TBD) |
| `SENDER_BLOCK_TTL_DAYS` | `7` | How long a blocklisting lasts |

## Endpoints

### `POST /webhooks/photon` (Photon webhook)

JSON, exactly as Photon sends it ([fixture](../../contracts/fixtures/photon-inbound-imessage.sample.json), [Photon docs](https://photon.codes/docs/webhooks/events)).

1. Verify the **raw body** before parsing: `X-Spectrum-Signature` must equal `v0=` + hex HMAC-SHA256(`PHOTON_WEBHOOK_SECRET`, `"v0:" + X-Spectrum-Timestamp + ":" + body`), compared in constant time, with the timestamp within `SIGNATURE_TOLERANCE_SECONDS`. A missing header or stale timestamp gets `400`, and a bad signature gets `401`. There's no bypass flag. Tests and the simulator sign their requests.
2. Parse. A signed but malformed body (not JSON, no `message.id` or `message.sender.id`) gets `400`. Anything the gateway doesn't handle gets `200 ok` and is dropped, so Photon doesn't retry it: an event other than `messages`, a platform other than `imessage`, a non-inbound message, an unknown content type, or empty text.
3. Map content to the API `kind`. `text`, `richlink` (its URL) and `group` albums (text items joined, attachment items listed) are classified. `attachment`, `reaction` and `contact` have no text, so they're stored with their metadata (contact phones masked) and **delivered with reason `not_classified`**. Group chats (`space.type == "group"`) get an opaque `conversation` id. See the table in [the plan](../../docs/features/photon-imessage.md#payload-handled).
4. Dedupe on `message.id` (UNIQUE in SQLite). Photon delivers at least once and retries on 5xx, 408, 429 and timeouts. A retry gets `200 ok` and nothing else happens.
5. Map `sender.id` (an E.164 number or an Apple ID email) to an opaque, stable `participantId` (`p_<hex>`) and a masked display (`***-***-0142` or `j***@icloud.com`).
6. Store the message as `pending` and answer `200 ok`. The gateway never replies to the sender, and it has no Photon send code.
7. After responding, judge **each message on its own** (Tuan, 2026-11-08: block the message, not the sender). Text-less content is `delivered` with reason `not_classified`. Text is classified through the `Classifier` interface: `score >= BLOCK_THRESHOLD` → `blocked`, else `delivered`, reason `model_verdict`. A scam sender's next legit message is delivered.
8. Only with `SENDER_BLOCKLIST=on` (parked): before classifying, check the blocklist with a keyed hash of the normalized handle. A blocklisted sender's message, including text-less content, is `blocked` with reason `sender_blocked`, `verdict: null` and no classifier call. Every model block records fingerprints, and `SENDER_BLOCK_STRIKES` blocks, or one at `SENDER_BLOCK_SCORE` or above, blocklist the sender for `SENDER_BLOCK_TTL_DAYS`. Atlas errors are logged and ignored (fail open).
9. If the classifier throws, times out or returns something malformed, **fail open** (Tuan, 2026-11-07): the message is `delivered` with reason `classifier_unavailable` and `verdict: null`. The UI shows this as "unverified".

Raw handles and Photon message and space ids live only in the SQLite file. They never appear in API responses, and logs show only masked handles and opaque ids.

### `GET /api/messages?limit=N`

Read-only, `limit` 1–200 (default 100), newest first. The response shape is exactly [`contracts/query-api.v1.schema.json`](../../contracts/query-api.v1.schema.json); a test validates real output against it. CORS allows `CORS_ORIGINS`, GET only.

### `GET /healthz`

`{"ok":true}`.

### `POST /admin/messages/restore` (operator tool, not part of the contract)

"Not a scam" for **one message**. It only exists when `ADMIN_TOKEN` is set (otherwise `404`). Send `X-Admin-Token: <ADMIN_TOKEN>` (missing → `401`, wrong → `403`) and the body `{"messageId": "msg_..."}`, the opaque id from `GET /api/messages`, never a handle.

It moves only that message from blocked to the inbox, with reason `override`, keeping its verdict. A message that isn't blocked gets `409`. Only with `SENDER_BLOCKLIST=on`, it also allowlists the sender. The response is `{ok, messageId, allowlisted}`, where `allowlisted` is `null` when the blocklist is off and `false` if the Atlas write failed (run it again). **The web app must never call it.**

```bash
npm run message:restore -- msg_0123abcd...
```

### `POST /debug/reset` (developer tool, not part of the contract)

Clears all messages and participants. Only exists when `GATEWAY_DEBUG=1` (otherwise `404`). Needs `X-Debug-Token: <DEBUG_TOKEN>`: missing → `401`, wrong → `403`.

```bash
curl -X POST -H "X-Debug-Token: $DEBUG_TOKEN" localhost:8787/debug/reset
```

**The web app must never call `/debug/*`.** Keep `GATEWAY_DEBUG=0` on any public deployment unless you need it, and use a long random token if you turn it on.

## Classifiers

- **`StubClassifier`** (default): keyword/regex rules that return `{label, score, category, model: "stub@0", highlights}`. Highlights are exact character spans into the message. Categories are the seven names in [`data/scam_categories.csv`](../../data/scam_categories.csv); legit messages get `category: null`. It's a placeholder for demos and tests, not a model.
- **`HttpClassifier`** (when `CLASSIFIER_URL` is set): `POST {CLASSIFIER_URL}/classify` with JSON `{messageId, text}` only (the opaque gateway id, never a handle or Photon id). Expects `{messageId, label, score, category, model, highlights: [{start, end, text, weight}]}`. Highlight spans that don't fit the message are dropped, and `text` is re-sliced from the message so it always matches the span.

## Connecting a real Photon iMessage line

1. Run the gateway somewhere Photon can reach over **public HTTPS**. Photon refuses `http`, private and loopback addresses, and redirects. For the Vultr VM, follow [`DEPLOY.md`](DEPLOY.md).
2. Register the webhook (dashboard at app.photon.codes, the "Webhook" tab, or the API):

   ```bash
   curl -X POST "https://spectrum.photon.codes/projects/$PHOTON_PROJECT_ID/webhooks/" \
     -u "$PHOTON_PROJECT_ID:$PHOTON_PROJECT_SECRET" -H "Content-Type: application/json" \
     -d '{"webhookUrl":"https://<host>/webhooks/photon"}'
   ```

3. Put the returned `data.signingSecret` in `PHOTON_WEBHOOK_SECRET` and restart. The project id and secret are only for registering. The gateway doesn't need them.

The URL isn't part of the signature, so proxies and tunnels need no extra config (there's no `PUBLIC_WEBHOOK_URL` anymore). A tunnel (cloudflared, ngrok) is needed **only** when a real iMessage should reach a gateway on a laptop. The simulator and `npm run send:sample` POST to `localhost` directly.

## Layout

```
src/app.ts         createApp({ db, classifier, config }) -> Hono app (+ idle() for tests)
src/photon.ts      Spectrum signature check and payload parsing
src/server.ts      reads env, opens SQLite, picks the classifier, listens
src/classifier.ts  Classifier interface, StubClassifier, HttpClassifier
src/db.ts          SQLite schema and queries
src/handle.ts      iMessage handle normalization and masking (shared by db and blocklist)
src/blocklist.ts   sender blocklist (parked, SENDER_BLOCKLIST=on): fingerprints, MemoryBlocklist, MongoBlocklist
src/config.ts      env parsing and validation
src/types.ts       types copied from the v1 contract
scripts/           db-reset, send-sample, message-restore
test/              vitest suites and a local fake classifier server
```
