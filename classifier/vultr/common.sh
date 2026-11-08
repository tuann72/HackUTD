# shellcheck shell=bash
# Shared helpers for the Vultr scripts. Sourced, not run.
# Uses the Vultr REST API v2 (https://www.vultr.com/api/) with curl + jq, so vultr-cli is optional.
# NOT YET RUN AGAINST A REAL ACCOUNT: read each script before using it.

set -euo pipefail

API="https://api.vultr.com/v2"
# shellcheck disable=SC2034  # used by the scripts that source this file
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ConnectTimeout=10)

die() { echo "error: $*" >&2; exit 1; }
log() { echo "[$(date +%H:%M:%S)] $*" >&2; }

need() { for c in "$@"; do command -v "$c" >/dev/null || die "missing '$c' (brew install $c)"; done; }

require_key() {
  [ -n "${VULTR_API_KEY:-}" ] || die "export VULTR_API_KEY first (Vultr > Account > API). Never commit or paste it."
}

# api METHOD PATH [JSON_BODY] -> response body on stdout. The key goes in a header, never in argv logs.
api() {
  local method=$1 path=$2 body=${3:-}
  local args=(-sS -X "$method" -H "Authorization: Bearer ${VULTR_API_KEY}" -H "Content-Type: application/json"
              -w '\n%{http_code}')
  [ -n "$body" ] && args+=(--data "$body")
  local out code
  out=$(curl "${args[@]}" "${API}${path}") || die "request to ${path} failed"
  code=${out##*$'\n'}
  out=${out%$'\n'*}
  if [ "${code:0:1}" != "2" ]; then
    die "Vultr API ${method} ${path} -> HTTP ${code}: $(echo "$out" | jq -r '.error? // .' 2>/dev/null || echo "$out")"
  fi
  echo "$out"
}

# Newest Ubuntu LTS x64 image id, unless OS_ID is set.
ubuntu_os_id() {
  if [ -n "${OS_ID:-}" ]; then echo "$OS_ID"; return; fi
  api GET "/os?per_page=500" | jq -r '[.os[] | select(.family == "ubuntu" and (.name | test("LTS x64")))]
    | sort_by(.name) | last | .id // empty'
}

# Prints "monthly_cost<TAB>hourly_estimate" for a plan id.
plan_price() {
  api GET "/plans?type=all&per_page=500" | jq -r --arg p "$1" \
    '.plans[] | select(.id == $p) | "\(.monthly_cost)\t\((.monthly_cost / 730 * 1000 | round) / 1000)"'
}

# Plans of a given type actually available in a region, cheapest first.
available_plans() { # TYPE REGION
  local avail
  avail=$(api GET "/regions/$2/availability?type=$1" | jq -c '.available_plans')
  api GET "/plans?type=$1&per_page=500" | jq -r --argjson a "$avail" \
    '[.plans[] | select(.id as $id | $a | index($id))] | sort_by(.monthly_cost) | .[] | "\(.id)\t$\(.monthly_cost)/mo\t\(.ram)MB RAM\t\(.gpu_type // "")"'
}

# Uploads ~/.ssh/id_ed25519.pub once (by name "tgate") and prints its id.
ssh_key_id() {
  local pub=${SSH_PUBKEY:-$HOME/.ssh/id_ed25519.pub}
  [ -f "$pub" ] || die "no SSH public key at $pub (ssh-keygen -t ed25519, or set SSH_PUBKEY)"
  local id
  id=$(api GET "/ssh-keys?per_page=500" | jq -r '.ssh_keys[] | select(.name == "tgate") | .id' | head -n1)
  if [ -z "$id" ]; then
    log "uploading $pub to Vultr as ssh key 'tgate'"
    id=$(api POST /ssh-keys "$(jq -n --arg k "$(cat "$pub")" '{name: "tgate", ssh_key: $k}')" | jq -r '.ssh_key.id')
  fi
  echo "$id"
}

# Asks before anything that costs money, unless YES=1.
confirm() {
  [ "${YES:-0}" = 1 ] && return 0
  read -r -p "$* [type yes] " ans
  [ "$ans" = yes ] || die "aborted"
}

create_instance() { # REGION PLAN LABEL -> instance id
  local os key
  os=$(ubuntu_os_id); [ -n "$os" ] || die "no Ubuntu LTS image found; set OS_ID"
  key=$(ssh_key_id)
  api POST /instances "$(jq -n --arg r "$1" --arg p "$2" --arg l "$3" --argjson os "$os" --arg k "$key" \
    '{region: $r, plan: $p, os_id: $os, label: $l, hostname: $l, sshkey_id: [$k], backups: "disabled"}')" \
    | jq -r '.instance.id'
}

# Waits until the instance is running and SSH answers; prints its IPv4.
wait_ready() { # INSTANCE_ID
  local ip="" status=""
  for _ in $(seq 1 90); do
    read -r status ip < <(api GET "/instances/$1" | jq -r '"\(.instance.server_status) \(.instance.main_ip)"')
    if [ "$status" = ok ] && [ "$ip" != "0.0.0.0" ]; then break; fi
    sleep 10
  done
  [ "$status" = ok ] || die "instance $1 not ready after 15 min (status=$status)"
  for _ in $(seq 1 30); do
    ssh "${SSH_OPTS[@]}" -o BatchMode=yes "root@$ip" true 2>/dev/null && { echo "$ip"; return; }
    sleep 10
  done
  die "instance $1 ($ip) never accepted SSH"
}

delete_instance() { api DELETE "/instances/$1" >/dev/null && log "deleted instance $1"; }
