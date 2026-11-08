# T-Gate

T-Gate detects likely scam messages and warns the recipient. Built for HackUTD's **Safe Signal (T-Mobile)** and **Vultr** tracks.

The MVP uses one Twilio number as the "victim". A simulated "perpetrator" sends scam and legitimate messages from a message bank as Twilio-format webhook calls. T-Gate classifies each message the victim receives as scam or legitimate, and blocks scams before they reach the victim.

Proposed, not final: the victim gets a short "potential scam blocked" notice with a link to a blocked-scams panel. The panel shows why each message was blocked, its category, and the scam keywords highlighted. For the MVP, a basic Next.js page lists delivered and blocked messages. A 3D scene (React Three Fiber) is planned for later. The stack is TypeScript for the gateway, simulator and web app, and Python for the classifier: MiniLM, trained and served on Vultr ([`classifier/`](classifier/README.md)).

Status: **building the MVP**. On `main`: the classifier code, the query API contract, the `apps/web` scaffold, the message bank and perpetrator simulator (`services/perpetrator-sim/`), the gateway (`services/gateway/`) and the `/messages` UI. Next: the real classifier (2.3) and deployment (3.1). See [`AGENTS.md`](AGENTS.md) for project context and the working agreement, [`CHANGELOG.md`](CHANGELOG.md) for design decisions, and [`data/README.md`](data/README.md) for the dataset.

## Feature board

Every feature has a plan in [`docs/features/`](docs/features/) with ordered tasks and parallelization notes. New plans start from [`_TEMPLATE.md`](docs/features/_TEMPLATE.md).

| Feature | Plan | Phase | Status |
|---|---|---|---|
| Twilio MVP: webhook gateway, simulator, classifier, basic Next.js message UI | [twilio-mvp.md](docs/features/twilio-mvp.md) | MVP | In progress |
| Classifier service: MiniLM trained and served on Vultr | [classifier-service.md](docs/features/classifier-service.md) | MVP | In progress |
| Live public demo: anyone texts the victim number, results shown in real time | _Not written yet_ | Later | Not started |
| Initial 3D scene: pink victim blob, sender shooting messages, potential scams blocked (first step of the parked 3D scene) | [initial-3d-scene.md](docs/features/initial-3d-scene.md) | Later | In progress (`/scene` with fake data, #14) |
| Scam notice and blocked-scams panel, with keyword highlights (proposed) | _Not written yet_ | TBD | Not started |
| 3D conversation scene, Next.js + React Three Fiber (parked) | _Not written yet_ | Later | Not started |

## Active work

**Check this table and `gh pr list --state open` before starting anything.** Add a row when you start a task, open a draft PR right away so other branches can see the claim, and update the row as status changes. See `AGENTS.md`, "Claim the work".

| Feature | Task | Branch | Worked on by | Status | PR |
|---|---|---|---|---|---|
| Classifier service | MiniLM ([#3](https://github.com/lytx02/HackUTD/pull/3)) and TF-IDF ([#6](https://github.com/lytx02/HackUTD/pull/6)) code merged, **not yet run on full data**. Next: train both on Vultr (task 2.1; TF-IDF via README Option B), then deploy (task 3.1) | — | Tuan | Not started | — |

Status values: **In progress**, **Blocked**, **In review**, **Done**. "Worked on by" names the person and, if applicable, the agent (for example, `Tuan + Claude Code`).
