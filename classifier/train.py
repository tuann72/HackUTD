"""Train the T-Gate MiniLM classifier (frozen MiniLM embeddings + logistic regression head).

Runs anywhere; intended to run on a Vultr GPU instance (see classifier/README.md).

    python classifier/train.py                      # 8-class scam categories (default)
    python classifier/train.py --labels binary      # spam/ham only
    python classifier/train.py --limit 5000         # quick smoke test

Outputs (in --out, default classifier/artifacts/, never committed):
    head.joblib     the logistic-regression head
    model.json      encoder name, label names, version (read by the service)
    metrics.json    val/test metrics on the real splits only
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import torch
from sentence_transformers import SentenceTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, f1_score, precision_recall_fscore_support

ENCODER = "sentence-transformers/all-MiniLM-L6-v2"
REPO_ROOT = Path(__file__).resolve().parent.parent


def pick_device(requested: str) -> str:
    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_label_names(labels: str) -> list[str]:
    if labels == "binary":
        return ["Ham", "Scam"]
    cats = pd.read_csv(REPO_ROOT / "data" / "scam_categories.csv").sort_values("label")
    return cats["name"].tolist()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(REPO_ROOT / "data" / "scam_categories_100k_full.csv"))
    ap.add_argument("--labels", choices=["category", "binary"], default="category")
    ap.add_argument("--out", default=str(REPO_ROOT / "classifier" / "artifacts"))
    ap.add_argument("--device", default="auto", help="auto | cuda | mps | cpu")
    ap.add_argument("--batch-size", type=int, default=256)
    ap.add_argument("--limit", type=int, default=0, help="sample N train rows (smoke test)")
    ap.add_argument("--version", default="0.1")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    device = pick_device(args.device)
    target = "label_class" if args.labels == "category" else "is_spam"
    label_names = load_label_names(args.labels)

    df = pd.read_csv(args.data, usecols=["id", "message", target, "split", "style"])
    df["message"] = df["message"].fillna("").astype(str)
    if args.limit:
        train = df[df.split == "train"].sample(n=min(args.limit, (df.split == "train").sum()), random_state=0)
        df = pd.concat([train, df[df.split != "train"]])
    print(f"rows={len(df)} device={device} labels={args.labels}")

    encoder = SentenceTransformer(ENCODER, device=device)
    # MiniLM reads at most this many tokens (~1,000 characters); longer emails are truncated.
    print(f"encoder max_seq_length={encoder.max_seq_length} tokens")
    t0 = time.time()
    X = encoder.encode(
        df["message"].tolist(),
        batch_size=args.batch_size,
        normalize_embeddings=True,
        show_progress_bar=True,
        convert_to_numpy=True,
    )
    encode_secs = time.time() - t0
    print(f"encoded {len(df)} messages in {encode_secs:.0f}s")
    y = df[target].to_numpy()
    split = df["split"].to_numpy()
    style = df["style"].to_numpy()

    clf = LogisticRegression(max_iter=3000, class_weight="balanced", C=4.0)
    clf.fit(X[split == "train"], y[split == "train"])

    metrics: dict = {"encode_seconds": round(encode_secs, 1), "device": device}
    for name in ("val", "test"):
        mask = split == name
        pred = clf.predict(X[mask])
        true = y[mask]
        # Scam vs ham is what the gateway blocks on, so always report it.
        p, r, f, _ = precision_recall_fscore_support(true != 0, pred != 0, average="binary")
        metrics[name] = {
            "n": int(mask.sum()),
            "scam_vs_ham": {"precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4)},
            "macro_f1": round(f1_score(true, pred, average="macro"), 4),
            # T-Gate handles SMS, but ~80% of val/test rows are email, so report SMS on its own.
            "sms_scam_vs_ham_f1": round(f1_score(
                true[style[mask] == "sms"] != 0, pred[style[mask] == "sms"] != 0), 4),
            "report": classification_report(
                true, pred, labels=list(range(len(label_names))), target_names=label_names,
                output_dict=True, zero_division=0,
            ),
        }
        print(f"\n== {name} (real rows only, n={mask.sum()}) ==")
        print(f"scam-vs-ham P={p:.4f} R={r:.4f} F1={f:.4f}  macro-F1={metrics[name]['macro_f1']:.4f}  "
              f"SMS-only scam-vs-ham F1={metrics[name]['sms_scam_vs_ham_f1']:.4f} (n={(style[mask] == 'sms').sum()})")
        print(classification_report(true, pred, labels=list(range(len(label_names))),
                                    target_names=label_names, zero_division=0))

    joblib.dump(clf, out / "head.joblib")
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (out / "model.json").write_text(json.dumps({
        "model": f"minilm-lr-{args.labels}@{args.version}",
        "encoder": ENCODER,
        "labels": args.labels,
        "label_names": label_names,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "train_rows": int((split == "train").sum()),
    }, indent=2))
    print(f"\nwrote {out}/head.joblib, model.json, metrics.json")


if __name__ == "__main__":
    main()
