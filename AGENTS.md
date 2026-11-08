# T-Gate Project Context

This file is the shared source of truth for every coding agent (Claude Code, Codex, Cursor, Copilot, Gemini, etc.) and for human contributors. `CLAUDE.md` imports this file; Codex and most other agents read `AGENTS.md` directly. Put project rules here, not in tool-specific files.

> **Feature plans live in [`docs/features/`](docs/features/).** Before working on a feature, read its plan there: it has the concrete design, ordered tasks, what can run in parallel, and who's on what. Current plans:
>
> - [`docs/features/twilio-mvp.md`](docs/features/twilio-mvp.md): the MVP (Twilio webhook, gateway, simulator, basic message UI).
>
> New plans start from [`docs/features/_TEMPLATE.md`](docs/features/_TEMPLATE.md). Add each new plan to the list above.

## Project summary

- **Name:** **T-Gate** (renamed from the earlier working name "Gate Guardian"). The repository folder and GitHub repo are still called `HackUTD`.
- **Problem:** Scam calls and messages pressure people, especially older adults, into rash decisions that cause financial, personal, or emotional harm.
- **Concept:** Detect likely scam activity, warn the recipient, and potentially help respond on their behalf while keeping the recipient in control.
- **Hackathon track:** **Safe Signal (T-Mobile)** only, for now (Tuan, 2026-11-07). Photon, listed in the SRS, is dropped.
- **Current project state:** Planning. There is no app code yet, and scaffolding is on hold. The only content beyond docs is a labeled message dataset plus its build scripts in [`data/`](data/) (see [Data](#data)). Do not assume an implementation or technology stack exists until it is present in the repo or agreed by the team.

## Current scope (agreed)

### MVP: Twilio scam-message simulation

The MVP is **Twilio-first** and replaces the SRS's MVP. There is no mobile app. The full plan is in [`docs/features/twilio-mvp.md`](docs/features/twilio-mvp.md).

- **MVP UI (Tuan, 2026-11-07):** a **basic Next.js page** that lists messages as delivered (inbox) or blocked. It polls the gateway's read-only query API (`GET /api/messages`); there's no event stream or WebSocket in the MVP. The **3D scene is parked** for later, along with the scam notice and blocked-scams panel. Don't build them for the MVP.
- **Tunnels are only for local dev with a real phone.** Twilio delivers webhooks to a public URL, so a gateway on a laptop needs a tunnel to receive real texts. The simulator posts straight to `localhost`, and a deployed gateway needs no tunnel. Recommendation: deploy the gateway early. Hosting is TBD.

- The team owns **one Twilio phone number, the victim number.** It receives messages and is the number T-Gate protects. (This replaces the earlier two-number plan; see `CHANGELOG.md`, "One Twilio number, simulated perpetrator".)
- **The perpetrator is simulated with API calls**, not a second Twilio number. A perpetrator simulator sends HTTP requests to the gateway's webhook in exactly the format Twilio uses for an inbound SMS to the victim number (`From`, `To`, `Body`, `MessageSid`, …), signed with a valid `X-Twilio-Signature`. The gateway handles simulated and real messages the same way.
- **Message bank:** the simulator draws its messages from a bank of labeled scam and legitimate examples, so demos and tests are repeatable and show both outcomes. Candidate sources: a subset of the real `test` split in `data/` (SMS-style rows), plus generated messages (templates or LLM-written). The exact mix is TBD.
- **Real path check:** a teammate texts the victim number from their own phone to confirm the real Twilio → gateway path works. That's the same path the later public demo uses.
- Messages that arrive at the victim number are classified as scam or legitimate (see [Classifier](#classifier-direction-not-final)).

### Later: live public demo

Planned after the MVP works, not part of the MVP:

- Anyone (for example, judges or attendees) can text the victim number directly, including example scam messages.
- Incoming messages show up in real time on a display and are classified as they arrive.

### Deferred or stretch

- **Live in-call (voice) detection, alerts, and a voice response for the recipient:** stretch scope from the SRS.
- **User confirmation step** before a response flow: mentioned in the SRS. The action, consent model, and interaction are undecided.

### Classifier direction (not final)

Two approaches are under consideration. Both still need to be fleshed out (features, training data, label scheme, evaluation, latency, and where the model runs):

1. **TF-IDF + logistic regression:** the current leading approach. `data/README.md` reports a binary spam/ham baseline with this method (F1 ≈ 0.98 on the real test split).
2. **MiniLM-based model:** for example, MiniLM sentence embeddings with a classifier on top, or a fine-tuned MiniLM. Being considered as an alternative or upgrade.

Do not commit to one approach in code or docs until the team chooses. **Keyword highlighting** (see below) is much simpler and more faithful with TF-IDF + LR, which counts in its favor.

**Training data (agreed, Tuan):** train on [`data/scam_categories_100k_full.csv`](data/README.md#scam_categories_100k_fullcsv), the most aggregated labeled file. It has the 8-class `label_class`, the binary `is_spam`, and the `split`/`style`/`is_synthetic`/`label_confidence` metadata, so it supports either label scheme. Evaluate only on the real `val`/`test` splits. The message bank is separate demo input, not training data.

**Where the model runs (under consideration, not agreed):** the team is considering [Vultr](https://www.vultr.com/) to train the model and host it as an inference service. The gateway would send each intercepted message to the Vultr-hosted model and block or deliver based on the verdict it returns. See [`CHANGELOG.md`, "Classifier service on Vultr"](CHANGELOG.md#classifier-service-on-vultr-under-consideration).

## Proposed architecture: interception gateway and demo scene (not agreed)

**Status: proposed by Tuan on 2026-11-07, not yet agreed by the team, except where marked as Tuan's decision.** For the MVP, only the gateway, simulator, classifier interface and a read-only query API are in play; the event stream, scene, notice and panel below are later scope (see [MVP](#mvp-twilio-scam-message-simulation)). No code exists for it, and scaffolding is on hold. The full spec (component responsibilities, event contract v1, gateway behavior, scene design, open questions) is in [`CHANGELOG.md`, "Proposal: Twilio interception gateway and decoupled demo scene"](CHANGELOG.md#proposal-twilio-interception-gateway-and-decoupled-demo-scene). Read it before building anything in this area.

**How interception works:** Twilio sends every SMS addressed to the victim number to our webhook. No phone sits behind that number. The victim's inbox is virtual and owned by the gateway, so the gateway acts as the victim's carrier. It classifies each message, then **delivers** it to the inbox or **blocks** it (quarantine log). Blocking needs no outbound SMS, so Twilio trial and A2P 10DLC limits don't apply to it.

**Stack:**
- **TypeScript (Tuan's decision, 2026-11-07):** the gateway (Twilio webhook and query API, built with **Hono**), the perpetrator simulator and the web app.
- **Python:** the model training and inference service.
- **Web app (Tuan's decision):** Next.js with **React Three Fiber** for the 3D scene and **Motion** (`motion/react`) for DOM animation (bubbles, panel, toasts). Don't use the deprecated `framer-motion-3d`, which doesn't support React 19. Animate 3D objects in R3F (`useFrame` with damping).
- **Gateway hosting:** recommended as a **separate TypeScript service** on an always-on host, not Next.js route handlers on Vercel. Vercel can't hold the event stream or local storage, and a web deploy must never be able to break interception. See [`CHANGELOG.md`, "Technology stack"](CHANGELOG.md#technology-stack-typescript).

**Components** (each separately runnable):

1. **Perpetrator simulator:** picks messages from the message bank (or takes typed ones) and POSTs signed, Twilio-format inbound-SMS requests straight to the gateway's webhook. No second Twilio number and no outbound SMS. Has a dry-run mode that prints instead of sending.
2. **Interception gateway:** inbound webhook for the victim number. Verifies the Twilio signature, dedupes on `MessageSid`, classifies through a classifier interface, applies the deliver/block policy, stores the result, publishes events and returns empty TwiML (never auto-replies to the sender).
3. **Classifier service:** a separate Python inference service, likely on **Vultr** (under consideration). The gateway calls it over HTTPS (`POST /classify` → `{ label, score, category, model, highlights }`) through a classifier interface, with a strict timeout, so the model choice or host can change without touching the gateway. Vultr returns only a verdict. The block/deliver policy (thresholds, fail-safe) stays in the gateway. Only message text and an opaque id are sent, never phone numbers.
4. **Event stream and query API:** versioned JSON events (`message.received`, `message.classified`, `message.delivered`, `message.blocked`, `victim.notified`, `participant.joined`) over WebSocket or SSE (TBD), plus a read-only query API (`GET /api/blocked`, `GET /api/blocked/:id`) for the panel.
5. **Block log:** every blocked message is recorded with **why** it was blocked: scam category, score, model version, reason (`model_verdict` or `classifier_unavailable`) and time. The categories would likely come from the 7 FTC-derived scam groups in `data/scam_categories.csv`, which depends on the still-TBD label scheme. `message.blocked` events carry the category so displays can show it.
6. **Scam notice (proposed):** when a message is blocked, the gateway sends the victim a short notice, for example "T-Gate blocked a potential scam from ***-***-4821 (Imposter & Phishing). View: <link>". It never includes the scam's text or links. It always goes to the virtual victim inbox. Also sending it as a real SMS to a protected handset (for example, a verified teammate phone) is TBD, and that would be outbound SMS.
7. **Blocked-scams panel (proposed):** the notice link opens `/blocked/<id>` in the web app. The panel lists all blocked messages with why they were blocked, the **category highlighted** as a badge, and the **scam keywords highlighted** in the message text. Links and numbers inside scam text are shown defanged and non-clickable.
8. **Keyword highlighting (proposed):** with TF-IDF + LR, each word's contribution (TF-IDF value × coefficient) gives per-message highlight spans, and the top coefficients give a "words to watch" list per category. MiniLM needs occlusion or attribution methods instead. Highlights are associations, not proof, and the labels were partly keyword-rule-derived, so they may echo those rules. Optionally, soft highlights on borderline messages that get delivered help victims judge scams that slip through (TBD).
9. **Web app (Next.js on Vercel):** the 3D scene (`/`, React Three Fiber) and the panel (`/blocked`) are separate routes in one Next.js app. R3F runs client-side. Vercel can't host a WebSocket server, so the browser connects straight to the gateway's stream hosted elsewhere, through `NEXT_PUBLIC_EVENTS_URL` and `NEXT_PUBLIC_API_URL`. With no URLs set, it falls back to mock fixtures. The web app holds no secrets.

**Decoupling rules (firm requirement from Tuan).** Follow these in any implementation:

- The gateway and the web app share **only the versioned contract** (event schema, query API schema and sample fixtures), never code. TypeScript types generated from the schemas are fine. Neither imports from the other.
- Data flows **one way**. The web app subscribes to events and may **read** the query API, but never writes to the gateway or calls Twilio or the classifier.
- Interception behaves identically with zero, one or many displays connected. Publishing is fire-and-forget, so a crashed or slow display can never delay or change a block decision or the webhook response.
- Each side runs and is testable alone. The gateway uses recorded webhook payloads and a fake classifier. The web app uses a mock event source and mock query responses from fixture files, and the live URLs are configuration, not code.
- Events never contain raw phone numbers, Twilio SIDs or credentials. They use opaque participant IDs and masked display strings.
- The web app contains no business logic. It renders the event's `action`, category and highlights, and never re-decides scam vs. legitimate.

**Initial scene (Tuan, 2026-11-07; later scope, still parked):** when the scene is un-parked, build this first: one pink victim blob and one sender blob that shoots messages at it. Red messages are flagged as a **potential scam** (always say "potential scam", not "scam"), and each message either goes through or is blocked and pops. Plan: [`docs/features/initial-3d-scene.md`](docs/features/initial-3d-scene.md).

**Scene (firm requirement from Tuan: keep it simple):** blob people (R3F meshes) wander and bob. When one sends a message, a chat bubble (HTML via drei `<Html>`, animated with Motion) appears above its head. Delivered messages float to the victim. A scam bubble turns red with a "Blocked" stamp and pops before it reaches the victim. New public senders spawn as new blobs (later scope).

Everything above except the two firm requirements is a proposal. Open items stay **TBD**: where the gateway and event stream are hosted, WebSocket vs. SSE, Vultr products and cost, the block-category scheme, where the scam notice goes, panel login, the highlight method if MiniLM is chosen, fail-open vs. fail-closed when the classifier is down, block thresholds, storage, and moderation for the public demo.

## Open questions — do not guess

- **Message type:** the MVP assumes text messages to the victim number. Whether voice calls are in scope for the Twilio MVP is TBD.
- **Twilio architecture:** TypeScript with Hono is agreed for the gateway. Still TBD: how inbound webhooks reach the gateway during development and the demo (hosting, tunneling). The decoupled event stream, scene, scam notice and panel are proposed (see [Proposed architecture](#proposed-architecture-interception-gateway-and-demo-scene-not-agreed)) but not agreed.
- **Perpetrator simulator:** whether it sends scripted conversations, random draws from the message bank, messages typed by a teammate, or a mix.
- **Message bank:** which `data/` rows to use (likely SMS-style rows from the real `test` split), how many, whether to add generated messages and how to generate them (templates or an LLM), and the bank's file format.
- **Classifier:** final approach (see above), label scheme (binary spam/ham or the 8-class scam categories), thresholds, and evaluation measures.
- **Live public demo:** moderation, rate limits, privacy of numbers texting in, and cost controls.
- **Privacy, storage, latency, and fail-safe behavior.**
- **User journey:** alert design, what "respond on the recipient's behalf" means, and when confirmation is required.
- **Team:** roster, ownership (the SRS mentions Jev for scam classification; confirm before treating it as current), demo narrative, success criteria, and submission checklist.

Keep these items marked **TBD** until the team resolves them. Distinguish agreed decisions from proposals and assumptions.

## Project documents

- **Source SRS:** [HackUTD SRS](https://docs.google.com/document/d/1XIBEqGl1SWqR6r0WXhKSHVs-ZWZYoIjby72qngpZ06o/edit). It predates the Twilio-first decision; where it disagrees with this file, this file wins.
- **Design specification:** [`CHANGELOG.md`](CHANGELOG.md). Detailed decisions, rationale, and the decision log.
- **Work tracker:** [`README.md`](README.md#active-work). Lists every feature and every branch an agent or person is currently working on.
- **Feature plans:** [`docs/features/`](docs/features/). One file per feature, with ordered tasks and parallelization notes. Start new ones from [`docs/features/_TEMPLATE.md`](docs/features/_TEMPLATE.md).
- **Dataset reference:** [`data/README.md`](data/README.md).

## Data

[`data/README.md`](data/README.md) is the full reference: file purposes, columns, label maps, provenance, cleaning, synthetic-data method and caveats. Key points:

- **`data/scam_categories_100k.csv`:** `message`, `label` (0 = ham, 1–7 = scam groups merged from the FTC Consumer Sentinel categories). `data/scam_categories.csv` maps each label to its name.
- **`data/spam_ham_100k.csv`:** the same 100k messages with binary `label` (1 = spam, 0 = ham) and an older `spam_type` column.
- The `*_full.csv` variants carry the metadata: `split`, `is_synthetic`, `source`, `label_method`, `label_confidence`.
- **Evaluate only on the `val`/`test` splits.** These are 100% real messages and have no synthetic leakage. About 68% of rows are synthetic, and all of them are in `train`.
- **Labels are machine-assigned** (keyword rules plus a classifier), not human-annotated, and the scam classes are imbalanced.
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
- **Never commit secrets.** Twilio account SIDs, auth tokens, API keys, and phone-number credentials go in a local `.env` (ignored by git) or a secrets manager. Commit a `.env.example` with placeholder values instead.
- **Do not commit large generated files** (models, datasets, build output) without agreeing on where they live.
- **Verify your work.** Run the code, tests, or a manual check before calling a task done. Report failures honestly, with output; do not claim something works if you did not run it.
- **Ask instead of guessing** on product decisions, external actions (sending real messages, spending Twilio credit, deleting data), and anything marked TBD.
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
