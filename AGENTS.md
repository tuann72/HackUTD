# T-Guard Project Context

This file is the shared source of truth for every coding agent (Claude Code, Codex, Cursor, Copilot, Gemini, etc.) and for human contributors. `CLAUDE.md` imports this file; Codex and most other agents read `AGENTS.md` directly. Put project rules here, not in tool-specific files.

> **Feature plans live in [`docs/features/`](docs/features/).** Before working on a feature, read its plan there: it has the concrete design, ordered tasks, what can run in parallel, and who's on what. Current plans:
>
> - [`docs/features/photon-imessage.md`](docs/features/photon-imessage.md): the gateway takes iMessages through Photon (Spectrum) webhooks, replacing the Twilio webhook (in progress).
> - [`docs/features/twilio-mvp.md`](docs/features/twilio-mvp.md): the MVP (gateway, simulator, basic message UI). Its Twilio webhook parts are superseded by the Photon plan.
> - [`docs/features/sender-blocklist.md`](docs/features/sender-blocklist.md): sender blocklist and scam fingerprints in MongoDB Atlas (in progress).
> - [`docs/features/voice-scam-guard.md`](docs/features/voice-scam-guard.md): proposed later feature for SIP-routed call transcription, classification, and warnings.
> - [`docs/features/potential-threat-data.md`](docs/features/potential-threat-data.md): synthetic threat/coercion/fake-emergency texts with a proposed label 8 "Potential Threat" (in progress; label scheme TBD).
>
> New plans start from [`docs/features/_TEMPLATE.md`](docs/features/_TEMPLATE.md). Add each new plan to the list above.

## Project summary

