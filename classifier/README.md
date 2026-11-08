# T-Gate classifier (MiniLM, trained and served on Vultr)

Frozen [`all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) sentence embeddings plus a logistic-regression head, trained on [`data/scam_categories_100k_full.csv`](../data/README.md). Training runs on a **Vultr Cloud GPU** instance. Inference runs as a small CPU service on **Vultr Cloud Compute**. The plan is in [`docs/features/classifier-service.md`](../docs/features/classifier-service.md).

```
classifier/
  train.py                  embed → fit head → evaluate on real val/test → write artifacts/
  requirements-train.txt
  scripts/vultr_gpu_train.sh  run on the Vultr GPU instance
  service/app.py            FastAPI: POST /classify, GET /healthz
  service/requirements.txt
  Dockerfile                CPU inference image (bakes in MiniLM + artifacts/)
  artifacts/                head.joblib, model.json, metrics.json (gitignored)
```

The service returns a **verdict only**. Block and deliver thresholds live in the gateway (see `CHANGELOG.md`, "Classifier service on Vultr").

## 1. Train on a Vultr GPU

Training needs about 1–3 minutes of GPU time for the head-only model, so the GPU instance should live for well under an hour. **It bills hourly until you destroy it.**

1. In the Vultr console, deploy a **Cloud GPU** instance (any NVIDIA GPU; the smallest or a fractional one is enough), with an Ubuntu image that has NVIDIA drivers. Add your SSH key.
2. Copy the code and data over (or `git clone` the repo on the instance):

   ```bash
   rsync -av --exclude .venv --exclude artifacts classifier data/scam_categories_100k_full.csv data/scam_categories.csv \
     root@<gpu-ip>:~/tgate/ --relative
   ```

3. On the instance:

   ```bash
   cd ~/tgate && bash classifier/scripts/vultr_gpu_train.sh            # 8-class (default)
   # or: bash classifier/scripts/vultr_gpu_train.sh --labels binary
   ```

4. Copy the model back, then **destroy the GPU instance**:

   ```bash
   scp -r root@<gpu-ip>:~/tgate/classifier/artifacts classifier/
   ```

`train.py` also runs locally (`--device mps` on a Mac, or `--limit 5000` for a quick smoke test).

## 2. Run the service locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r classifier/service/requirements.txt
cd classifier && CLASSIFIER_TOKEN=devtoken uvicorn service.app:app --port 8000

curl -s localhost:8000/classify -H 'Authorization: Bearer devtoken' -H 'content-type: application/json' \
  -d '{"messageId":"m1","text":"URGENT: your account is locked. Verify your PIN at chase-secure-login.com"}'
```

```json
{"messageId":"m1","label":"scam","score":0.99,"category":"Imposter & Phishing","model":"minilm-lr-category@0.1",
 "highlights":[{"start":0,"end":6,"text":"URGENT","weight":1.0}, ...]}
```

Environment variables: `CLASSIFIER_TOKEN` (required in any deployed environment; if unset, auth is off), `CLASSIFIER_ARTIFACTS` (default `classifier/artifacts`), `CLASSIFIER_DEVICE` (default `cpu`).

## 3. Deploy inference on Vultr Cloud Compute

Build for `linux/amd64`, since Vultr's regular instances are x86:

```bash
cd classifier
docker build --platform linux/amd64 -t tgate-classifier:0.1 .
```

Push it to a registry (Vultr Container Registry or Docker Hub), then on a Vultr Cloud Compute instance (2 GB RAM is enough):

```bash
docker run -d --restart unless-stopped -p 8000:8000 -e CLASSIFIER_TOKEN=<secret> <registry>/tgate-classifier:0.1
```

Put HTTPS in front of it (for example, Caddy) before the gateway calls it. The hosting details are still TBD; see the feature plan.

## How it works

- **Score:** `score = 1 − P(Ham)`. `label` is `scam` when `score ≥ 0.5`; the gateway applies its own thresholds to `score`.
- **Category:** the most likely of the 7 scam classes (8-class model only; `null` for the binary model or legitimate messages).
- **Highlights (occlusion):** for scam verdicts, the service removes each non-stopword word, re-scores, and returns the up-to-5 words whose removal lowers the scam log-odds most. `weight` is relative to the strongest word (0–1). These are associations, not proof. The training labels were partly keyword-rule-derived, so highlights may echo those rules.
- **Privacy:** the service receives only message text and an opaque id. It doesn't log message text.
