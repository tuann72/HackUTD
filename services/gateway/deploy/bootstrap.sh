#!/usr/bin/env bash
# Sets up (or updates) the T-Gate gateway on a fresh Ubuntu 24.04 VM. Safe to re-run.
#
#   curl -fsSL <raw bootstrap.sh url> -o bootstrap.sh   # or scp it from services/gateway/deploy/
#   sudo bash bootstrap.sh --host gateway.example.com [--branch main] [--ufw]
#
# What it does, skipping anything already done:
#   1. apt basics, Node 24 (NodeSource) and Caddy (official repo)
#   2. system user `tgate` with home /opt/t-gate
#   3. a read-only GitHub deploy key; on first run it prints the public key and stops so you can add it
#   4. sparse clone of services/gateway + contracts (or fetch + fast-forward on re-runs), then npm ci
#   5. .env from .env.example if missing (never overwritten), mode 600
#   6. the systemd unit, enabled and (re)started
#   7. /etc/caddy/Caddyfile for --host, then a Caddy reload
#   8. optional ufw firewall: 22, 80, 443 only (--ufw)
set -euo pipefail

REPO="${REPO:-git@github.com:tuann72/HackUTD.git}"
BRANCH="main"
HOST=""
USE_UFW=0
APP_HOME=/opt/t-gate
CHECKOUT="$APP_HOME/HackUTD"
GW="$CHECKOUT/services/gateway"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:?--host needs a hostname}"; shift 2 ;;
    --branch) BRANCH="${2:?--branch needs a name}"; shift 2 ;;
    --ufw) USE_UFW=1; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
as_tgate() { sudo -u tgate -H "$@"; }

[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
if [[ -n "$HOST" && ! "$HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then echo "--host must be a bare hostname, e.g. gateway.example.com" >&2; exit 2; fi
if ! grep -q 'Ubuntu' /etc/os-release 2>/dev/null; then echo "warning: written for Ubuntu 24.04; continuing anyway" >&2; fi

log "1/8 packages, Node 24, Caddy"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
node_major() {
  if command -v node >/dev/null; then node -p 'process.versions.node.split(".")[0]'; else echo 0; fi
}
if [[ "$(node_major)" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node --version)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
echo "caddy $(caddy version | head -1)"

log "2/8 user tgate"
id tgate >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_HOME" --shell /usr/sbin/nologin tgate

log "3/8 GitHub deploy key"
KEY="$APP_HOME/.ssh/id_ed25519"
if [[ ! -f "$KEY" ]]; then
  as_tgate mkdir -p "$APP_HOME/.ssh"
  as_tgate ssh-keygen -q -t ed25519 -N "" -C "t-gate-gateway@$(hostname)" -f "$KEY"
fi
as_tgate bash -c "ssh-keygen -F github.com >/dev/null || ssh-keyscan -t ed25519 github.com >> '$APP_HOME/.ssh/known_hosts' 2>/dev/null"
if [[ ! -d "$CHECKOUT/.git" ]] && ! as_tgate git ls-remote "$REPO" HEAD >/dev/null 2>&1; then
  echo "Add this key on GitHub: repo Settings > Deploy keys > Add deploy key (leave write access OFF):"
  echo
  cat "$KEY.pub"
  echo
  echo "Then re-run this script with the same options."
  exit 3
fi

log "4/8 code ($BRANCH) and dependencies"
if [[ ! -d "$CHECKOUT/.git" ]]; then
  as_tgate git clone --filter=blob:none --sparse --branch "$BRANCH" "$REPO" "$CHECKOUT"
  as_tgate git -C "$CHECKOUT" sparse-checkout set services/gateway contracts
else
  as_tgate git -C "$CHECKOUT" fetch --quiet origin "$BRANCH"
  as_tgate git -C "$CHECKOUT" checkout --quiet "$BRANCH"
  as_tgate git -C "$CHECKOUT" merge --ff-only --quiet "origin/$BRANCH"
fi
echo "at $(as_tgate git -C "$CHECKOUT" log --oneline -1)"
(cd "$GW" && as_tgate npm ci --no-audit --no-fund --loglevel=error)

log "5/8 .env"
if [[ ! -f "$GW/.env" ]]; then
  as_tgate cp "$GW/.env.example" "$GW/.env"
  echo "created $GW/.env from .env.example (dev placeholders). Edit it: sudo -u tgate nano $GW/.env"
else
  echo "kept existing $GW/.env"
fi
chmod 600 "$GW/.env"
if grep -q '^PHOTON_WEBHOOK_SECRET=dev-photon-webhook-secret-change-me' "$GW/.env"; then
  echo "note: PHOTON_WEBHOOK_SECRET is still the dev placeholder (fine for the simulator; replace it after registering the webhook)"
fi

log "6/8 systemd service"
install -m 644 "$GW/deploy/t-gate-gateway.service" /etc/systemd/system/t-gate-gateway.service
systemctl daemon-reload
systemctl enable --quiet t-gate-gateway
systemctl restart t-gate-gateway

log "7/8 Caddy"
if [[ -n "$HOST" ]]; then
  sed "s/GATEWAY_HOST/$HOST/" "$GW/deploy/Caddyfile" > /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  systemctl reload caddy || systemctl restart caddy
  echo "Caddy serves https://$HOST -> localhost:8787"
else
  echo "skipped (no --host). Re-run with --host <gateway-hostname> once DNS points here."
fi

log "8/8 firewall"
if [[ $USE_UFW -eq 1 ]]; then
  apt-get install -y -qq ufw >/dev/null
  ufw allow OpenSSH >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  ufw status | sed -n '1,8p'
else
  echo "skipped (--ufw not given). Use a Vultr firewall group allowing only 22, 80, 443."
fi

log "health check"
for _ in $(seq 1 15); do
  if curl -fsS localhost:8787/healthz >/dev/null 2>&1; then echo "gateway is up: $(curl -s localhost:8787/healthz)"; break; fi
  sleep 1
done
curl -fsS localhost:8787/healthz >/dev/null 2>&1 || { echo "gateway did not come up; see: journalctl -u t-gate-gateway -n 50" >&2; exit 1; }
if [[ -n "$HOST" ]]; then echo "public check (once the certificate is issued): curl https://$HOST/healthz"; fi
echo "done. (bootstrap dir: $HERE)"
