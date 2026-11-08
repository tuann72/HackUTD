# Photon iMessage gateway (replaces the Twilio webhook)

**Decision (Tuan, 2026-11-08):** move from Twilio SMS to **iMessage through Photon (Spectrum)**. The gateway stops being a Twilio webhook and becomes a **Spectrum webhook receiver**. Only iMessage is in scope. SMS and Twilio are dropped. The rest of the MVP stays the same: SQLite inbox and blocked log, fail-open classifier, polled query API, simulator, and the web UI.

## How interception works with Photon

1. The team gets a Photon iMessage line, the **victim line**. Photon gives it a phone number (`space.phone`), or `"shared"` on a pooled line.
2. A webhook pointing at the gateway is registered on the Photon project (see [Webhook setup](#webhook-setup)). Photon returns a **signing secret** once. That value is `PHOTON_WEBHOOK_SECRET`.
3. Every inbound iMessage to the line arrives as `POST /webhooks/photon` with a JSON body (`event: "messages"`) and `X-Spectrum-*` headers.
4. The gateway checks the signature and timestamp, dedupes on `message.id`, stores the message as `pending`, returns `200 ok` right away, then classifies it and marks it delivered or blocked. This is the same policy as before.
5. The gateway **never replies**. Photon sends a message only if code calls `space.send` or `message.reply`, and the gateway has no Photon send code at all.

Like the Twilio design, the victim's inbox is virtual. "Blocked" means the gateway's inbox doesn't show the message. With a Photon-hosted line, no real phone shows these messages to the victim either. What a "blocked" message means on a real victim handset is **TBD** (it would need on-device or relay delivery).

### Signature (from [Photon: verifying signatures](https://photon.codes/docs/webhooks/verifying-signatures))

- `X-Spectrum-Signature: v0=<hex>`, where `hex = HMAC-SHA256(secret, "v0:" + X-Spectrum-Timestamp + ":" + rawBody)`, in lowercase hex.
- The signature is computed over the **raw body bytes**. Don't parse and re-serialize the body before checking it. The webhook URL isn't part of the signature, so `PUBLIC_WEBHOOK_URL` is gone.
- The gateway rejects requests whose timestamp is more than 300 s from now (replay protection), with a constant-time comparison.
- Responses: missing headers or a stale timestamp get `400`, a bad signature gets `401`, and everything else gets `200`. That includes duplicates, unknown events and content types the gateway ignores, so Photon doesn't retry them. Photon retries 5xx, 408 and 429 up to 6 times, so the gateway must answer fast and never 5xx on purpose.

### Payload handled

```json
{ "event": "messages",
  "space":   { "id": "any;-;+15555550142", "platform": "imessage", "type": "dm", "phone": "+15555550100" },
  "message": { "id": "spc-msg-…", "platform": "imessage", "direction": "inbound", "timestamp": "…",
               "sender": { "id": "+15555550142", "platform": "imessage" },
               "space": { … }, "content": { "type": "text", "text": "…" } } }
```

| `content.type` | Gateway behavior (scaffolding) |
|---|---|
| `text` | Classified: `text` |
| `richlink` | Classified: the `url` (scam links often arrive as rich links) |
| `group` (album) | Text and URL items joined and classified as one message. Empty → ignored |
| `attachment`, `reaction`, `contact`, unknown | Acknowledged with 200 and ignored (logged). **TBD**: show attachments as "[attachment]" entries? |

The iMessage `sender.id` is usually E.164, but iMessage handles can also be **email addresses**. The gateway masks both (`***-***-0142`, `j***@icloud.com`) and never exposes either in the query API.

## Webhook setup

Photon only delivers to **public HTTPS** URLs. It rejects `http`, private and loopback addresses, and redirects. So real iMessages need either the Vultr-deployed gateway behind HTTPS or a tunnel in local dev. The simulator still posts straight to `localhost`.

```bash
# Project id and secret: Photon dashboard > Settings (or `photon projects show`).
curl -X POST "https://spectrum.photon.codes/projects/$PHOTON_PROJECT_ID/webhooks/" \
  -u "$PHOTON_PROJECT_ID:$PHOTON_PROJECT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl":"https://<gateway-host>/webhooks/photon"}'
# Response data.signingSecret -> the gateway's PHOTON_WEBHOOK_SECRET (shown once).
```

You can also register it in the dashboard (app.photon.codes, the "Webhook" tab). The project id and secret are only for registering. The gateway needs only the signing secret.

## Tasks

| # | Task | Depends on | Parallel? | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 1.1 | Scaffolding: gateway `/webhooks/photon` (signature, dedupe, content parsing), SQLite schema for handles, simulator signs Spectrum payloads, fixture, docs | — | — | In progress | `feat/photon-imessage-gateway` | Tuan + Claude Code | TBD |
| 1.2 | Provision a Photon iMessage line and project. Register the webhook against the deployed gateway | 1.1, gateway deploy | Yes, with 1.3 | Not started | — | — | — |
| 1.3 | Record a real delivery and replace the synthetic fixture (`contracts/fixtures/photon-inbound-imessage.sample.json`) | 1.2 | — | Not started | — | — | — |
| 1.4 | Real-path check: a teammate iMessages the line, it shows in the UI | 1.2 | — | Not started | — | — | — |
| 1.5 | Wire the sender blocklist on handles (normalize email handles too; `normalizeNumber` only handles numbers today) | 1.1, sender-blocklist task 2.x | — | Not started | — | — | — |
| 1.6 | Decide on attachments, reactions and group chats (`space.type == "group"`) | — | Yes | Not started | — | — | — |

## Open questions (TBD)

- Dedicated line or shared pool (`space.phone == "shared"`). With a shared line, the gateway would also have to filter by `space.id`.
- What "blocked" means for a real handset victim (see above).
- Whether to also keep an SMS path. Not planned. Photon's own SMS provider would be a separate decision.
- Dedupe retention: the gateway keeps every `message.id` forever in SQLite. Photon suggests a 24–48 h TTL, which is fine at hackathon scale.
