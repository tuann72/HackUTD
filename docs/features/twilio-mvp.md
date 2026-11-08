# Feature: Twilio MVP

- **Slug:** `twilio-mvp`
- **Phase:** MVP
- **Status:** Not started
- **Owner:** TBD

## Goal

The team owns **one Twilio number, the victim number**. A **simulated perpetrator** sends scam and legitimate messages from a **message bank** by POSTing signed, Twilio-format webhook requests to the gateway, as if Twilio were delivering SMS to the victim. Each message is classified as scam or legitimate, and the result is shown to the team. A real phone texting the victim number checks the real Twilio path. See `AGENTS.md`, "Current scope", and `DESIGN.md`, "Perpetrator simulator" and "Message bank".

## Out of scope

- Letting the public text the victim number (that is the separate "Live public demo" feature).
- Voice calls, and responding on the victim's behalf.

## Open questions

- Backend language and framework. **Leaning TypeScript** (Tuan) for the gateway and simulator. The classifier service stays Python. Framework and hosting are **TBD**. See `DESIGN.md`, "Technology stack".
- How Twilio webhooks reach the backend in development and during the demo (hosting or tunnel). **TBD**
- How results are shown: dashboard, reply SMS, or both. **TBD.** Proposed: an interception gateway publishes versioned events to a decoupled Three.js scene. See `DESIGN.md`, "Proposal: Twilio interception gateway and decoupled demo scene". The task list below predates that proposal.
- Classifier: TF-IDF + logistic regression or MiniLM; label scheme (binary or 8-class). **TBD.** Training data is agreed: `data/scam_categories_100k_full.csv`.
- Simulator modes: scripted conversations, random bank draws, typed messages, or a mix. **TBD**
- Message bank: size, mix of `data/` test-split rows and generated messages, generation method, file format. **TBD**

## Tasks

The task list below is a **proposed** breakdown. Confirm or revise it once the open questions above are answered.

### Stage 0: decisions

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 0.1 | Choose backend stack and webhook hosting; record in `DESIGN.md` | — | 0.2 | Not started | | | |
| 0.2 | Choose classifier approach and label scheme; record in `DESIGN.md` | — | 0.1 | Not started | | | |

### Stage 1: foundations (parallel)

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 1.1 | Twilio setup: get the one victim number; `.env.example` with placeholder credentials; record one real inbound webhook payload as a fixture | — | 1.2, 1.3, 1.4 | Not started | | | |
| 1.2 | Backend skeleton with an inbound-SMS webhook for the victim number | 0.1 | 1.1, 1.3, 1.4 | Not started | | | |
| 1.3 | Classifier training and evaluation on the `val`/`test` splits; export the model | 0.2 | 1.1, 1.2, 1.4 | Not started | | | |
| 1.4 | Message bank: pick SMS-style `data/` test-split rows across categories, add generated messages, write the bank file | — | 1.1, 1.2, 1.3 | Not started | | | |

### Stage 2: integration

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 2.1 | Call the classifier from the webhook and store or log each result | 1.2, 1.3 | 2.2 | Not started | | | |
| 2.2 | Perpetrator simulator: sends bank messages as signed, Twilio-format POSTs to the webhook; dry-run mode | 1.1, 1.4 | 2.1 | Not started | | | |

### Stage 3: presentation

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 3.1 | Show classification results (format TBD) | 2.1 | 3.2 | Not started | | | |
| 3.2 | End-to-end demo run: simulator → gateway → classified result, plus one real phone texting the victim number; write a demo script | 2.1, 2.2 | 3.1 | Not started | | | |

## Task details

Fill in per task (what, files touched, done-when) once Stage 0 decisions are made.

## Progress notes

- **2026-11-07:** Proposed (not yet in the task list): a scam notice to the victim, a blocked-scams panel in the Next.js app, and keyword highlighting. Android and Photon are dropped. See the `DESIGN.md` decision log.

- **2026-11-07:** Switched to one Twilio number. The perpetrator is now simulated with signed webhook calls, fed by a message bank (task 1.4). Task 1.1 needs only one number, and task 2.2 no longer sends real SMS.

- **2026-11-07:** Plan created from the team's Twilio-first scope decision. Tasks are proposed, not agreed.
