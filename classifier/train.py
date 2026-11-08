"""Train a T-Gate classifier. Two model kinds share the same data, metrics and service:

    --model minilm (default)  frozen MiniLM sentence embeddings + logistic regression.
                              Wants a GPU (runs on the Vultr GPU instance; see README).
    --model tfidf             TF-IDF word/bigram features + logistic regression.
                              CPU only, ~1-3 minutes, no PyTorch needed. The baseline to beat.

    python classifier/train.py                          # MiniLM, 8-class scam categories
    python classifier/train.py --model tfidf            # TF-IDF + LR
    python classifier/train.py --labels binary          # spam/ham only (either model)
    python classifier/train.py --limit 5000             # quick smoke test

Outputs (in --out, default classifier/artifacts/, never committed):
    model.json        kind, label names, version (read by the service)
    head.joblib       the logistic-regression classifier
    vectorizer.joblib the TF-IDF vectorizer (tfidf only)
    keywords.json     top "words to watch" per scam class (tfidf only)
    metrics.json      val/test metrics on the real splits only
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
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, f1_score, precision_recall_fscore_support

ENCODER = "sentence-transformers/all-MiniLM-L6-v2"
REPO_ROOT = Path(__file__).resolve().parent.parent


def pick_device(requested: str) -> str:
    import torch

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


def featurize_minilm(texts: list[str], device: str, batch_size: int):
    from sentence_transformers import SentenceTransformer

    encoder = SentenceTransformer(ENCODER, device=device)
    # MiniLM reads at most this many tokens (~1,000 characters); longer emails are truncated.
    print(f"encoder max_seq_length={encoder.max_seq_length} tokens")
    return encoder.encode(texts, batch_size=batch_size, normalize_embeddings=True,
                          show_progress_bar=True, convert_to_numpy=True)


def make_tfidf():
    from sklearn.feature_extraction.text import TfidfVectorizer

    # The service maps highlight spans back to the text with this same token pattern,
    # so keep TOKEN_PATTERN in service/app.py in sync if you change it.
    return TfidfVectorizer(lowercase=True, token_pattern=r"(?u)\b\w\w+\b", ngram_range=(1, 2),
                           min_df=2, max_df=0.9, sublinear_tf=True, max_features=300_000)


def scam_weight_vectors(clf: LogisticRegression) -> dict[int, np.ndarray]:
    """Per scam class k: weights whose dot product with x is the log-odds of k vs Ham."""
    classes = list(clf.classes_)
    if len(classes) == 2:  # binary: coef_ has one row, log-odds of class 1 vs 0
        return {int(classes[1]): clf.coef_[0]}
    ham = classes.index(0)
    return {int(c): clf.coef_[i] - clf.coef_[ham] for i, c in enumerate(classes) if c != 0}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["minilm", "tfidf"], default="minilm")
    ap.add_argument("--data", default=str(REPO_ROOT / "data" / "scam_categories_100k_full.csv"))
    ap.add_argument("--labels", choices=["category", "binary"], default="category")
    ap.add_argument("--out", default=str(REPO_ROOT / "classifier" / "artifacts"))
    ap.add_argument("--device", default="auto", help="minilm only: auto | cuda | mps | cpu")
    ap.add_argument("--batch-size", type=int, default=256)
    ap.add_argument("--limit", type=int, default=0, help="sample N train rows (smoke test)")
    ap.add_argument("--version", default="0.1")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    target = "label_class" if args.labels == "category" else "is_spam"
    label_names = load_label_names(args.labels)

    df = pd.read_csv(args.data, usecols=["id", "message", target, "split", "style"])
    df["message"] = df["message"].fillna("").astype(str)
    if args.limit:
        train = df[df.split == "train"].sample(n=min(args.limit, (df.split == "train").sum()), random_state=0)
        df = pd.concat([train, df[df.split != "train"]])
    y = df[target].to_numpy()
    split = df["split"].to_numpy()
    style = df["style"].to_numpy()
    is_train = split == "train"
    texts = df["message"].tolist()

    device = pick_device(args.device) if args.model == "minilm" else "cpu"
    print(f"model={args.model} rows={len(df)} device={device} labels={args.labels}")

    t0 = time.time()
    vectorizer = None
    if args.model == "minilm":
        X = featurize_minilm(texts, device, args.batch_size)
        clf = LogisticRegression(max_iter=3000, class_weight="balanced", C=4.0)
    else:
        vectorizer = make_tfidf()
        # Fit the vocabulary on train only, so val/test words never leak into the features.
        vectorizer.fit([t for t, tr in zip(texts, is_train) if tr])
        X = vectorizer.transform(texts)
        print(f"tfidf vocabulary={len(vectorizer.vocabulary_)} terms")
        clf = LogisticRegression(max_iter=3000, class_weight="balanced", C=8.0)
    feat_secs = time.time() - t0
    print(f"featurized {len(df)} messages in {feat_secs:.0f}s")

    t0 = time.time()
    clf.fit(X[is_train], y[is_train])
    fit_secs = time.time() - t0
    print(f"fit classifier in {fit_secs:.0f}s")

    metrics: dict = {"model": args.model, "featurize_seconds": round(feat_secs, 1),
                     "fit_seconds": round(fit_secs, 1), "device": device}
    for name in ("val", "test"):
        mask = split == name
        pred = clf.predict(X[mask])
        true = y[mask]
        sms = style[mask] == "sms"
        # Scam vs ham is what the gateway blocks on, so always report it.
        p, r, f, _ = precision_recall_fscore_support(true != 0, pred != 0, average="binary")
        metrics[name] = {
            "n": int(mask.sum()),
            "scam_vs_ham": {"precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4)},
            "macro_f1": round(f1_score(true, pred, average="macro"), 4),
            # T-Gate handles SMS, but ~80% of val/test rows are email, so report SMS on its own.
            "sms_scam_vs_ham_f1": round(f1_score(true[sms] != 0, pred[sms] != 0), 4),
            "report": classification_report(
                true, pred, labels=list(range(len(label_names))), target_names=label_names,
                output_dict=True, zero_division=0,
            ),
        }
        print(f"\n== {name} (real rows only, n={mask.sum()}) ==")
        print(f"scam-vs-ham P={p:.4f} R={r:.4f} F1={f:.4f}  macro-F1={metrics[name]['macro_f1']:.4f}  "
              f"SMS-only scam-vs-ham F1={metrics[name]['sms_scam_vs_ham_f1']:.4f} (n={sms.sum()})")
        print(classification_report(true, pred, labels=list(range(len(label_names))),
                                    target_names=label_names, zero_division=0))

    files = ["model.json", "head.joblib", "metrics.json"]
    joblib.dump(clf, out / "head.joblib")
    meta = {
        "kind": f"{args.model}-lr",
        "model": f"{args.model}-lr-{args.labels}@{args.version}",
        "labels": args.labels,
        "label_names": label_names,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "train_rows": int(is_train.sum()),
    }
    if args.model == "minilm":
        meta["encoder"] = ENCODER
    else:
        joblib.dump(vectorizer, out / "vectorizer.joblib")
        # "Words to watch": the terms that push hardest toward each scam class.
        vocab = vectorizer.get_feature_names_out()
        keywords = {label_names[k]: [str(vocab[i]) for i in np.argsort(-w)[:15]]
                    for k, w in scam_weight_vectors(clf).items()}
        (out / "keywords.json").write_text(json.dumps(keywords, indent=2))
        files += ["vectorizer.joblib", "keywords.json"]
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (out / "model.json").write_text(json.dumps(meta, indent=2))
    # Drop files a previous run of the other model kind left behind, so the service can't mix them.
    for stale in ("vectorizer.joblib", "keywords.json"):
        if stale not in files and (out / stale).exists():
            (out / stale).unlink()
    print(f"\nwrote {', '.join(files)} to {out}")


if __name__ == "__main__":
    main()
