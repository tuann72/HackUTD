# T-Gate

T-Gate detects likely scam messages and warns the recipient. Built for HackUTD's **Safe Signal (T-Mobile)** and **Vultr** tracks.

The MVP uses one Twilio number as the "victim". A simulated "perpetrator" sends scam and legitimate messages from a message bank as Twilio-format webhook calls. T-Gate classifies each message the victim receives as scam or legitimate, and blocks scams before they reach the victim.

Proposed, not final: the victim gets a short "potential scam blocked" notice with a link to a blocked-scams panel. The panel shows why each message was blocked, its category, and the scam keywords highlighted. For the MVP, a basic Next.js page lists delivered and blocked messages. A 3D scene (React Three Fiber) is planned for later. The stack is TypeScript for the gateway, simulator and web app, and Python for the classifier: MiniLM, trained and served on Vultr ([`classifier/`](classifier/README.md)).

Status: **planning**. The classifier code exists; the gateway, simulator and web app don't yet. See [`AGENTS.md`](AGENTS.md) for project context and the working agreement, [`CHANGELOG.md`](CHANGELOG.md) for design decisions, and [`data/README.md`](data/README.md) for the dataset.

## Feature board

Every feature has a plan in [`docs/features/`](docs/features/) with ordered tasks and parallelization notes. New plans start from [`_TEMPLATE.md`](docs/features/_TEMPLATE.md).

| Feature | Plan | Phase | Status |
|---|---|---|---|
| Twilio MVP: webhook gateway, simulator, classifier, basic Next.js message UI | [twilio-mvp.md](docs/features/twilio-mvp.md) | MVP | Not started |
| Classifier service: MiniLM trained and served on Vultr | [classifier-service.md](docs/features/classifier-service.md) | MVP | In progress |
| Live public demo: anyone texts the victim number, results shown in real time | _Not written yet_ | Later | Not started |
| Scam notice and blocked-scams panel, with keyword highlights (proposed) | _Not written yet_ | TBD | Not started |
| 3D conversation scene, Next.js + React Three Fiber (parked) | _Not written yet_ | Later | Not started |

## Active work

**Check this table and `gh pr list --state open` before starting anything.** Add a row when you start a task, open a draft PR right away so other branches can see the claim, and update the row as status changes. See `AGENTS.md`, "Claim the work".

| Feature | Task | Branch | Worked on by | Status | PR |
|---|---|---|---|---|---|
| Classifier service | Code, deploy files and README merged ([#3](https://github.com/lytx02/HackUTD/pull/3)). Next: train on a Vultr GPU (task 2.1), then deploy (task 3.1); see `classifier/README.md` | — | Tuan | Not started | — |
| Classifier service | Task 1.3: TF-IDF + logistic-regression model as a selectable baseline in the same service | `feat/classifier-tfidf-lr` | Tuan + Claude Code | In progress | _draft PR_ |

Status values: **In progress**, **Blocked**, **In review**, **Done**. "Worked on by" names the person and, if applicable, the agent (for example, `Tuan + Claude Code`).
