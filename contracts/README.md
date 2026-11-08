# Contracts

The only thing the gateway and the web app share (see `AGENTS.md`, "Decoupling rules"). Neither side imports the other's code. Each side may copy or generate types from these files.

| File | What it is |
|---|---|
| [`query-api.v1.schema.json`](query-api.v1.schema.json) | JSON Schema for `GET /api/messages`, the gateway's read-only query API |
| [`fixtures/messages.v1.sample.json`](fixtures/messages.v1.sample.json) | A sample `GET /api/messages` response. The web app uses it when `NEXT_PUBLIC_API_URL` is unset |
| [`fixtures/photon-inbound-imessage.sample.json`](fixtures/photon-inbound-imessage.sample.json) | The headers and JSON body Photon (Spectrum) posts for an inbound iMessage. **Synthetic**, built from Photon's documented payload; replace with a recorded real delivery (photon-imessage task 1.3) |
| [`voice-call-result.v1.schema.json`](voice-call-result.v1.schema.json) | Versioned server-to-server submission for one after-call transcript and classifier result |
| [`voice-call-results.v1.schema.json`](voice-call-results.v1.schema.json) | Versioned read-only response for `GET /api/voice/calls` |
| [`fixtures/voice-call-results.v1.sample.json`](fixtures/voice-call-results.v1.sample.json) | Synthetic sample response for the voice-result contract |

## Voice call result API (v1)

- `POST /api/voice/calls` accepts the submission schema and requires `Authorization: Bearer <VOICE_GUARD_RESULTS_INGEST_TOKEN>`; only the LiveKit worker should use it.
- `GET /api/voice/calls?limit=20` returns the response schema and requires `Authorization: Bearer <VOICE_GUARD_RESULTS_VIEW_TOKEN>`; the Vercel UI sends this from memory and never writes to the route.
- The call ID is opaque. The record contains the final transcript and classifier label, score, category, model, and completion time. It contains no phone number, SIP identity, room name, or Photon ID.
- Vercel rejects storage until `VOICE_GUARD_RESULTS_TTL_SECONDS` is explicitly set and `MONGODB_URI` is available. Atlas records get an `expiresAt` timestamp and TTL index; reads also filter expired records immediately. The selected retention duration and who should receive the view token remain operator decisions.
- The classifier is trained on text messages, so its call result is an unvalidated plumbing signal, not a call-level accuracy claim.

## `GET /api/messages` (v1)

- Query: `limit` (1–200, default 100).
- Returns `{ "schema": "t-gate.query-api", "version": 1, "messages": [...] }`, newest first.
- The UI re-fetches the whole list each poll, because a message's `action` changes from `pending` once it's classified.
- `DELETE /api/messages` deletes every message and returns `{ "ok": true, "cleared": <n> }`. It's the web UI's "Clear chats" button (Tuan, 2026-11-08). Unauthenticated. The other writes are the password-protected Unblock and Clear blocks below.

Each message:

