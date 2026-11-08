"""Train a T-Guard classifier. Three model kinds share the same data, metrics and service:

    --model minilm (default)  frozen MiniLM sentence embeddings + logistic regression.
                              Wants a GPU (runs on the Vultr GPU instance; see README).
    --model tfidf             TF-IDF word/bigram features + logistic regression.
                              CPU only, ~1-3 minutes, no PyTorch needed. The baseline to beat.
    --model stacked           both of the above, each trained on train, then a small LR (the
                              "stacker") on their class log-probabilities, trained on the real
                              val split. Wants a GPU for the MiniLM half. Best SMS F1, calibration
                              and unseen-scam recall in the 2026-11-07 comparison (CHANGELOG.md).

    python classifier/train.py                          # MiniLM, 8-class scam categories
    python classifier/train.py --model tfidf            # TF-IDF + LR
    python classifier/train.py --model stacked          # TF-IDF + MiniLM, stacked
    python classifier/train.py --labels binary          # spam/ham only (any model)
    python classifier/train.py --limit 5000             # quick smoke test

Outputs (in --out, default classifier/artifacts/, never committed):
    model.json          kind, label names, version (read by the service)
    head.joblib         the logistic-regression classifier (for stacked: the stacker)
    vectorizer.joblib   the TF-IDF vectorizer (tfidf, stacked)
    keywords.json       top "words to watch" per scam class (tfidf, stacked)
    tfidf_head.joblib, minilm_head.joblib   the two base models (stacked only)
    metrics.json        val/test metrics on the real splits only, plus suggested thresholds

Stacked caveat: the stacker is fit on val, so its val metrics are in-sample; judge it on test.
Its suggested thresholds come from 5-fold out-of-fold stacker scores on val, not in-sample ones.
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
from sklearn.metrics import (classification_report, f1_score, precision_recall_curve,
                             precision_recall_fscore_support)
from sklearn.model_selection import StratifiedKFold, cross_val_predict

ENCODER = "sentence-transformers/all-MiniLM-L6-v2"
STACK_EPS = 1e-9  # stacker features are log(P + eps); the service reads it from model.json
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


def stack_features(p_tfidf: np.ndarray, p_minilm: np.ndarray) -> np.ndarray:
    """Stacker input: both base models' class log-probabilities side by side (TF-IDF first).
    service/app.py builds the same features; keep the two in sync."""
    return np.hstack([np.log(p_tfidf + STACK_EPS), np.log(p_minilm + STACK_EPS)])


def precision_threshold(is_scam: np.ndarray, scam_prob: np.ndarray, target: float) -> float | None:
    """Lowest P(scam) cutoff whose precision is at least `target` (None if never reached)."""
    prec, _, thr = precision_recall_curve(is_scam, scam_prob)
    ok = np.where(prec[:-1] >= target)[0]
    return round(float(thr[ok[0]]), 4) if len(ok) else None


def scam_vs_ham(true: np.ndarray, pred: np.ndarray) -> dict:
    p, r, f, _ = precision_recall_fscore_support(true != 0, pred != 0, average="binary")
    return {"precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["minilm", "tfidf", "stacked"], default="minilm")
    ap.add_argument("--data", default=str(REPO_ROOT / "data" / "scam_categories_100k_full.csv"))
    ap.add_argument("--labels", choices=["category", "binary"], default="category")
    ap.add_argument("--out", default=str(REPO_ROOT / "classifier" / "artifacts"))
    ap.add_argument("--device", default="auto", help="minilm/stacked only: auto | cuda | mps | cpu")
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
    is_train, is_val, is_test = split == "train", split == "val", split == "test"
    texts = df["message"].tolist()

    use_tfidf = args.model in ("tfidf", "stacked")
    use_minilm = args.model in ("minilm", "stacked")
    device = pick_device(args.device) if use_minilm else "cpu"
    print(f"model={args.model} rows={len(df)} device={device} labels={args.labels}")

    # --- features ---
    t0 = time.time()
    vectorizer = None
    if use_tfidf:
        vectorizer = make_tfidf()
        # Fit the vocabulary on train only, so val/test words never leak into the features.
        vectorizer.fit([t for t, tr in zip(texts, is_train) if tr])
        X_tf = vectorizer.transform(texts)
        print(f"tfidf vocabulary={len(vectorizer.vocabulary_)} terms")
    if use_minilm:
        X_mn = featurize_minilm(texts, device, args.batch_size)
    feat_secs = time.time() - t0
    print(f"featurized {len(df)} messages in {feat_secs:.0f}s")

    # --- base models, each trained on train only ---
    t0 = time.time()
    tf_clf = mn_clf = None
    probs: dict[str, np.ndarray] = {}  # class probabilities for every row, per base model
    if use_tfidf:
        tf_clf = LogisticRegression(max_iter=3000, class_weight="balanced", C=8.0)
        tf_clf.fit(X_tf[is_train], y[is_train])
        probs["tfidf"] = tf_clf.predict_proba(X_tf)
    if use_minilm:
        mn_clf = LogisticRegression(max_iter=3000, class_weight="balanced", C=4.0)
        mn_clf.fit(X_mn[is_train], y[is_train])
        probs["minilm"] = mn_clf.predict_proba(X_mn)

    # --- the served model ---
    val_scam = None  # P(scam) on val used to pick thresholds
    if args.model == "stacked":
        if list(tf_clf.classes_) != list(mn_clf.classes_):
            raise SystemExit("base models saw different classes; cannot stack")
        Z = stack_features(probs["tfidf"], probs["minilm"])
        # Trained on val, not train: the base models fit train closely (and train is 68%
        # synthetic), so their train probabilities would teach the stacker to over-trust them.
        head = LogisticRegression(max_iter=5000, C=1.0).fit(Z[is_val], y[is_val])
        P = head.predict_proba(Z)
        # Thresholds from out-of-fold stacker scores, so they aren't tuned on in-sample output.
        oof = cross_val_predict(LogisticRegression(max_iter=5000, C=1.0), Z[is_val], y[is_val],
                                cv=StratifiedKFold(n_splits=5, shuffle=True, random_state=0),
                                method="predict_proba")
        val_scam = 1.0 - oof[:, list(head.classes_).index(0)]
    else:
        head = tf_clf if args.model == "tfidf" else mn_clf
        P = probs[args.model]
    fit_secs = time.time() - t0
    print(f"fit classifier(s) in {fit_secs:.0f}s")

    classes = np.array(head.classes_)
    ham_col = list(classes).index(0)
    pred_all = classes[P.argmax(1)]
    scam_all = 1.0 - P[:, ham_col]
    if val_scam is None:
        val_scam = scam_all[is_val]

    metrics: dict = {"model": args.model, "featurize_seconds": round(feat_secs, 1),
                     "fit_seconds": round(fit_secs, 1), "device": device}
    if args.model == "stacked":
        metrics["note"] = "stacker trained on val: val metrics are in-sample, judge it on test"
    for name in ("val", "test"):
        mask = split == name
        pred = pred_all[mask]
        true = y[mask]
        sms = style[mask] == "sms"
        # Scam vs ham is what the gateway blocks on, so always report it.
        svh = scam_vs_ham(true, pred)
        m = {
            "n": int(mask.sum()),
            "scam_vs_ham": svh,
            "macro_f1": round(f1_score(true, pred, average="macro"), 4),
            # T-Guard handles SMS, but ~80% of val/test rows are email, so report SMS on its own.
            "sms_scam_vs_ham_f1": round(f1_score(true[sms] != 0, pred[sms] != 0), 4),
            "false_blocks": int(((pred != 0) & (true == 0)).sum()),
            "missed_scams": int(((pred == 0) & (true != 0)).sum()),
            "report": classification_report(
                true, pred, labels=list(range(len(label_names))), target_names=label_names,
                output_dict=True, zero_division=0,
            ),
        }
        if args.model == "stacked":  # each half alone, for comparison
            m["base_models_scam_vs_ham"] = {k: scam_vs_ham(true, classes[v[mask].argmax(1)])
                                            for k, v in probs.items()}
        metrics[name] = m
        print(f"\n== {name} (real rows only, n={mask.sum()}) ==")
        print(f"scam-vs-ham P={svh['precision']:.4f} R={svh['recall']:.4f} F1={svh['f1']:.4f}  "
              f"macro-F1={m['macro_f1']:.4f}  SMS-only scam-vs-ham F1={m['sms_scam_vs_ham_f1']:.4f} "
              f"(n={sms.sum()})  false blocks={m['false_blocks']}  missed scams={m['missed_scams']}")
        if "base_models_scam_vs_ham" in m:
            print(f"base models alone: {json.dumps(m['base_models_scam_vs_ham'])}")
        print(classification_report(true, pred, labels=list(range(len(label_names))),
                                    target_names=label_names, zero_division=0))

    # Suggested cutoffs for the gateway's BLOCK_THRESHOLD. Picked on val, checked on test.
    # Only suggestions: the block policy stays in the gateway.
    suggested = {}
    for target_p in (0.97, 0.99):
        t = precision_threshold(y[is_val] != 0, val_scam, target_p)
        if t is not None:
            p, r, _, _ = precision_recall_fscore_support(y[is_test] != 0, scam_all[is_test] >= t,
                                                         average="binary", zero_division=0)
            suggested[f"precision_{target_p:.2f}"] = {"threshold": t, "test_precision": round(p, 4),
                                                      "test_recall": round(r, 4)}
    metrics["suggested_thresholds"] = suggested
    print(f"suggested thresholds (picked on val, checked on test): {json.dumps(suggested)}")

    files = ["model.json", "head.joblib", "metrics.json"]
    joblib.dump(head, out / "head.joblib")
    meta = {
        "kind": f"{args.model}-lr",
        "model": f"{args.model}-lr-{args.labels}@{args.version}",
        "labels": args.labels,
        "label_names": label_names,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "train_rows": int(is_train.sum()),
    }
    if use_minilm:
        meta["encoder"] = ENCODER
    if args.model == "stacked":
        meta["stack_eps"] = STACK_EPS
        meta["stack_order"] = ["tfidf", "minilm"]
        joblib.dump(tf_clf, out / "tfidf_head.joblib")
        joblib.dump(mn_clf, out / "minilm_head.joblib")
        files += ["tfidf_head.joblib", "minilm_head.joblib"]
    if use_tfidf:
        joblib.dump(vectorizer, out / "vectorizer.joblib")
        # "Words to watch": the terms that push hardest toward each scam class (TF-IDF model).
        vocab = vectorizer.get_feature_names_out()
        keywords = {label_names[k]: [str(vocab[i]) for i in np.argsort(-w)[:15]]
                    for k, w in scam_weight_vectors(tf_clf).items()}
        (out / "keywords.json").write_text(json.dumps(keywords, indent=2))
        files += ["vectorizer.joblib", "keywords.json"]
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (out / "model.json").write_text(json.dumps(meta, indent=2))
    # Drop files a previous run of another model kind left behind, so the service can't mix them.
    for stale in ("vectorizer.joblib", "keywords.json", "tfidf_head.joblib", "minilm_head.joblib"):
        if stale not in files and (out / stale).exists():
            (out / stale).unlink()
    print(f"\nwrote {', '.join(files)} to {out}")


if __name__ == "__main__":
    main()
