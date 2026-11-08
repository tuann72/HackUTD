# Feature: Classifier service (MiniLM on Vultr)

- **Slug:** `classifier-minilm-vultr`
- **Phase:** MVP
- **Status:** In progress
- **Owner:** Tuan + Claude Code

## Goal

Train a MiniLM-based scam classifier on Vultr and serve it as an HTTPS inference service on Vultr that the gateway calls for every intercepted message (`POST /classify` → `{ label, score, category, model, highlights }`). This covers task 1.3 of the [Twilio MVP plan](twilio-mvp.md) and the Vultr track. See `AGENTS.md`, "Classifier", and `CHANGELOG.md`, "Classifier service on Vultr". Code and runbook: [`classifier/`](../../classifier/README.md).

## Out of scope

- Gateway code that calls the service, and the block/deliver policy (Twilio MVP task 2.1).
- The panel that renders highlights.

## Open questions

- **Label scheme:** 8-class (default in `train.py`, gives the block category) or binary. **TBD**, decide after comparing full-data metrics.
- **Fine-tuning:** head-only first. Fine-tune MiniLM on the Vultr GPU only if head-only scam-vs-ham F1 is clearly below the TF-IDF + LR baseline (F1 ≈ 0.98). **TBD**
- **Vultr products:** Cloud GPU for training and Cloud Compute (CPU) for inference are the plan. Instance sizes, region, registry and HTTPS setup are **TBD**.
- **Thresholds and fail-safe** (gateway-side): **TBD**, informed by the metrics from task 2.1.

## Tasks

### Stage 1: code

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 1.1 | `train.py`: MiniLM embeddings + LR head, eval on real val/test, write artifacts | — | 1.2 | Done | `feat/classifier-minilm-vultr` | Tuan + Claude Code | [#3](https://github.com/lytx02/HackUTD/pull/3) |
| 1.2 | Inference service (FastAPI), bearer auth, occlusion highlights, Dockerfile | — | 1.1 | Done | `feat/classifier-minilm-vultr` | Tuan + Claude Code | [#3](https://github.com/lytx02/HackUTD/pull/3) |
| 1.3 | TF-IDF + LR model (`train.py --model tfidf`), served by the same service with coefficient-based highlights; the comparison baseline and a fallback | 1.1, 1.2 | 2.1 | Done (code merged; full-data run pending, see 2.1) | `feat/classifier-tfidf-lr` | Tuan + Claude Code | [#6](https://github.com/lytx02/HackUTD/pull/6) |
| 1.4 | Artifact-free tests (tiny synthetic TF-IDF model, mocked MiniLM encoder) and laptop-side Vultr scripts for 2.1 and 3.1 (written, not run) | 1.1–1.3 | 2.1 | In review | `chore/classifier-vultr-ready` | Tuan + Claude Code | [#28](https://github.com/tuann72/HackUTD/pull/28) |

### Stage 2: train on Vultr

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 2.1 | Full training run on a Vultr Cloud GPU (8-class and binary); record metrics vs. the TF-IDF baseline in `CHANGELOG.md`; destroy the instance. One command: `classifier/vultr/train_gpu.sh` (task 1.4). Needs `VULTR_API_KEY`, a region and a GPU plan from Tuan | 1.1 | — | Not started | | | |
| 2.2 | (Only if 2.1 falls short) fine-tune MiniLM on the Vultr GPU | 2.1 | — | Not started | | | |

### Stage 3: serve on Vultr

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 3.1 | Build and run the image on Vultr Cloud Compute with a secret token; share the URL with the gateway owner. One command: `classifier/vultr/deploy_inference.sh` (task 1.4). **TBD:** `MODE=shared` (on the gateway VM, loopback only) or `separate` (own server, HTTPS via sslip.io); see the classifier README | 1.2, 2.1 | — | Not started | | | |

## Task details

### 2.1 Full training run

- **What:** follow `classifier/README.md`, step 1. Run both `--labels category` and `--labels binary`.
- **Files:** `CHANGELOG.md` (metrics), artifacts stored outside git (location TBD: Vultr Object Storage or the image registry).
- **Done when:** metrics for both label schemes are recorded, a label scheme is chosen, and the GPU instance is destroyed.

### 1.3 TF-IDF + LR model

- **What:** `train.py --model tfidf` (TF-IDF word 1–2-grams, vocabulary fit on train only, LR with balanced class weights). The service picks the model kind from `model.json` and computes coefficient-based highlights. `scripts/train_tfidf.sh` trains on any Linux box without a GPU. README, "Option B".
- **Files:** `classifier/train.py`, `classifier/service/app.py`, `classifier/Dockerfile`, `classifier/scripts/train_tfidf.sh`, `classifier/requirements-train-tfidf.txt`, `classifier/README.md`.
- **Done when:** a TF-IDF model trains on the full data with its metrics printed, `tests/test_service.py` passes against it, and highlights point at the right characters.

### 3.1 Deploy

- **What:** follow `classifier/README.md`, step 3.
- **Done when:** `curl https://<host>/healthz` works from outside, `/classify` rejects requests without the token, and latency per message is measured.

## Progress notes

- **2026-11-07:** TF-IDF + LR merged (#6) at Tuan's request without a training run or test run. Task 2.1 must train both models and run `tests/test_service.py` against each.

- **2026-11-07:** Review pass. Dataset check: no empty messages, and `label_class` and `is_spam` agree on every row. 2,397 messages are over 5,000 characters (101 in test), so the service now accepts up to 50k characters instead of rejecting them. MiniLM truncates at 256 tokens. Val/test are ~80% email, so `train.py` now also reports SMS-only F1. The service refuses to start without `CLASSIFIER_TOKEN` (unless `CLASSIFIER_ALLOW_NO_AUTH=1`), the container runs as non-root, and `deploy/` adds Docker Compose + Caddy (HTTPS through sslip.io; the image builds on the server, so no registry is needed). The README is rewritten as a step-by-step `vultr-cli` guide, with a prompt for AI agents. Not yet run: a full training run, the Docker build and the tests. Those run on Vultr in tasks 2.1 and 3.1.

- **2026-11-07:** Smoke test on a Mac (5k train rows, 8-class head): scam-vs-ham F1 0.949 and macro-F1 0.80 on the real test split. A full run is still needed to compare with the TF-IDF baseline. CPU inference takes about 15–120 ms per message, including highlights.
- **2026-11-07:** Tuan chose MiniLM, trained and hosted on Vultr (Vultr credits; Vultr track).
