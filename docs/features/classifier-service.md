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

### Stage 1: code (done in the first PR)

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 1.1 | `train.py`: MiniLM embeddings + LR head, eval on real val/test, write artifacts | — | 1.2 | In review | `feat/classifier-minilm-vultr` | Tuan + Claude Code | [#3](https://github.com/lytx02/HackUTD/pull/3) |
| 1.2 | Inference service (FastAPI), bearer auth, occlusion highlights, Dockerfile | — | 1.1 | In review | `feat/classifier-minilm-vultr` | Tuan + Claude Code | [#3](https://github.com/lytx02/HackUTD/pull/3) |

### Stage 2: train on Vultr

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 2.1 | Full training run on a Vultr Cloud GPU (8-class and binary); record metrics vs. the TF-IDF baseline in `CHANGELOG.md`; destroy the instance | 1.1 | — | Not started | | | |
| 2.2 | (Only if 2.1 falls short) fine-tune MiniLM on the Vultr GPU | 2.1 | — | Not started | | | |

### Stage 3: serve on Vultr

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 3.1 | Build and push the image; run it on Vultr Cloud Compute with HTTPS and a secret token; share the URL with the gateway owner | 1.2, 2.1 | — | Not started | | | |

## Task details

### 2.1 Full training run

- **What:** follow `classifier/README.md`, step 1. Run both `--labels category` and `--labels binary`.
- **Files:** `CHANGELOG.md` (metrics), artifacts stored outside git (location TBD: Vultr Object Storage or the image registry).
- **Done when:** metrics for both label schemes are recorded, a label scheme is chosen, and the GPU instance is destroyed.

### 3.1 Deploy

- **What:** follow `classifier/README.md`, step 3.
- **Done when:** `curl https://<host>/healthz` works from outside, `/classify` rejects requests without the token, and latency per message is measured.

## Progress notes

- **2026-11-07:** Smoke test on a Mac (5k train rows, 8-class head): scam-vs-ham F1 0.949 and macro-F1 0.80 on the real test split. A full run is still needed to compare with the TF-IDF baseline. CPU inference takes about 15–120 ms per message, including highlights.
- **2026-11-07:** Tuan chose MiniLM, trained and hosted on Vultr (Vultr credits; Vultr track).
