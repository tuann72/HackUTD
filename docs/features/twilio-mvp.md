# Feature: Twilio MVP

- **Slug:** `twilio-mvp`
- **Phase:** MVP
- **Status:** In progress
- **Owner:** TBD

## Goal

Real and simulated text messages to the **victim number** reach our gateway, get classified, and are **delivered** to a virtual inbox or **blocked**. A **basic Next.js page** shows every message and what happened to it.

That's the whole MVP. The 3D scene, the scam notice and the blocked-scams panel come later (see [Out of scope](#out-of-scope)).

Background: `AGENTS.md`, "Current scope"; `CHANGELOG.md`, "Perpetrator simulator", "Message bank" and "Gateway behavior details".

## At a glance

```
Real phone ──SMS──► Twilio ──webhook──┐
Simulator ──signed POST───────────────┤
                                      ▼
                    Gateway  POST /twilio/sms
                    verify signature → dedupe → classify → deliver/block → store
                                      │
                    GET /api/messages (read-only)
                                      ▼
                    Next.js page, polls every 1–2 s
                    ┌─────────────────────────────────┐
                    │ Inbox (delivered) │ Blocked     │
                    │ ***-0110 Dinner…  │ ***-0142 🚫 │
                    │                   │ Imposter    │
                    └─────────────────────────────────┘
```

