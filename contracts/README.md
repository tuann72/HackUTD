# Contracts

The only thing the gateway and the web app share (see `AGENTS.md`, "Decoupling rules"). Neither side imports the other's code. Each side may copy or generate types from these files.

| File | What it is |
|---|---|
| [`query-api.v1.schema.json`](query-api.v1.schema.json) | JSON Schema for `GET /api/messages`, the gateway's read-only query API |
| [`fixtures/messages.v1.sample.json`](fixtures/messages.v1.sample.json) | A sample `GET /api/messages` response. The web app uses it when `NEXT_PUBLIC_API_URL` is unset |
| [`fixtures/photon-inbound-imessage.sample.json`](fixtures/photon-inbound-imessage.sample.json) | The headers and JSON body Photon (Spectrum) posts for an inbound iMessage. **Synthetic**, built from Photon's documented payload; replace with a recorded real delivery (photon-imessage task 1.3) |

## `GET /api/messages` (v1)

- Query: `limit` (1–200, default 100).
- Returns `{ "schema": "t-gate.query-api", "version": 1, "messages": [...] }`, newest first.
- The UI re-fetches the whole list each poll, because a message's `action` changes from `pending` once it's classified.

Each message:

| Field | Meaning |
|---|---|
| `id` | Opaque message id (not Photon's `message.id`) |
| `from.participantId`, `from.display` | Opaque sender id and masked iMessage handle (`***-***-0142`, or `j***@icloud.com` for an email handle). Never a raw handle |
| `body` | Message text |
| `receivedAt` | ISO 8601 time the gateway accepted it |
| `action` | `pending`, `delivered` or `blocked` |
| `reason` | `model_verdict`, `classifier_unavailable` (fail open: delivered, unverified) or `null` while pending |
| `verdict` | `{ label, score, category, model, highlights }` from the classifier, or `null` if pending or unavailable |

Highlight spans are character offsets into `body` with `0 <= start < end <= body.length` (JSON Schema can't express this; the gateway drops spans that don't fit). Consumers should still guard against bad spans.

Display rule: `action == "delivered"` with `reason == "classifier_unavailable"` shows as **unverified**. The UI never re-decides scam vs. legitimate.

## Webhook signing (gateway and simulator)

Photon signs each webhook with the webhook's signing secret ([docs](https://photon.codes/docs/webhooks/verifying-signatures)):

- `X-Spectrum-Signature: v0=<hex>`, where `hex` is HMAC-SHA256 over `"v0:" + X-Spectrum-Timestamp + ":" + <raw body>`. Verify the raw bytes before parsing JSON.
- The gateway rejects timestamps more than 300 s from its clock. The URL isn't signed, so proxies and tunnels need no extra config.
- In dev, the simulator and the gateway share the placeholder secret `dev-photon-webhook-secret-change-me`.
- A 200 from the webhook only means the message was accepted, not classified. Read the outcome from `GET /api/messages`.

## Not part of the contract

`POST /debug/reset` on the gateway clears its SQLite database. It's a developer tool, off unless `GATEWAY_DEBUG=1`, and the web app must never call it.
