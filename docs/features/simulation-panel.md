# Feature: Simulation panel

- **Slug:** `sim-panel` (branch `feat/web-sim-panel`)
- **Phase:** MVP (demo tooling)
- **Status:** In review
- **Owner:** Tuan + Claude Code

## Goal

Buttons in a sidebar on `/` that run perpetrator simulations without a terminal: preset scenarios, random bursts from the message bank, and a custom message. Each run is configurable (count, scam ratio, interval, sender) and can be stopped. Requested by Tuan on 2026-11-08.

## Design

- **The browser never holds the signing secret.** It calls the web app's own server route `POST /api/simulate` with one step (`from`, `body` or `content`, optional `group`). The route builds a Photon (Spectrum) `messages` payload, signs it with `X-Spectrum-Signature` and POSTs it to the gateway's webhook, the same request `services/perpetrator-sim` sends.
- **The browser paces the run.** It sends one step per request and waits between steps, so a long run never hits Vercel's function time limit, and Stop works at once.
- **Target:** `SIM_WEBHOOK_URL`, else `${NEXT_PUBLIC_API_URL}/webhooks/photon` (the gateway the page reads). **Secret:** `SIM_WEBHOOK_SECRET`, else `PHOTON_WEBHOOK_SECRET`. Both are server-only. With no URL or secret, `GET /api/simulate` reports `enabled: false` and the panel shows how to turn it on.
- **Safety rails (copied from the CLI):** fictional `+1555xxxxxxx` numbers only, never a `photon.codes` URL, text capped at 1,000 characters, and a best-effort per-instance rate limit (60 sends a minute).
- **Configurable buttons:** `apps/web/lib/sim/presets.ts` lists the buttons. Runtime controls in the panel adjust count, scam ratio, interval and sender.
- **Message bank copy:** the web app never reads outside `apps/web` (Vercel builds only that folder), so `npm run sync:bank` copies `data/message_bank/` into `apps/web/lib/sim/bank.json` (`npm run check:bank` fails if it's stale), like `sync:contract`.

**Decoupling exception (Tuan, 2026-11-08):** like "Clear chats", the panel makes the web app write to the gateway, by sending signed webhooks. `/api/simulate` is **unauthenticated**: anyone who can open the page can inject simulated messages. They're limited to fictional senders and rate-limited.

## Out of scope

- Authentication for `/api/simulate` (TBD if the page goes public).
- Simulation in replay/static mode (no gateway to send to).

## Tasks

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 1.1 | Server route, bank sync, presets, sidebar UI, tests, docs | — | — | In review | `feat/web-sim-panel` | Tuan + Claude Code | [#54](https://github.com/tuann72/HackUTD/pull/54) |

## Setup

On Vercel (Project > Settings > Environment Variables, server-only):

- `SIM_WEBHOOK_SECRET`: the VM gateway's `PHOTON_WEBHOOK_SECRET`, when `NEXT_PUBLIC_API_URL` points at the VM. Not needed when the page reads the Vercel backup itself (it reuses `PHOTON_WEBHOOK_SECRET`).
- `SIM_WEBHOOK_URL` (optional): another webhook to send to.

Locally: put the same values in `apps/web/.env.local` next to `NEXT_PUBLIC_API_URL=http://localhost:8787` (the gateway's dev secret is `dev-photon-webhook-secret-change-me`).

## Progress notes

- 2026-11-08: built in #54. Tests cover the planner, validation, rails, rate limit and a round trip through the Vercel webhook receiver.
