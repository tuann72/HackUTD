#!/usr/bin/env bash
# Classifier task 2.1, from your laptop, in one command:
#   rent a Vultr Cloud GPU -> copy code + data -> train MiniLM -> copy artifacts back -> DELETE the GPU.
# The GPU is deleted on success, failure or Ctrl-C (trap), unless KEEP_INSTANCE=1.
#
#   export VULTR_API_KEY=...                       # never commit or paste it
#   bash classifier/vultr/train_gpu.sh --list      # GPU plans available in $REGION, with prices
#   GPU_PLAN=<id> bash classifier/vultr/train_gpu.sh [-- --labels binary]
#
# Settings (env), all TBD by the team:
#   REGION     default ewr (New Jersey). GPU stock varies by region; --list shows what's there.
#   GPU_PLAN   required. Pick the cheapest from --list; a fractional A16/A40 is plenty for this.
#   OS_ID      default: newest Ubuntu LTS x64. GPU plans may need Vultr's NVIDIA image instead.
#   YES=1      skip the price confirmation.
# Training runs remotely; nothing heavy runs on your laptop.
# NOT YET RUN AGAINST A REAL ACCOUNT.
source "$(dirname "$0")/common.sh"
need curl jq rsync ssh scp

REGION=${REGION:-ewr}
TRAIN_ARGS=()
LIST=0
while [ $# -gt 0 ]; do
  case $1 in
    --list) LIST=1 ;;
    --) shift; TRAIN_ARGS=("$@"); break ;;
    *) die "unknown argument $1 (train.py args go after --)" ;;
  esac
  shift
done

require_key
if [ "$LIST" = 1 ]; then
  log "GPU plans available in $REGION (cheapest first):"
  available_plans vcg "$REGION"
  exit 0
fi
[ -n "${GPU_PLAN:-}" ] || die "set GPU_PLAN (see: bash classifier/vultr/train_gpu.sh --list)"
[ -f "$REPO_ROOT/data/scam_categories_100k_full.csv" ] || die "missing data/scam_categories_100k_full.csv"

read -r monthly hourly < <(plan_price "$GPU_PLAN") || true
[ -n "${monthly:-}" ] || die "unknown plan $GPU_PLAN"
confirm "Create GPU instance $GPU_PLAN in $REGION (~\$$hourly/hour, billed until deleted; this script deletes it)?"

INSTANCE_ID=$(create_instance "$REGION" "$GPU_PLAN" tgate-train)
[ -n "$INSTANCE_ID" ] && [ "$INSTANCE_ID" != null ] || die "instance create returned no id"
log "created GPU instance $INSTANCE_ID"

cleanup() {
  local code=$?
  if [ "${KEEP_INSTANCE:-0}" = 1 ]; then
    log "KEEP_INSTANCE=1: GPU $INSTANCE_ID is STILL RUNNING AND BILLING. Delete it: vultr-cli instance delete $INSTANCE_ID"
  else
    delete_instance "$INSTANCE_ID" || log "!! could not delete $INSTANCE_ID: delete it in the Vultr console NOW"
  fi
  exit $code
}
trap cleanup EXIT INT TERM

IP=$(wait_ready "$INSTANCE_ID")
log "GPU instance up at $IP"

log "copying classifier/ and training data (~95 MB)"
(cd "$REPO_ROOT" && rsync -aR -e "ssh ${SSH_OPTS[*]}" --exclude '.venv*' --exclude artifacts --exclude __pycache__ \
  classifier/ data/scam_categories_100k_full.csv data/scam_categories.csv "root@$IP:tgate/")

# Install NVIDIA drivers only if the image has none (needs one reboot).
if ! ssh "${SSH_OPTS[@]}" "root@$IP" nvidia-smi >/dev/null 2>&1; then
  log "no NVIDIA driver on the image; installing (one reboot)"
  ssh "${SSH_OPTS[@]}" "root@$IP" 'apt-get update -q && apt-get install -yq ubuntu-drivers-common && ubuntu-drivers install' >&2
  ssh "${SSH_OPTS[@]}" "root@$IP" reboot || true
  sleep 30
  IP=$(wait_ready "$INSTANCE_ID")
fi

log "training (installs packages, then trains; ~10-20 min)"
# shellcheck disable=SC2029  # TRAIN_ARGS are expanded locally on purpose
ssh "${SSH_OPTS[@]}" "root@$IP" "cd tgate && bash classifier/scripts/vultr_gpu_train.sh ${TRAIN_ARGS[*]:-}" >&2

ART="$REPO_ROOT/classifier/artifacts"
if [ -d "$ART" ]; then
  BAK="$ART.bak-$(date +%Y%m%d-%H%M%S)"
  mv "$ART" "$BAK"
  log "kept the previous artifacts in $BAK"
fi
scp "${SSH_OPTS[@]}" -r "root@$IP:tgate/classifier/artifacts" "$REPO_ROOT/classifier/" >&2
log "artifacts copied to classifier/artifacts/ (gitignored; don't commit)"

jq '{model, device, test: {scam_vs_ham: .test.scam_vs_ham, sms_scam_vs_ham_f1: .test.sms_scam_vs_ham_f1, macro_f1: .test.macro_f1}}' \
  "$ART/metrics.json"
echo "Compare test scam_vs_ham.f1 with the TF-IDF baseline (~0.98) and record both in CHANGELOG.md (task 2.1)."
# cleanup() deletes the GPU instance on exit.