| Field | Meaning |
|---|---|
| `id` | Opaque message id (not Photon's `message.id`) |
| `from.participantId`, `from.display` | Opaque sender id and masked iMessage handle (`***-***-0142`, or `j***@icloud.com` for an email handle). Never a raw handle |
| `body` | Message text |
| `receivedAt` | ISO 8601 time the gateway accepted it |
| `action` | `pending`, `delivered` or `blocked` |
| `reason` | `model_verdict`, `classifier_unavailable` (fail open: delivered, unverified), `not_classified` (no text to check: attachment, reaction, contact card), `sender_blocked` (blocked without the model because the sender is on the blocklist; `verdict` is `null`. emitted while the gateway's `SENDER_BLOCKLIST` is `on`, the default since 2026-11-08), `override` (a person marked this message "Not a scam" and it moved to the inbox; the original `verdict` is kept) or `null` while pending |
| `verdict` | `{ label, score, category, model, highlights }` from the classifier, or `null` if pending, unavailable or not classified |
| `kind` | `text`, `link`, `attachment`, `reaction`, `contact` or `album` (iMessage content). Optional: absent means `text` |
| `conversation` | `{ id, type }`: an opaque chat id (`c_<hex>`) and `dm` or `group`. Optional: absent means a DM |
| `attachments` | `[{ name, mimeType, size }]`, metadata only (never a file or URL). Optional, `[]` when none |
| `reaction` | `{ emoji, targetPreview }` for `kind: "reaction"`, else `null`. `targetPreview` is up to ~80 characters of the message reacted to |
| `contact` | `{ name, phones }` for a shared contact card, else `null`. `phones` are masked like `from.display` |

`verdict.review` (optional, added 2026-11-08) is `{ decision, reason, model, checks, bankSource }`, Nemotron's second opinion when the score was in the review band. When present, `action` and `verdict.label` follow its decision, and `verdict.score` stays the classifier's.

`kind`, `conversation`, `attachments`, `reaction` and `contact` were added to v1 on 2026-11-08 as optional fields, so older v1 data stays valid. The gateway always sends them. For non-text kinds, `body` is `""`. The UI renders from `kind` and the extras, never from guessing at `body`.

Highlight spans are character offsets into `body` with `0 <= start < end <= body.length` (JSON Schema can't express this; the gateway drops spans that don't fit). Consumers should still guard against bad spans.

Display rules: `action == "delivered"` with `reason == "classifier_unavailable"` shows as **unverified**, `reason == "not_classified"` shows as **not checked**, `sender_blocked` as **blocked: known scam sender**, and `override` as **restored**. The UI never re-decides scam vs. legitimate.

## Unblock and Clear blocks (v1, added 2026-11-08)

Two password-protected writes from the web UI (Tuan, 2026-11-08). Both need the header `X-Action-Password`, checked on the server against `UI_ACTION_PASSWORD` (default `4321`). The web app never hardcodes the password; the user types it. A missing or wrong password returns `401 { "error": "wrong password" }`.

- `POST /api/messages/:id/unblock` moves one blocked message to the inbox (`action: "delivered"`, `reason: "override"`, original `verdict` kept). With the sender blocklist on, it also allowlists that sender. Returns `{ "ok": true, "messageId": "<id>", "allowlisted": true | false | null }` (`null` when the blocklist is off). `404` if no such message, `409` if it isn't blocked.
- `GET /api/blocklist` returns `{ "enabled": <bool>, "blockedSenders": <n> }`: whether the sender blocklist is on and how many senders are blocked right now. No password.
- `POST /api/blocklist/clear` unblocks every sender: it deletes every sender record (blocks, strikes and allowlist entries) and keeps the text fingerprints. Messages already in the blocked log stay there. Returns `{ "ok": true, "cleared": <senders removed>, "enabled": <bool> }` (`cleared: 0, enabled: false` when the blocklist is off).

## Webhook signing (gateway and simulator)

Photon signs each webhook with the webhook's signing secret ([docs](https://photon.codes/docs/webhooks/verifying-signatures)):

- `X-Spectrum-Signature: v0=<hex>`, where `hex` is HMAC-SHA256 over `"v0:" + X-Spectrum-Timestamp + ":" + <raw body>`. Verify the raw bytes before parsing JSON.
- The gateway rejects timestamps more than 300 s from its clock. The URL isn't signed, so proxies and tunnels need no extra config.
- In dev, the simulator and the gateway share the placeholder secret `dev-photon-webhook-secret-change-me`.
- A 200 from the webhook only means the message was accepted, not classified. Read the outcome from `GET /api/messages`.

## Not part of the contract

`POST /admin/messages/restore` ("Not a scam" for one message, only when `ADMIN_TOKEN` is set) and `POST /debug/reset` (clears the SQLite database) are operator tools.

`POST /debug/reset` on the gateway clears its SQLite database. It's a developer tool, off unless `GATEWAY_DEBUG=1`, and the web app must never call it.
