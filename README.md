# T-Guard

T-Guard detects likely scam messages and warns the recipient. Built for HackUTD's **Safe Signal (T-Mobile)** and **Vultr** tracks.

The MVP uses one Photon iMessage line as the "victim". Real iMessages reach the gateway through Photon's webhooks, and a simulated "perpetrator" sends scam and legitimate messages from a message bank as Photon-format webhook calls. T-Guard classifies each message the victim receives as a potential scam or legitimate, blocks potential scams before they reach the victim's virtual inbox, and shows the result in the web app.

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
| Voice scam guard: Photon SIP call audio, transcript classification, and Vercel warning | [voice-scam-guard.md](docs/features/voice-scam-guard.md) | Later | Consolidated worker, classifier, and Vercel result flow in review; production configuration remains |
| Potential Threat synthetic data: threat, coercion and fake-emergency extortion texts, proposed label 8 | [potential-threat-data.md](docs/features/potential-threat-data.md) | MVP | In progress (data only; label scheme TBD) |
| Simulation panel: sidebar buttons on `/` that send simulated iMessages to the gateway | [simulation-panel.md](docs/features/simulation-panel.md) | MVP | Done (#54) |
| Scam notice and blocked-scams panel, with keyword highlights (proposed) | _Not written yet_ | TBD | Not started |
| 3D conversation scene, Next.js + React Three Fiber (parked) | _Not written yet_ | Later | Not started |

## Active work

**Check this table and `gh pr list --state open` before starting anything.** Add a row when you start a task, open a draft PR right away so other branches can see the claim, and update the row as status changes. See `AGENTS.md`, "Claim the work".

| Feature | Task | Branch | Worked on by | Status | PR |
|---|---|---|---|---|---|
| Message UI | Landing T: remove the black slab, add the right serif and two small pink squares beside the stem | `feat/landing-t-dots` | Tuan + Claude Code | In review | — |
| Initial 3D scene | Shield's T in Manrope ExtraBold (closest free match to T-Mobile's TeleNeo) | `feat/scene-shield-t-font` | Tuan + Claude Code | Done | [#75](https://github.com/tuann72/HackUTD/pull/75) |
| Voice scam guard | Caller-only STT worker, after-call classifier, protected Vercel result API/UI, and LiveKit Cloud deployment (tasks 1.1–1.4, 1.6; call-script and production call evaluation pending) | `feat/voice-guard-call-results` | Codex | In review | [#63](https://github.com/tuann72/HackUTD/pull/63) |
| Message UI | Wordmark shield (the U in T-GUARD) as tall as the letters everywhere | `feat/web-logo-shield` | Tuan + Claude Code | Done | [#73](https://github.com/tuann72/HackUTD/pull/73) |
| Initial 3D scene | Shield/Hand switch above the scene (hand back as an option); Rapid fire button (50 msgs, 100 ms); iMessage demo and Smoke test removed | `feat/web-guard-toggle` | Tuan + Claude Code | Done | [#71](https://github.com/tuann72/HackUTD/pull/71) |
| Message UI | Message text size follows length (short = larger, long = smaller) | `feat/web-text-size` | Tuan + Claude Code | Done | [#72](https://github.com/tuann72/HackUTD/pull/72) |
| Initial 3D scene | Move the shield a little left (x 2.2 → 1.9); a white "T" replaces its check mark; the U in the GUARD wordmark is the shield | `fix/scene-shield-left` | Tuan + Claude Code | Done | [#69](https://github.com/tuann72/HackUTD/pull/69) |
| Initial 3D scene | Replace the hand and box with a pink (T-Mobile magenta) Lucide shield in the same spot | `feat/scene-shield` | Tuan + Claude Code | Done | [#68](https://github.com/tuann72/HackUTD/pull/68) |
| Message UI | No em dashes in UI, sortable most-active-numbers table, landing blocks form a "T" | `feat/web-ui-polish` | Tuan + Claude Code | Done | [#67](https://github.com/tuann72/HackUTD/pull/67) |
| Message UI | Dashboard page (`/dashboard`) and button; move T-Guard left of the Receiver, box text back, Receiver label at the bottom | `feat/web-dashboard` | Tuan + Claude Code | Done | [#65](https://github.com/tuann72/HackUTD/pull/65) |
| Message UI | Inter font (thicker), button hovers, no arrows on Simulate buttons, bean sender + Receiver bean behind the hand, "T-Guard" box label | `feat/web-theme-tweaks` | Tuan + Claude Code | Done | [#64](https://github.com/tuann72/HackUTD/pull/64) |
| Message UI | Restyle `/messages` after the T-GUARD prototype (paper/ink/pink, labels, counter row, light only) | `feat/web-messages-theme` | Tuan + Claude Code | Done | [#62](https://github.com/tuann72/HackUTD/pull/62) |
| Classifier data | 600 synthetic scam texts: government threats, IRS, ID/identification requests, health scams (150 each); merged by `build_splits.py` | `data/gov-health-id-irs-scams` | Tuan + Claude Code | Done (retrain not run) | [#61](https://github.com/tuann72/HackUTD/pull/61) |
| Nemotron review | Second-opinion review in the score band, with Nessie bank checks, behind `REVIEWER=off` | `feat/nemotron-review` | Timothy + Claude Code | Done | [#59](https://github.com/tuann72/HackUTD/pull/59) |
| Initial 3D scene | Replace the right (Receiver) blob with the T-GUARD pink box and a photographic hand that slaps blocked potential scams away (art and strike timings from the T-GUARD offline prototype) | `feat/scene-slap-hand` | Tuan + Claude Code | Done | [#60](https://github.com/tuann72/HackUTD/pull/60) |
| Simulation panel | Remove the "Burst settings" inputs from the Simulate sidebar (bursts use fixed defaults) | `fix/web-sim-remove-burst-settings` | Tuan + Claude Code | Done | [#58](https://github.com/tuann72/HackUTD/pull/58) |
| Classifier data | Merge the 300 free-ham rows into `scam_categories_100k(_full).csv` (100,300 rows); `build_splits.py` stops reading them separately | `data/free-ham-into-100k` | Tuan + Claude Code | Done (retrain not run) | [#57](https://github.com/tuann72/HackUTD/pull/57) |
| Classifier data | 300 harmless "free" ham texts ("feel free", "free pizza") so "free" stops reading as a scam cue; merged by `build_splits.py` | `data/free-ham-synthetic` | Tuan + Claude Code | Done (retrain not run) | [#56](https://github.com/tuann72/HackUTD/pull/56) |
| Message UI | Landing page at `/` with a Start button; scene + lists move to `/messages` | `feat/web-landing-page` | Tuan + Claude Code | Done | [#55](https://github.com/tuann72/HackUTD/pull/55) |
| Simulation panel | Sidebar buttons on `/messages` that run configurable simulations (presets, random bursts, custom text) through a server-side signing route | `feat/web-sim-panel` | Tuan + Claude Code | Done | [#54](https://github.com/tuann72/HackUTD/pull/54) |
| Project | Rename the project T-Gate → T-Guard (display name; technical ids unchanged) | `chore/rename-t-guard` | Tuan + Claude Code | Done | [#53](https://github.com/tuann72/HackUTD/pull/53) |
| Initial 3D scene | Sender label still missing: draw both labels as DOM over the canvas, placed each frame from the blob anchors (no drei `<Html>`) | `fix/scene-sender-label-overlay` | Tuan + Claude Code | Done | [#50](https://github.com/tuann72/HackUTD/pull/50) |
| Initial 3D scene | Bigger 3D scene band on `/` (taller band, camera reframed) | `feat/web-bigger-scene` | Claude (agent) | Done | [#48](https://github.com/tuann72/HackUTD/pull/48) |
| Initial 3D scene | Fast-slow-fast message flight (fast first 30%, slow middle 40%, fast last 30% of the distance) | `feat/scene-flight-easing` | Claude (agent) | Done | [#47](https://github.com/tuann72/HackUTD/pull/47) |
| Message UI | Remove the "Live" source pill from the T-Guard header | `fix/web-remove-live-indicator` | Claude (agent) | Done | [#49](https://github.com/tuann72/HackUTD/pull/49) |
| Initial 3D scene | Remove the legend overlay (Potential scam / Message) from the scene | `fix/scene-remove-legend` | Claude (agent) | Done | [#46](https://github.com/tuann72/HackUTD/pull/46) |
| Message UI | "Clear chats" deletes every message (`DELETE /api/messages` on the gateway and the Vercel backup) instead of hiding them | `feat/web-clear-deletes` | Tuan + Claude Code | Done | [#45](https://github.com/tuann72/HackUTD/pull/45) |
| Potential Threat data | Seeded synthetic threat/coercion rows (proposed label 8), hard negatives and held-out eval file (task 1.1) | `data/potential-threat-synthetic` | Tuan + Claude Code | In review (data built; label scheme TBD) | [#43](https://github.com/tuann72/HackUTD/pull/43) |
| Initial 3D scene | Sender label missing: draw each label inside its blob (bobs with it), pill background | `fix/scene-sender-label` | Tuan + Claude Code | Done | [#44](https://github.com/tuann72/HackUTD/pull/44) |
| Message UI | Remove the count/category tags under the T-Guard title | `fix/web-header-remove-tags` | Tuan + Claude Code | Done | [#42](https://github.com/tuann72/HackUTD/pull/42) |
| Message UI | Collapsible Inbox and Blocked sections | `feat/web-collapsible-lists` | Tuan + Claude Code | Done | [#41](https://github.com/tuann72/HackUTD/pull/41) |
| Initial 3D scene | Sender/Receiver labels under the blobs, rename Victim → Receiver, drop "(protected)" | `fix/scene-blob-labels` | Tuan + Claude Code | Done | [#40](https://github.com/tuann72/HackUTD/pull/40) |
| Message UI | Scam score as a percentage with two decimals, truncated (95.43%) | `fix/web-score-two-decimals` | Tuan + Claude Code | Done | [#39](https://github.com/tuann72/HackUTD/pull/39) |
| Message UI | "Clear chats" button on `/`: hides the current inbox/blocked messages in this browser (nothing deleted on the gateway) | `feat/web-clear-chats` | JP + Claude Code | In review | [#38](https://github.com/tuann72/HackUTD/pull/38) |
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
