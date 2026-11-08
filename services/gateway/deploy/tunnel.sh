#!/usr/bin/env bash
# Exposes a gateway running on this laptop (npm run dev, port 8787) at a public HTTPS URL,
# so Photon can deliver real iMessages to it. Photon refuses http and localhost; the URL is
# not part of the signature, so no gateway config changes are needed.
#
#   npm run tunnel                # quick tunnel; prints https://<random>.trycloudflare.com
#   PORT=8788 npm run tunnel
#
# Then register https://<random>.trycloudflare.com/webhooks/photon with `npm run photon:webhook -- register ...`
# (quick-tunnel URLs change on every run: delete the old webhook with `photon:webhook -- delete <id>`).
set -euo pipefail
PORT="${PORT:-8787}"
if ! command -v cloudflared >/dev/null; then
  echo "cloudflared is not installed. macOS: brew install cloudflared   (or use: ngrok http $PORT)" >&2
  exit 1
fi
if ! curl -fsS "localhost:$PORT/healthz" >/dev/null 2>&1; then
  echo "warning: nothing answers on localhost:$PORT/healthz yet. Start the gateway: npm run dev" >&2
fi
echo "Webhook URL will be: https://<the trycloudflare.com host printed below>/webhooks/photon"
exec cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT"
