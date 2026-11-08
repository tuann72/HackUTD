"""Score a trained model on the held-out files, separately from training.

    python classifier/evaluate.py --artifacts classifier/artifacts
    python classifier/evaluate.py --artifacts ... --external path/to/textphish.csv

Runs messages through service/app.py's own code, so the numbers describe what is served: a message
counts as a scam when P(scam) >= 0.5. Writes metrics_test.json next to the model.

Use this once per finished model. Don't tune on these numbers: tune on val in train.py.
--external takes a CSV with columns `message` and `label` (0 = benign, anything else = threat).
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score

REPO_ROOT = Path(__file__).resolve().parent.parent
THREAT_CLASS = 8


def ece(is_scam: np.ndarray, score: np.ndarray, bins: int = 10) -> float:
    idx = np.clip((score * bins).astype(int), 0, bins - 1)
    return float(sum(abs(score[idx == b].mean() - is_scam[idx == b].mean()) * (idx == b).mean()
                     for b in range(bins) if (idx == b).any()))


def binary(y_scam: np.ndarray, score: np.ndarray, cutoff: float) -> dict:
    pred = score >= cutoff
    tp, fp, fn = int((pred & y_scam).sum()), int((pred & ~y_scam).sum()), int((~pred & y_scam).sum())
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return {"precision": round(p, 4), "recall": round(r, 4), "f1": round(2 * p * r / (p + r), 4) if p + r else 0.0,
            "false_blocks": fp, "missed_scams": fn}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifacts", default=str(REPO_ROOT / "classifier" / "artifacts"))
    ap.add_argument("--splits", default=str(REPO_ROOT / "classifier" / "splits"))
    ap.add_argument("--external", default="")
    args = ap.parse_args()
    art, splits = Path(args.artifacts).resolve(), Path(args.splits).resolve()

    os.environ["CLASSIFIER_ARTIFACTS"] = str(art)
    os.environ.setdefault("CLASSIFIER_ALLOW_NO_AUTH", "1")
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from service import app as service

    classes = np.array(service.classes)
    ham_col = service.ham_col

    def score(texts: list[str]) -> tuple[np.ndarray, np.ndarray]:
        probs = np.vstack([service.class_probs(texts[i:i + 512]) for i in range(0, len(texts), 512)])
        return 1.0 - probs[:, ham_col], classes[probs.argmax(1)]

    meta = json.loads((art / "model.json").read_text())
    train_metrics = json.loads((art / "metrics.json").read_text())
    cutoffs = {"0.5": 0.5}
    for name, s in train_metrics.get("suggested_thresholds", {}).items():
        cutoffs[name] = s["threshold"]
    out: dict = {"model": meta["model"]}

    test = pd.read_csv(splits / "test.csv")
    test["message"] = test["message"].fillna("").astype(str)
    y = test["label_class"].to_numpy()
    s, pred = score(test["message"].tolist())
    sms = (test["style"] == "sms").to_numpy()
    out["test"] = {
        "n": len(test), "n_sms": int(sms.sum()),
        "at_cutoff": {k: binary(y != 0, s, c) for k, c in cutoffs.items()},
        "sms_f1": round(f1_score(y[sms] != 0, s[sms] >= 0.5), 4),
        "category_accuracy": round(accuracy_score(y, pred), 4),
        "category_macro_f1": round(f1_score(y, pred, average="macro"), 4),
        "ece": round(ece(y != 0, s), 4),
    }

    te = pd.read_csv(splits / "threat_eval.csv")
    te["message"] = te["message"].fillna("").astype(str)
    yt = te["label_class"].to_numpy()
    st, pt = score(te["message"].tolist())
    th = yt == THREAT_CLASS
    out["threat_eval"] = {
        "n_threats": int(th.sum()), "n_hard_negatives": int((~th).sum()),
        "threats_blocked": round(float((st[th] >= 0.5).mean()), 4),
        "threats_named_correctly": round(float((pt[th] == THREAT_CLASS).mean()), 4),
        "hard_negatives_blocked": round(float((st[~th] >= 0.5).mean()), 4),
    }

    if args.external:
        ex = pd.read_csv(args.external)
        ex["message"] = ex["message"].fillna("").astype(str)
        positive = ex["label"].to_numpy() != 0
        se, pe = score(ex["message"].tolist())
        out["external"] = {
            "n_threats": int(positive.sum()), "n_benign": int((~positive).sum()),
            "threats_blocked": round(float((se[positive] >= 0.5).mean()), 4),
            "threats_named_correctly": round(float((pe[positive] == THREAT_CLASS).mean()), 4),
            "benign_blocked": round(float((se[~positive] >= 0.5).mean()), 4),
        }

    (art / "metrics_test.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
