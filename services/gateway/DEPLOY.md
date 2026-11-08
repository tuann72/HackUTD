# Deploy the gateway on a Vultr VM

Runbook for task 3.1 of [`docs/features/twilio-mvp.md`](../../docs/features/twilio-mvp.md), for Photon iMessage ([`photon-imessage.md`](../../docs/features/photon-imessage.md)). The gateway runs on a Vultr VM (Tuan, 2026-11-07). The web app is on Vercel. See [`CHANGELOG.md`, "Gateway on a Vultr VM, web app on Vercel"](../../CHANGELOG.md). For the accounts and credentials this needs, start with [`docs/SETUP.md`](../../docs/SETUP.md).

The end result:

```
iPhone ──iMessage──> Photon line ──HTTPS POST /webhooks/photon──┐
                                                                 ▼
browser (Vercel site) ──HTTPS GET /api/messages──> Caddy :443 ──> gateway :8787 (systemd) ──> SQLite file
LiveKit voice worker ──HTTPS POST /classify──> Caddy :443 ──> classifier :8000 (loopback, bearer token required)
```

**Why HTTPS is required:** the Vercel site is served over HTTPS, so browsers block calls to a plain-HTTP gateway (mixed content). Photon also delivers webhooks only to public HTTPS URLs, with no plain HTTP, private IPs or redirects.

The deploy files live in [`deploy/`](deploy/):

| File | What it is |
|---|---|
| [`bootstrap.sh`](deploy/bootstrap.sh) | Sets up or updates the VM. It's idempotent: re-run it to deploy a new commit |
| [`t-gate-gateway.service`](deploy/t-gate-gateway.service) | The systemd unit (`npm start` as user `tgate`) |
| [`Caddyfile`](deploy/Caddyfile) | Template for the HTTPS reverse proxy. It sends only `/classify` to the loopback classifier on port 8000 and all other paths to the gateway. `bootstrap.sh` fills in the hostname |
| [`tunnel.sh`](deploy/tunnel.sh) | For laptops only: a public HTTPS tunnel to a local gateway (`npm run tunnel`) |

## Decide before you start

These are still **TBD**. Record your choices in the "Gateway on a Vultr VM" entry of `CHANGELOG.md`.

- **Domain:** a hostname for the gateway, for example `gateway.<team-domain>`, with an `A` record pointing at the VM's IP. Caddy can't get a certificate for a bare IP.
- **VM size and region:** the smallest Cloud Compute plan is enough. A US region is a reasonable default.

## 1. Create the VM

1. In Vultr, go to **Deploy → Cloud Compute**. Choose **Ubuntu 24.04 LTS** and the smallest plan, and add your SSH key.
2. Allow only **22, 80 and 443**, with either a Vultr firewall group or `bootstrap.sh --ufw`. Don't open 8787: only Caddy talks to the gateway.
3. Point the DNS `A` record for the gateway hostname at the VM's IP. Wait until `dig +short <gateway-host>` returns that IP.

## 2. Run the bootstrap

Copy the script up from your laptop, then run it. Use `--branch` to deploy a branch other than `main`:

```bash
scp services/gateway/deploy/bootstrap.sh root@<vm-ip>:
ssh root@<vm-ip> 'bash bootstrap.sh --host <gateway-host> --ufw'
```

The repo is private, so the **first run stops after printing a deploy key**:

1. On GitHub, open the repo's **Settings → Deploy keys → Add deploy key**. Paste the key and leave write access **off**.
2. Run the same command again.

The second run does the rest:

- installs Node 24 and Caddy
- makes a sparse clone of only `services/gateway` and `contracts`, then runs `npm ci`
- creates `.env` from `.env.example` with mode 600 (an existing `.env` is never overwritten)
- installs and starts the service
- writes the Caddyfile and reloads Caddy
- checks `localhost:8787/healthz`

Check it from your laptop:

```bash
curl -s https://<gateway-host>/healthz     # {"ok":true} with a valid certificate
```

If the certificate fails, check that DNS points at the VM and that ports 80 and 443 are open. Let's Encrypt needs both.

## 3. Edit `.env` on the VM

```bash
sudo -u tgate nano /opt/t-gate/HackUTD/services/gateway/.env
sudo systemctl restart t-gate-gateway      # after every .env change
```

**Never commit `.env`, and never paste a real secret into the repo, a PR or chat.** Set at least these:

| Variable | Value on the VM |
|---|---|
| `PORT` | `8787` |
| `PHOTON_WEBHOOK_SECRET` | Keep the dev placeholder until step 6, so the simulator can test the VM. Step 6 replaces it |
| `CORS_ORIGINS` | The Vercel site's origin, for example `https://<project>.vercel.app`, plus any custom domain, comma-separated. No trailing slash |
| `CLASSIFIER_URL`, `CLASSIFIER_TOKEN` | Leave empty for the keyword stub until the classifier is deployed |
| `MONGODB_URI`, `FINGERPRINT_SECRET` | Optional ([`SETUP.md`](../../docs/SETUP.md)). With neither set, the blocklist stays in memory |
| `GATEWAY_DEBUG` | `0` on the public VM. If you set it to `1`, `DEBUG_TOKEN` must be a long random string |

