# Photon iMessage gateway (replaces the Twilio webhook)

**Decision (Tuan, 2026-11-08):** move from Twilio SMS to **iMessage through Photon (Spectrum)**. The gateway stops being a Twilio webhook and becomes a **Spectrum webhook receiver**. Only iMessage is in scope. SMS and Twilio are dropped. The rest of the MVP stays the same: SQLite inbox and blocked log, fail-open classifier, polled query API, simulator, and the web UI.

**Follow-up decisions (Tuan, 2026-11-08):**

1. The team **enters the Photon track**.
2. ~~One dedicated line~~. **Corrected (Tuan, 2026-11-08):** the team is on a Free/Pro plan with a **shared-pool number**, and that number is the victim number. Photon delivers only our project's conversations to our webhook, so the gateway does no extra filtering.
3. Attachments, reactions, contact cards and group chats **show in the UI**.
4. The victim's inbox is the **virtual inbox** (the web UI), as with Twilio.

## How interception works with Photon

1. The team's victim line is the **shared-pool number** Photon routes our project's conversations through (Free/Pro plan; a dedicated line needs Business). The gateway stores whatever `space.phone` holds and doesn't depend on it.

   What this means, per [Photon's line model](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing):
   - **No group chats.** Shared pools can't create groups or deliver group-change events, so the "Group chat" UI won't trigger from real messages. It stays for the simulator and for a later dedicated line.
   - **Quotas:** 5,000 messages per server per day and **50 new conversations per line per day**. That matters for the live public demo, where every judge who texts in is a new conversation. Raise it via help@photon.codes.
   - **Not documented:** whether *any* iPhone can reach our project through the shared number or only linked users, and whether the number can differ across senders. Task 1.4 (a real iPhone that has never texted the line) answers this. Test with a second teammate's phone before the demo.
2. A webhook pointing at the gateway is registered on the Photon project (see [Webhook setup](#webhook-setup)). Photon returns a **signing secret** once. That value is `PHOTON_WEBHOOK_SECRET`.
3. Every inbound iMessage to the line arrives as `POST /webhooks/photon` with a JSON body (`event: "messages"`) and `X-Spectrum-*` headers.
4. The gateway checks the signature and timestamp, dedupes on `message.id`, stores the message as `pending`, returns `200 ok` right away, then classifies it and marks it delivered or blocked. This is the same policy as before.
5. The gateway **never replies**. Photon sends a message only if code calls `space.send` or `message.reply`, and the gateway has no Photon send code at all.

**Virtual inbox (decided):** as in the Twilio design, the victim's inbox is the gateway's virtual inbox, shown in the web UI. "Blocked" means the message goes to the blocked list instead of the inbox. No real handset sits behind the Photon line, so nothing reaches a phone directly. Relaying delivered messages to a real handset is out of scope.

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

| `content.type` | API `kind` | Gateway behavior |
|---|---|---|
| `text` | `text` | Classified: `text` |
| `richlink` | `link` | Classified: the `url` (scam links often arrive as rich links) |
| `group` (album) | `album` | Text and URL items joined and classified. Attachment items are listed in `attachments`. Photos only (no text) → delivered, `not_classified` |
| `attachment` | `attachment` | Delivered, reason `not_classified`. `attachments: [{name, mimeType, size}]` holds metadata only, because Photon sends no bytes or URLs |
| `reaction` | `reaction` | Delivered, `not_classified`. `reaction: {emoji, targetPreview}` |
| `contact` | `contact` | Delivered, `not_classified`. `contact: {name, phones}`, with the phones **masked** before storage |
| unknown, or empty text | — | Acknowledged with 200 and ignored (logged) |

**Group chats:** `space.type == "group"` is stored as a conversation. The API's `conversation: {id, type}` has an opaque `c_<hex>` id per chat, so the raw `space.id` never leaves the gateway. Group messages are classified like DMs, and each sender keeps their own participant id. The UI shows a "Group chat" badge.

**Not classified:** attachment-only messages aren't judged, because the model reads text only. The UI shows them as "Not checked". There's no sender-level blocking by default, so a scam sender's later attachments are delivered unchecked too. Only with the parked `SENDER_BLOCKLIST=on` are a blocklisted sender's attachments, reactions and contact cards blocked (`sender_blocked`).

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
| 1.1 | Scaffolding: gateway `/webhooks/photon` (signature, dedupe, content parsing), SQLite schema for handles, simulator signs Spectrum payloads, fixture, docs | — | — | Done | `feat/photon-imessage-gateway` | Tuan + Claude Code | [#24](https://github.com/tuann72/HackUTD/pull/24) |
| 1.2 | Provision a Photon iMessage line and project. Register the webhook against the deployed gateway | 1.1, gateway deploy | Yes, with 1.3 | Not started | — | — | — |
| 1.3 | Record a real delivery and replace the synthetic fixture (`contracts/fixtures/photon-inbound-imessage.sample.json`) | 1.2 | — | Not started | — | — | — |
| 1.4 | Real-path check: a teammate iMessages the line, it shows in the UI | 1.2 | — | Not started | — | — | — |
| 1.5 | Wire the sender blocklist on handles (normalize email handles too; `normalizeNumber` only handles numbers today) | 1.1, sender-blocklist task 2.x | — | Done | `feat/sender-blocklist-gateway-flow` | Tuan + Claude Code | [#27](https://github.com/tuann72/HackUTD/pull/27) |
| 1.6 | Attachments, reactions, contact cards and group chats in the gateway, contract and UI | 1.1 | — | Done | `feat/photon-imessage-gateway` | Tuan + Claude Code | [#24](https://github.com/tuann72/HackUTD/pull/24) |
| 1.7 | Deploy tooling and setup checklist: `docs/SETUP.md`, `npm run photon:webhook`, `services/gateway/deploy/` (Caddyfile, systemd unit, bootstrap), tunnel helper | 1.1 | Yes | Done | `chore/photon-deploy-tooling` | Tuan + Claude Code | [#25](https://github.com/tuann72/HackUTD/pull/25) |
| 1.8 | Simulator: send attachments, reactions, contact cards, links, albums and group chats; `imessage-demo` scenario; `docs/DEMO.md` demo script | 1.6 | Yes | Done | `feat/photon-sim-rich-content` | Tuan + Claude Code | [#26](https://github.com/tuann72/HackUTD/pull/26) |

## Open questions (TBD)

- Attachment-only messages: delivered unchecked (`not_classified`). There's no sender-level blocking by default (Tuan, 2026-11-08: block the message, not the sender). Only with the parked `SENDER_BLOCKLIST=on` would a blocklisted sender's attachments be blocked.
- Whether to also keep an SMS path. Not planned. Photon's own SMS provider would be a separate decision.
- Dedupe retention: the gateway keeps every `message.id` forever in SQLite. Photon suggests a 24–48 h TTL, which is fine at hackathon scale.
