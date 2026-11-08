# T-Gate

T-Gate detects likely scam messages and warns the recipient. Built for HackUTD's **Safe Signal (T-Mobile)** and **Vultr** tracks.

The MVP uses one Photon iMessage line as the "victim". Real iMessages reach the gateway through Photon's webhooks, and a simulated "perpetrator" sends scam and legitimate messages from a message bank as Photon-format webhook calls. T-Gate classifies each message the victim receives as a potential scam or legitimate, blocks potential scams before they reach the victim's virtual inbox, and shows the result in the web app.

Proposed, not final: the victim gets a short "potential scam blocked" notice with a link to a blocked-scams panel. The panel shows why each message was blocked, its category, and the scam keywords highlighted. For the MVP, a basic Next.js page lists delivered and blocked messages. A 3D scene (React Three Fiber) is planned for later. The stack is TypeScript for the gateway, simulator and web app, and Python for the classifier: MiniLM, trained and served on Vultr ([`classifier/`](classifier/README.md)).

Status: **building the MVP**. On `main`: the classifier code, the query API contract, the `apps/web` scaffold, the message bank and perpetrator simulator (`services/perpetrator-sim/`), the gateway (`services/gateway/`), the gateway's Vultr deploy runbook, the sender-blocklist module, and the web UI: one page at `/` with the 3D scene above the inbox/blocked lists. Next: the real classifier (2.3), deployment (3.1) and wiring the sender blocklist into the gateway. See [`AGENTS.md`](AGENTS.md) for project context and the working agreement, [`CHANGELOG.md`](CHANGELOG.md) for design decisions, and [`data/README.md`](data/README.md) for the dataset. The demo walkthrough is in [`docs/DEMO.md`](docs/DEMO.md).

