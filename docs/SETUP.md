# Accounts and credentials setup

Every account, key and secret T-Guard needs, in the order to create them, and where each value goes. Nothing here is set up yet (Tuan, 2026-11-08).

**Twilio is no longer needed.** The gateway takes iMessages through Photon (see [`docs/features/photon-imessage.md`](features/photon-imessage.md)). Don't create a Twilio account, and ignore any `TWILIO_*` variable in older docs.

**Rules for every secret below:** keep it in a gitignored `.env`, in Vercel's environment settings, or in a password manager. Never put one in the repo, a PR, an issue or a chat. Each `.env.example` holds placeholders only.

## What you can do with no accounts at all

Everything runs locally against fake data, with no accounts:

- Gateway: `services/gateway`, `npm run dev`
- Simulator: `services/perpetrator-sim`, `npm run sim -- scenario smoke.jsonl`
- Web app: `apps/web`, `npm run dev`. It uses mock data when `NEXT_PUBLIC_API_URL` is unset.

The dev placeholder secrets already match each other. Accounts are needed only for a public deployment and real iMessages.

## Order

| # | What | Who (likely) | Cost | Needed for | Optional? |
|---|---|---|---|---|---|
| 1 | [Photon project and line](#1-photon-project-and-line) | Tuan | Free/Pro plan; the shared-pool number is the victim number | Real iMessages | Required for the real demo |
| 2 | [Vultr account and API key](#2-vultr-account-and-api-key) | Tuan | Team credits. CPU VMs are billed monthly (check `vultr-cli plans list`), the GPU is billed hourly | Gateway VM, classifier VM, training | Required |
| 3 | [Domain and DNS](#3-domain-and-dns) | Tuan | A domain the team owns, or a cheap new one | HTTPS for the gateway (and the classifier) | Required |
| 4 | [Generated secrets](#4-generated-secrets) | Whoever deploys | Free | Gateway, classifier | Required |
| 5 | [Vercel env var](#5-vercel) | Tuan | Free tier | Web app reading the live gateway | Required for the live UI |
| 6 | [MongoDB Atlas](#6-mongodb-atlas-optional) | Timothy | Free M0 tier | Durable sender blocklist | **Optional**: without it the blocklist is in memory, and the gateway fails open |
| 7 | [GitHub deploy key](#7-github-deploy-key) | Whoever deploys | Free | VM pulling the private repo | Required (printed by `bootstrap.sh`) |

## 1. Photon project and line

The team's project is on **Photon 2.0 / Beta**, which the Photon track requires (Timothy, 2026-11-08). The stable site, API and CLI defaults are a different backend, and a Beta project doesn't exist there.

1. Use the project at [app.beta.photon.codes](https://app.beta.photon.codes). Its id starts with `pho_prj_`. The Stable API rejects that id with a 422.
2. Create an **API key** (`pho_ask_...` or `pho_sk_...`) in the Beta dashboard.
3. Use the project's iMessage number. **Decided (Tuan, 2026-11-08):** it's a **shared-pool** number ([line model](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing)). That number is the victim number. What a shared pool means:
   - no group chats
   - at most **50 new conversations per line per day**, which matters if many judges text in (ask help@photon.codes to raise it)
   - Photon's docs don't say whether any iPhone can reach the project or only linked users, so check with a phone that has never texted it.
4. Register the webhook once the gateway has a public HTTPS URL. The VM's is `https://149-28-243-66.sslip.io/webhooks/photon`. [`DEPLOY.md`](../services/gateway/DEPLOY.md) step 6 runs:

   ```bash
   npm run photon:webhook -- register https://149-28-243-66.sslip.io/webhooks/photon --write-env
   ```

   Photon shows the **signing secret** only in that response.

| Value | Goes in | Notes |
|---|---|---|
| `PHOTON_PROJECT_ID` | Only the shell that runs `npm run photon:webhook` (`read -p`, see DEPLOY step 6) | Starts with `pho_prj_`. Not needed by the running gateway |
| `PHOTON_PROJECT_SECRET` | Same. Never in a file you commit | The Beta API key (`pho_ask_...` or `pho_sk_...`) |
| `PHOTON_WEBHOOK_SECRET` | `services/gateway/.env` on the VM (`--write-env` puts it there) | Signing secret, starts with `whsec_`. If it's lost or leaks: `npm run photon:webhook -- rotate <id> --write-env` |

## 2. Vultr account and API key

1. Create or join the team's Vultr account and apply the hackathon credits.
2. **Account → API → Enable API**. Copy the key and allow-list your IP.
3. On your laptop, run `export VULTR_API_KEY=...` (in `~/.zshrc`, never in the repo) for `vultr-cli`, which the [classifier runbook](../classifier/README.md) uses.

What runs on Vultr:

| Server | Plan | Runbook |
|---|---|---|
| Gateway VM | Smallest Cloud Compute, Ubuntu 24.04 | [`services/gateway/DEPLOY.md`](../services/gateway/DEPLOY.md) |
| Classifier VM | Cloud Compute with ≥ 2 GB RAM | [`classifier/README.md`](../classifier/README.md) |
| Training GPU | Smallest Cloud GPU, **deleted after the run** | [`classifier/README.md`](../classifier/README.md) step 1 |

| Value | Goes in |
|---|---|
| `VULTR_API_KEY` | Your shell only (`~/.zshrc`) |

## 3. Domain and DNS

Photon delivers only to **public HTTPS**, and Caddy can't get a certificate for a bare IP, so the gateway needs a hostname.

1. Pick a hostname, for example `gateway.<team-domain>` (and `classifier.<team-domain>` if the classifier gets its own VM).
2. After creating the VM, add a DNS **A record** pointing that hostname at the VM's IP. Check it with `dig +short gateway.<team-domain>`.
3. Record the choice in `CHANGELOG.md`, in the "Gateway on a Vultr VM" entry.

**No domain yet?** For local testing only, `npm run tunnel` in `services/gateway` gives a laptop gateway a temporary public HTTPS URL (Cloudflare quick tunnel) that Photon can deliver to. The URL changes on every run, so you'd re-register the webhook each time.

## 4. Generated secrets

Make each one with `openssl rand -hex 32`. Don't reuse one for another purpose.

| Value | Goes in | Optional? |
|---|---|---|
| `CLASSIFIER_TOKEN` | The classifier's `.env` **and** the gateway's `.env` (the same value) | Required once the classifier is deployed |
| `FINGERPRINT_SECRET` | The gateway's `.env` | Required only with `MONGODB_URI`. Changing it orphans every stored fingerprint |
| `DEBUG_TOKEN` | The gateway's `.env` | Only if `GATEWAY_DEBUG=1`. Keep debug off on the public VM unless needed |

## 5. Vercel

The web app is already set up to deploy to Vercel (repo-root `vercel.json`). In **Project → Settings → Environment Variables**:

| Value | Goes in | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Vercel env (Production) | `https://<gateway-host>`, no trailing slash. **Redeploy** after setting it; it's fixed at build time. It's public, not a secret |
| `MONGODB_URI`, `MONGODB_DB` | Vercel env | The Atlas inbox for the Vercel webhook backup (`/webhooks/photon` on Vercel). |
| `GATEWAY_WEBHOOK_URL`, `GATEWAY_WEBHOOK_SECRET` | LiveKit Cloud worker secrets | `https://<gateway-host>/webhooks/photon` and the gateway's `PHOTON_WEBHOOK_SECRET`. The worker posts each finished call's transcript there (see [`services/voice-guard/README.md`](../services/voice-guard/README.md)). |

Then put the Vercel origin (for example `https://<project>.vercel.app`) in the gateway's `CORS_ORIGINS`.

## 6. MongoDB Atlas (optional)

Atlas stores only the sender blocklist and scam fingerprints, as keyed hashes ([plan](features/sender-blocklist.md)). Without it, the gateway keeps them in memory and they're lost on restart. If Atlas is down, messages are still classified (fail open).

1. Create a free **M0** cluster, a database user, and an IP allow-list entry for the gateway VM's IP.
2. **Connect → Drivers** gives the connection string.

| Value | Goes in |
|---|---|
| `MONGODB_URI` | The gateway's `.env` |
| `MONGODB_DB` | The gateway's `.env` (default `tgate`) |
| `FINGERPRINT_SECRET` | The gateway's `.env` (from step 4) |

## 7. GitHub deploy key

The repo is private. On its first run, `services/gateway/deploy/bootstrap.sh` prints a read-only SSH public key. Add it under the repo's **Settings → Deploy keys** with write access **off**, then re-run the script. The private key stays on the VM.

## Where everything ends up

| File or place | Values |
|---|---|
| VM: `/opt/t-gate/HackUTD/services/gateway/.env` (mode 600) | `PHOTON_WEBHOOK_SECRET`, `CORS_ORIGINS`, `CLASSIFIER_URL`, `CLASSIFIER_TOKEN`, optionally `MONGODB_URI`, `MONGODB_DB`, `FINGERPRINT_SECRET`, `GATEWAY_DEBUG`, `DEBUG_TOKEN` |
| Classifier VM: `classifier/.env` | `CLASSIFIER_TOKEN` |
| Vercel env | `NEXT_PUBLIC_API_URL` |
| Your shell only | `VULTR_API_KEY`, `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET` |
| Laptop `services/perpetrator-sim/.env` (optional) | `GATEWAY_WEBHOOK_URL`, and `PHOTON_WEBHOOK_SECRET` only if you simulate against the real VM after step 1.4 |
