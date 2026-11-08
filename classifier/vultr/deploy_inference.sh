#!/usr/bin/env bash
# Classifier task 3.1, from your laptop: put the trained classifier online on a Vultr CPU server.
# Docker is built and run ON THE SERVER, never on your laptop.
#
#   export VULTR_API_KEY=...                         # only needed with CREATE=1
#   MODE=shared   HOST=<gateway-vm-ip> bash classifier/vultr/deploy_inference.sh
#   MODE=separate CREATE=1               bash classifier/vultr/deploy_inference.sh
#
# Two layouts (the team still has to pick one; see README "Where the classifier runs"):
#   shared    On the gateway's VM (services/gateway/DEPLOY.md). The container listens on
#             127.0.0.1:8000 only; the gateway calls http://127.0.0.1:8000 with the token, so no
#             public classifier URL and no extra certificate. This is the one-server idea from
#             commit d28ebd5 ("Host the gateway on the classifier's Vultr server"), adapted to the
#             gateway's systemd + host-Caddy setup on main. Needs >= 2 GB RAM (MiniLM on CPU).
#   separate  Its own server with its own Caddy and an sslip.io HTTPS hostname
#             (classifier/deploy/docker-compose.yml, README step 2). The gateway calls it over HTTPS.
#
# Settings (env):
#   MODE       shared | separate (required)
#   HOST       existing server IP (required unless CREATE=1)
#   CREATE=1   create a new CPU server first (REGION, CPU_PLAN); asks before spending unless YES=1
#   REGION     default ewr      CPU_PLAN  default vc2-2c-4gb (~$20/mo; vc2-1c-2gb is the minimum)
# The token is generated ON the server with openssl and never printed; the script says where it is.
# NOT YET RUN AGAINST A REAL ACCOUNT.
source "$(dirname "$0")/common.sh"
need ssh rsync

MODE=${MODE:-}
case $MODE in shared|separate) ;; *) die "set MODE=shared or MODE=separate (see the header of this script)";; esac
[ -f "$REPO_ROOT/classifier/artifacts/model.json" ] || die "no classifier/artifacts/ yet: run train_gpu.sh (or train TF-IDF, README option B) first"

if [ "${CREATE:-0}" = 1 ]; then
  need curl jq
  require_key
  REGION=${REGION:-ewr}
  CPU_PLAN=${CPU_PLAN:-vc2-2c-4gb}
  read -r monthly _ < <(plan_price "$CPU_PLAN") || true
  [ -n "${monthly:-}" ] || die "unknown plan $CPU_PLAN"
  confirm "Create CPU server $CPU_PLAN in $REGION (~\$$monthly/month, stays on until you delete it)?"
  ID=$(create_instance "$REGION" "$CPU_PLAN" tgate-classifier)
  log "created instance $ID; waiting for it"
  HOST=$(wait_ready "$ID")
fi
[ -n "${HOST:-}" ] || die "set HOST=<server ip> or CREATE=1"
R=(ssh "${SSH_OPTS[@]}" "root@$HOST")

log "copying classifier/ (code + artifacts) to $HOST"
(cd "$REPO_ROOT" && rsync -aR -e "ssh ${SSH_OPTS[*]}" --exclude '.venv*' --exclude __pycache__ --exclude deploy/.env \
  classifier/ "root@$HOST:tgate/")

log "installing Docker if missing"
"${R[@]}" 'command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh' >&2

if [ "$MODE" = shared ]; then
  log "building and starting the classifier on 127.0.0.1:8000 (first build ~5 min)"
  "${R[@]}" bash -s >&2 <<'EOF'
set -euo pipefail
install -d -m 700 /etc/tgate
[ -s /etc/tgate/classifier.env ] || { umask 077; echo "CLASSIFIER_TOKEN=$(openssl rand -hex 32)" > /etc/tgate/classifier.env; }
cd ~/tgate/classifier
docker build -q -t tgate-classifier .
docker rm -f tgate-classifier >/dev/null 2>&1 || true
docker run -d --name tgate-classifier --restart unless-stopped \
  --env-file /etc/tgate/classifier.env -p 127.0.0.1:8000:8000 tgate-classifier
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8000/healthz && exit 0; sleep 5; done
echo "classifier did not become healthy; see: docker logs tgate-classifier" >&2; exit 1
EOF
  cat <<EOF

Classifier is up on $HOST at http://127.0.0.1:8000 (not reachable from the internet).
In the gateway's .env on that VM (services/gateway/.env), set:
  CLASSIFIER_URL=http://127.0.0.1:8000
  CLASSIFIER_TOKEN=<the value in /etc/tgate/classifier.env on the VM>
then: sudo systemctl restart t-gate-gateway
EOF
else
  DOMAIN="${HOST//./-}.sslip.io"
  log "starting classifier + Caddy with docker compose for https://$DOMAIN (first build ~5 min)"
  "${R[@]}" DOMAIN="$DOMAIN" bash -s >&2 <<'EOF'
set -euo pipefail
cd ~/tgate/classifier/deploy
if [ ! -s .env ]; then
  umask 077
  printf 'TGATE_DOMAIN=%s\nCLASSIFIER_TOKEN=%s\n' "$DOMAIN" "$(openssl rand -hex 32)" > .env
fi
command -v ufw >/dev/null && ufw allow 80,443/tcp >/dev/null || true
docker compose up -d --build
for i in $(seq 1 30); do curl -fsS "https://$DOMAIN/healthz" && exit 0; sleep 5; done
echo "not healthy over HTTPS yet; see: docker compose logs caddy classifier" >&2; exit 1
EOF
  cat <<EOF

Classifier is up at https://$DOMAIN
In the gateway's .env, set:
  CLASSIFIER_URL=https://$DOMAIN
  CLASSIFIER_TOKEN=<the value in ~/tgate/classifier/deploy/.env on $HOST>
EOF
fi
