#!/usr/bin/env bash
# Run ON a Vultr Cloud GPU instance (Ubuntu + NVIDIA drivers) to train the classifier.
#   1. Copy the repo's classifier/ and data/ dirs (or git clone the repo) onto the instance.
#   2. bash classifier/scripts/vultr_gpu_train.sh [--labels category|binary]
#   3. Copy classifier/artifacts/ back, then DESTROY the GPU instance (it bills hourly).
set -euo pipefail
cd "$(dirname "$0")/../.."

nvidia-smi || { echo "No GPU visible; is this a GPU instance?"; exit 1; }
python3 -m venv classifier/.venv
source classifier/.venv/bin/activate
pip install --upgrade pip
pip install -r classifier/requirements-train.txt

python classifier/train.py --device cuda "$@"

echo
echo "Done. From your laptop, copy the model back:"
echo "  scp -r root@<instance-ip>:$(pwd)/classifier/artifacts classifier/"
echo "Then destroy this GPU instance in the Vultr console."
