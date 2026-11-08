# Deploy the gateway on a Vultr VM

Runbook for task 3.1 of [`docs/features/twilio-mvp.md`](../../docs/features/twilio-mvp.md), updated for Photon iMessage ([`photon-imessage.md`](../../docs/features/photon-imessage.md)). The gateway runs on a Vultr VM (Tuan, 2026-11-07). The web app is already on Vercel and is not part of this guide. See [`CHANGELOG.md`, "Gateway on a Vultr VM, web app on Vercel"](../../CHANGELOG.md).

The end result:

```
iPhone ──iMessage──> Photon line ──HTTPS POST /webhooks/photon──┐
                                                                 ▼
browser (Vercel site) ──HTTPS GET /api/messages──> Caddy :443 ──> gateway :8787 (systemd) ──> SQLite file
```

**Why HTTPS is required:** the Vercel site is served over HTTPS, so browsers block calls to a plain-HTTP gateway (mixed content). Photon only delivers webhooks to public HTTPS URLs (no plain HTTP, private IPs or redirects).

## Decide before you start

These are still **TBD**. Record what you choose in `CHANGELOG.md`, in the "Gateway on a Vultr VM" entry.

- **Domain:** you need a hostname for the gateway, for example `gateway.<team-domain>`, with an `A` record pointing at the VM's IP. Caddy can't get a certificate for a bare IP.
- **VM size and region:** the smallest Cloud Compute plan is enough. A US region is a reasonable default.
- **HTTPS:** this guide uses **Caddy**, which gets and renews the certificate automatically. Any reverse proxy with TLS works if the team prefers another one.

## 1. Create the VM

1. In Vultr: **Deploy → Cloud Compute**, **Ubuntu 24.04 LTS**, smallest plan, and add your SSH key.
2. Add a Vultr firewall group, or use `ufw` on the VM, that allows only **22, 80 and 443**. Don't open 8787: only Caddy talks to the gateway.
3. Point the DNS `A` record for your gateway hostname at the VM's IP. Wait until `dig +short <gateway-host>` returns that IP.

## 2. Install Node 24 and Caddy

The gateway needs **Node 24 or newer** (`engines` in `package.json`; it uses the built-in `node:sqlite`).

```bash
# Node 24 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
node --version            # must print v24.x or newer

# Caddy (official apt repo)
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

## 3. Get the code onto the VM

The repo is **private**, and a full checkout is about 450 MB because of the CSVs in `data/`. The gateway needs only `services/gateway/` and `contracts/`.

Create a user that runs the service:

```bash
sudo useradd --system --create-home --home-dir /opt/t-gate --shell /usr/sbin/nologin tgate
```

Then use **one** of these options.

**Option A, a sparse clone with a read-only deploy key** (easy to update later with `git pull`):

1. On the VM, run `sudo -u tgate ssh-keygen -t ed25519 -f /opt/t-gate/.ssh/id_ed25519 -N ""`.
2. On GitHub, open the repo's **Settings → Deploy keys → Add deploy key**, paste `/opt/t-gate/.ssh/id_ed25519.pub`, and leave write access **off**.
3. Clone:

   ```bash
   sudo -u tgate git clone --filter=blob:none --sparse git@github.com:tuann72/HackUTD.git /opt/t-gate/HackUTD
   cd /opt/t-gate/HackUTD
   sudo -u tgate git sparse-checkout set services/gateway contracts
   ```

**Option B, copy from your laptop:**

```bash
rsync -av --exclude node_modules --exclude data --exclude .env \
  services/gateway contracts root@<vm-ip>:/opt/t-gate/HackUTD/services/
# then on the VM, move contracts to /opt/t-gate/HackUTD/contracts and run:
sudo chown -R tgate:tgate /opt/t-gate
```

Install the dependencies. `npm start` runs through `tsx`, which is a devDependency, so install everything rather than just the production dependencies:

```bash
cd /opt/t-gate/HackUTD/services/gateway
sudo -u tgate npm ci
sudo -u tgate npm test        # optional check that the install works on this VM
```

## 4. Create `.env` on the VM

Create `/opt/t-gate/HackUTD/services/gateway/.env`. **Never commit it, and never paste the real token into the repo, a PR or chat.**

```bash
sudo -u tgate cp .env.example .env
sudo chmod 600 .env
sudo -u tgate nano .env
```

Set at least these:

| Variable | Value on the VM |
|---|---|
| `PORT` | `8787` |
| `PHOTON_WEBHOOK_SECRET` | The signing secret Photon returns when you register the webhook (step 9). To test with the simulator first, keep the dev placeholder for now, then switch |
| `DB_PATH` | `./data/gateway.sqlite` (the default; it's created relative to `services/gateway`) |
| `CORS_ORIGINS` | The Vercel site's origin, for example `https://<project>.vercel.app`, plus any custom domain, comma-separated. No trailing slash |
| `CLASSIFIER_URL` | Leave empty for the keyword stub until task 2.3 |
| `GATEWAY_DEBUG` | `0` on the public VM. If you set it to `1`, `DEBUG_TOKEN` must be a long random string |

