#!/usr/bin/env bash
# Train the TF-IDF + LR model on any Linux box: no GPU needed. Easiest place is the Vultr
# inference server itself (README, option B), so the model is already where Docker needs it.
#   bash classifier/scripts/train_tfidf.sh [--labels category|binary]
set -euo pipefail
cd "$(dirname "$0")/../.."

[ -f data/scam_categories_100k_full.csv ] || { echo "Missing data/scam_categories_100k_full.csv"; exit 1; }
python3 -m venv --help >/dev/null 2>&1 || { apt-get update -q && apt-get install -yq python3-venv; }
python3 -m venv classifier/.venv-tfidf
source classifier/.venv-tfidf/bin/activate
pip install -q --upgrade pip
pip install -q -r classifier/requirements-train-tfidf.txt

python classifier/build_splits.py
python classifier/train.py --model tfidf "$@"
echo
echo "Done. Model is in classifier/artifacts/. Next: cd classifier/deploy && docker compose up -d --build"
