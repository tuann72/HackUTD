# Contracts

The only thing the gateway and the web app share (see `AGENTS.md`, "Decoupling rules"). Neither side imports the other's code. Each side may copy or generate types from these files.

| File | What it is |
|---|---|
| [`query-api.v1.schema.json`](query-api.v1.schema.json) | JSON Schema for `GET /api/messages`, the gateway's read-only query API |
| [`fixtures/messages.v1.sample.json`](fixtures/messages.v1.sample.json) | A sample `GET /api/messages` response. The web app uses it when `NEXT_PUBLIC_API_URL` is unset |
| [`fixtures/twilio-inbound-sms.sample.json`](fixtures/twilio-inbound-sms.sample.json) | The form fields Twilio posts for an inbound SMS. **Synthetic**, built from Twilio's documented fields; replace with a recorded real request (task 1.1) |

## `GET /api/messages` (v1)

- Query: `limit` (1–200, default 100).
- Returns `{ "schema": "t-gate.query-api", "version": 1, "messages": [...] }`, newest first.
- The UI re-fetches the whole list each poll, because a message's `action` changes from `pending` once it's classified.

Each message:

| Field | Meaning |
|---|---|
| `id` | Opaque message id (not the Twilio `MessageSid`) |
| `from.participantId`, `from.display` | Opaque sender id and masked number (`***-***-0142`). Never a raw number |
| `body` | Message text |
| `receivedAt` | ISO 8601 time the gateway accepted it |
| `action` | `pending`, `delivered` or `blocked` |
| `reason` | `model_verdict`, `classifier_unavailable` (fail open: delivered, unverified) or `null` while pending |
| `verdict` | `{ label, score, category, model, highlights }` from the classifier, or `null` if pending or unavailable |

Highlight spans are character offsets into `body` with `0 <= start < end <= body.length` (JSON Schema can't express this; the gateway drops spans that don't fit). Consumers should still guard against bad spans.

Display rule: `action == "delivered"` with `reason == "classifier_unavailable"` shows as **unverified**. The UI never re-decides scam vs. legitimate.

## Webhook signing (gateway and simulator)

Twilio signs each webhook over the **exact URL** configured for the number plus the sorted form fields. The gateway must validate against that same URL string:

- In dev, the simulator signs for `GATEWAY_WEBHOOK_URL` (default `http://localhost:8787/twilio/sms`), and the gateway validates against `http://localhost:<PORT>/twilio/sms`.
- Behind a tunnel or proxy, set the gateway's `PUBLIC_WEBHOOK_URL` to the public URL configured in Twilio (and point the simulator's `GATEWAY_WEBHOOK_URL` at it too). Otherwise the URL the gateway rebuilds from the request won't match, and every request gets 403.
- A 200 from the webhook only means the message was accepted, not classified. Read the outcome from `GET /api/messages`.

## Not part of the contract

`POST /debug/reset` on the gateway clears its SQLite database. It's a developer tool, off unless `GATEWAY_DEBUG=1`, and the web app must never call it.