**Setting up accounts and credentials?** Start with [`docs/SETUP.md`](docs/SETUP.md) (Photon, Vultr, domain, Vercel, optional Atlas; Twilio isn't needed). Deploying the gateway: [`services/gateway/DEPLOY.md`](services/gateway/DEPLOY.md).

## Feature board

Every feature has a plan in [`docs/features/`](docs/features/) with ordered tasks and parallelization notes. New plans start from [`_TEMPLATE.md`](docs/features/_TEMPLATE.md).

| Feature | Plan | Phase | Status |
|---|---|---|---|
| Photon iMessage gateway: Spectrum webhook replaces Twilio, iMessage only | [photon-imessage.md](docs/features/photon-imessage.md) | MVP | In progress |
| Twilio MVP: webhook gateway, simulator, classifier, basic Next.js message UI (webhook part superseded by Photon) | [twilio-mvp.md](docs/features/twilio-mvp.md) | MVP | In progress |
| Classifier service: MiniLM trained and served on Vultr | [classifier-service.md](docs/features/classifier-service.md) | MVP | In progress |
| Live public demo: anyone texts the victim number, results shown in real time | _Not written yet_ | Later | Not started |
| Sender blocklist and scam fingerprints in MongoDB Atlas | [sender-blocklist.md](docs/features/sender-blocklist.md) | MVP | Parked: wired but off by default, per-message blocking only (#22, #23, #27) |
| Initial 3D scene: pink victim blob, sender shooting messages, potential scams blocked (first step of the parked 3D scene) | [initial-3d-scene.md](docs/features/initial-3d-scene.md) | Later | In progress (on `/` above the message lists, live polled data, #14, #19) |
| Voice scam guard: Photon SIP call audio, transcript classification, and Vercel warning | [voice-scam-guard.md](docs/features/voice-scam-guard.md) | Later | In review; proposed, separate from the iMessage MVP |
| Scam notice and blocked-scams panel, with keyword highlights (proposed) | _Not written yet_ | TBD | Not started |
| 3D conversation scene, Next.js + React Three Fiber (parked) | _Not written yet_ | Later | Not started |

## Active work

**Check this table and `gh pr list --state open` before starting anything.** Add a row when you start a task, open a draft PR right away so other branches can see the claim, and update the row as status changes. See `AGENTS.md`, "Claim the work".

| Feature | Task | Branch | Worked on by | Status | PR |
|---|---|---|---|---|---|
| Message UI | "Clear chats" button on `/`: hides the current inbox/blocked messages in this browser (nothing deleted on the gateway) | `feat/web-clear-chats` | JP + Claude Code | In review | [#38](https://github.com/tuann72/HackUTD/pull/38) |
| Voice scam guard | Interview and master plan: Photon SIP feasibility, after-call test, live warning, and caller–victim bridge | `feat/voice-scam-detection` | Codex | In review | [#36](https://github.com/tuann72/HackUTD/pull/36) |
| Classifier service | Stacked model option, `train.py --model stacked` (task 1.5), deployed on the gateway VM | `feat/classifier-service-stacked` | Timothy + Claude Code | Done | — |
| Photon iMessage gateway | Photon 2.0 / Beta webhooks: registration script (`pho_prj_` → destinations API, `rotate`) and Standard Webhooks + `message.received` on the Vercel route | `feat/photon-beta-webhooks` | Tuan + Claude Code | Done | — |
| Photon iMessage gateway | Photon webhook on the Vercel site (`/webhooks/photon` + `/api/messages`, Atlas store), backup to the VM gateway | `feat/web-photon-webhook` | Tuan + Claude Code | In review | — |
| Sender blocklist | `DNS_SERVERS` for Atlas on Windows; drop deprecated `timeoutMS` | `fix/sender-blocklist-dns` | Timothy + Claude Code | Done | [#29](https://github.com/tuann72/HackUTD/pull/29) |
| Classifier service | Artifact-free tests + Vultr train/deploy scripts, not executed (task 1.4) | `chore/classifier-vultr-ready` | Tuan + Claude Code | Done | [#28](https://github.com/tuann72/HackUTD/pull/28) |
| Photon iMessage gateway | Simulator: rich iMessage content, demo scenario and demo script (task 1.8) | `feat/photon-sim-rich-content` | Tuan + Claude Code | Done | [#26](https://github.com/tuann72/HackUTD/pull/26) |
| Photon iMessage gateway | Deploy tooling and setup checklist: `docs/SETUP.md`, webhook registration script, VM deploy files, tunnel helper (task 1.7) | `chore/photon-deploy-tooling` | Tuan + Claude Code | Done | [#25](https://github.com/tuann72/HackUTD/pull/25) |
| Sender blocklist | Blocklist wired but parked behind `SENDER_BLOCKLIST` (default off), one-message restore route, email handle fix (tasks 1.1, 2.1, 2.2; photon-imessage 1.5) | `feat/sender-blocklist-gateway-flow` | Tuan + Claude Code | Done | [#27](https://github.com/tuann72/HackUTD/pull/27) |
| Photon iMessage gateway | Replace the Twilio webhook with Photon (Spectrum) iMessage webhooks: gateway, simulator, fixture, docs (task 1.1) | `feat/photon-imessage-gateway` | Tuan + Claude Code | Done | [#24](https://github.com/tuann72/HackUTD/pull/24) |
| Sender blocklist | Fingerprint + blocklist module (task 1.2) | `feat/sender-blocklist-module` | Timothy + Claude Code | Done | [#23](https://github.com/tuann72/HackUTD/pull/23) |
| Sender blocklist | Write the plan | `feat/sender-blocklist-plan` | Timothy + Claude Code | Done | [#22](https://github.com/tuann72/HackUTD/pull/22) |
| Initial 3D scene | Combine scene and messages on `/`, 2D bubble image (task 3.4) | `feat/initial-3d-scene-combined-page` | Tuan + Claude Code | Done | [#19](https://github.com/tuann72/HackUTD/pull/19) |
| Classifier service | MiniLM ([#3](https://github.com/lytx02/HackUTD/pull/3)) and TF-IDF ([#6](https://github.com/lytx02/HackUTD/pull/6)) code merged, **not yet run on full data**. Next: train both on Vultr (task 2.1; TF-IDF via README Option B), then deploy (task 3.1) | — | Tuan | Not started | — |

Status values: **In progress**, **Blocked**, **In review**, **Done**. "Worked on by" names the person and, if applicable, the agent (for example, `Tuan + Claude Code`).
