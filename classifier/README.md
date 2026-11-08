# T-Gate classifier: getting it running on Vultr

This folder is T-Gate's scam detector. Give it a text message, and it tells you whether it looks like a scam, what kind of scam, and which words gave it away:

```
"Congrats! You won a $1000 gift card. Claim at bit.ly/xx"
   → scam (score 0.99) · Prizes, Lotteries & Advance-Fee · highlights: won, gift, Claim
```

It uses a small language model called **MiniLM**. We **train** it on a rented Vultr GPU, then **run** it on a cheap Vultr server, so the gateway can ask it about every text the victim number receives. Nothing heavy runs on your laptop.

```
 your laptop ──copy code + data──▶ Vultr GPU server (rent ~30 min, then delete)
     ▲                                  │ trains the model (~5 min)
     └────────copy model back───────────┘
     │
     └──copy code + model──▶ Vultr CPU server (stays on) ◀──HTTPS── T-Gate gateway
                               runs the classifier 24/7
```

## The whole job at a glance

| Step | What you do | Time | Cost |
|---|---|---|---|
| 0 | Install `vultr-cli` and connect it to your account (once) | 10 min | free |
| 1 | Rent a GPU, train, copy the model back, **delete the GPU** | ~30 min | a dollar or two of credits (billed by the hour) |
| 2 | Rent a small CPU server and put the classifier online | ~20 min | a few dollars a month of credits |
| 3 | Test it, and give the URL and token to whoever builds the gateway | 5 min | free |

Prices vary, so check what `vultr-cli plans list` shows before you create anything.