See the [Environment table in the README](README.md#environment) for every variable.

## 5. Run it as a systemd service

Create `/etc/systemd/system/t-gate-gateway.service`:

```ini
[Unit]
Description=T-Gate interception gateway
After=network-online.target
Wants=network-online.target

[Service]
User=tgate
Group=tgate
WorkingDirectory=/opt/t-gate/HackUTD/services/gateway
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=2
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

`npm start` loads `.env` itself (`--env-file-if-exists=.env`), so the unit doesn't need `EnvironmentFile`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now t-gate-gateway
systemctl status t-gate-gateway
curl -s localhost:8787/healthz     # {"ok":true}
journalctl -u t-gate-gateway -f    # logs show masked numbers only
```

## 6. Put Caddy in front for HTTPS

Replace `/etc/caddy/Caddyfile` with:

```
<gateway-host> {
	reverse_proxy localhost:8787
}
```

```bash
sudo systemctl reload caddy
curl -s https://<gateway-host>/healthz    # {"ok":true}, with a valid certificate
```

If the certificate fails, check that DNS points at the VM and that ports 80 and 443 are open: Let's Encrypt needs both.

## 7. Connect the Vercel site

1. In Vercel: **Project → Settings → Environment Variables**, set `NEXT_PUBLIC_API_URL=https://<gateway-host>` (no trailing slash).
2. **Redeploy.** `NEXT_PUBLIC_*` values are fixed at build time, so changing the variable alone does nothing.
3. Check that `CORS_ORIGINS` in the VM's `.env` includes the exact Vercel origin. Restart the gateway after any `.env` change: `sudo systemctl restart t-gate-gateway`.

## 8. Test with the simulator (no Photon yet)

From a laptop, with the VM still on the dev signing secret, run the simulator against the deployed webhook ([simulator README](../perpetrator-sim/README.md)):

```bash
cd services/perpetrator-sim
npm install
GATEWAY_WEBHOOK_URL=https://<gateway-host>/webhooks/photon \
PHOTON_WEBHOOK_SECRET=<same secret as the VM's .env> \
npm run sim -- scenario smoke.jsonl
```

Each send should print status `200`. A `400` usually means the laptop's clock is more than 5 minutes off, and a `401` means the secrets differ.

**Done when:** the scenario's messages show up on the Vercel `/messages` page within a few seconds, split into inbox and blocked.

## 9. Connect Photon (photon-imessage task 1.2) and iMessage from a real phone

1. Register the webhook (dashboard at app.photon.codes, the "Webhook" tab, or the API; project id and secret are under Settings):

   ```bash
   curl -X POST "https://spectrum.photon.codes/projects/$PHOTON_PROJECT_ID/webhooks/" \
     -u "$PHOTON_PROJECT_ID:$PHOTON_PROJECT_SECRET" -H "Content-Type: application/json" \
     -d '{"webhookUrl":"https://<gateway-host>/webhooks/photon"}'
   ```

2. Put the returned `signingSecret` (shown once) in the VM's `.env` as `PHOTON_WEBHOOK_SECRET`, then restart the gateway. After this, the simulator only works if it signs with the real secret. Keep it in `.env` only.
3. iMessage the Photon line from a real iPhone.
4. Check `journalctl -u t-gate-gateway` and the `/` page. A `401` in the logs means the secret is wrong. A `400` "stale timestamp" means the VM clock is off, so check `timedatectl`.

## Updating and resetting

```bash
cd /opt/t-gate/HackUTD && sudo -u tgate git pull            # Option A
cd services/gateway && sudo -u tgate npm ci
sudo systemctl restart t-gate-gateway
```

To clear stored messages before a demo, stop the gateway, run `sudo -u tgate npm run db:reset`, then start it again. Or turn on `GATEWAY_DEBUG` with a token and use `POST /debug/reset` (see the README).

## Checklist

- [ ] VM up, only 22/80/443 open, DNS `A` record points at it
- [ ] `node --version` is 24+
- [ ] `.env` created on the VM (mode 600), not committed
- [ ] `systemctl status t-gate-gateway` active; `curl https://<gateway-host>/healthz` → `{"ok":true}`
- [ ] Vercel `NEXT_PUBLIC_API_URL` set and redeployed; `CORS_ORIGINS` includes the Vercel origin
- [ ] Simulator scenario shows up on the live `/messages` page
- [ ] Photon webhook registered, `PHOTON_WEBHOOK_SECRET` set; a real iMessage shows up
- [ ] Domain, VM size/region and HTTPS choice recorded in `CHANGELOG.md`