The [Environment table in the README](README.md#environment) lists every variable.

## 4. Connect the Vercel site

1. In Vercel, go to **Project → Settings → Environment Variables** and set `NEXT_PUBLIC_API_URL=https://<gateway-host>` (no trailing slash).
2. **Redeploy.** `NEXT_PUBLIC_*` values are fixed at build time, so changing the variable alone does nothing.
3. Check that `CORS_ORIGINS` on the VM includes the exact Vercel origin.

## 5. Test with the simulator (no Photon yet)

From a laptop, with the VM still on the dev signing secret ([simulator README](../perpetrator-sim/README.md)):

```bash
cd services/perpetrator-sim && npm install
GATEWAY_WEBHOOK_URL=https://<gateway-host>/webhooks/photon \
PHOTON_WEBHOOK_SECRET=dev-photon-webhook-secret-change-me \
npm run sim -- scenario smoke.jsonl
```

Each send should print status `200`:

- `400` usually means the laptop's clock is more than 5 minutes off.
- `401` means the secrets differ.

**Done when:** the scenario's messages show up on the Vercel `/` page within a few seconds, split into inbox and blocked.

## 6. Connect Photon (photon-imessage task 1.2) and iMessage from a real phone

The team's project is on **Photon 2.0 / Beta** ([app.beta.photon.codes](https://app.beta.photon.codes)). This is the same procedure as the Vercel route, with the VM's URL. The deployed VM's webhook URL is `https://149-28-243-66.sslip.io/webhooks/photon`.

You need two values from the Beta dashboard:

- the **project id**, which starts with `pho_prj_`
- an **API key**, which starts with `pho_ask_` or `pho_sk_`. It goes in `PHOTON_PROJECT_SECRET`, and it's not the same as a Stable project secret

Register the webhook **on the VM** with `--write-env`, so the signing secret (`whsec_...`) never leaves it. `read -s` keeps the key out of shell history. The script picks the Beta API from the `pho_prj_` id.

```bash
cd /opt/t-gate/HackUTD/services/gateway
read -rp 'Photon project id: ' PHOTON_PROJECT_ID; read -rsp 'Photon API key: ' PHOTON_PROJECT_SECRET; echo
export PHOTON_PROJECT_ID PHOTON_PROJECT_SECRET
sudo -E -u tgate npm run photon:webhook -- list
sudo -E -u tgate npm run photon:webhook -- register https://149-28-243-66.sslip.io/webhooks/photon --write-env
unset PHOTON_PROJECT_ID PHOTON_PROJECT_SECRET
sudo systemctl restart t-gate-gateway
```

If `list` already shows the VM's URL, don't register it twice. Run `rotate <id> --write-env` instead of `register`, so the VM gets a secret that matches. On Beta, the old secret keeps working for one more hour after a rotation. `list` and `delete <id>` manage destinations. A Vercel destination in the list can stay: each destination gets its own copy of every message and has its own signing secret.

For a project on Stable (a project id without `pho_prj_`), the same commands use the Stable API, with the Stable project secret in place of the API key.

After this, the simulator only works if it signs with the real secret.

Then:

1. iMessage the Photon line from a real iPhone.
2. Watch `journalctl -u t-gate-gateway -f` and the `/` page:
   - `401` in the logs means the secret is wrong.
   - `400` "stale timestamp" means the VM clock is off; check `timedatectl`.
   - If nothing arrives at all, run `npm run photon:webhook -- list` and check that the URL is exactly `https://<gateway-host>/webhooks/photon`.

## Real iMessages to a laptop (no VM)

This is for local testing before the VM exists. Photon refuses `localhost`, so you need a public HTTPS tunnel. The URL isn't part of the signature, so the gateway needs no config change.

```bash
cd services/gateway
npm run dev                      # terminal 1
npm run tunnel                   # terminal 2: prints https://<random>.trycloudflare.com (needs `brew install cloudflared`)
npm run photon:webhook -- register https://<random>.trycloudflare.com/webhooks/photon --write-env   # needs PHOTON_PROJECT_ID/SECRET
# restart `npm run dev` so it picks up the new PHOTON_WEBHOOK_SECRET
```

Quick-tunnel URLs change on every run. Delete the stale webhook with `npm run photon:webhook -- delete <id>` (find the id with `list`), or Photon keeps retrying a dead URL.

## Updating and resetting

Re-run the bootstrap. It fast-forwards the checkout, runs `npm ci` and restarts the service:

```bash
ssh root@<vm-ip> 'bash bootstrap.sh --host <gateway-host>'
```

To clear stored messages before a demo:

```bash
sudo systemctl stop t-gate-gateway
cd /opt/t-gate/HackUTD/services/gateway && sudo -u tgate npm run db:reset
sudo systemctl start t-gate-gateway
```

Or turn on `GATEWAY_DEBUG` with a token and use `POST /debug/reset` (see the README). A database left over from an older schema makes the gateway refuse to start, and `db:reset` fixes that too.

## Checklist

- [ ] VM up, only 22/80/443 open, DNS `A` record points at it
- [ ] `bootstrap.sh` finished; `curl https://<gateway-host>/healthz` → `{"ok":true}`
- [ ] `.env` on the VM (mode 600) has `CORS_ORIGINS` set, and it isn't committed
- [ ] Vercel `NEXT_PUBLIC_API_URL` set and redeployed
- [ ] Simulator scenario shows up on the live `/` page
- [ ] Photon webhook registered (`npm run photon:webhook -- list`) and `PHOTON_WEBHOOK_SECRET` set; a real iMessage shows up
- [ ] Domain and VM size/region recorded in `CHANGELOG.md`