| Piece | What it is | Language |
|---|---|---|
| Gateway | Small HTTP service: the Twilio webhook plus a read-only query API | TypeScript + [Hono](https://hono.dev) |
| Classifier | A stub at first, behind a classifier interface; the real model plugs in later | Stub in TS; real model in Python |
| Simulator | CLI that sends signed, Twilio-format POSTs from a scenario file | TypeScript |
| Message UI | One Next.js page that polls the query API | TypeScript (Next.js) |

## How it works

### How a message reaches us (and when a tunnel is needed)

A text to the victim number lands on **Twilio's servers**, not ours. Twilio then sends an HTTP request (the webhook) to a URL we configure. That URL must be reachable from the public internet.

| Situation | Needs a tunnel? | Why |
|---|---|---|
| Simulator → gateway on your laptop | **No** | The simulator POSTs straight to `http://localhost:<port>/twilio/sms` |
| Real phone → gateway on a public host | **No** | Twilio calls the host's public URL directly |
| Real phone → gateway on your laptop | **Yes** | Twilio can't reach `localhost`, so a tunnel (cloudflared, ngrok) gives it a public URL |

**Recommendation:** deploy the gateway early to a host with a public URL so nobody needs a tunnel. A tunnel is still fine for a quick local test of the real path. Twilio signs requests against the exact URL, so the tunnel URL must match what's configured in the Twilio console.

### What the gateway does with one message

1. **Verify** `X-Twilio-Signature`. Reject with 403 if it's invalid.
2. **Dedupe** on `MessageSid`, because Twilio retries. If it's already seen, return 200 and stop.
3. **Map** the `From` number to an opaque participant id and a masked display string (`***-***-0142`).
4. **Reply to Twilio** right away with 200 and empty TwiML (`<Response></Response>`). Never reply to the sender.
5. **Classify** asynchronously through the classifier interface, with a strict timeout.
6. **Apply policy:** block if the score is at or above the threshold, otherwise deliver. The threshold and the classifier-down behavior are TBD.
7. **Store** the message with its verdict and action, in memory or SQLite.

Replying before classifying (step 4 before step 5) keeps Twilio from timing out and retrying while the model is slow.

### Query API (read-only)

`GET /api/messages?limit=<n>` returns messages newest first. The exact shape is in [`contracts/`](../../contracts/README.md), the only thing the gateway and UI share:

```json
{
  "schema": "t-gate.query-api",
  "version": 1,
  "messages": [
    {
      "id": "msg_51a0",
      "from": { "participantId": "p_3f1c", "display": "***-***-0142" },
      "body": "I'm in trouble, I need $800 in gift cards, please don't tell mom",
      "receivedAt": "2026-11-07T21:14:03.120Z",
      "action": "blocked",
      "reason": "model_verdict",
      "verdict": {
        "label": "scam", "score": 0.97, "category": "Imposter & Phishing", "model": "stub@0",
        "highlights": [{ "start": 31, "end": 41, "text": "gift cards", "weight": 0.8 }]
      }
    }
  ]
}
```

- No raw phone numbers, Twilio SIDs or credentials in responses.
- While classification is pending, `action` is `"pending"` and `reason` and `verdict` are `null`. If the classifier is down, the message is delivered with `reason: "classifier_unavailable"` and `verdict: null` (fail open).
- CORS must allow the UI's origin.

### Simulator

- Sends the same form fields Twilio sends for an inbound SMS (copy the exact list from the recorded fixture in task 1.1), signed with the auth token the same way Twilio signs.
- Uses fictional sender numbers (`+1-555-01xx`), one per simulated sender.
- **Scenario mode (main demo mode):** reads a file of `{ delayMs, from, body, expected }` steps and plays them in order. Example:

  | t | Sender | Message | Expected |
  |---|---|---|---|
  | 0s | Pharmacy (+1-555-0101) | "Your prescription is ready for pickup at…" | deliver |
  | 6s | "Grandson" (+1-555-0142) | "Hi Grandma it's me, I lost my phone, this is my new number" | deliver (borderline) |
  | 12s | "Grandson" (+1-555-0142) | "I'm in trouble, I need $800 in gift cards, please don't tell mom" | block |
  | 18s | "Bank" (+1-555-0177) | "Your account is locked. Verify at bit.ly/…" | block |
  | 25s | Daughter (+1-555-0110) | "Dinner Sunday still on?" | deliver |

- **Random mode (tests):** `--n 20 --scam-ratio 0.6` draws from the message bank.
- **`--dry-run`:** prints the requests instead of sending them.
- `expected` is used only to check results afterwards. The gateway never sees it.

### Message UI

- One Next.js page with two columns: **Inbox** (delivered) and **Blocked**, each showing the masked sender, time, body, and score. Blocked messages also show a category badge.
- Polls `GET /api/messages` every 1–2 seconds. No WebSocket and no 3D.
- Configured by `NEXT_PUBLIC_API_URL`. With it unset, the page reads a fixture file, so it works with no backend.
- No business logic. It shows `action` and `verdict` as the gateway returned them.
- Links and numbers inside blocked message bodies are shown as plain, non-clickable text.

### Twilio account notes

- **Inbound needs no registration.** Blocking sends nothing, so the MVP works on a trial account.
- **Outbound SMS** (for example, a future scam notice to a real phone) is limited to verified numbers on trial and adds a trial prefix. Texting anyone else needs A2P 10DLC or toll-free verification, which can take days. Not needed for the MVP.
- **To check:** whether the trial number accepts inbound texts from unverified phones. Test it with a teammate's phone.
- Secrets (account SID, auth token, the victim number) go in `.env`. Commit only `.env.example`.

## Out of scope

- The 3D scene (React Three Fiber). Parked for later; ideas are in `CHANGELOG.md`, "3D scene".
- Scam notice to the victim, the blocked-scams panel and keyword highlights.
- Real-time event stream (WebSocket or SSE). The MVP UI polls.
- Letting the public text the victim number (the separate "Live public demo" feature).
- Voice calls, and responding on the victim's behalf.

## Open questions

| Question | Recommendation | Status |
|---|---|---|
| Where the gateway runs: **A.** a separate small TS service on Railway, Render, Fly or a Vultr VM, with the UI on Vercel; or **B.** Next.js route handlers on Vercel plus a hosted DB | **A**: matches the decoupling rules, and a UI deploy can't break interception | **Decided:** A, gateway on a **Vultr VM**, web app on Vercel (Tuan, 2026-11-07) |
| Storage | **SQLite** (`node:sqlite`), with debug tools to clear it (`POST /debug/reset` when `GATEWAY_DEBUG=1`, and an `npm run db:reset` script) | **Decided** (Tuan, 2026-11-07) |
| Classifier-down behavior | **Fail open:** deliver with `reason: classifier_unavailable`, shown as "unverified" | **Decided** (Tuan, 2026-11-07) |
| Block threshold | `BLOCK_THRESHOLD` env var, default 0.5, tuned on `val` later | **TBD** |
| Classifier approach and label scheme | MiniLM on Vultr (Tuan), with TF-IDF + LR as the baseline; label scheme still open; see [classifier-service.md](classifier-service.md). The gateway calls either through the same `POST /classify` | Approach **agreed**; label scheme **TBD** |
| Message bank file format | **JSONL** | **Decided** (Tuan, 2026-11-07) |
| Message bank size and mix | Scenario files plus a small bank of SMS-style rows | **TBD** |
| Where the message UI lives | **`apps/web`, route `/messages`**, so the 3D scene ([PR #2](https://github.com/lytx02/HackUTD/pull/2)) can take `/` later | **Decided** (Tuan, 2026-11-07) |
| Does the trial number accept texts from unverified phones? | Test it in task 1.1 | **TBD** |

## Tasks

Tasks in the same stage can run **in parallel**. Each task touches its own folder (layout from `CHANGELOG.md`, "Decoupling rules"), so parallel branches don't conflict.

### Stage 0: decisions

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 0.1 | Choose gateway hosting (A or B) and storage; record in `CHANGELOG.md` | — | 0.2 | Done (A: Vultr VM; web on Vercel) | `chore/deploy-vercel-web` | Tuan + Claude Code | [#16](https://github.com/tuann72/HackUTD/pull/16) |
| 0.2 | Choose classifier approach and label scheme; record in `CHANGELOG.md` | — | 0.1 | In progress (approach done: MiniLM on Vultr; label scheme after the Vultr training run) | | Tuan | [#3](https://github.com/lytx02/HackUTD/pull/3) |

### Stage 1: foundations

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 1.1 | Twilio setup and a recorded webhook fixture. **Partly done:** a synthetic fixture and the contract are in `contracts/`; the real number and recording need a person | — | 1.2–1.5 | In progress | `feat/twilio-mvp-contract` | Tuan + Claude Code | [#4](https://github.com/lytx02/HackUTD/pull/4) |
| 1.2 | Gateway: webhook, signature check, dedupe, stub classifier, storage, query API (plus the HTTP classifier client for 2.3) | contract | 1.1, 1.3–1.5 | Done | `feat/twilio-mvp-gateway` | Tuan + Claude Code | [#10](https://github.com/lytx02/HackUTD/pull/10) |
| 1.3a | `apps/web` scaffold with the 3D-scene packages and the shared `lib/messages` data layer (done first, so the scene can start in parallel) | contract | all | Done | `feat/twilio-mvp-web-scaffold` | Tuan + Claude Code | [#5](https://github.com/lytx02/HackUTD/pull/5) |
| 1.3 | Message UI: `/messages` page (with 2.2) | 1.3a | 1.1, 1.2, 1.4, 1.5 | Done | `feat/twilio-mvp-message-ui` | Tuan + Claude Code | [#11](https://github.com/lytx02/HackUTD/pull/11) |
| 1.4 | Message bank and demo scenario files (with 2.1) | — | 1.1–1.3, 1.5 | Done | `feat/twilio-mvp-simulator` | Tuan + Claude Code | [#13](https://github.com/lytx02/HackUTD/pull/13) |
| 1.5 | Classifier: train, evaluate on `val`/`test`, export. Tracked in [classifier-service.md](classifier-service.md) | 0.2 | 1.1–1.4 | In progress (code done; Vultr training next) | | Tuan | [#3](https://github.com/lytx02/HackUTD/pull/3) |

### Stage 2: integration

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 2.1 | Simulator CLI: scenario mode, random mode, dry run | 1.1, 1.4 | 2.2, 2.3 | Done | `feat/twilio-mvp-simulator` | Tuan + Claude Code | [#13](https://github.com/lytx02/HackUTD/pull/13) |
| 2.2 | Connect the UI to the live query API | 1.2, 1.3 | 2.1, 2.3 | Done | `feat/twilio-mvp-message-ui` | Tuan + Claude Code | [#11](https://github.com/lytx02/HackUTD/pull/11) |
| 2.3 | Replace the stub classifier with the real model | 1.2, 1.5 | 2.1, 2.2 | Not started | | | |

### Stage 3: demo

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 3.1 | Deploy the gateway, point the Twilio number at it, run a scenario and one real-phone text end to end; write the demo script | 2.1, 2.2 (2.3 if ready) | — | Not started | | | |

## Task details

### 1.1 Twilio setup and a recorded webhook fixture

- **What:** get the victim number; set its "A message comes in" webhook; write `.env.example` (placeholders only); text the number from a real phone and save the raw POST (headers and form body, with secrets and real numbers replaced) as a fixture. Check whether an unverified phone can text the trial number.
- **Files:** `.env.example`, `contracts/fixtures/twilio-inbound-sms.json` (path TBD).
- **Done when:** the fixture is committed and its field list is documented.
- **Note:** recording the fixture needs a public URL for a moment: a tunnel, or a request-bin style service.

### 1.2 Gateway

- **What:** `POST /twilio/sms` and `GET /api/messages`, following [What the gateway does](#what-the-gateway-does-with-one-message). The stub classifier can be simple keyword rules, so the whole path works before the model exists.
- **Files:** `services/gateway/` (path TBD).
- **Done when:** replaying the 1.1 fixture (correctly signed) stores a message; a bad signature gets 403; a repeated `MessageSid` is ignored; the query API returns the message without raw numbers. Tests cover all four.

### 1.3 Message UI

- **What:** the page described in [Message UI](#message-ui), reading a fixture file.
- **Files:** `apps/web/` (path TBD), plus a fixture for the query API response.
- **Done when:** `npm run dev` shows delivered and blocked columns from the fixture.

### 1.4 Message bank and scenarios

- **What:** a small bank of labeled messages (SMS-style rows from the real `test` split plus generated ones) and at least one demo scenario like the [example above](#simulator).
- **Files:** `data/message_bank/` (format TBD).
- **Done when:** the files exist and each row has an expected label and a source.

### 1.5 Classifier

- **What:** see `AGENTS.md`, "Classifier direction". Train on `data/scam_categories_100k_full.csv`, evaluate only on `val`/`test`.
- **Files:** `classifier/` (path TBD).
- **Done when:** metrics are reported and a model artifact can be loaded by an inference service.

### 2.1 Simulator CLI

- **What:** see [Simulator](#simulator).
- **Files:** `services/perpetrator-sim/` (path TBD).
- **Done when:** a scenario plays against a local gateway and every message shows up in the query API; `--dry-run` prints the signed requests without sending.

### 2.2 Connect the UI

- **What:** poll the live query API when `NEXT_PUBLIC_API_URL` is set.
- **Done when:** a simulator run shows up on the page within about 2 seconds per message.

### 2.3 Real classifier

- **What:** run the 1.5 model as a service and point the gateway's classifier interface at it, with a timeout.
- **Done when:** the scenario's expected labels match the verdicts, or the mismatches are listed.

### 3.1 End-to-end demo

- **What:** deploy the gateway (or tunnel it), set the Twilio webhook URL, run a scenario, and text the number from a real phone.
- **Done when:** both kinds of message appear on the page, and the demo script is written down.

## Progress notes

- **2026-11-07:** Contract (#4) and the `apps/web` scaffold (#5) merged. The 3D scene can branch from `main`. The `/messages` UI (#9) showed the gateway's live results: Inbox 3, Blocked 2.
- **2026-11-07:** Gateway (#10) and `/messages` UI (#11) merged; tasks 1.2, 1.3 and 2.2 Done. Next: 2.3 (real classifier) and 3.1 (deploy, real-phone test); 1.1 still needs the real Twilio number.
- **2026-11-07:** Message bank and simulator merged (#13): `data/message_bank/` (91 SMS-style `test` rows + 27 generated, two scenarios) and `services/perpetrator-sim/` (`scenario`, `random`, `send`, `--dry-run`). Bank size and mix are still open; re-check the webhook field list once task 1.1 records a real Twilio request.
- **2026-11-07:** Local end-to-end check passed: the simulator (#7) played `grandparent.jsonl` against the gateway (#8). All 5 outcomes matched `expected` (3 delivered, 2 blocked as Imposter & Phishing), no raw numbers or SIDs appeared in `/api/messages`, and a wrong auth token got 403. Not yet tried with real Twilio traffic.
- **2026-11-07:** Implementation started (Tuan). Decided: SQLite with debug reset, fail open, JSONL, UI at `apps/web` `/messages`. The query API contract is in `contracts/`. The gateway, UI and simulator are built in parallel on separate branches stacked on `feat/twilio-mvp-contract`. The classifier is PR #3's work; the gateway calls its `POST /classify` (`{messageId, text}` → `{messageId, label, score, category, model, highlights}`, bearer token). The query API dropped `since`: the UI re-fetches the list, because pending messages change.
- **2026-11-07:** Hono chosen as the gateway framework (Tuan).
- **2026-11-07:** TypeScript confirmed for the gateway and simulator (Tuan). Framework and hosting still TBD.
- **2026-11-07:** Plan rewritten around a concrete MVP (Tuan): the MVP UI is a basic Next.js page that polls a read-only query API; the 3D scene is parked for later. Added how messages reach the gateway and when a tunnel is needed, the gateway steps, the query API, simulator scenario mode and a task list split by folder for parallel work.
- **2026-11-07:** Switched to one Twilio number. The perpetrator is simulated with signed webhook calls, fed by a message bank.
- **2026-11-07:** Plan created from the team's Twilio-first scope decision.