> **Want an AI agent to do this for you?** Skip to [Let an AI agent set it up](#let-an-ai-agent-set-it-up). It has a ready-to-paste prompt.

## Before you start

- [ ] A Vultr account with credits
- [ ] [Homebrew](https://brew.sh) on your Mac
- [ ] An SSH key. Check with `ls ~/.ssh/id_ed25519.pub`. If it's missing, run `ssh-keygen -t ed25519` and press Enter at every prompt.
- [ ] This repo on your laptop. Run every command below **from the repo root** (the folder with `AGENTS.md` in it) unless a step says otherwise.

## Step 0: set up `vultr-cli` (once)

1. Install it:

   ```bash
   brew install vultr/vultr-cli/vultr-cli
   ```

2. In the Vultr website, go to **Account → API**, enable the API, and copy your API key. If there's an **Access Control** list, add your current IP address (or allow all IPv4 for the hackathon). Otherwise every command fails with "unauthorized".

3. Give the key to the CLI. Never commit it or paste it into chat:

   ```bash
   export VULTR_API_KEY=paste-your-key-here     # add to ~/.zshrc to keep it
   vultr-cli account                             # should print your account info
   ```

4. Upload your SSH key, so you can log into the servers you create:

   ```bash
   vultr-cli ssh-key create --name tgate --key "$(cat ~/.ssh/id_ed25519.pub)"
   vultr-cli ssh-key list                        # copy the ID → this is KEY_ID below
   ```

5. Find the Ubuntu image ID:

   ```bash
   vultr-cli os list | grep -i ubuntu            # pick the newest "Ubuntu xx.04 LTS x64" → OS_ID
   ```

## Step 1: train the model on a Vultr GPU

The GPU server is billed every hour it exists, so **delete it when you're done** (step 1.6).

1. **Pick a GPU plan.** GPU plan IDs usually start with `vcg`. The smallest (or a fractional) GPU is plenty.

   ```bash
   vultr-cli plans list | grep -i vcg            # → GPU_PLAN
   vultr-cli regions list                        # → REGION, e.g. ewr (New Jersey), dfw (Dallas)
   ```

   If nothing shows up, or creating the server fails with "plan not available in region", try another region. Or create the GPU instance in the Vultr website (**Deploy → Cloud GPU**) and continue from 1.3.

2. **Create the server:**

   ```bash
   vultr-cli instance create --region REGION --plan GPU_PLAN --os OS_ID \
     --ssh-keys KEY_ID --label tgate-train
   vultr-cli instance list                       # wait until it shows an IP → GPU_IP, and note its ID
   ```

3. **Copy the code and training data over** (about 95 MB):

   ```bash
   rsync -avR --exclude .venv --exclude artifacts \
     classifier/ data/scam_categories_100k_full.csv data/scam_categories.csv \
     root@GPU_IP:tgate/
   ```

   If it asks "Are you sure you want to continue connecting?", type `yes`.

4. **Log in and train:**

   ```bash
   ssh root@GPU_IP
   cd tgate
   tmux                                         # keeps training alive if your Wi-Fi drops (reattach: tmux attach)
   bash classifier/scripts/vultr_gpu_train.sh   # 8 scam categories (the default)
   ```

   It installs Python packages (a few minutes), then trains (a few minutes more). At the end it prints a report. The numbers to look at are:
   - `scam-vs-ham F1` on **test**: how well it separates scams from normal messages (1.0 is perfect). The old TF-IDF baseline scored about **0.98**.
   - `SMS-only scam-vs-ham F1`: the same score, counting only text messages. This is what T-Gate actually sees.

   Type `exit` (twice if you're in tmux) to log out.

5. **Copy the trained model back to your laptop:**

   ```bash
   scp -r root@GPU_IP:tgate/classifier/artifacts classifier/
   ls classifier/artifacts                       # head.joblib  metrics.json  model.json
   ```

   These files are small and gitignored. Don't commit them.

6. **Delete the GPU server:**

   ```bash
   vultr-cli instance delete GPU_INSTANCE_ID
   vultr-cli instance list                       # tgate-train should be gone
   ```

## Step 2: put the classifier online

This server stays on during the hackathon. It doesn't need a GPU.

1. **Create a small CPU server.** Pick a plan with **at least 2 GB of RAM** (for example `vc2-1c-2gb`):

   ```bash
   vultr-cli plans list --type vc2               # → CPU_PLAN
   vultr-cli instance create --region REGION --plan CPU_PLAN --os OS_ID \
     --ssh-keys KEY_ID --label tgate-classifier
   vultr-cli instance list                       # → SERVER_IP
   ```

2. **Install Docker and open the web ports:**

   ```bash
   ssh root@SERVER_IP
   curl -fsSL https://get.docker.com | sh
   ufw allow 80,443/tcp                         # Vultr's Ubuntu has a firewall on; "command not found" is fine
   exit
   ```

3. **Copy the code and the trained model over:**

   ```bash
   rsync -avR --exclude .venv classifier/ root@SERVER_IP:tgate/
   ```

4. **Configure it and start it:**

   ```bash
   ssh root@SERVER_IP
   cd tgate/classifier/deploy
   cp .env.example .env
   nano .env
   ```

   Set two values in `.env`:
   - `TGATE_DOMAIN`: your server's IP with dashes plus `.sslip.io`. For example, IP `45.76.1.2` becomes `45-76-1-2.sslip.io`. [sslip.io](https://sslip.io) is a free service that turns an IP into a hostname, which lets the server get a real HTTPS certificate automatically.
   - `CLASSIFIER_TOKEN`: a long random password. Make one with `openssl rand -hex 32`. The gateway needs it, so keep a copy somewhere safe.

   Then start it:

   ```bash
   docker compose up -d --build                  # first build takes ~5 min
   docker compose ps                             # both services should say "running"
   ```

## Step 3: check that it works

From your laptop:

```bash
curl https://45-76-1-2.sslip.io/healthz
# {"ok":true,"model":"minilm-lr-category@0.1"}

curl https://45-76-1-2.sslip.io/classify \
  -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"messageId":"test1","text":"URGENT: your bank account is locked. Verify your PIN at chase-secure-login.com"}'
# {"label":"scam","score":0.99,"category":"Imposter & Phishing", "highlights":[...], ...}
```

Without the token you get `401 unauthorized`, which is correct.

**Hand-off to the gateway:** the gateway needs two values in its `.env`. Send them privately, never in the repo or a public channel.

```
CLASSIFIER_URL=https://45-76-1-2.sslip.io
CLASSIFIER_TOKEN=the-token-you-made
```

## Day-to-day

- **Retrain** (new data or settings): redo step 1, then copy the new `artifacts/` to the server (step 2.3) and run `docker compose up -d --build` in `tgate/classifier/deploy`.
- **Logs:** `ssh root@SERVER_IP 'cd tgate/classifier/deploy && docker compose logs -f classifier'`. Message text is never logged.
- **After the hackathon:** `vultr-cli instance delete <id>` for `tgate-classifier`, and check `vultr-cli instance list` for anything left running.

## Troubleshooting

| Problem | Fix |
|---|---|
| `vultr-cli` says unauthorized | `VULTR_API_KEY` isn't set in this terminal, or your IP isn't in **Account → API → Access Control**. |
| "plan not available" when creating | That region doesn't have that plan. Try another region, or create it in the website. |
| `ssh: connection refused` | The server is still booting. Wait a minute. |
| Training says "No GPU visible" | The image has no NVIDIA driver. On the server, run `ubuntu-drivers install && reboot`, or recreate it with a GPU image from the website. |
| `curl https://…` fails but `docker compose ps` looks fine | Ports 80/443 are blocked (`ufw allow 80,443/tcp`), or `TGATE_DOMAIN` doesn't match the IP. Check `docker compose logs caddy`. |
| `docker compose up` says `CLASSIFIER_TOKEN` missing | You didn't create `deploy/.env` (step 2.4). |
| Build fails at `COPY artifacts/...` | The model wasn't copied to the server. Redo step 1.5, then step 2.3. |
| Server runs out of memory | Use a plan with more RAM (2 GB minimum, 4 GB is comfortable). |

## Let an AI agent set it up

You can hand this to Claude Code, Codex or a similar agent running in this repo. Do steps 0.1–0.3 yourself first, so your API key stays in your terminal and never goes into the chat. Then paste:

```text
Set up the T-Gate classifier on Vultr by following classifier/README.md, steps 0.4 to 3.
VULTR_API_KEY is already exported in my shell; never print it, echo it, or write it to a file.

Rules:
- Do NOT train the model or run Docker on my laptop. Training happens on the Vultr GPU server,
  and Docker runs only on the Vultr CPU server.
- Before every `vultr-cli instance create` or `instance delete`, show me the exact command,
  the plan and its price, and wait for my OK.
- Pick the smallest GPU plan available and a CPU plan with at least 2 GB of RAM, in the same region.
- After training, copy classifier/artifacts back, show me the test metrics (scam-vs-ham F1 and
  SMS-only F1) next to the TF-IDF baseline of 0.98, then delete the GPU server and confirm
  with `vultr-cli instance list`.
- Generate CLASSIFIER_TOKEN on the server with `openssl rand -hex 32`, and tell me where it is
  instead of pasting it into chat.
- Never commit artifacts/, .env files, keys or tokens.
- Finish by running the two curl checks from step 3 and reporting the results honestly.
  If a step fails, stop and tell me what happened instead of working around it.
```

## How it works (short version)

- **Training (`train.py`):** MiniLM turns each message into 384 numbers that capture its meaning. A simple logistic-regression model learns which patterns mean which scam type. It trains on [`data/scam_categories_100k_full.csv`](../data/README.md) and is scored only on the real `val` and `test` messages, never on synthetic ones. MiniLM reads the first ~256 tokens (about 1,000 characters), so long emails are cut off. SMS always fits.
- **Labels:** `--labels category` (the default) predicts one of 8 classes: Ham plus 7 scam groups, which gives the block log its "why". `--labels binary` predicts scam or not. Which one we ship is still TBD.
- **The service (`service/app.py`):**
  - `score` is the chance the message is a scam (0 to 1). `label` is `scam` when `score ≥ 0.5`, but the **gateway** decides what to block using its own thresholds.
  - `highlights` come from removing each word and seeing how much the scam score drops. They're hints, not proof. The training labels were partly made by keyword rules, so highlights can echo those rules.
  - It only ever receives message text and an opaque id, never phone numbers.
- **Security:** every `/classify` call needs `Authorization: Bearer <token>`, and the service refuses to start without a token. HTTPS comes from Caddy. The container runs as a non-root user.

### Files

```
classifier/
  README.md                  you are here
  train.py                   training script (runs on the Vultr GPU)
  requirements-train.txt     training packages
  scripts/vultr_gpu_train.sh one-command training on the GPU server
  service/app.py             the web service: POST /classify, GET /healthz
  service/requirements.txt   service packages
  Dockerfile                 packages the service, MiniLM and the model into one image
  deploy/                    docker-compose.yml + Caddyfile + .env.example for the CPU server
  tests/test_service.py      checks auth, a scam, a normal message and a long email
  artifacts/                 the trained model (created by training; gitignored)
```

### Optional: working on the code locally

This runs on your own computer and downloads about 2 GB of packages plus the 90 MB MiniLM model. You don't need it for the steps above.

```bash
python3 -m venv classifier/.venv && source classifier/.venv/bin/activate
pip install -r classifier/requirements-train.txt -r classifier/requirements-dev.txt
python classifier/train.py --limit 5000                         # quick sample training (~2 min on a Mac)
cd classifier && pytest tests                                   # needs artifacts/
CLASSIFIER_ALLOW_NO_AUTH=1 uvicorn service.app:app --port 8000  # local only; never deploy without a token
```