- **Name:** **T-Guard** (Tuan, 2026-11-08; earlier names "T-Gate" and "Gate Guardian"). The repository folder and GitHub repo are still called `HackUTD`. Technical identifiers (the `t-gate.query-api` contract value, package names, the VM's `/opt/t-gate` path and `t-gate-gateway` unit, the `tgate` MongoDB database, `TGATE_DOMAIN`) still use the old name so the live deploy keeps working; always write "T-Guard" in UI text and docs.
- **Problem:** Scam calls and messages pressure people, especially older adults, into rash decisions that cause financial, personal, or emotional harm.
- **Concept:** Detect likely scam activity, warn the recipient, and potentially help respond on their behalf while keeping the recipient in control.
- **Hackathon tracks:** **Safe Signal (T-Mobile)** and **Vultr** (Tuan, 2026-11-07). The Vultr track is covered by training and serving the classifier on Vultr. **Update (Tuan, 2026-11-08):** Photon is back as the **messaging provider** (iMessage through Photon's Spectrum webhooks, replacing Twilio). The team **enters the Photon track** too (Tuan, 2026-11-08).
- **Current project state:** Building the MVP (Tuan lifted the scaffolding hold for it on 2026-11-07), now on **iMessage through Photon** (2026-11-08, branch `feat/photon-imessage-gateway`, which replaces the Twilio webhook in the gateway and simulator): the query API contract in [`contracts/`](contracts/README.md), the message bank in [`data/message_bank/`](data/message_bank/README.md), the perpetrator simulator in [`services/perpetrator-sim/`](services/perpetrator-sim/README.md), the gateway in [`services/gateway/`](services/gateway/README.md), the message UI with the initial 3D scene (`apps/web/`, one page at `/`), and the sender-blocklist module (`services/gateway/src/blocklist.ts`, not yet wired into the webhook flow) are on `main`. The repo also has the classifier's training script and inference service (MiniLM and a TF-IDF + LR baseline) in [`classifier/`](classifier/README.md), and a labeled message dataset plus its build scripts in [`data/`](data/) (see [Data](#data)). Do not assume an implementation or technology stack exists until it is present in the repo or agreed by the team.

## Current scope (agreed)

### MVP: iMessage scam-message simulation (Photon)

The MVP started **Twilio-first** (SMS) and replaces the SRS's MVP. There is no mobile app. **Decision (Tuan, 2026-11-08): iMessage only, through Photon (Spectrum) webhooks. SMS and Twilio are dropped.** The webhook plan is [`docs/features/photon-imessage.md`](docs/features/photon-imessage.md). The rest of the MVP (UI, storage, fail-open, simulator, message bank) is in [`docs/features/twilio-mvp.md`](docs/features/twilio-mvp.md), and where the two disagree on the webhook, the Photon plan wins.

- **MVP UI (Tuan, 2026-11-07):** a **basic Next.js page** that lists messages as delivered (inbox) or blocked. It polls the gateway's read-only query API (`GET /api/messages`); there's no event stream or WebSocket in the MVP. The **3D scene is parked** for later, along with the scam notice and blocked-scams panel. Don't build them for the MVP. **Update (Tuan, 2026-11-07):** the message list and the initial scene are now **one page at `/`**, the scene band on top and the inbox/blocked lists below; `/messages` and `/scene` redirect to `/`.
- **Tunnels are only for local dev with a real phone.** Photon delivers webhooks only to a public **HTTPS** URL (no private IPs or redirects), so a gateway on a laptop needs a tunnel to receive real iMessages. The simulator posts straight to `localhost`, and a deployed gateway needs no tunnel. The gateway will be deployed on a Vultr VM (Tuan, 2026-11-07); deploying it early is recommended.
- **MVP decisions (Tuan, 2026-11-07):** SQLite storage with debug tools to clear it; **fail open** when the classifier is down (deliver, marked unverified); JSONL message bank; each package standalone (own `package.json`, no workspaces). The gateway and UI share only [`contracts/`](contracts/README.md).

- The team uses **one Photon shared-pool number as the victim line** (Free/Pro plan, not a dedicated Business line; formerly one Twilio number). Shared pools have no group chats and a quota of 50 new conversations per line per day. Whether any iPhone can reach our project through it is undocumented; test it (photon-imessage task 1.4). It receives messages and is the line T-Guard protects. Its inbox is the gateway's **virtual inbox** shown in the web UI. No real handset sits behind it (Tuan, 2026-11-08).
- **The perpetrator is simulated with API calls.** A perpetrator simulator sends HTTP requests to the gateway's webhook in exactly Photon's inbound `messages` format (JSON with `space`, `message.id`, `message.sender.id`, `message.content`), signed with a valid `X-Spectrum-Signature` (HMAC-SHA256 over `v0:<timestamp>:<body>`). The gateway handles simulated and real messages the same way.
- **Message bank:** the simulator draws its messages from a bank of labeled scam and legitimate examples, so demos and tests are repeatable and show both outcomes. Candidate sources: a subset of the real `test` split in `data/` (SMS-style rows), plus generated messages (templates or LLM-written). The exact mix is TBD.
- **Real path check:** a teammate iMessages the victim line from their own iPhone to confirm the real Photon → gateway path works. That's the same path the later public demo uses.
- Messages that arrive at the victim number are classified as scam or legitimate (see [Classifier](#classifier-agreed-minilm-on-vultr)).

### Later: live public demo

Planned after the MVP works, not part of the MVP:

- Anyone (for example, judges or attendees) can text the victim number directly, including example scam messages.
- Incoming messages show up in real time on a display and are classified as they arrive.

### Deferred or stretch

- **Voice scam guard (proposed, later; not part of the iMessage MVP):** route calls to a Photon voice number through SIP to a media application, transcribe caller audio, classify transcript text, and show a warning in the Vercel app. The requested first proof classifies after a tester hangs up; live warnings are the main follow-up. See [`docs/features/voice-scam-guard.md`](docs/features/voice-scam-guard.md) and the [master plan](.plans/voice-scam-guard-spec.md). This is a SIP/media path; the Photon message webhook does not carry call audio. The exact Photon product/line, speech-to-text provider, victim endpoint, transcript retention, and live warning transport are TBD.
- **Voice response or automatic call control:** stretch scope from the SRS. No automatic hangup, blocking, or spoken response is included in the first two voice-guard stages.
- **User confirmation step** before a response flow: mentioned in the SRS. The action, consent model, and interaction are undecided.

### Classifier (agreed: MiniLM on Vultr)

**Decision (Tuan, 2026-11-07):** use **MiniLM**, trained and hosted on **Vultr** (the team has Vultr credits, and it covers the Vultr track). TF-IDF + logistic regression is no longer the plan. Its binary baseline (F1 ≈ 0.98 on the real test split, `data/README.md`) is the bar MiniLM is compared against. **Full runs (Timothy, 2026-11-07):** TF-IDF beats MiniLM alone, but the two combined ("stacked") catch the most never-seen scam types. Proposed: ship the stacked flow. See `CHANGELOG.md`, "TF-IDF vs. MiniLM, combined flows and zero-day test".

- **Model:** frozen `sentence-transformers/all-MiniLM-L6-v2` embeddings with a logistic-regression head. Fine-tuning MiniLM is a fallback only if the head-only model falls clearly short of the baseline.
- **Training:** on a **Vultr Cloud GPU** instance, destroyed after each run. Code and runbook: [`classifier/`](classifier/README.md). Plan: [`docs/features/classifier-service.md`](docs/features/classifier-service.md).
- **Inference:** a Python FastAPI service in a Docker image on **Vultr Cloud Compute** (CPU). The gateway calls `POST /classify` over HTTPS with a bearer token.
- **Highlights:** by occlusion (drop each word, re-score), not coefficients. See component 8 below.
- **TF-IDF + LR is also implemented** (`train.py --model tfidf`) as the comparison baseline and a fallback. It trains on a CPU in minutes, and the same service serves it with exact coefficient-based highlights. Whichever model is in `classifier/artifacts/` is the one served. MiniLM stays the planned model unless the team decides otherwise after comparing both on the real test split.
- **Training data is built first:** `classifier/build_splits.py` writes leak-free `train_val.csv`, `test.csv` and `threat_eval.csv`. `train.py` never reads test; `classifier/evaluate.py` scores a finished model in a separate run.
- **Stacked is also implemented** (`train.py --model stacked`, 2026-11-08): both models trained on `train`, combined by a small LR trained on `val`, served by the same service with occlusion highlights. It is the **proposed** production model (best SMS F1, calibration and unseen-scam recall), not yet agreed. `metrics.json` lists suggested thresholds; the block threshold is still the gateway's. See `CHANGELOG.md`, "Stacked model option built".
- **Still TBD:** label scheme (8-class is the `train.py` default because it gives the block category, binary is the alternative), thresholds, Vultr instance sizes, region, registry and HTTPS setup.

**Training data (agreed, Tuan):** train on [`data/scam_categories_100k_full.csv`](data/README.md#scam_categories_100k_fullcsv), the most aggregated labeled file. It has the 8-class `label_class`, the binary `is_spam`, and the `split`/`style`/`is_synthetic`/`label_confidence` metadata, so it supports either label scheme. Evaluate only on the real `val`/`test` splits. The message bank is separate demo input, not training data.

## Proposed architecture: interception gateway and demo scene (not agreed)

**Status: proposed by Tuan on 2026-11-07, not yet agreed by the team, except where marked as Tuan's decision.** For the MVP, only the gateway, simulator, classifier interface and a read-only query API are in play; the event stream, scene, notice and panel below are later scope (see [MVP](#mvp-twilio-scam-message-simulation)). Only the MVP pieces are being built. The full spec (component responsibilities, event contract v1, gateway behavior, scene design, open questions) is in [`CHANGELOG.md`, "Proposal: Twilio interception gateway and decoupled demo scene"](CHANGELOG.md#proposal-twilio-interception-gateway-and-decoupled-demo-scene). Read it before building anything in this area.

**How interception works:** Photon sends every iMessage addressed to the victim line to our webhook (`POST /webhooks/photon`). No victim phone sits behind that line. The victim's inbox is virtual and owned by the gateway, so the gateway acts as the victim's carrier. It classifies each message, then **delivers** it to the inbox or **blocks** it (quarantine log). Blocking needs no outbound message. The gateway has no Photon send code, so it can never reply to a sender.

**Stack:**
- **TypeScript (Tuan's decision, 2026-11-07):** the gateway (Photon webhook and query API, built with **Hono**), the perpetrator simulator and the web app.
- **Python:** the model training and inference service.
- **Web app (Tuan's decision):** Next.js with **React Three Fiber** for the 3D scene and **Motion** (`motion/react`) for DOM animation (bubbles, panel, toasts). Don't use the deprecated `framer-motion-3d`, which doesn't support React 19. Animate 3D objects in R3F (`useFrame` with damping).
- **Vercel webhook backup (Tuan, 2026-11-08):** the web app also serves `POST /webhooks/photon` and `GET /api/messages` (`apps/web/lib/server/inbox.ts`, Atlas store, classifies before the 200), so Photon can deliver to `https://hackutd-omega.vercel.app/webhooks/photon`. This is an exception to "the web app holds no secrets" (server-only env vars, never `NEXT_PUBLIC_`). The VM gateway stays the primary. The page reads whichever one `NEXT_PUBLIC_API_URL` points at. **Photon 2.0 / Beta (2026-11-08):** the team's Photon project is on Beta (`pho_prj_` id, app.beta.photon.codes), whose webhooks are "destinations" on `api.photon.codes/v1` signed with Standard Webhooks (`webhook-id`/`webhook-timestamp`/`webhook-signature`, `whsec_` secret) and carry `message.received` events. `npm run photon:webhook` picks Beta from the `pho_prj_` id (adds `rotate`), and the Vercel route accepts both formats. The VM gateway (`services/gateway/src/photon.ts`) accepts both formats too (Timothy, 2026-11-08).
- **Hosting (Tuan, 2026-11-07):** the gateway runs as a **separate TypeScript service on a Vultr VM**, not on Vercel. Vercel can't keep its SQLite file or its classify-after-reply work, and a web deploy must never be able to break interception. Only the web app (`apps/web`) deploys to **Vercel**, through the repo-root `vercel.json` (one service, `web`, no bindings). The browser reaches the gateway at `NEXT_PUBLIC_API_URL`. See [`CHANGELOG.md`, "Technology stack"](CHANGELOG.md#technology-stack-typescript).

**Components** (each separately runnable):

1. **Perpetrator simulator:** picks messages from the message bank (or takes typed ones) and POSTs signed, Photon-format inbound-iMessage webhooks straight to the gateway. Nothing goes through Photon or Apple. Has a dry-run mode that prints instead of sending.
2. **Interception gateway:** inbound Photon webhook for the victim line. Verifies `X-Spectrum-Signature` and the timestamp, dedupes on `message.id`, classifies through a classifier interface, applies the deliver/block policy, stores the result, publishes events and returns `200 ok` (never replies to the sender).
3. **Classifier service:** a separate Python inference service on **Vultr** (agreed; see [Classifier](#classifier-agreed-minilm-on-vultr)). The gateway calls it over HTTPS (`POST /classify` → `{ label, score, category, model, highlights }`) through a classifier interface, with a strict timeout, so the model choice or host can change without touching the gateway. Vultr returns only a verdict. The block/deliver policy (thresholds, fail-safe) stays in the gateway. Only message text and an opaque id are sent, never phone numbers.
4. **Event stream and query API:** versioned JSON events (`message.received`, `message.classified`, `message.delivered`, `message.blocked`, `victim.notified`, `participant.joined`) over WebSocket or SSE (TBD), plus a read-only query API (`GET /api/blocked`, `GET /api/blocked/:id`) for the panel.
5. **Block log:** every blocked message is recorded with **why** it was blocked: scam category, score, model version, reason (`model_verdict` or `classifier_unavailable`) and time. The categories would likely come from the 7 FTC-derived scam groups in `data/scam_categories.csv`, which depends on the still-TBD label scheme. `message.blocked` events carry the category so displays can show it.
   - **Sender blocklist and fingerprints (Timothy, 2026-11-08; plan: [`docs/features/sender-blocklist.md`](docs/features/sender-blocklist.md)):** each model-blocked message records a keyed hash (HMAC-SHA256, gateway-only secret) of the sender's normalized iMessage handle (number or Apple ID email) and of its normalized text in **MongoDB Atlas**. Never raw handles or text. A sender is blocklisted, and its later messages blocked without the classifier (reason `sender_blocked`), only after repeated scams or one very high score, and the block expires. With the blocklist on, the "Not a scam" override also allowlists it. SQLite stays the inbox and blocked log; Atlas is fail-open like the classifier. **Parked (Tuan, 2026-11-08): "we don't aim to block users, just block that instance of a message."** The module is wired but behind `SENDER_BLOCKLIST`, **default `off`**: no blocklist calls and no Atlas connection, and each message is judged on its own. `on` keeps sender-level blocking (reason `sender_blocked`) as an option. The operator override `POST /admin/messages/restore` plus `npm run message:restore` (`ADMIN_TOKEN`) restores one blocked message to the inbox (reason `override`). It's not a web button.
6. **Scam notice (proposed):** when a message is blocked, the gateway sends the victim a short notice, for example "T-Guard blocked a potential scam from ***-***-4821 (Imposter & Phishing). View: <link>". It never includes the scam's text or links. It always goes to the virtual victim inbox. Also sending it as a real SMS to a protected handset (for example, a verified teammate phone) is TBD, and that would be outbound SMS.
7. **Blocked-scams panel (proposed):** the notice link opens `/blocked/<id>` in the web app. The panel lists all blocked messages with why they were blocked, the **category highlighted** as a badge, and the **scam keywords highlighted** in the message text. Links and numbers inside scam text are shown defanged and non-clickable.
8. **Keyword highlighting (proposed):** the MiniLM service computes highlights by occlusion: it drops each word, re-scores, and returns the words whose removal lowers the scam log-odds most, as character spans with weights. Highlights are associations, not proof, and the labels were partly keyword-rule-derived, so they may echo those rules. Optionally, soft highlights on borderline messages that get delivered help victims judge scams that slip through (TBD).
9. **Web app (Next.js on Vercel):** the 3D scene (`/`, React Three Fiber) and the panel (`/blocked`) are separate routes in one Next.js app. R3F runs client-side. Vercel can't host a WebSocket server, so the browser connects straight to the gateway's stream hosted elsewhere, through `NEXT_PUBLIC_EVENTS_URL` and `NEXT_PUBLIC_API_URL`. With no URLs set, it falls back to mock fixtures. The web app holds no secrets.

**Decoupling rules (firm requirement from Tuan).** Follow these in any implementation:

- The gateway and the web app share **only the versioned contract** (event schema, query API schema and sample fixtures), never code. TypeScript types generated from the schemas are fine. Neither imports from the other.
- Data flows **one way**. The web app subscribes to events and may **read** the query API, but never writes to the gateway or calls Photon or the classifier. **One exception (Tuan, 2026-11-08):** the "Clear chats" button calls `DELETE /api/messages`, which deletes every stored message on the gateway (or the Vercel backup's Atlas inbox). It is unauthenticated by choice, so anyone who can open the page can wipe the inbox.
- Interception behaves identically with zero, one or many displays connected. Publishing is fire-and-forget, so a crashed or slow display can never delay or change a block decision or the webhook response.
- Each side runs and is testable alone. The gateway uses recorded webhook payloads and a fake classifier. The web app uses a mock event source and mock query responses from fixture files, and the live URLs are configuration, not code.
- Events never contain raw phone numbers or iMessage handles, Photon message/space ids, or credentials. They use opaque participant IDs and masked display strings.
- The web app contains no business logic. It renders the event's `action`, category and highlights, and never re-decides scam vs. legitimate.

**Initial scene (Tuan, 2026-11-07):** built early with fake data ([#14](https://github.com/lytx02/HackUTD/pull/14)), then moved onto the home page `/` above the message lists ([#19](https://github.com/tuann72/HackUTD/pull/19)). It animates the same polled `GET /api/messages` data as the lists (or the mock replay when no gateway URL is set), so it no longer has its own fake messages. The projectile is a flat 2D chat-bubble image (`apps/web/public/scene/`), not a 3D ball. The rest of the scene (crowds, event stream) is still parked. It's one pink victim blob and one sender blob that shoots messages at it. Red messages are flagged as a **potential scam** (always say "potential scam", not "scam"), and each message either goes through or is blocked and pops. Plan: [`docs/features/initial-3d-scene.md`](docs/features/initial-3d-scene.md).

**Scene (firm requirement from Tuan: keep it simple):** blob people (R3F meshes) wander and bob. When one sends a message, a chat bubble (HTML via drei `<Html>`, animated with Motion) appears above its head. Delivered messages float to the victim. A scam bubble turns red with a "Blocked" stamp and pops before it reaches the victim. New public senders spawn as new blobs (later scope).

Everything above except the two firm requirements is a proposal. Open items stay **TBD**: where the gateway and event stream are hosted, WebSocket vs. SSE, Vultr products and cost, the block-category scheme, where the scam notice goes, panel login, fail-open vs. fail-closed when the classifier is down, block thresholds, storage, and moderation for the public demo.

## Open questions — do not guess

- **Message type (Tuan, 2026-11-08):** iMessage text, rich links and albums are classified. Attachments, reactions and contact cards are shown in the UI and delivered as "not checked" (`not_classified`). Group chats are shown with a badge. Voice calls remain out of scope for the message MVP; the separate proposed voice guard uses SIP/media, not the message webhook. See [`docs/features/voice-scam-guard.md`](docs/features/voice-scam-guard.md).
- **Gateway architecture:** TypeScript with Hono is agreed for the gateway. Still TBD: how inbound webhooks reach the gateway during development and the demo (hosting, tunneling). The decoupled event stream, scene, scam notice and panel are proposed (see [Proposed architecture](#proposed-architecture-interception-gateway-and-demo-scene-not-agreed)) but not agreed.
- **Perpetrator simulator:** the CLI supports all three (scripted `scenario` files, `random` bank draws, typed `send`). Which mix the demo uses is TBD.
- **Message bank:** which `data/` rows to use (likely SMS-style rows from the real `test` split), how many, whether to add generated messages and how to generate them (templates or an LLM), and the bank's file format.
- **Classifier:** MiniLM on Vultr is agreed (see above). Still open: label scheme (binary spam/ham or the 8-class scam categories), thresholds, whether fine-tuning is needed, and evaluation measures.
- **Live public demo:** moderation, rate limits, privacy of numbers texting in, and cost controls.
- **Sender blocklist:** parked, off by default (Tuan, 2026-11-08: block the message, not the sender). Whether to ever turn on `SENDER_BLOCKLIST`, and its strikes, score and expiry defaults, are TBD. See [`docs/features/sender-blocklist.md`](docs/features/sender-blocklist.md).
- **Voice scam guard:** whether the voice number is assigned to the team's Photon 2.0/Beta project and is eligible for Voice, STT service, classifier call-level evaluation/windowing, victim bridge endpoint, transcript retention period, warning transport/thresholds, and consent/disclosure requirements are TBD. Never infer voice call media from the Photon messaging webhook. See [`docs/features/voice-scam-guard.md`](docs/features/voice-scam-guard.md).
- **Privacy, storage, latency, and fail-safe behavior.**
- **User journey:** alert design, what "respond on the recipient's behalf" means, and when confirmation is required.
- **Team:** roster, ownership (the SRS mentions Jev for scam classification; confirm before treating it as current), demo narrative, success criteria, and submission checklist.

Keep these items marked **TBD** until the team resolves them. Distinguish agreed decisions from proposals and assumptions.

## Project documents

- **Source SRS:** [HackUTD SRS](https://docs.google.com/document/d/1XIBEqGl1SWqR6r0WXhKSHVs-ZWZYoIjby72qngpZ06o/edit). It predates the Twilio-first decision; where it disagrees with this file, this file wins.
- **Accounts and credentials:** [`docs/SETUP.md`](docs/SETUP.md). Every account, key and secret, in order, and where each value goes (Photon, Vultr, domain, Vercel, Atlas). Twilio is not needed.
- **Design specification:** [`CHANGELOG.md`](CHANGELOG.md). Detailed decisions, rationale, and the decision log.
- **Work tracker:** [`README.md`](README.md#active-work). Lists every feature and every branch an agent or person is currently working on.
- **Feature plans:** [`docs/features/`](docs/features/). One file per feature, with ordered tasks and parallelization notes. Start new ones from [`docs/features/_TEMPLATE.md`](docs/features/_TEMPLATE.md).
- **Interview master specs:** [`.plans/`](.plans/) holds interview-led master specs when a feature needs a broader product/technical design; the feature tracker remains in `docs/features/`.
- **Dataset reference:** [`data/README.md`](data/README.md).
- **Demo script:** [`docs/DEMO.md`](docs/DEMO.md). The judge walkthrough, setup, live iPhone moment and fallbacks.

## Data

[`data/README.md`](data/README.md) is the full reference: file purposes, columns, label maps, provenance, cleaning, synthetic-data method and caveats. Key points:

- **`data/scam_categories_100k.csv`:** `message`, `label` (0 = ham, 1–7 = scam groups merged from the FTC Consumer Sentinel categories). `data/scam_categories.csv` maps each label to its name.
- **`data/spam_ham_100k.csv`:** the same 100k messages with binary `label` (1 = spam, 0 = ham) and an older `spam_type` column.
- The `*_full.csv` variants carry the metadata: `split`, `is_synthetic`, `source`, `label_method`, `label_confidence`.
- **Evaluate only on the `val`/`test` splits.** These are 100% real messages and have no synthetic leakage. About 68% of rows are synthetic, and all of them are in `train`.
- **Labels are machine-assigned** (keyword rules plus a classifier), not human-annotated, and the scam classes are imbalanced.
- **Threats & Extortion (label 8, decided by Timothy 2026-11-08; the served model has 9 classes, see `CHANGELOG.md`). Source data, originally "Potential Threat":** `data/potential_threat_synthetic.csv` (4,100 template rows, all `train`: proposed label 8 "Potential Threat" plus ham hard negatives) and the held-out `data/potential_threat_eval.csv` (`split = threat_eval`, never train on it), built by `data/build_threat_synthetic.py`. Label 8 is not in `scam_categories.csv` and `train.py` does not read these files yet; the label scheme stays TBD. See `data/README.md`, section 4.
- **Rebuild scripts:** `data/build_100k.py`, `data/recategorize.py`, `data/ftc_taxonomy.py`. The raw source corpora are not in the repo; they are in `~/Downloads/scam_data` on the original author's machine.
- **Repo size:** the CSVs are committed directly (no Git LFS). The four 100k files are 85–93 MB each, under GitHub's 100 MB limit but over its 50 MB warning. Do not add larger files; use Git LFS or keep them out of the repo instead. Each worktree checks out a full copy (about 450 MB).

## Working agreement for all agents

These rules apply to every model and tool. Follow them by default unless a person explicitly tells you otherwise for a specific task.

### 1. Before starting any work

1. Read this file, then the relevant `docs/features/` plan, `CHANGELOG.md` sections, and the existing code. Do not choose an approach before looking at what exists.
2. Sync with the remote: `git fetch origin`.
3. **Check that nobody is already doing the work:**
   - `gh pr list --state open` (and `gh pr list --state all --search "<keyword>"` for related work).
   - `git branch -r` for branches without a PR yet.
   - The [Active work](README.md#active-work) table in `README.md`, on `origin/main` **and** on open PR branches.
   - If someone else already has the task, do not start a duplicate. Pick another unblocked task or ask the person you are working for.

### 2. Parallel work: one branch, one worktree

Several agents and people work on this repo at the same time. **By default, every task runs on its own branch in its own git worktree**, so agents never share a working directory or step on each other's uncommitted changes.

- **Never commit directly to `main`.** Branch from an up-to-date `origin/main`.
- **Branch names:** `<type>/<feature-slug>-<short-task>`, where type is `feat`, `fix`, `docs`, `data`, `chore`, or `exp` (experiment). Example: `feat/twilio-mvp-inbound-webhook`.
- **Create the worktree** as a sibling of the main checkout:

  ```bash
  git fetch origin
  git worktree add ../HackUTD-<branch-with-slashes-as-dashes> -b <branch> origin/main
  cd ../HackUTD-<branch-with-slashes-as-dashes>
  ```

  Tools with built-in worktree support may use their own location instead (for example, Claude Code's `--worktree` flag or its worktree tool).
- One task per worktree. Do not switch branches inside a worktree another agent may be using, and do not edit files in another agent's worktree.
- When the branch is merged, remove the worktree: `git worktree remove <path>` and delete the branch.

### 3. Claim the work so others can see it

As soon as you start a task:

1. Add or update its row in the [Active work](README.md#active-work) table in `README.md`: feature, task, branch, who or which agent is working on it, status, and PR link.
2. Mark the task **In progress** in its `docs/features/<feature>.md` plan, with the branch name.
3. Commit that change on your branch, push, and **open a draft PR immediately** (`gh pr create --draft`). The draft PR is what makes your claim visible to agents checking from other branches, because your README edit is not on `main` until the PR merges.
4. Keep the row current: update status when you are blocked, ready for review, or done. Remove the row (or mark it **Done**) in the PR that completes the task.

### 4. Plan features before building them

Every new feature gets a plan file in `docs/features/<feature-slug>.md`, copied from [`_TEMPLATE.md`](docs/features/_TEMPLATE.md), and a row in the README's [Feature board](README.md#feature-board). The plan must:

- Group all of the feature's tasks together.
- Order them: which tasks come first, and what each one depends on.
- Say which tasks can run **in parallel** (no shared files or blocking dependencies) and which must be sequential.
- Track each task's status (**Not started**, **In progress**, **Blocked**, **In review**, **Done**), branch, owner, and PR.
- Give enough context for another agent to pick up any unblocked task cold.
- Mark undecided items as **TBD** instead of inventing answers.

Split work into tasks small enough to land in one focused PR, and prefer splits that touch different files so they can run in parallel.

### 5. While working

- **Stay in scope.** Do the task you claimed. Note other problems in the feature plan or PR description instead of fixing them on the side.
- **Make small, focused commits** with messages that say what changed and why.
- **Never commit secrets.** Photon project secrets and webhook signing secrets, API keys, and phone-number credentials go in a local `.env` (ignored by git) or a secrets manager. Commit a `.env.example` with placeholder values instead.
- **Do not commit large generated files** (models, datasets, build output) without agreeing on where they live.
- **Verify your work.** Run the code, tests, or a manual check before calling a task done. Report failures honestly, with output; do not claim something works if you did not run it.
- **Ask instead of guessing** on product decisions, external actions (sending real messages, spending Photon or Vultr credit, deleting data), and anything marked TBD.
- **Preserve other people's changes.** Do not reformat or rewrite files you did not need to touch, and do not force-push shared branches.

### 6. Keep the docs current

1. When a task changes an agreed requirement, scope, architecture, technology choice, user behavior, or implementation status, update `AGENTS.md` in the same PR so the next agent has accurate context.
2. Record detailed decisions and their rationale in `CHANGELOG.md` (add a decision-log entry). Keep unresolved questions explicit.
3. Update the feature plan and the README tracker as task status changes.
4. If the SRS, this file, and the code disagree, surface the discrepancy and use the newest explicit team decision. Do not silently turn a stretch idea into an MVP requirement.
5. Follow any more specific `AGENTS.md` files found in subdirectories.

### 7. Finishing a task

1. Rebase on or merge the latest `origin/main` and resolve conflicts, especially in `README.md`.
2. Confirm the checks above pass and the docs are updated.
3. Mark the PR ready for review and describe what changed, how it was verified, and any follow-ups.
4. Set the task to **In review**, then **Done** when merged, and clean up the worktree.

**Merging PRs (Tuan, 2026-11-08):** agents may merge PRs themselves, their own or ones a person asked them to merge, with `gh pr merge <n> --merge` (merge commits, not squash). Before merging:

- The PR is not a draft and GitHub says it's mergeable (`gh pr view <n> --json mergeable,mergeStateStatus`), with no conflicts.
- The tests for every package it touches pass on the PR branch after merging the latest `origin/main`, and you ran them yourself.
- Its base is `main`, or the PR it's stacked on is already merged.
- A teammate's PR: only when that person or Tuan asks you to.

After merging, delete the branch only if no open PR uses it as its base (`gh pr list --state open --json number,baseRefName`). Deleting a base branch auto-closes the PRs stacked on it. Claude Code's project settings (`.claude/settings.json`) allow `gh pr merge` without a prompt; other agents follow the same rule.
